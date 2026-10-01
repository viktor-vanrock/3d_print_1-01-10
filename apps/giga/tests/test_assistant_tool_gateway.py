import json
import time

import httpx
import pytest

from giga.assistant.tool_gateway import ToolGateway, ToolGatewayConfig, ToolGatewayError

_SERVICE_TOKEN = "offline-service-token-0123456789abcdef"


def context():
    return {
        "run_id": "run-1",
        "thread_id": "thread-1",
        "message": {"id": "msg-1", "content": "P1S"},
        "mode": "global",
        "scopes": ["catalog:read"],
        "tools": ["search_printers", "get_printer"],
        "context": [],
        "context_truncated": False,
        "context_omitted_turns": 0,
        "correlation_id": "run-1",
    }


def gateway(handle):
    return ToolGateway(
        ToolGatewayConfig("http://api.internal:3000", _SERVICE_TOKEN),
        "run-1",
        "worker-7",
        42,
        deadline=time.monotonic() + 45,
        transport=httpx.MockTransport(handle),
    )


def test_gateway_context_and_tool_are_fenced_to_configured_origin():
    seen = []

    def handle(request):
        seen.append(request)
        assert str(request.url).startswith(
            "http://api.internal:3000/internal/assistant/v1/runs/run-1/"
        )
        assert request.headers["x-assistant-service-token"] == _SERVICE_TOKEN
        assert request.headers["x-assistant-lease-owner"] == "worker-7"
        assert request.headers["x-assistant-lease-generation"] == "42"
        assert request.extensions["timeout"]["read"] <= 20
        if request.method == "GET":
            return httpx.Response(200, json=context())
        assert json.loads(request.content) == {
            "args": {"query": "P1S", "limit": 6, "requested_fields": []}
        }
        return httpx.Response(
            200,
            json={
                "run_id": "run-1",
                "tool": "search_printers",
                "result": {"resolution": "not_found", "evidence": []},
                "correlation_id": "run-1",
            },
        )

    api = gateway(handle)
    assert api.context().run_id == "run-1"
    assert api.execute("search_printers", {"query": "P1S"}).resolution == "not_found"
    assert len(seen) == 2


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example",
        "http://8.8.8.8",
        "http://169.254.169.254",
        "http://api.internal/path",
        "http://a:b@api.internal",
        "http://api.internal?secret=x",
    ],
)
def test_reject_public_or_credential_bearing_origins(origin):
    with pytest.raises(ValueError):
        ToolGatewayConfig(origin, _SERVICE_TOKEN)


@pytest.mark.parametrize("length", [0, 31, 513])
def test_reject_service_token_length_outside_api_guard(length):
    with pytest.raises(ValueError):
        ToolGatewayConfig("http://api.internal:3000", "a" * length)


@pytest.mark.parametrize("length", [32, 512])
def test_accept_service_token_length_at_api_guard_bounds(length):
    config = ToolGatewayConfig("http://api.internal:3000", "a" * length)
    assert len(config.service_token) == length


@pytest.mark.parametrize("status", [301, 302, 400, 401, 403, 404, 409, 422, 429, 503])
def test_domain_failure_and_redirect_never_retry_or_forward_token(status):
    seen = []

    def handle(request):
        seen.append(request)
        return httpx.Response(status, headers={"Location": "https://evil.example"})

    with pytest.raises(ToolGatewayError) as failure:
        gateway(handle).context()
    assert failure.value.retryable is (status >= 500)
    assert len(seen) == 1


def test_invalid_args_reject_before_http_and_identity_mismatch_is_error():
    seen = []

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json={**context(), "run_id": "another-run"})

    api = gateway(handle)
    with pytest.raises(ToolGatewayError):
        api.execute("search_printers", {"query": "P1S", "user_id": "victim"})
    with pytest.raises(ToolGatewayError):
        api.execute("delete_printer", {})
    assert seen == []
    with pytest.raises(ToolGatewayError):
        api.context()


def test_news_range_uses_public_from_alias_on_gateway_wire():
    period = {
        "from": "2026-09-01T00:00:00Z",
        "to": "2026-09-08T00:00:00Z",
        "defaulted": False,
        "bounded": False,
        "date_basis": "portal_published_at",
    }

    def handle(request):
        assert json.loads(request.content) == {
            "args": {"from": "2026-09-01", "to": "2026-09-07", "limit": 10}
        }
        return httpx.Response(
            200,
            json={
                "run_id": "run-1",
                "tool": "list_news",
                "result": {"resolution": "resolved", "evidence": [], "period": period},
                "correlation_id": "run-1",
            },
        )

    result = gateway(handle).execute("list_news", {"from": "2026-09-01", "to": "2026-09-07"})
    assert result.period is not None
    assert result.period.from_ == period["from"]
