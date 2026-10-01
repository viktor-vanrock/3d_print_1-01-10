import json
import logging
import os
import sys
from pathlib import Path
from uuid import UUID

import httpx
import pytest
import yaml

from giga.assistant import preflight
from giga.assistant.tool_gateway import ToolGatewayConfig


@pytest.fixture(autouse=True)
def _clean_assistant_env(monkeypatch):
    for name in tuple(os.environ):
        if name.startswith(("ASSISTANT_", "GIGACHAT_", "HYPERPC_", "PORTAL_QUEUE_")):
            monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)


def _enabled_env(monkeypatch, tmp_path: Path, provider: str = "gigachat") -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setenv("ASSISTANT_LIFECYCLE_ENABLED", "1")
    monkeypatch.setenv("ASSISTANT_PROVIDER", provider)
    monkeypatch.setenv("ASSISTANT_INTERNAL_API_ORIGIN", "http://api")
    monkeypatch.setenv("ASSISTANT_SERVICE_TOKEN", "x" * 32)
    monkeypatch.setenv("PORTAL_QUEUE_METRICS_DIR", str(tmp_path / "metrics"))


def test_gateway_probe_uses_versioned_uuid_before_testing_lease(monkeypatch) -> None:
    original_client = httpx.Client

    def respond(request: httpx.Request) -> httpx.Response:
        run_id = request.url.path.split("/")[-2]
        assert UUID(run_id).version == 4
        assert request.headers["x-assistant-lease-generation"] == "0"
        return httpx.Response(400)

    monkeypatch.setattr(
        preflight.httpx,
        "Client",
        lambda **kwargs: original_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    preflight._gateway_probe(ToolGatewayConfig("http://api", "x" * 32))


def test_disabled_lifecycle_needs_no_provider_or_gateway(monkeypatch) -> None:
    monkeypatch.setenv("ASSISTANT_LIFECYCLE_ENABLED", "0")
    assert preflight.validate_environment() is False


def test_enabled_gigachat_validates_gateway_model_and_system_ca(monkeypatch, tmp_path) -> None:
    _enabled_env(monkeypatch, tmp_path)
    monkeypatch.setenv("GIGACHAT_CREDENTIALS", "offline-placeholder")
    seen = []

    assert preflight.validate_environment(gateway_probe=lambda config: seen.append(config.origin))
    assert seen == ["http://api"]


def test_enabled_gigachat_names_missing_credential_environment(monkeypatch, tmp_path) -> None:
    _enabled_env(monkeypatch, tmp_path)

    with pytest.raises(preflight.PreflightError) as error:
        preflight.validate_environment(gateway_probe=lambda _config: None)

    assert str(error.value) == (
        "GigaChat credentials are required: set GIGACHAT_CREDENTIALS or both "
        "GIGACHAT_CLIENT_ID and GIGACHAT_API_KEY"
    )


@pytest.mark.parametrize(
    ("missing", "expected"),
    [
        ("ASSISTANT_INTERNAL_API_ORIGIN", "ASSISTANT_INTERNAL_API_ORIGIN"),
        ("ASSISTANT_SERVICE_TOKEN", "ASSISTANT_SERVICE_TOKEN"),
    ],
)
def test_enabled_assistant_names_missing_gateway_environment(
    monkeypatch, tmp_path, missing, expected
) -> None:
    _enabled_env(monkeypatch, tmp_path)
    monkeypatch.delenv(missing)

    with pytest.raises(preflight.PreflightError) as error:
        preflight.validate_environment(gateway_probe=lambda _config: None)

    assert expected in str(error.value)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("ASSISTANT_PROVIDER", "unknown"),
        ("ASSISTANT_INTERNAL_API_ORIGIN", "https://public.example.com"),
        ("ASSISTANT_SERVICE_TOKEN", "short"),
        ("GIGACHAT_VERIFY_SSL_CERTS", "false"),
        ("GIGACHAT_ENVIRONMENT", "unknown"),
        ("ASSISTANT_GIGACHAT_MODEL", "unpinned-model"),
        ("GIGACHAT_CA_BUNDLE_FILE", "/missing/assistant-ca.pem"),
        ("ASSISTANT_POLL_INTERVAL_SECONDS", "nan"),
    ],
)
def test_enabled_lifecycle_rejects_invalid_configuration(
    monkeypatch, tmp_path, name, value
) -> None:
    _enabled_env(monkeypatch, tmp_path)
    monkeypatch.setenv("GIGACHAT_CREDENTIALS", "offline-placeholder")
    monkeypatch.setenv(name, value)

    with pytest.raises(preflight.PreflightError):
        preflight.validate_environment(gateway_probe=lambda _config: None)


def test_hyperpc_is_configuration_only_rollback(monkeypatch, tmp_path) -> None:
    _enabled_env(monkeypatch, tmp_path, provider="hyperpc")
    monkeypatch.setenv("HYPERPC_STRUCTURED_URL", "http://hyperpc.internal:1236")
    seen = []

    assert preflight.validate_environment(
        gateway_probe=lambda _config: None,
        hyperpc_probe=lambda config: seen.append(config.structured_url),
    )
    assert seen == ["http://hyperpc.internal:1236"]


def test_health_requires_fresh_queue_metrics_only_when_enabled(monkeypatch, tmp_path) -> None:
    marker = tmp_path / "preflight.ok"
    metrics_dir = tmp_path / "metrics"
    metrics_dir.mkdir()
    marker.write_text("ok\n", encoding="utf-8")
    metrics = metrics_dir / "giga-assistant.prom"
    metrics.write_text('portal_queue_depth{queue="giga-assistant"} 0\n', encoding="utf-8")
    monkeypatch.setenv("ASSISTANT_PREFLIGHT_MARKER", str(marker))
    monkeypatch.setenv("PORTAL_QUEUE_METRICS_DIR", str(metrics_dir))
    monkeypatch.setenv("ASSISTANT_LIFECYCLE_ENABLED", "1")

    preflight.check_health(max_metrics_age_seconds=60, now=metrics.stat().st_mtime + 30)
    with pytest.raises(preflight.PreflightError):
        preflight.check_health(max_metrics_age_seconds=60, now=metrics.stat().st_mtime + 61)

    monkeypatch.setenv("ASSISTANT_LIFECYCLE_ENABLED", "0")
    metrics.unlink()
    preflight.check_health(max_metrics_age_seconds=60)


def test_worker_values_share_giga_vault_and_production_is_scale_zero() -> None:
    root = Path(__file__).resolve().parents[3]
    dev = yaml.safe_load((root / "envs/dev/giga-assistant-worker.yaml").read_text())
    prod = yaml.safe_load((root / "envs/prod/giga-assistant-worker.yaml").read_text())

    for values in (dev, prod):
        command = " ".join(values["image"]["args"])
        assert "giga.assistant.preflight preflight" in command
        assert "exec giga-assistant-worker" in command
        assert "giga-worker" not in command
        assert "uvicorn" not in command
        assert values["service"] == {"enabled": False, "ports": []}
        assert values["ingress"] == {"enabled": False}
        assert values["configMap"]["config"]["GIGACHAT_VERIFY_SSL_CERTS"] == "true"
        assert values["configMap"]["config"]["ASSISTANT_LIFECYCLE_ENABLED"] == "0"
        assert "livenessProbe" in values and "readinessProbe" in values
        assert (
            values["podAnnotations"]["vault.hashicorp.com/agent-inject-secret-config"]
            == "rndml/aiportal/giga"
        )
        assert (
            'secret "rndml/aiportal/giga"'
            in values["podAnnotations"]["vault.hashicorp.com/agent-inject-template-config"]
        )
    assert dev["replicaCount"] == 1
    assert dev["configMap"]["config"]["GIGACHAT_ENVIRONMENT"] == "ift"
    assert prod["replicaCount"] == 0
    assert prod["configMap"]["config"]["GIGACHAT_ENVIRONMENT"] == "prod"

    deploy = (root / ".deploy.yml").read_text(encoding="utf-8")
    assert "deploy_dev_giga_assistant_worker:" in deploy
    assert "VALUES_PATH: envs/dev/giga-assistant-worker.yaml" in deploy
    assert "deploy_prod_giga_assistant_worker:" in deploy
    assert "VALUES_PATH: envs/prod/giga-assistant-worker.yaml" in deploy


def test_preflight_logs_missing_gigachat_credentials_while_disabled(
    monkeypatch, tmp_path, caplog
) -> None:
    monkeypatch.setenv("ASSISTANT_LIFECYCLE_ENABLED", "0")
    monkeypatch.setenv("ASSISTANT_PREFLIGHT_MARKER", str(tmp_path / "preflight.ok"))
    monkeypatch.setattr(sys, "argv", ["preflight", "preflight"])

    with caplog.at_level(logging.WARNING, logger="giga.assistant.preflight"):
        assert preflight.main() == 0

    assert "GIGACHAT_CLIENT_ID and GIGACHAT_API_KEY" in caplog.text


def test_preflight_does_not_log_credentials_when_pair_is_complete(monkeypatch, caplog) -> None:
    monkeypatch.setenv("GIGACHAT_CLIENT_ID", "sensitive-client")
    monkeypatch.setenv("GIGACHAT_API_KEY", "sensitive-key")

    with caplog.at_level(logging.WARNING, logger="giga.assistant.preflight"):
        preflight.log_missing_gigachat_credentials(os.environ)

    assert not caplog.records


def test_preflight_marker_contains_no_configuration_values(monkeypatch, tmp_path) -> None:
    marker = tmp_path / "preflight.ok"
    monkeypatch.setenv("ASSISTANT_PREFLIGHT_MARKER", str(marker))
    monkeypatch.setenv("ASSISTANT_PROVIDER", "hyperpc")
    preflight.write_marker(True)

    assert json.loads(marker.read_text()) == {
        "lifecycle_enabled": True,
        "provider": "hyperpc",
        "schema": "giga-assistant-preflight.v1",
    }
