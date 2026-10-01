"""One provider step; authorization, tools, validation and retries belong to the router.

Terminal text remains structured JSON (including clarification/generation offers)
for the existing result validator. No SDK objects or exceptions cross this port.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, replace
from typing import Any, Literal, Protocol

ProviderErrorCode = Literal[
    "configured_unavailable",
    "provider_timeout",
    "provider_error",
    "certificate_error",
    "invalid_output",
    "model_mismatch",
]


@dataclass(frozen=True)
class ProviderMessage:
    role: Literal["user", "assistant"]
    content: str = field(repr=False)


@dataclass(frozen=True)
class ProviderFunctionCall:
    name: str
    arguments: dict[str, Any] = field(repr=False)


@dataclass(frozen=True)
class ProviderFunctionResult:
    call: ProviderFunctionCall
    result: dict[str, Any] = field(repr=False)


@dataclass(frozen=True)
class ProviderRequest:
    system_prompt: str = field(repr=False)
    message: str = field(repr=False)
    context: tuple[ProviderMessage, ...] = field(default=(), repr=False)
    evidence: tuple[dict[str, Any], ...] = field(default=(), repr=False)
    functions: tuple[dict[str, Any], ...] = field(default=(), repr=False)
    generation_offer_allowed: bool = False
    function_results: tuple[ProviderFunctionResult, ...] = field(default=(), repr=False)
    max_tokens: int = 800
    timeout_seconds: float = 20.0
    # Absolute time.monotonic() deadline shared with the router/tool budget.
    deadline: float | None = None
    correlation_id: str | None = None

    def for_attempt(self) -> ProviderRequest:
        """Start one shared budget, including serialization and authentication."""
        deadline = time.monotonic() + min(20.0, self.timeout_seconds)
        if self.deadline is not None:
            deadline = min(deadline, self.deadline)
        return replace(self, deadline=deadline)

    def attempt_timeout(self) -> float:
        remaining = self.deadline - time.monotonic() if self.deadline is not None else 20.0
        return max(0.0, min(20.0, self.timeout_seconds, remaining))

    def user_payload(self) -> str:
        """Untrusted content stays data, never interpolated into system policy."""
        available_skills = [
            {
                "name": function["name"],
                "description": function.get("description", ""),
                "input_schema": function["parameters"],
                "mutating": False,
            }
            for function in self.functions
        ]
        if self.generation_offer_allowed:
            available_skills.append(
                {
                    "name": "generation_offer",
                    "description": (
                        "Предложить генерацию 3D-модели после подтверждения пользователя."
                    ),
                    "input_schema": {"type": "object", "properties": {}},
                    "mutating": True,
                }
            )
        payload = {
            "user_message": self.message,
            "conversation_context": [
                {"role": item.role, "content": item.content} for item in self.context
            ],
            "catalog_evidence": list(self.evidence),
            "available_skills": available_skills,
        }
        if self.function_results and not self.functions:
            payload["tool_results"] = [
                {"name": item.call.name, "result": item.result} for item in self.function_results
            ]
        return json.dumps(payload, ensure_ascii=False, allow_nan=False)


@dataclass(frozen=True)
class ProviderError:
    # Fixed codes only: exception strings/bodies/headers are never returned.
    code: ProviderErrorCode
    retryable: bool = False


@dataclass(frozen=True)
class ProviderTurn:
    kind: Literal["text", "function_call", "error"]
    text: str | None = field(default=None, repr=False)
    function_call: ProviderFunctionCall | None = None
    error: ProviderError | None = None

    @classmethod
    def failed(cls, code: ProviderErrorCode, *, retryable: bool = False) -> ProviderTurn:
        return cls(kind="error", error=ProviderError(code=code, retryable=retryable))


class AssistantProvider(Protocol):
    def complete(self, request: ProviderRequest) -> ProviderTurn:
        """Execute one attempt, with no tool execution or hidden retry loop."""
        ...
