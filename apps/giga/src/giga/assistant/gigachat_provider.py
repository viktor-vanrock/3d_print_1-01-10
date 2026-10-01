"""Assistant-only GigaChat native functions; deliberately separate from generation.

Pinned SDK/model contract: docs/runbooks/giga-assistant-provider-contract.md.
An offline adapter does not satisfy the environment's opt-in activation probe.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import ssl
from dataclasses import dataclass, field
from typing import Any

import httpx
from gigachat import GigaChat
from gigachat.exceptions import ResponseError
from gigachat.models import Chat, Function, FunctionCall, Messages, MessagesRole

from .provider import ProviderFunctionCall, ProviderRequest, ProviderTurn

logger = logging.getLogger("giga.assistant.gigachat_provider")

APPROVED_MODEL = "GigaChat-3-Pro"
EXPECTED_RESPONSE_MODEL = "GigaChat-3-Pro:32.4.30.3"
TERMINAL_RESPONSE_FORMAT = {
    "type": "json_schema",
    "schema": {
        "type": "object",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["answer", "clarification", "generation_offer", "out_of_scope"],
            },
            "text": {"type": "string"},
            "citation_ids": {"type": "array", "items": {"type": "string"}},
            "question": {"type": "string"},
            "reason": {"type": "string"},
            "branch": {"type": "string"},
            "prompt_summary": {"type": "string"},
            "note": {"type": "string"},
        },
        "required": ["kind"],
        "additionalProperties": False,
    },
    "strict": True,
}
GIGACHAT_ENDPOINTS = {
    "ift": (
        "https://gigachat.ift.sberdevices.ru/v1",
        "https://gigachat.ift.sberdevices.ru/v1/token",
    ),
    "prod": (
        "https://api.giga.chat/v1",
        "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    ),
}


class ProviderConfigurationError(ValueError):
    """Only fixed safe reasons, never configuration values."""


@dataclass(frozen=True)
class GigaChatProviderConfig:
    credentials: str = field(repr=False)
    environment: str = "ift"
    model: str = APPROVED_MODEL
    expected_response_model: str = EXPECTED_RESPONSE_MODEL
    scope: str = "GIGACHAT_API_CORP"
    ca_bundle_file: str | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        if not self.credentials:
            raise ProviderConfigurationError("missing credentials")
        if self.environment not in GIGACHAT_ENDPOINTS:
            raise ProviderConfigurationError("unsupported GigaChat environment")
        if self.model != APPROVED_MODEL or not self.expected_response_model:
            raise ProviderConfigurationError("invalid pinned model configuration")
        if self.scope not in {"GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"}:
            raise ProviderConfigurationError("unsupported API scope")

    @property
    def base_url(self) -> str:
        return GIGACHAT_ENDPOINTS[self.environment][0]

    @property
    def auth_url(self) -> str:
        return GIGACHAT_ENDPOINTS[self.environment][1]


def load_config() -> GigaChatProviderConfig | None:
    """Read only dedicated secret names. Missing credentials are unavailable."""
    if os.getenv("GIGACHAT_VERIFY_SSL_CERTS", "true").strip().lower() not in {
        "1",
        "true",
        "yes",
    }:
        raise ProviderConfigurationError("TLS verification is required")
    credentials = os.getenv("GIGACHAT_CREDENTIALS")
    if not credentials:
        client_id, api_key = os.getenv("GIGACHAT_CLIENT_ID"), os.getenv("GIGACHAT_API_KEY")
        if not client_id or not api_key:
            return None
        credentials = base64.b64encode(f"{client_id}:{api_key}".encode()).decode()
    return GigaChatProviderConfig(
        credentials=credentials,
        environment=os.getenv("GIGACHAT_ENVIRONMENT", "ift").strip().lower(),
        model=os.getenv("ASSISTANT_GIGACHAT_MODEL", APPROVED_MODEL),
        expected_response_model=os.getenv(
            "ASSISTANT_GIGACHAT_EXPECTED_RESPONSE_MODEL", EXPECTED_RESPONSE_MODEL
        ),
        scope=os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_CORP"),
        ca_bundle_file=os.getenv("GIGACHAT_CA_BUNDLE_FILE") or None,
    )


def _certificate_failure(exc: BaseException) -> bool:
    seen: set[int] = set()
    while id(exc) not in seen:
        seen.add(id(exc))
        if isinstance(exc, ssl.SSLError) or "CERTIFICATE_VERIFY_FAILED" in str(exc):
            return True
        cause = exc.__cause__ or exc.__context__
        if cause is None:
            break
        exc = cause
    return False


def _project_scalar(spec: dict[str, Any]) -> dict[str, Any]:
    annotations = {
        "title",
        "default",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "minLength",
        "maxLength",
        "pattern",
    }
    if set(spec) - {"type", "description", "enum"} - annotations:
        raise ValueError("unsupported function property schema")
    if spec.get("type") not in {"string", "integer", "number", "boolean"}:
        raise ValueError("unsupported function property type")
    if "enum" in spec and (
        spec["type"] != "string"
        or not isinstance(spec["enum"], list)
        or not spec["enum"]
        or not all(isinstance(value, str) for value in spec["enum"])
    ):
        raise ValueError("unsupported function enum")
    return {key: value for key, value in spec.items() if key not in annotations}


def project_function(function: dict[str, Any]) -> dict[str, Any]:
    """Wire schema for flat scalar parameters and arrays of scalar items only.

    Scalar bounds/defaults remain authoritative in the router/API validator.
    Array cardinality is retained explicitly: the SDK property model drops it.
    Reject references, unions and nested containers rather than weaken them.
    """
    if set(function) - {
        "name",
        "description",
        "parameters",
        "few_shot_examples",
        "return_parameters",
    }:
        raise ValueError("unsupported function fields")
    schema = function["parameters"]
    if not isinstance(schema, dict) or schema.get("type") != "object":
        raise ValueError("function parameters must be an object")
    if set(schema) - {"type", "properties", "required", "title", "description"}:
        raise ValueError("unsupported parameter schema")
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        raise ValueError("function properties must be an object")
    projected: dict[str, Any] = {}
    array_bounds: dict[str, dict[str, int]] = {}
    for name, spec in properties.items():
        if not isinstance(name, str) or not isinstance(spec, dict):
            raise ValueError("invalid function property")
        if spec.get("type") != "array":
            projected[name] = _project_scalar(spec)
            continue
        if set(spec) - {"type", "description", "items", "minItems", "maxItems", "title", "default"}:
            raise ValueError("unsupported array schema")
        items = spec.get("items")
        if not isinstance(items, dict):
            raise ValueError("array items must be a scalar schema")
        bounds = {key: spec[key] for key in ("minItems", "maxItems") if key in spec}
        if any(type(value) is not int or value < 0 for value in bounds.values()):
            raise ValueError("invalid array bounds")
        if bounds.get("minItems", 0) > bounds.get("maxItems", float("inf")):
            raise ValueError("invalid array bounds")
        projected[name] = {"type": "array", "items": _project_scalar(items)}
        if "description" in spec:
            projected[name]["description"] = spec["description"]
        array_bounds[name] = bounds
    required = schema.get("required", [])
    if not isinstance(required, list) or any(
        not isinstance(name, str) or name not in properties for name in required
    ):
        raise ValueError("invalid required properties")
    payload = {
        "name": function["name"],
        "description": function.get("description"),
        "parameters": {"type": "object", "properties": projected, "required": required},
    }
    for optional in ("few_shot_examples", "return_parameters"):
        if optional in function and function[optional]:
            payload[optional] = function[optional]
    wire = Function.model_validate(payload).model_dump(by_alias=True, exclude_none=True)
    for name, bounds in array_bounds.items():
        wire["parameters"]["properties"][name].update(bounds)
    return wire


def _remaining_timeout(request: ProviderRequest) -> float:
    timeout = request.attempt_timeout()
    if timeout <= 0:
        raise httpx.TimeoutException("assistant deadline exhausted")
    return timeout


class GigaChatProvider:
    def __init__(self, config: GigaChatProviderConfig | None) -> None:
        self._config = config

    @property
    def model_name(self) -> str:
        return self._config.model if self._config is not None else APPROVED_MODEL

    def complete(self, request: ProviderRequest) -> ProviderTurn:
        config = self._config
        if config is None:
            return ProviderTurn.failed("configured_unavailable")
        request = request.for_attempt()
        timeout = request.attempt_timeout()
        if timeout <= 0:
            return ProviderTurn.failed("provider_timeout", retryable=True)
        phase = "oauth"
        try:
            context = ssl.create_default_context()
            if config.ca_bundle_file:
                context.load_verify_locations(cafile=config.ca_bundle_file)
        except (OSError, ValueError):
            return ProviderTurn.failed("certificate_error")
        try:
            messages = [
                Messages(role=MessagesRole.SYSTEM, content=request.system_prompt),
                Messages(role=MessagesRole.USER, content=request.user_payload()),
            ]
            for item in request.function_results if request.functions else ():
                messages.extend(
                    [
                        Messages(
                            role=MessagesRole.ASSISTANT,
                            function_call=FunctionCall(
                                name=item.call.name, arguments=item.call.arguments
                            ),
                        ),
                        Messages(
                            role=MessagesRole.FUNCTION,
                            name=item.call.name,
                            content=json.dumps(item.result, ensure_ascii=False, allow_nan=False),
                        ),
                    ]
                )
            payload = Chat(
                model=config.model,
                messages=messages,
                # SDK FunctionParametersProperty drops array cardinality.
                # additional_fields is the SDK's supported wire-field path;
                # leave typed functions unset so it cannot overwrite this list.
                additional_fields={
                    "functions": [project_function(item) for item in request.functions]
                }
                if request.functions
                else None,
                function_call="auto" if request.functions else "none",
                response_format=None if request.functions else TERMINAL_RESPONSE_FORMAT,
                max_tokens=min(800, request.max_tokens),
                temperature=0.0,
                stream=False,
            )
        except (TypeError, ValueError, KeyError):
            return ProviderTurn.failed("invalid_output")
        try:
            # Separate OAuth and chat to recompute the shared remaining budget.
            # The token-only chat client has no auth credentials, so the SDK's
            # cached-token 401 replay is disabled. Empty values block SDK env
            # fallback (the pinned SDK drops None constructor arguments).
            options = dict(
                scope=config.scope,
                base_url=config.base_url,
                auth_url=config.auth_url,
                model=config.model,
                verify_ssl_certs=True,
                ssl_context=context,
                ca_bundle_file="",
                user="",
                password="",
                cert_file="",
                key_file="",
                key_file_password="",
                max_retries=0,
            )
            with GigaChat(
                **options,
                credentials=config.credentials,
                access_token="",
                timeout=_remaining_timeout(request),
            ) as auth_client:
                token = auth_client.get_token()
            if token is None or not token.access_token:
                logger.warning(
                    "assistant GigaChat request failed run_id=%s phase=oauth reason=empty_token",
                    request.correlation_id,
                )
                return ProviderTurn.failed("provider_error")
            phase = "chat"
            with GigaChat(
                **options,
                credentials="",
                access_token=token.access_token,
                timeout=_remaining_timeout(request),
            ) as client:
                completion = client.chat(payload)
            _remaining_timeout(request)
        except Exception as exc:
            logger.warning(
                "assistant GigaChat request failed run_id=%s phase=%s error_type=%s status_code=%s",
                request.correlation_id,
                phase,
                type(exc).__name__,
                exc.status_code if isinstance(exc, ResponseError) else None,
            )
            if _certificate_failure(exc):
                return ProviderTurn.failed("certificate_error")
            if isinstance(exc, httpx.TimeoutException):
                return ProviderTurn.failed("provider_timeout", retryable=True)
            if isinstance(exc, ResponseError):
                return ProviderTurn.failed(
                    "provider_error",
                    retryable=exc.status_code == 429 or 500 <= exc.status_code < 600,
                )
            return ProviderTurn.failed("provider_error")
        try:
            if completion.model != config.expected_response_model:
                return ProviderTurn.failed("model_mismatch")
            if len(completion.choices) != 1:
                return ProviderTurn.failed("invalid_output")
            choice = completion.choices[0]
            call = choice.message.function_call
            if choice.finish_reason == "function_call":
                if (
                    call is None
                    or call.name not in {item["name"] for item in request.functions}
                    or not isinstance(call.arguments, dict)
                ):
                    return ProviderTurn.failed("invalid_output")
                return ProviderTurn(
                    kind="function_call",
                    function_call=ProviderFunctionCall(name=call.name, arguments=call.arguments),
                )
            content = choice.message.content
            if (
                call is not None
                or choice.finish_reason != "stop"
                or not isinstance(content, str)
                or not content.strip()
            ):
                return ProviderTurn.failed("invalid_output")
            return ProviderTurn(kind="text", text=content)
        except (AttributeError, TypeError, ValueError, KeyError):
            return ProviderTurn.failed("invalid_output")
