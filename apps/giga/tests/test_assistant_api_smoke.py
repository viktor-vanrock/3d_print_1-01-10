"""Structural checks for the local HTTP corpus runner; no provider requests."""

import asyncio
import importlib.util
import json
import sys
from pathlib import Path

import httpx

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "assistant_api_smoke.py"
SPEC = importlib.util.spec_from_file_location("assistant_api_smoke", SCRIPT)
assert SPEC and SPEC.loader
smoke = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = smoke
SPEC.loader.exec_module(smoke)


def test_corpus_contract_and_filtering():
    corpus = Path(__file__).parent / "fixtures" / "assistant_portal_questions.json"
    cases = smoke.load_cases(corpus, set(), None)
    assert 50 <= len(cases) <= 100
    assert len({case.id for case in cases}) == len(cases)
    assert smoke.load_cases(corpus, {cases[0].category}, 1) == cases[:1]
    assert all(case.expected and case.group for case in cases)


def test_known_record_requires_matching_server_source():
    case = smoke.Case(
        "printer-01", "printer_lookup", "P1S", ("answer",), "printer-01", "printer", ("P1S",)
    )
    run = {"status": "done", "result": {"kind": "answer", "text": "Есть P1S", "citations": []}}
    assert smoke.assess(run, case.expected, case)[1] == "missing_expected_source"
    run["result"]["citations"] = [
        {"title": "Bambu Lab A1", "entity_type": "printer", "canonical_url": "/printers/a1"}
    ]
    assert smoke.assess(run, case.expected, case)[1] == "missing_expected_source"
    run["result"]["citations"][0]["title"] = "Bambu Lab P1S"
    assert smoke.assess(run, case.expected, case)[0] == "pass"


def test_expected_answer_terms_are_checked_without_storing_response_text():
    case = smoke.Case(
        "compare",
        "material_comparison",
        "Сравни ABS и PLA",
        ("answer",),
        "compare",
        text_contains=("ABS", "PLA"),
    )
    run = {"status": "done", "result": {"kind": "answer", "text": "ABS", "citations": []}}
    assert smoke.assess(run, case.expected, case)[1] == "missing_expected_text"
    run["result"]["text"] = "ABS и PLA"
    assert smoke.assess(run, case.expected, case) == ("pass", "ok", 0)


def test_unexpected_answer_terms_are_rejected_without_storing_response_text():
    case = smoke.Case(
        "compare",
        "material_comparison",
        "Сравни ABS и PLA",
        ("answer",),
        "compare",
        text_not_contains=("товаров",),
    )
    run = {
        "status": "done",
        "result": {"kind": "answer", "text": "ABS (192 товаров)", "citations": []},
    }
    assert smoke.assess(run, case.expected, case) == ("fail", "unexpected_text", 0)
    run["result"]["text"] = "ABS и PLA"
    assert smoke.assess(run, case.expected, case) == ("pass", "ok", 0)


def test_uses_one_thread_for_followups_and_reports_questions_without_response_text(tmp_path):
    corpus = tmp_path / "cases.json"
    corpus.write_text(
        json.dumps(
            {
                "cases": [
                    {
                        "id": "a",
                        "category": "printer",
                        "question": "secret question one",
                        "expected_outcome": "answer",
                        "thread_id": "dialog",
                    },
                    {
                        "id": "b",
                        "category": "printer",
                        "question": "secret question two",
                        "expected_outcome": "either",
                        "thread_id": "dialog",
                    },
                ]
            }
        )
    )
    posts = []

    def handler(request):
        if request.url.path == "/auth/dev":
            return httpx.Response(
                200,
                json={"ok": True},
                headers={"set-cookie": "portal_session=secret-session; Path=/"},
            )
        if request.url.path == "/assistant/threads":
            posts.append("thread")
            return httpx.Response(201, json={"thread": {"id": "thread-1"}})
        if request.url.path.endswith("/messages"):
            assert request.headers["cookie"] == "portal_session=secret-session"
            posts.append(json.loads(request.content)["content"])
            return httpx.Response(201, json={"run": {"id": f"run-{len(posts)}"}})
        if "/runs/" in request.url.path:
            return httpx.Response(
                200,
                json={
                    "run": {
                        "status": "done",
                        "result": {"kind": "answer", "text": "private answer", "citations": []},
                    }
                },
            )
        raise AssertionError(request.url.path)

    cases = smoke.load_cases(corpus, set(), None)
    result = asyncio.run(
        smoke.run_cases(
            cases, "http://127.0.0.1:3000", 5, 0.01, transport=httpx.MockTransport(handler)
        )
    )
    assert posts == ["thread", "secret question one", "secret question two"], result
    assert [item["status"] for item in result] == ["pass", "pass"]
    assert [item["question"] for item in result] == [
        "secret question one",
        "secret question two",
    ]
    assert "private answer" not in json.dumps(result)


def test_quota_stops_without_bypassing():
    def handler(request):
        if request.url.path == "/auth/dev":
            return httpx.Response(200, json={"ok": True})
        if request.url.path == "/assistant/threads":
            return httpx.Response(201, json={"thread": {"id": "thread"}})
        if request.url.path.endswith("/messages"):
            return httpx.Response(429, json={"message": "private quota details"})
        raise AssertionError(request.url.path)

    cases = [smoke.Case(str(i), "printer", "question", ("answer",), "group") for i in range(3)]
    result = asyncio.run(
        smoke.run_cases(
            cases, "http://localhost:3000", 5, 0.01, transport=httpx.MockTransport(handler)
        )
    )
    assert [item["status"] for item in result] == ["fail", "skipped", "skipped"]
    assert result[0]["reason"] == "http_429"
    assert "private" not in json.dumps(result)


def test_malformed_results_fail_without_text_leakage():
    assert (
        smoke.assess(
            {"status": "done", "result": {"kind": "answer", "text": "", "citations": []}},
            ("answer",),
        )[1]
        == "malformed_answer"
    )
    assert (
        smoke.assess(
            {
                "status": "done",
                "result": {
                    "kind": "answer",
                    "text": "hi",
                    "citations": [{"title": "x", "canonical_url": "javascript:alert(1)"}],
                },
            },
            ("answer",),
        )[1]
        == "unsafe_citation_url"
    )
