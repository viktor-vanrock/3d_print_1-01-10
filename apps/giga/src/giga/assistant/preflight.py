"""Fail-closed deployment checks for the standalone assistant worker.

The preflight runs before ``giga-assistant-worker`` starts, so an enabled
workload cannot claim a queue row with an invalid gateway/provider setup.
It intentionally validates configuration and bounded health endpoints only;
the opt-in live GigaChat contract probe remains a separate release gate.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import ssl
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from . import hyperpc_client
from .config import AssistantWorkerConfig, load_assistant_worker_config
from .gigachat_provider import ProviderConfigurationError
from .gigachat_provider import load_config as load_gigachat_config
from .tool_gateway import ToolGatewayConfig

_DEFAULT_MARKER = "/tmp/giga-assistant-health/preflight.ok"
_PROBE_RUN_ID = "00000000-0000-4000-8000-000000000000"
logger = logging.getLogger("giga.assistant.preflight")


class PreflightError(RuntimeError):
    """A fixed, credential-safe deployment configuration failure."""


GatewayProbe = Callable[[ToolGatewayConfig], None]
ProviderProbe = Callable[[hyperpc_client.HyperpcConfig], None]


def _enabled(environ: Mapping[str, str]) -> bool:
    value = environ.get("ASSISTANT_LIFECYCLE_ENABLED", "0")
    if value not in {"0", "1"}:
        raise PreflightError("ASSISTANT_LIFECYCLE_ENABLED must be 0 or 1")
    return value == "1"


def _validate_worker_config(config: AssistantWorkerConfig | None) -> AssistantWorkerConfig:
    if config is None:
        raise PreflightError("DATABASE_URL is required when assistant lifecycle is enabled")
    if (
        not all(
            math.isfinite(value)
            for value in (
                config.poll_interval_seconds,
                config.lease_seconds,
                config.heartbeat_interval_seconds,
                config.shutdown_grace_seconds,
            )
        )
        or config.poll_interval_seconds <= 0
        or config.lease_seconds < 45
        or config.max_attempts < 1
        or not 1 <= config.max_response_tokens <= 800
        or config.heartbeat_interval_seconds <= 0
        or config.heartbeat_interval_seconds > config.lease_seconds / 3
        or config.shutdown_grace_seconds < 0
    ):
        raise PreflightError("assistant worker timing or budget configuration is invalid")
    return config


def _validate_metrics_directory(environ: Mapping[str, str]) -> Path:
    raw = environ.get("PORTAL_QUEUE_METRICS_DIR", "")
    path = Path(raw)
    if not raw or not path.is_absolute():
        raise PreflightError("PORTAL_QUEUE_METRICS_DIR must be an absolute path")
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".preflight-write-check"
        probe.write_text("ok\n", encoding="utf-8")
        probe.unlink()
    except OSError:
        raise PreflightError("assistant metrics directory is not writable") from None
    return path


def _gateway_probe(config: ToolGatewayConfig) -> None:
    """Prove route reachability and the shared token without touching a real run.

    The deliberately invalid lease generation reaches the guarded controller and
    must return 400. A bad token returns 401, and an absent route returns 404.
    """

    url = config.origin.rstrip("/") + f"/internal/assistant/v1/runs/{_PROBE_RUN_ID}/context"
    try:
        with httpx.Client(trust_env=False, follow_redirects=False, timeout=5.0) as client:
            response = client.get(
                url,
                headers={
                    "x-assistant-service-token": config.service_token,
                    "x-assistant-lease-owner": "assistant-preflight",
                    "x-assistant-lease-generation": "0",
                    "x-correlation-id": "assistant-preflight",
                },
            )
    except httpx.HTTPError:
        raise PreflightError("assistant internal gateway is unreachable") from None
    if response.status_code != 400:
        raise PreflightError(
            f"assistant internal gateway token or route check failed (HTTP {response.status_code})"
        )


def _validate_hyperpc_url(value: str) -> None:
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme in {"http", "https"}
            and bool(parsed.hostname)
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
        )
    except ValueError:
        valid = False
    if not valid:
        raise PreflightError("HYPERPC structured URL is invalid")


def _hyperpc_probe(config: hyperpc_client.HyperpcConfig) -> None:
    try:
        with httpx.Client(trust_env=False, follow_redirects=False, timeout=5.0) as client:
            response = client.get(f"{config.structured_url.rstrip('/')}/v1/models")
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        raise PreflightError("HYPERPC structured provider health check failed") from None
    models = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(models, list) or not models:
        raise PreflightError("HYPERPC structured provider has no model")


def _validate_gigachat() -> None:
    try:
        config = load_gigachat_config()
        if config is None:
            raise PreflightError(
                "GigaChat credentials are required: set GIGACHAT_CREDENTIALS or both "
                "GIGACHAT_CLIENT_ID and GIGACHAT_API_KEY"
            )
        context = ssl.create_default_context()
        if config.ca_bundle_file:
            bundle = Path(config.ca_bundle_file)
            if not bundle.is_file():
                raise PreflightError("GigaChat CA bundle file is unavailable")
            context.load_verify_locations(cafile=bundle)
    except PreflightError:
        raise
    except (ProviderConfigurationError, OSError, ValueError):
        raise PreflightError("GigaChat model, endpoint or CA configuration is invalid") from None


def log_missing_gigachat_credentials(environ: Mapping[str, str]) -> None:
    """Report absent provider credentials even when the lifecycle is disabled."""
    if environ.get("ASSISTANT_PROVIDER", "gigachat") != "gigachat":
        return
    if environ.get("GIGACHAT_CREDENTIALS") or (
        environ.get("GIGACHAT_CLIENT_ID") and environ.get("GIGACHAT_API_KEY")
    ):
        return
    logger.warning(
        "Assistant GigaChat credentials are missing: set GIGACHAT_CREDENTIALS or both "
        "GIGACHAT_CLIENT_ID and GIGACHAT_API_KEY"
    )


def validate_environment(
    *,
    gateway_probe: GatewayProbe = _gateway_probe,
    hyperpc_probe: ProviderProbe = _hyperpc_probe,
) -> bool:
    """Validate enabled deployment configuration; return lifecycle state."""

    env = os.environ
    if not _enabled(env):
        return False
    try:
        config = _validate_worker_config(load_assistant_worker_config())
    except (TypeError, ValueError):
        raise PreflightError("assistant worker numeric configuration is invalid") from None
    if not config.lifecycle_enabled:
        raise PreflightError("assistant lifecycle configuration is inconsistent")
    _validate_metrics_directory(env)
    missing_gateway = tuple(
        name
        for name in ("ASSISTANT_INTERNAL_API_ORIGIN", "ASSISTANT_SERVICE_TOKEN")
        if not env.get(name)
    )
    if missing_gateway:
        raise PreflightError(
            "assistant internal gateway requires environment variables: "
            + ", ".join(missing_gateway)
        )
    try:
        gateway = ToolGatewayConfig(
            env.get("ASSISTANT_INTERNAL_API_ORIGIN", ""),
            env.get("ASSISTANT_SERVICE_TOKEN", ""),
        )
    except ValueError:
        raise PreflightError(
            "ASSISTANT_INTERNAL_API_ORIGIN or ASSISTANT_SERVICE_TOKEN is invalid"
        ) from None
    gateway_probe(gateway)

    provider = env.get("ASSISTANT_PROVIDER", "gigachat")
    if provider == "gigachat":
        _validate_gigachat()
    elif provider == "hyperpc":
        hyperpc = hyperpc_client.load_config()
        if hyperpc is None:
            raise PreflightError("HYPERPC structured provider is not configured")
        _validate_hyperpc_url(hyperpc.structured_url)
        hyperpc_probe(hyperpc)
    else:
        raise PreflightError("ASSISTANT_PROVIDER must be gigachat or hyperpc")
    return True


def _marker_path(environ: Mapping[str, str]) -> Path:
    return Path(environ.get("ASSISTANT_PREFLIGHT_MARKER", _DEFAULT_MARKER))


def write_marker(enabled: bool, environ: Mapping[str, str] | None = None) -> None:
    env = os.environ if environ is None else environ
    marker = _marker_path(env)
    if not marker.is_absolute():
        raise PreflightError("ASSISTANT_PREFLIGHT_MARKER must be an absolute path")
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(
            json.dumps(
                {
                    "schema": "giga-assistant-preflight.v1",
                    "lifecycle_enabled": enabled,
                    "provider": env.get("ASSISTANT_PROVIDER", "gigachat"),
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
    except OSError:
        raise PreflightError("assistant preflight marker is not writable") from None


def check_health(
    environ: Mapping[str, str] | None = None,
    *,
    max_metrics_age_seconds: float,
    now: float | None = None,
) -> None:
    env = os.environ if environ is None else environ
    marker = _marker_path(env)
    if not marker.is_file():
        raise PreflightError("assistant preflight marker is missing")
    if not _enabled(env):
        return
    metrics_dir = Path(env.get("PORTAL_QUEUE_METRICS_DIR", ""))
    metrics = metrics_dir / "giga-assistant.prom"
    try:
        age = (time.time() if now is None else now) - metrics.stat().st_mtime
        content = metrics.read_text(encoding="utf-8")
    except OSError:
        raise PreflightError("assistant queue metrics are unavailable") from None
    if age < 0 or age > max_metrics_age_seconds or "portal_queue_" not in content:
        raise PreflightError("assistant queue metrics are stale or invalid")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="giga assistant deployment preflight")
    parser.add_argument("command", choices=("preflight", "health"))
    parser.add_argument("--max-metrics-age-seconds", type=float, default=120.0)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "preflight":
            log_missing_gigachat_credentials(os.environ)
            enabled = validate_environment()
            write_marker(enabled)
            print(f"assistant preflight passed: lifecycle_enabled={enabled}", flush=True)
        else:
            if args.max_metrics_age_seconds <= 0:
                raise PreflightError("metrics age must be positive")
            check_health(max_metrics_age_seconds=args.max_metrics_age_seconds)
    except PreflightError as exc:
        print(f"assistant preflight failed: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
