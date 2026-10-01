import multiprocessing
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from portal_queue_lifecycle import (
    Acquisition,
    ClaimedJob,
    ClaimToken,
    InMemoryMetricsSink,
    Outcome,
    QueueWorkerRunner,
    RunOutcome,
    ShutdownController,
)

from giga.assistant import lifecycle_worker, router
from giga.assistant.config import load_assistant_worker_config
from giga.assistant.lifecycle import AssistantPayload
from giga.assistant.lifecycle_worker import classify_assistant_failure, execute_assistant
from giga.assistant.provider import ProviderTurn
from giga.assistant.tool_gateway import RunContext


def test_assistant_entrypoint_has_no_legacy_queue_fallback() -> None:
    root = Path(__file__).resolve().parents[1]
    pyproject = (root / "pyproject.toml").read_text(encoding="utf-8")
    source = (root / "src/giga/assistant/lifecycle_worker.py").read_text(encoding="utf-8")

    assert 'giga-assistant-worker = "giga.assistant.lifecycle_worker:run_loop"' in pyproject
    assert "QueueWorkerRunner(" in source
    assert "AssistantRepository(" in source
    assert "run_legacy_loop" not in source
    assert "_wait_disabled(" in source
    assert not (root / "src/giga/assistant/worker.py").exists()


def load_assistant_worker_config_from_values():
    from giga.assistant.config import AssistantWorkerConfig

    return AssistantWorkerConfig(
        database_url="postgres://unused",
        poll_interval_seconds=0.1,
        lease_seconds=90,
        heartbeat_interval_seconds=10,
        shutdown_grace_seconds=30,
        max_attempts=3,
        max_response_tokens=800,
        lifecycle_enabled=True,
    )


def test_assistant_lifecycle_requires_explicit_enable(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setenv("ASSISTANT_LIFECYCLE_ENABLED", "1")

    config = load_assistant_worker_config()

    assert config is not None
    assert config.lifecycle_enabled is True
    assert config.max_attempts == 3
    assert config.heartbeat_interval_seconds <= config.lease_seconds / 3


def test_worker_exceptions_keep_existing_terminal_error_policy() -> None:
    failure = classify_assistant_failure(
        RuntimeError("boom"),
        None,  # type: ignore[arg-type]
    )

    assert failure.error == "assistant worker failed"
    assert failure.retryable is False


def test_inner_composition_uses_api_identity_context_and_offer_id(monkeypatch):
    seen = []
    observations = []

    class Gateway:
        def context(self):
            return RunContext(
                run_id="run-42",
                thread_id="thread-1",
                message={"id": "msg-1", "content": "сделай 3d подставку"},
                mode="global",
                scopes=["generation:propose"],
                tools=[],
                context=[],
                context_truncated=False,
                context_omitted_turns=0,
                correlation_id="run-42",
            )

        def execute(self, *_):
            raise AssertionError("must not call tools")

    class Provider:
        provider_name = "fake-provider"
        model_name = "fake-model"

        def complete(self, request):
            seen.append(request)
            return ProviderTurn(
                kind="text",
                text='{"kind":"generation_offer","branch":"openscad","prompt_summary":"stand"}',
            )

    result = lifecycle_worker._execute_assistant(
        None,
        load_assistant_worker_config_from_values(),
        "run-42",
        "owner-1",
        1,
        time.monotonic() + 45,
        gateway=Gateway(),
        provider=Provider(),
        on_observation=observations.append,
    )
    assert result.result["offer_id"] == "run-42"
    assert not seen[0].functions
    assert seen[0].message == "сделай 3d подставку"
    assert observations[0].provider == "fake-provider"
    assert observations[0].model == "fake-model"
    assert observations[0].contract_version == "assistant.evidence.v2"
    assert observations[0].tool_count == 0
    assert observations[0].evidence_count == 0
    assert observations[0].context_truncated is False
    assert observations[0].result_kind == "generation_offer"
    assert observations[0].correlation_id == "run-42"


def test_assistant_observation_emits_safe_metrics_and_structured_log(caplog):
    observation = lifecycle_worker.AssistantRunObservation(
        provider="gigachat",
        model="GigaChat-3-Pro",
        contract_version="assistant.evidence.v2",
        tool_names=("search_printers", "get_printer"),
        tool_count=2,
        evidence_count=1,
        latency_ms=123,
        context_truncated=True,
        result_kind="answer",
        correlation_id="safe-correlation-id",
    )
    metrics = InMemoryMetricsSink()

    with caplog.at_level("INFO", logger="giga.assistant.audit"):
        lifecycle_worker._emit_observation(observation)
    lifecycle_worker._record_metrics(metrics, observation)

    assert '"provider":"gigachat"' in caplog.text
    assert '"model":"GigaChat-3-Pro"' in caplog.text
    assert '"contract_version":"assistant.evidence.v2"' in caplog.text
    assert '"tool_names":["search_printers","get_printer"]' in caplog.text
    assert '"correlation_id":"safe-correlation-id"' in caplog.text
    assert "prompt" not in caplog.text
    assert "thread" not in caplog.text
    values = {
        (sample.name, dict(sample.labels)["operation"]): sample.value
        for sample in (*metrics.counters(), *metrics.gauges())
    }
    assert values[("portal_assistant_tool_calls_total", "tool:search_printers")] == 1
    assert values[("portal_assistant_tool_calls_total", "tool:get_printer")] == 1
    assert values[("portal_assistant_tool_count", "tool_count")] == 2
    assert values[("portal_assistant_evidence_count", "evidence_count")] == 1
    assert values[("portal_assistant_latency_ms", "latency_ms")] == 123


def _hanging_child(connection, *_args):
    connection.send(("deadline", time.monotonic() + 0.15))
    time.sleep(30)
    connection.send(("result", {"kind": "answer", "text": "late", "citations": []}))


def _waiting_child(connection, *_args):
    connection.send(("deadline", time.monotonic() + 20))
    time.sleep(30)


def _job():
    return ClaimedJob(
        token=ClaimToken("run-42", "owner-1", 1),
        payload=AssistantPayload("run-42", "thread-1", "user-1", "P1S"),
        attempts=1,
        lease_expires_at=datetime.now(UTC),
    )


def test_spawned_attempt_is_terminated_and_joined_before_timeout_result(monkeypatch):
    monkeypatch.setattr(lifecycle_worker, "_child_execute", _hanging_child)
    before = {p.pid for p in multiprocessing.active_children()}
    started = time.monotonic()
    result = execute_assistant("unused", None, load_assistant_worker_config_from_values(), _job())
    assert result.result["code"] == "provider_timeout"
    assert time.monotonic() - started < 10
    assert {p.pid for p in multiprocessing.active_children()} == before


def test_lease_loss_terminates_child_and_queue_has_no_terminal_write(monkeypatch):
    monkeypatch.setattr(lifecycle_worker, "_child_execute", _waiting_child)
    job = _job()
    writes = []

    class Lifecycle:
        def reclaim_expired(self, *_):
            return Acquisition(Outcome.EMPTY)

        def claim(self, *_):
            return Acquisition(Outcome.APPLIED, job)

        def heartbeat(self, *_):
            return Outcome.APPLIED

        def succeed(self, *_):
            writes.append("succeed")
            return Outcome.APPLIED

        def fail(self, *_):
            writes.append("fail")
            return Outcome.APPLIED

    before = {p.pid for p in multiprocessing.active_children()}
    runner = QueueWorkerRunner(
        Lifecycle(),
        owner_id="owner-1",
        lease_seconds=90,
        heartbeat_interval_seconds=1,
        shutdown=ShutdownController(30),
    )
    timer = threading.Timer(0.5, job.token.mark_lease_lost)
    timer.start()
    try:
        outcome = runner.run_once(
            lambda claimed: execute_assistant(
                "unused", None, load_assistant_worker_config_from_values(), claimed
            ),
            classify_assistant_failure,
        )
    finally:
        timer.join()
    assert outcome == RunOutcome.STALE
    assert writes == []
    assert {p.pid for p in multiprocessing.active_children()} == before


def test_already_lost_lease_does_not_spawn():
    job = _job()
    job.token.mark_lease_lost()
    with pytest.raises(router.LeaseLost):
        execute_assistant("unused", None, load_assistant_worker_config_from_values(), job)
