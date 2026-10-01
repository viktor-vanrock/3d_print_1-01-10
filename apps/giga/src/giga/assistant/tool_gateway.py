"""Run/lease-bound reads to one configured private API origin, without redirects."""

from __future__ import annotations

import ipaddress
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import quote, urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .provider import ProviderMessage
from .schemas import EvidenceCitation
from .skills import READ_INPUTS, AssistantMode

logger = logging.getLogger("giga.assistant.tool_gateway")


class ToolGatewayError(Exception):
    def __init__(self, *, retryable: bool = False) -> None:
        super().__init__("assistant internal API unavailable")
        self.retryable = retryable


class GatewayModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ContextMessage(GatewayModel):
    id: str
    content: str = Field(min_length=1, max_length=4000)


class ContextTurn(GatewayModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=12000)


class RunContext(GatewayModel):
    run_id: str
    thread_id: str
    message: ContextMessage
    mode: AssistantMode
    scopes: list[str]
    tools: list[str]
    context: list[ContextTurn] = Field(max_length=16)
    context_truncated: bool
    context_omitted_turns: int = Field(ge=0)
    correlation_id: str

    def provider_context(self) -> tuple[ProviderMessage, ...]:
        return tuple(ProviderMessage(role=t.role, content=t.content) for t in self.context)


class NewsPeriod(GatewayModel):
    from_: str = Field(alias="from")
    to: str
    defaulted: bool
    bounded: bool
    date_basis: Literal["portal_published_at"]


class MaterialTemperatureStats(GatewayModel):
    median_listed_min_c: float | None
    median_listed_max_c: float | None
    sample_count: int = Field(ge=0)


class MaterialEnclosureStats(GatewayModel):
    required_count: int = Field(ge=0)
    not_required_count: int = Field(ge=0)
    unknown_count: int = Field(ge=0)


class MaterialFamilyStats(GatewayModel):
    material_type: str = Field(min_length=1, max_length=100)
    published_products: int = Field(ge=0)
    nozzle_temp_c: MaterialTemperatureStats
    bed_temp_c: MaterialTemperatureStats
    enclosure: MaterialEnclosureStats


class MaterialComparison(GatewayModel):
    families: list[MaterialFamilyStats] = Field(min_length=2, max_length=4)


class ToolResult(GatewayModel):
    resolution: Literal["resolved", "ambiguous", "not_found", "data_quality_conflict"]
    evidence: list[EvidenceCitation] = Field(max_length=10)
    period: NewsPeriod | None = None
    material_comparison: MaterialComparison | None = None


class ToolResponse(GatewayModel):
    run_id: str
    tool: str
    result: ToolResult
    correlation_id: str


@dataclass(frozen=True)
class ToolGatewayConfig:
    origin: str
    service_token: str = field(repr=False)

    def __post_init__(self) -> None:
        try:
            url = urlsplit(self.origin)
            hostname = url.hostname or ""
            try:
                address = ipaddress.ip_address(hostname)
                private = (
                    address.is_loopback
                    or address
                    in ipaddress.ip_network("fc00::/7" if address.version == 6 else "10.0.0.0/8")
                    or (
                        address.version == 4
                        and (
                            address in ipaddress.ip_network("172.16.0.0/12")
                            or address in ipaddress.ip_network("192.168.0.0/16")
                        )
                    )
                )
            except ValueError:
                private = bool(re.fullmatch(r"[a-zA-Z0-9.-]+", hostname)) and (
                    "." not in hostname
                    or hostname.endswith((".internal", ".svc", ".svc.cluster.local", ".localhost"))
                )
            valid = (
                private
                and url.scheme in {"http", "https"}
                and url.port != 0
                and not url.username
                and not url.password
                and url.path in {"", "/"}
                and not url.query
                and not url.fragment
                and 32 <= len(self.service_token) <= 512
                and bool(self.service_token.strip())
                and not re.search(r"[\r\n]", self.service_token)
            )
        except ValueError:
            valid = False
        if not valid:
            raise ValueError("assistant API requires a configured private origin and service token")


class ToolGateway:
    def __init__(
        self,
        config: ToolGatewayConfig,
        run_id: str,
        owner_id: str,
        generation: int,
        *,
        deadline: float,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if (
            not run_id
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", owner_id)
            or generation < 1
        ):
            raise ValueError("invalid assistant lease identity")
        self.config = config
        self.run_id = run_id
        self.owner_id = owner_id
        self.generation = generation
        self.deadline = deadline
        self.transport = transport

    def _log_failure(
        self,
        suffix: str,
        reason: str,
        *,
        status_code: int | None = None,
        error_type: str | None = None,
    ) -> None:
        stage, _, tool_name = suffix.partition("/")
        logger.warning(
            "assistant internal API failed run_id=%s stage=%s tool=%s reason=%s "
            "status_code=%s error_type=%s",
            self.run_id,
            stage,
            tool_name or None,
            reason,
            status_code,
            error_type,
        )

    @classmethod
    def from_env(
        cls, run_id: str, owner_id: str, generation: int, *, deadline: float
    ) -> ToolGateway:
        return cls(
            ToolGatewayConfig(
                os.getenv("ASSISTANT_INTERNAL_API_ORIGIN", ""),
                os.getenv("ASSISTANT_SERVICE_TOKEN", ""),
            ),
            run_id,
            owner_id,
            generation,
            deadline=deadline,
        )

    def _request(self, suffix: str, args: dict | None = None) -> dict:
        timeout = min(20.0, self.deadline - time.monotonic())
        if timeout <= 0:
            self._log_failure(suffix, "deadline")
            raise ToolGatewayError(retryable=True)
        # URL/path/identity never come from model-selected arguments. Trust no proxy env.
        path = f"/internal/assistant/v1/runs/{quote(self.run_id, safe='')}/{suffix}"
        url = self.config.origin.rstrip("/") + path
        try:
            with httpx.Client(
                transport=self.transport, trust_env=False, follow_redirects=False
            ) as client:
                response = client.request(
                    "GET" if args is None else "POST",
                    url,
                    headers={
                        "x-assistant-service-token": self.config.service_token,
                        "x-assistant-lease-owner": self.owner_id,
                        "x-assistant-lease-generation": str(self.generation),
                        "x-correlation-id": self.run_id,
                    },
                    **({"json": {"args": args}} if args is not None else {}),
                    timeout=timeout,
                )
            if not response.is_success:
                # Domain 4xx (including 429) is never retried by this gateway.
                self._log_failure(suffix, "http_status", status_code=response.status_code)
                raise ToolGatewayError(retryable=response.status_code >= 500)
            if time.monotonic() >= self.deadline or len(response.content) > 256_000:
                self._log_failure(suffix, "deadline_or_oversize")
                raise ToolGatewayError(retryable=True)
            return response.json()
        except httpx.HTTPError as exc:
            self._log_failure(suffix, "transport", error_type=type(exc).__name__)
            raise ToolGatewayError(retryable=isinstance(exc, httpx.TransportError)) from None
        except ValueError:
            self._log_failure(suffix, "invalid_json")
            raise ToolGatewayError() from None

    def context(self) -> RunContext:
        try:
            result = RunContext.model_validate(self._request("context"))
            if (
                result.run_id != self.run_id
                or sum(len(t.content) for t in result.context) + len(result.message.content) > 12000
            ):
                self._log_failure("context", "invalid_response")
                raise ToolGatewayError()
            return result
        except ValidationError:
            self._log_failure("context", "invalid_schema")
            raise ToolGatewayError() from None

    def execute(self, name: str, args: dict) -> ToolResult:
        if name not in READ_INPUTS:
            self._log_failure("tools/unknown", "unknown_tool")
            raise ToolGatewayError()
        try:
            validated = (
                READ_INPUTS[name].model_validate(args).model_dump(exclude_none=True, by_alias=True)
            )
            response = ToolResponse.model_validate(self._request(f"tools/{name}", validated))
            if response.run_id != self.run_id or response.tool != name:
                self._log_failure(f"tools/{name}", "invalid_response")
                raise ToolGatewayError()
            return response.result
        except ValidationError:
            self._log_failure(f"tools/{name}", "invalid_schema")
            raise ToolGatewayError() from None
