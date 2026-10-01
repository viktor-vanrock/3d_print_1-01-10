"""Rollback adapter over the existing structured HYPERPC slot."""

from __future__ import annotations

import json
from dataclasses import replace

import httpx

from . import hyperpc_client
from .provider import ProviderFunctionCall, ProviderRequest, ProviderTurn


class HyperpcProvider:
    def __init__(self, config: hyperpc_client.HyperpcConfig | None) -> None:
        self._config = config

    @property
    def model_name(self) -> str:
        return "structured"

    def complete(self, request: ProviderRequest) -> ProviderTurn:
        if self._config is None:
            return ProviderTurn.failed("configured_unavailable")
        request = request.for_attempt()
        timeout = request.attempt_timeout()
        if timeout <= 0:
            return ProviderTurn.failed("provider_timeout", retryable=True)
        # The router owns the single shared retry budget. Do not inherit the
        # legacy client's environment-configured multi-attempt loop.
        config = replace(self._config, max_retries=0, timeout_seconds=timeout)
        try:
            payload = json.loads(request.user_payload())
            if request.function_results:
                payload["tool_results"] = [
                    {
                        "name": item.call.name,
                        "arguments": item.call.arguments,
                        "result": item.result,
                    }
                    for item in request.function_results
                ]
                payload["tool_call_used"] = True
            text = hyperpc_client.chat_structured(
                config,
                request.system_prompt,
                json.dumps(payload, ensure_ascii=False, allow_nan=False),
                max_tokens=min(800, request.max_tokens),
                deadline=request.deadline,
            )
        except (TypeError, ValueError, KeyError):
            return ProviderTurn.failed("invalid_output")
        except hyperpc_client.HyperpcTimeoutError:
            return ProviderTurn.failed("provider_timeout", retryable=True)
        except hyperpc_client.HyperpcError as exc:
            cause = exc.__cause__
            status = cause.response.status_code if isinstance(cause, httpx.HTTPStatusError) else 0
            return ProviderTurn.failed(
                "provider_error", retryable=status == 429 or 500 <= status < 600
            )
        # Preserve terminal structured output for router validation, including
        # its existing fenced-JSON handling and generation confirmation path.
        candidate = text.strip()
        if candidate.startswith("```") and candidate.endswith("```"):
            candidate = candidate[3:-3].removeprefix("json").strip()
        try:
            result = json.loads(candidate)
        except ValueError:
            return ProviderTurn(kind="text", text=text)
        if isinstance(result, dict) and result.get("kind") == "tool_call":
            name, arguments = result.get("skill"), result.get("args")
            if (
                not isinstance(name, str)
                or name not in {function["name"] for function in request.functions}
                or not isinstance(arguments, dict)
            ):
                return ProviderTurn.failed("invalid_output")
            return ProviderTurn(
                kind="function_call",
                function_call=ProviderFunctionCall(name=name, arguments=arguments),
            )
        return ProviderTurn(kind="text", text=text)
