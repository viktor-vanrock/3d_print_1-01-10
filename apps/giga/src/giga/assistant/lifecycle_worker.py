from __future__ import annotations

import json
import logging
import multiprocessing
import os
import time
from collections import Counter
from dataclasses import asdict, dataclass
from uuid import uuid4

from portal_queue_lifecycle import (
    ClaimedJob,
    MetricsSink,
    QueueLifecycle,
    QueueWorkerRunner,
    RunOutcome,
    ShutdownController,
    metrics_sink_from_env,
)

from . import hyperpc_client, router
from .config import AssistantWorkerConfig, load_assistant_worker_config
from .gigachat_provider import GigaChatProvider
from .gigachat_provider import load_config as load_gigachat_config
from .hyperpc_provider import HyperpcProvider
from .lifecycle import (
    AssistantFailure,
    AssistantPayload,
    AssistantRepository,
    AssistantSuccess,
    PsycopgTransactionManager,
)
from .provider import AssistantProvider
from .schemas import AssistantError, AssistantGenerationOffer
from .tool_gateway import ToolGateway, ToolGatewayError

logger = logging.getLogger("giga.assistant.lifecycle_worker")
_audit_logger = logging.getLogger("giga.assistant.audit")
_EVIDENCE_CONTRACT = "assistant.evidence.v2"


@dataclass(frozen=True, slots=True)
class AssistantRunObservation:
    provider: str
    model: str
    contract_version: str
    tool_names: tuple[str, ...]
    tool_count: int
    evidence_count: int
    latency_ms: int
    context_truncated: bool
    result_kind: str
    correlation_id: str
    error_code: str | None = None
    retryable: bool | None = None


def _provider_identity(provider: AssistantProvider | None, selected: str) -> tuple[str, str]:
    if isinstance(provider, GigaChatProvider):
        return "gigachat", provider.model_name
    if isinstance(provider, HyperpcProvider):
        return "hyperpc", provider.model_name
    if provider is not None:
        return getattr(provider, "provider_name", "fake"), getattr(provider, "model_name", "test")
    if selected == "gigachat":
        return "gigachat", os.getenv("ASSISTANT_GIGACHAT_MODEL", "GigaChat-3-Pro")
    return "hyperpc", "structured"


def _emit_observation(observation: AssistantRunObservation) -> None:
    record = {"event": "assistant.run.completed.v1", **asdict(observation)}
    # JSON is the actual message so the default process formatter preserves the structure.
    log = _audit_logger.warning if observation.error_code else _audit_logger.info
    log(
        json.dumps(record, ensure_ascii=True, separators=(",", ":"), sort_keys=True),
        extra=record,
    )


def _record_metrics(metrics: MetricsSink | None, observation: AssistantRunObservation) -> None:
    if metrics is None:
        return
    common = {"queue": "giga-assistant", "outcome": observation.result_kind}
    try:
        metrics.increment(
            "portal_assistant_runs_total",
            labels={
                **common,
                "operation": (
                    f"provider:{observation.provider}:{observation.model}:"
                    f"{observation.contract_version}"
                ),
            },
        )
        for tool_name, count in Counter(observation.tool_names).items():
            metrics.increment(
                "portal_assistant_tool_calls_total",
                labels={**common, "operation": f"tool:{tool_name}"},
                value=float(count),
            )
        metrics.gauge(
            "portal_assistant_tool_count",
            observation.tool_count,
            labels={**common, "operation": "tool_count"},
        )
        metrics.gauge(
            "portal_assistant_evidence_count",
            observation.evidence_count,
            labels={**common, "operation": "evidence_count"},
        )
        metrics.gauge(
            "portal_assistant_latency_ms",
            observation.latency_ms,
            labels={**common, "operation": "latency_ms"},
        )
        metrics.increment(
            "portal_assistant_context_total",
            labels={
                **common,
                "operation": f"context_truncated:{str(observation.context_truncated).lower()}",
            },
        )
    except Exception:
        logger.error("assistant observability metrics failed")


def _wait_disabled(reason: str) -> None:
    logger.warning("assistant worker is disabled: %s", reason)
    shutdown = ShutdownController(grace_seconds=0)
    with shutdown.install_signal_handlers():
        shutdown.wait()


def _execute_assistant(
    hyperpc_config: hyperpc_client.HyperpcConfig | None,
    config: AssistantWorkerConfig,
    run_id: str,
    owner_id: str,
    generation: int,
    deadline: float,
    *,
    provider: AssistantProvider | None = None,
    gateway: ToolGateway | None = None,
    on_attempt=None,
    on_observation=None,
) -> AssistantSuccess:
    """Directly testable composition; clients and secrets stay inside the child."""
    started = time.monotonic()
    budget = router.BudgetLedger(deadline=deadline, on_attempt=on_attempt)
    selected = os.getenv("ASSISTANT_PROVIDER", "gigachat")
    context_truncated = False
    correlation_id = run_id
    tool_names: list[str] = []
    try:
        gateway = gateway or ToolGateway.from_env(run_id, owner_id, generation, deadline=deadline)
        attempt = budget.attempt_deadline()
        context = gateway.context()
        context_truncated = context.context_truncated
        correlation_id = context.correlation_id
        budget.finish_attempt(attempt)
        if provider is None:
            if selected == "gigachat":
                provider = GigaChatProvider(load_gigachat_config())
            elif selected == "hyperpc":
                provider = HyperpcProvider(hyperpc_config)
            else:
                raise ValueError("unsupported assistant provider")
        result = router.route_message(
            hyperpc_config,
            context.message.content,
            [],
            provider=provider,
            context=context.provider_context(),
            mode=context.mode,
            scopes=frozenset(context.scopes),
            allowed_tools=frozenset(context.tools),
            execute_tool=gateway.execute,
            on_tool_call=tool_names.append,
            budget=budget,
            max_response_tokens=config.max_response_tokens,
            correlation_id=run_id,
        )
    except ToolGatewayError as exc:
        result = router._tool_error(retryable=exc.retryable)
    except ValueError:
        result = AssistantError(
            code="provider_error",
            message="Контекст или инструмент каталога недоступен.",
            retryable=True,
        )
    except router.BudgetExpired:
        result = router._provider_error("provider_timeout")
    result_payload = result.model_dump()
    if isinstance(result, AssistantGenerationOffer):
        result_payload["offer_id"] = run_id
    success = AssistantSuccess(result_payload)
    provider_name, model_name = _provider_identity(provider, selected)
    observation = AssistantRunObservation(
        provider=provider_name,
        model=model_name,
        contract_version=_EVIDENCE_CONTRACT,
        tool_names=tuple(tool_names),
        tool_count=len(tool_names),
        evidence_count=len(result_payload.get("citations", [])),
        latency_ms=round((time.monotonic() - started) * 1000),
        context_truncated=context_truncated,
        result_kind=str(result_payload["kind"]),
        correlation_id=correlation_id,
        error_code=result_payload.get("code") if result_payload["kind"] == "error" else None,
        retryable=result_payload.get("retryable") if result_payload["kind"] == "error" else None,
    )
    if on_observation is not None:
        on_observation(observation)
    return success


def _child_execute(connection, hyperpc_config, config, run_id, owner_id, generation, deadline):
    try:
        observations: list[AssistantRunObservation] = []
        result = _execute_assistant(
            hyperpc_config,
            config,
            run_id,
            owner_id,
            generation,
            deadline,
            on_attempt=lambda cutoff: connection.send(("deadline", cutoff)),
            on_observation=observations.append,
        )
        connection.send(
            (
                "result",
                {
                    "result": result.result,
                    "observation": asdict(observations[0]),
                },
            )
        )
    except Exception as exc:
        # No exception strings or remote bodies cross IPC or enter logs.
        connection.send(("failure", type(exc).__name__))
    finally:
        connection.close()


def execute_assistant(
    database_url: str,
    hyperpc_config: hyperpc_client.HyperpcConfig | None,
    config: AssistantWorkerConfig,
    job: ClaimedJob[AssistantPayload],
    metrics: MetricsSink | None = None,
) -> AssistantSuccess:
    """Kill and join synchronous SDK/API work before returning on lease loss/timeout.

    Spawn is deliberate: QueueWorkerRunner calls this from a thread, where fork
    would inherit live DB/client locks. No DB connection/client/token Event crosses
    the boundary; only config, identity scalars, deadlines and serialized results.
    """
    del database_url  # Database access belongs only to the queue lifecycle.
    logger.info("assistant run started run_id=%s", job.payload.run_id)
    started = time.monotonic()
    deadline = started + 45.0
    cutoff = deadline
    budget = router.BudgetLedger(deadline=deadline, lease_lost=lambda: job.token.lease_lost)
    budget.check()
    process_context = multiprocessing.get_context("spawn")
    receiver, sender = process_context.Pipe(duplex=False)
    process = process_context.Process(
        target=_child_execute,
        args=(
            sender,
            hyperpc_config,
            config,
            job.payload.run_id,
            job.token.owner_id,
            job.token.lease_generation,
            deadline,
        ),
        name="assistant-bounded-run",
    )
    process.start()
    sender.close()
    result = None
    observation = None
    try:
        while result is None:
            budget.check()
            if time.monotonic() >= cutoff:
                raise router.BudgetExpired("assistant attempt exhausted")
            if receiver.poll(min(0.02, max(0.0, cutoff - time.monotonic()))):
                try:
                    kind, value = receiver.recv()
                except EOFError:
                    logger.error(
                        "assistant child exited run_id=%s exit_code=%s",
                        job.payload.run_id,
                        process.exitcode,
                    )
                    raise RuntimeError("assistant child exited without result") from None
                budget.check()
                if kind == "deadline":
                    cutoff = min(deadline, value)
                elif kind == "result":
                    if isinstance(value, dict) and "result" in value:
                        result = AssistantSuccess(value["result"])
                        observation = AssistantRunObservation(**value["observation"])
                    else:
                        # Compatibility for process-control fixtures that predate observations.
                        result = AssistantSuccess(value)
                else:
                    logger.error(
                        "assistant child failed run_id=%s error_type=%s",
                        job.payload.run_id,
                        value,
                    )
                    raise RuntimeError("assistant child failed")
            elif not process.is_alive():
                logger.error(
                    "assistant child exited run_id=%s exit_code=%s",
                    job.payload.run_id,
                    process.exitcode,
                )
                raise RuntimeError("assistant child exited without result")
        budget.check()
    except router.BudgetExpired:
        result = AssistantSuccess(router._provider_error("provider_timeout").model_dump())
    finally:
        # No provider/tool call may survive the handler returning to the queue.
        if process.is_alive():
            process.terminate()
        process.join(timeout=1.0)
        if process.is_alive():
            process.kill()
            process.join()
        receiver.close()
        process.close()
    if job.token.lease_lost:
        raise router.LeaseLost("assistant lease lost")
    if observation is None:
        selected = os.getenv("ASSISTANT_PROVIDER", "gigachat")
        provider_name, model_name = _provider_identity(None, selected)
        observation = AssistantRunObservation(
            provider=provider_name,
            model=model_name,
            contract_version=_EVIDENCE_CONTRACT,
            tool_names=(),
            tool_count=0,
            evidence_count=len(result.result.get("citations", [])),
            latency_ms=round((time.monotonic() - started) * 1000),
            context_truncated=False,
            result_kind=str(result.result["kind"]),
            correlation_id=job.payload.run_id,
            error_code=result.result.get("code") if result.result["kind"] == "error" else None,
            retryable=result.result.get("retryable") if result.result["kind"] == "error" else None,
        )
    _emit_observation(observation)
    _record_metrics(metrics, observation)
    return result


def classify_assistant_failure(
    error: Exception,
    job: ClaimedJob[AssistantPayload],
) -> AssistantFailure:
    logger.error(
        "assistant worker failed run_id=%s error_type=%s",
        job.payload.run_id,
        type(error).__name__,
    )
    # Provider timeouts and invalid provider responses are normal AssistantResult(kind=error)
    # values. Exceptions here are worker failures and keep the existing terminal policy.
    return AssistantFailure("assistant worker failed", retryable=False)


def run_loop() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = load_assistant_worker_config()
    if config is None:
        _wait_disabled("DATABASE_URL is not configured")
        return
    if not config.lifecycle_enabled:
        _wait_disabled("ASSISTANT_LIFECYCLE_ENABLED is not set to 1")
        return
    _run_enabled(config, hyperpc_client.load_config())


def _run_enabled(
    config: AssistantWorkerConfig,
    hyperpc_config: hyperpc_client.HyperpcConfig | None,
) -> None:
    shutdown = ShutdownController(config.shutdown_grace_seconds)
    metrics = metrics_sink_from_env("giga-assistant")
    lifecycle = QueueLifecycle(
        queue="giga-assistant",
        transactions=PsycopgTransactionManager(config.database_url),
        repository=AssistantRepository(max_attempts=config.max_attempts),
        metrics=metrics,
    )
    runner = QueueWorkerRunner(
        lifecycle,
        owner_id=f"assistant-{uuid4()}",
        lease_seconds=int(config.lease_seconds),
        heartbeat_interval_seconds=config.heartbeat_interval_seconds,
        shutdown=shutdown,
    )
    with shutdown.install_signal_handlers():
        while not shutdown.requested:
            outcome = runner.run_once(
                lambda job: execute_assistant(
                    config.database_url,
                    hyperpc_config,
                    config,
                    job,
                    metrics,
                ),
                classify_assistant_failure,
            )
            if outcome in {RunOutcome.IDLE, RunOutcome.STOPPED}:
                shutdown.wait(config.poll_interval_seconds)
            elif outcome is RunOutcome.DRAIN_EXPIRED:
                return
            snapshot = lifecycle.collect_metrics()
            if outcome is not RunOutcome.IDLE:
                logger.info(
                    "assistant queue metrics outcome=%s depth=%d oldest_age_seconds=%.3f "
                    "expired_leases=%d counters=%s",
                    outcome.value,
                    snapshot.waiting_depth,
                    snapshot.oldest_waiting_age_seconds,
                    snapshot.expired_leases,
                    metrics.counters(),
                )
