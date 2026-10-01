"""Opt-in non-production verification of the GigaChat assistant contract.

The live test is skipped unless ``RUN_GIGACHAT_CONTRACT_PROBE=1``.  It never
prints credentials, access tokens, endpoint values, response bodies or raw
exceptions.  Unit tests in this module run offline and lock that fail-closed
behaviour before the probe is used by an operator.
"""

from __future__ import annotations

import base64
import logging
import os
import ssl
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest
from gigachat import GigaChat
from gigachat.models import Chat, Messages, MessagesRole
from gigachat.models.chat import ChatFunctionCall

from giga.assistant.gigachat_provider import (
    GigaChatProviderConfig,
    ProviderConfigurationError,
    load_config,
    project_function,
)
from giga.assistant.router import _function_schema
from giga.assistant.skills import SKILL_REGISTRY

_RUN_FLAG = "RUN_GIGACHAT_CONTRACT_PROBE"
_TIMEOUT_SECONDS = 20.0
_CONFIG_ENV_NAMES = (
    "GIGACHAT_CREDENTIALS",
    "GIGACHAT_CLIENT_ID",
    "GIGACHAT_API_KEY",
    "GIGACHAT_SCOPE",
    "GIGACHAT_ENVIRONMENT",
    "GIGACHAT_CA_BUNDLE_FILE",
    "GIGACHAT_VERIFY_SSL_CERTS",
    "ASSISTANT_GIGACHAT_MODEL",
    "ASSISTANT_GIGACHAT_EXPECTED_RESPONSE_MODEL",
)

_CATALOG_SKILL = SKILL_REGISTRY["search_printers"]
# Validate precisely every fixed SDK wire schema used by the deployed adapter.
_FUNCTION_SPECS = tuple(
    project_function(_function_schema(skill)) for skill in SKILL_REGISTRY.values()
)
_FUNCTION_SPEC = next(item for item in _FUNCTION_SPECS if item["name"] == "search_printers")


class _ProbeConfigurationError(RuntimeError):
    """Safe configuration failure whose message contains no environment values."""


def _load_probe_config() -> GigaChatProviderConfig:
    """Use the adapter's policy; probe failures contain no supplied values."""
    try:
        config = load_config()
    except ProviderConfigurationError:
        raise _ProbeConfigurationError("invalid provider configuration; details=redacted") from None
    if config is None:
        raise _ProbeConfigurationError("missing provider configuration; details=redacted")
    if config.ca_bundle_file:
        try:
            ca_exists = Path(config.ca_bundle_file).is_file()
        except OSError:
            ca_exists = False
        if not ca_exists:
            raise _ProbeConfigurationError("CA bundle must reference a file; details=redacted")
    return config


def _ssl_context(config: GigaChatProviderConfig) -> ssl.SSLContext:
    context = ssl.create_default_context()
    if config.ca_bundle_file:
        context.load_verify_locations(cafile=config.ca_bundle_file)
    return context


def _safe_call[ResultT](step: str, action: Callable[[], ResultT]) -> ResultT:
    """Run a probe step without allowing provider details into pytest output."""

    try:
        return action()
    except Exception as exc:
        raise AssertionError(
            f"GigaChat contract probe step failed: {step}; "
            f"error_type={type(exc).__name__}; details=redacted"
        ) from None


def _validate_function_schemas(
    config: GigaChatProviderConfig, context: ssl.SSLContext, access_token: str
) -> None:
    def request(function: dict) -> None:
        response = httpx.post(
            f"{config.base_url.rstrip('/')}/functions/validate",
            headers={"Authorization": f"Bearer {access_token}"},
            json=function,
            timeout=_TIMEOUT_SECONDS,
            verify=context,
        )
        if response.status_code != 200:
            raise RuntimeError("function validation returned non-200")
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("function validation returned a non-object")
        if payload.get("status") != 200 or payload.get("message") != "Function is valid":
            raise RuntimeError("function validation rejected the schema")
        warnings = payload.get("warnings", [])
        if warnings not in (None, []):
            raise RuntimeError("function validation returned warnings")

    for function in _FUNCTION_SPECS:
        _safe_call("functions_validate", lambda function=function: request(function))


def _verify_native_function_call(client: GigaChat, config: GigaChatProviderConfig) -> None:
    function = project_function(_FUNCTION_SPEC)
    request = Chat(
        model=config.model,
        messages=[
            Messages(
                role=MessagesRole.SYSTEM,
                content="Используй только переданную функцию и не отвечай обычным текстом.",
            ),
            Messages(role=MessagesRole.USER, content="Найди принтер Bambu Lab P1S."),
        ],
        additional_fields={"functions": [function]},
        function_call=ChatFunctionCall(name=function["name"]),
        max_tokens=64,
        stream=False,
    )
    completion = _safe_call("native_function_call", lambda: client.chat(request))
    if completion.model != config.expected_response_model:
        raise AssertionError(
            "GigaChat contract probe step failed: exact_model_identity; details=redacted"
        )
    if not completion.choices:
        raise AssertionError("GigaChat contract probe step failed: empty_choices; details=redacted")
    choice = completion.choices[0]
    function_call = choice.message.function_call
    if choice.finish_reason != "function_call" or function_call is None:
        raise AssertionError(
            "GigaChat contract probe step failed: function_call_shape; details=redacted"
        )
    if function_call.name != function["name"] or not isinstance(function_call.arguments, dict):
        raise AssertionError(
            "GigaChat contract probe step failed: function_call_payload; details=redacted"
        )
    if not isinstance(function_call.arguments.get("query"), str):
        raise AssertionError(
            "GigaChat contract probe step failed: function_call_arguments; details=redacted"
        )


def _clear_probe_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for variable_name in _CONFIG_ENV_NAMES:
        monkeypatch.delenv(variable_name, raising=False)


def test_safe_call_does_not_echo_provider_error() -> None:
    secret = "do-not-print-this-token"

    def fail() -> None:
        raise RuntimeError(f"provider error containing {secret}")

    with pytest.raises(AssertionError) as error:
        _safe_call("unit", fail)

    assert secret not in str(error.value)
    assert "details=redacted" in str(error.value)


def test_probe_rejects_disabled_tls_verification(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GIGACHAT_VERIFY_SSL_CERTS", "false")

    with pytest.raises(
        _ProbeConfigurationError, match="invalid provider configuration; details=redacted"
    ):
        _load_probe_config()


def test_probe_accepts_split_oauth_names_without_persisting_composed_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_probe_environment(monkeypatch)
    monkeypatch.setenv("GIGACHAT_CLIENT_ID", "test-client")
    monkeypatch.setenv("GIGACHAT_API_KEY", "test-secret")
    monkeypatch.setenv("GIGACHAT_VERIFY_SSL_CERTS", "true")

    config = _load_probe_config()

    assert config.credentials == base64.b64encode(b"test-client:test-secret").decode()
    assert "GIGACHAT_CREDENTIALS" not in os.environ


def test_probe_rejects_unknown_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_probe_environment(monkeypatch)
    monkeypatch.setenv("GIGACHAT_CREDENTIALS", "test-credential")
    monkeypatch.setenv("GIGACHAT_ENVIRONMENT", "unknown")

    with pytest.raises(
        _ProbeConfigurationError, match="invalid provider configuration; details=redacted"
    ):
        _load_probe_config()


@pytest.mark.skipif(
    os.getenv(_RUN_FLAG) != "1",
    reason=f"live GigaChat probe is opt-in; set {_RUN_FLAG}=1 in non-production only",
)
def test_gigachat_model_functions_and_ca_contract_live() -> None:
    config = _load_probe_config()
    context = _safe_call("ca_trust", lambda: _ssl_context(config))
    previous_log_disable = logging.root.manager.disable
    logging.disable(logging.CRITICAL)
    client: GigaChat | None = None
    try:
        client = _safe_call(
            "client_init",
            lambda: GigaChat(
                credentials=config.credentials,
                scope=config.scope,
                base_url=config.base_url,
                auth_url=config.auth_url,
                model=config.model,
                timeout=_TIMEOUT_SECONDS,
                verify_ssl_certs=True,
                ssl_context=context,
                max_retries=0,
            ),
        )
        models = _safe_call("models", client.get_models)
        if config.model not in {model.id_ for model in models.data}:
            raise AssertionError(
                "GigaChat contract probe step failed: approved_model_unavailable; details=redacted"
            )

        token = _safe_call("oauth", client.get_token)
        if token is None or not token.access_token:
            raise AssertionError("GigaChat contract probe step failed: oauth; details=redacted")

        _validate_function_schemas(config, context, token.access_token)
        _verify_native_function_call(client, config)
    finally:
        if client is not None:
            _safe_call("client_close", client.close)
        logging.disable(previous_log_disable)


def test_probe_uses_exact_deployed_schema_projection():
    assert _FUNCTION_SPEC == project_function(_function_schema(_CATALOG_SKILL))
    assert {item["name"] for item in _FUNCTION_SPECS} == set(SKILL_REGISTRY)
    assert set(_FUNCTION_SPEC["parameters"]["properties"]) == {
        "query",
        "limit",
        "requested_fields",
    }


def test_probe_and_runtime_reject_same_environment_configuration(monkeypatch):
    _clear_probe_environment(monkeypatch)
    monkeypatch.setenv("GIGACHAT_CREDENTIALS", "secret-credential")
    monkeypatch.setenv("GIGACHAT_ENVIRONMENT", "custom-url-is-forbidden")
    with pytest.raises(ProviderConfigurationError):
        load_config()
    with pytest.raises(_ProbeConfigurationError) as error:
        _load_probe_config()
    assert str(error.value) == "invalid provider configuration; details=redacted"
    assert "custom-url-is-forbidden" not in str(error.value)
    assert error.value.__suppress_context__ is True


def test_probe_returns_runtime_configuration_without_duplicate_policy(monkeypatch):
    _clear_probe_environment(monkeypatch)
    monkeypatch.setenv("GIGACHAT_CREDENTIALS", "test-credential")
    assert _load_probe_config() == load_config()
    assert isinstance(_load_probe_config(), GigaChatProviderConfig)


def test_probe_missing_credentials_is_redacted_configuration_error(monkeypatch):
    _clear_probe_environment(monkeypatch)
    assert load_config() is None
    with pytest.raises(_ProbeConfigurationError, match="missing provider configuration"):
        _load_probe_config()


def test_probe_missing_ca_file_fails_before_network(monkeypatch, tmp_path):
    _clear_probe_environment(monkeypatch)
    monkeypatch.setenv("GIGACHAT_CREDENTIALS", "test-credential")
    path = tmp_path / "private-missing-ca.pem"
    monkeypatch.setenv("GIGACHAT_CA_BUNDLE_FILE", str(path))
    assert load_config().ca_bundle_file == str(path)
    with pytest.raises(_ProbeConfigurationError) as error:
        _load_probe_config()
    assert str(error.value) == "CA bundle must reference a file; details=redacted"
    assert str(path) not in str(error.value)
