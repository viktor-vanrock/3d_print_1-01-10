"""Run a bounded, local assistant question corpus through the public HTTP API.

The report stores each test question and structural results. Response text, cookies
and source content remain in the API and are never written to the report.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

ALLOWED_KINDS = {"answer", "clarification", "generation_offer", "error"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


@dataclass(frozen=True)
class Case:
    id: str
    category: str
    question: str
    expected: tuple[str, ...]
    group: str
    citation_entity_type: str | None = None
    citation_title_terms: tuple[str, ...] = ()
    text_contains: tuple[str, ...] = ()
    text_not_contains: tuple[str, ...] = ()


def load_cases(path: Path, categories: set[str], limit: int | None) -> list[Case]:
    data = json.loads(path.read_text(encoding="utf-8"))
    raw = data.get("cases") if isinstance(data, dict) else data
    if not isinstance(raw, list):
        raise ValueError("Corpus must be an array or an object with a cases array")
    selected: list[Case] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Each case must be an object")
        identifier, category, question = (item.get(key) for key in ("id", "category", "question"))
        if not all(
            isinstance(value, str) and value.strip() for value in (identifier, category, question)
        ):
            raise ValueError("Each case needs nonempty id, category and question")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", identifier) or not re.fullmatch(
            r"[A-Za-z0-9_-]{1,80}", category
        ):
            raise ValueError("Case id and category must be safe short identifiers")
        if identifier in seen:
            raise ValueError(f"Duplicate case id: {identifier}")
        seen.add(identifier)
        expectation = item.get("expected_outcome", ["answer", "clarification"])
        if expectation == "either":
            expectation = ["answer", "clarification"]
        if isinstance(expectation, str):
            expectation = [expectation]
        if (
            not isinstance(expectation, list)
            or not expectation
            or any(not isinstance(kind, str) or kind not in ALLOWED_KINDS for kind in expectation)
        ):
            raise ValueError(f"Invalid expected_outcome for {identifier}")
        group = item.get("thread_id") or identifier
        if not isinstance(group, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", group):
            raise ValueError(f"Invalid thread_id for {identifier}")
        citation = item.get("expected_citation", {})
        if not isinstance(citation, dict):
            raise ValueError(f"Invalid expected_citation for {identifier}")
        entity_type = citation.get("entity_type")
        title_terms = citation.get("title_contains", [])
        text_contains = item.get("expected_text_contains", [])
        text_not_contains = item.get("expected_text_not_contains", [])
        if (
            entity_type is not None
            and entity_type not in {"printer", "comparison", "material", "news"}
            or not isinstance(title_terms, list)
            or any(not isinstance(term, str) or not term.strip() for term in title_terms)
            or not isinstance(text_contains, list)
            or any(not isinstance(term, str) or not term.strip() for term in text_contains)
            or not isinstance(text_not_contains, list)
            or any(not isinstance(term, str) or not term.strip() for term in text_not_contains)
        ):
            raise ValueError(f"Invalid expected_citation for {identifier}")
        if not categories or category in categories:
            selected.append(
                Case(
                    identifier,
                    category,
                    question,
                    tuple(expectation),
                    group,
                    entity_type,
                    tuple(title_terms),
                    tuple(text_contains),
                    tuple(text_not_contains),
                )
            )
    return selected[:limit]


def assess(run: dict, expected: tuple[str, ...], case: Case | None = None) -> tuple[str, str, int]:
    status, result = run.get("status"), run.get("result")
    if status == "error":
        return "fail", "run_error", 0
    if status != "done" or not isinstance(result, dict):
        return "fail", "invalid_terminal_run", 0
    kind = result.get("kind")
    if kind not in expected:
        return "fail", "unexpected_result_kind", 0
    if kind == "answer":
        text, citations = result.get("text"), result.get("citations")
        if not isinstance(text, str) or not text.strip() or not isinstance(citations, list):
            return "fail", "malformed_answer", 0
        if case is not None and any(
            term.casefold() not in text.casefold() for term in case.text_contains
        ):
            return "fail", "missing_expected_text", len(citations)
        if case is not None and any(
            term.casefold() in text.casefold() for term in case.text_not_contains
        ):
            return "fail", "unexpected_text", len(citations)
        for citation in citations:
            if not isinstance(citation, dict) or not isinstance(citation.get("title"), str):
                return "fail", "malformed_citation", len(citations)
            url = citation.get("canonical_url", citation.get("source_url"))
            if url is not None and (
                not isinstance(url, str)
                or url.lower().startswith(("javascript:", "data:", "file:"))
            ):
                return "fail", "unsafe_citation_url", len(citations)
        if case is not None and case.citation_entity_type:
            matching = [
                citation for citation in citations
                if citation.get("entity_type") == case.citation_entity_type
                and all(
                    term.casefold() in citation["title"].casefold()
                    for term in case.citation_title_terms
                )
                and (
                    citation.get("canonical_url")
                    or citation.get("source_url")
                    or citation.get("source_refs")
                )
            ]
            if not matching:
                return "fail", "missing_expected_source", len(citations)
        return "pass", "ok", len(citations)
    if kind == "clarification":
        if not isinstance(result.get("question"), str) or not result["question"].strip():
            return "fail", "malformed_clarification", 0
    return "pass", "ok", 0


async def request_json(client: httpx.AsyncClient, method: str, path: str, **kwargs: object) -> dict:
    response = await client.request(method, path, **kwargs)
    if response.status_code >= 400:
        # Never include the server response: it may contain private source data.
        raise RuntimeError(f"http_{response.status_code}")
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError("invalid_json") from exc
    if not isinstance(data, dict):
        raise RuntimeError("invalid_envelope")
    return data


async def run_cases(
    cases: list[Case],
    base_url: str,
    timeout: float,
    interval: float,
    concurrency: int = 1,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict]:
    # A single dev account has a real hourly quota. Stop at 429; never rotate users.
    groups: dict[str, list[Case]] = {}
    for case in cases:
        groups.setdefault(case.group, []).append(case)
    entries: dict[str, dict] = {}
    stop = asyncio.Event()
    semaphore = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(base_url=base_url, timeout=10, transport=transport) as client:
        await request_json(client, "POST", "/auth/dev")

        async def execute_group(group_cases: list[Case]) -> None:
            async with semaphore:
                thread_id = None
                for case in group_cases:
                    if stop.is_set():
                        entries[case.id] = {
                            "id": case.id,
                            "category": case.category,
                            "question": case.question,
                            "status": "skipped",
                            "reason": "quota_reached",
                        }
                        continue
                    start = time.monotonic()
                    try:
                        if thread_id is None:
                            thread = await request_json(
                                client,
                                "POST",
                                "/assistant/threads",
                                json={"title": f"API smoke {case.id}"},
                            )
                            thread_id = thread["thread"]["id"]
                        queued = await request_json(
                            client,
                            "POST",
                            f"/assistant/threads/{thread_id}/messages",
                            json={
                                "content": case.question,
                                "client_request_id": f"api-smoke-{uuid4()}",
                            },
                        )
                        run_id = queued["run"]["id"]
                        deadline = time.monotonic() + timeout
                        while True:
                            run = (
                                await request_json(
                                    client, "GET", f"/assistant/threads/{thread_id}/runs/{run_id}"
                                )
                            )["run"]
                            if run.get("status") in ("done", "error"):
                                verdict, reason, citations = assess(run, case.expected, case)
                                entries[case.id] = {
                                    "id": case.id,
                                    "category": case.category,
                                    "question": case.question,
                                    "status": verdict,
                                    "reason": reason,
                                    "run_status": run["status"],
                                    "result_kind": run.get("result", {}).get("kind"),
                                    "error_code": run.get("error_code"),
                                    "citations": citations,
                                    "elapsed_seconds": round(time.monotonic() - start, 2),
                                }
                                break
                            if time.monotonic() >= deadline:
                                raise RuntimeError("run_timeout")
                            await asyncio.sleep(min(interval, max(0, deadline - time.monotonic())))
                    except (httpx.HTTPError, KeyError, TypeError, RuntimeError) as exc:
                        reason = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
                        if reason == "http_429":
                            stop.set()
                        entries[case.id] = {
                            "id": case.id,
                            "category": case.category,
                            "question": case.question,
                            "status": "fail",
                            "reason": reason,
                            "elapsed_seconds": round(time.monotonic() - start, 2),
                        }
                        # A follow-up needs the previous successful response.
                        break

        await asyncio.gather(*(execute_group(group) for group in groups.values()))
    return [
        entries.get(
            case.id,
            {
                "id": case.id,
                "category": case.category,
                "question": case.question,
                "status": "skipped",
                "reason": "prior_turn_failed",
            },
        )
        for case in cases
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--report", type=Path, default=Path("assistant-api-report.json"))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--categories", help="Comma-separated categories")
    parser.add_argument("--timeout", type=float, default=120, help="Per-run timeout in seconds")
    parser.add_argument("--poll-interval", type=float, default=2)
    parser.add_argument(
        "--concurrency", type=int, default=1, help="1 to 3; keep low for provider quotas"
    )
    args = parser.parse_args()
    parsed = urlsplit(args.base_url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in LOCAL_HOSTS
        or parsed.username
        or parsed.password
    ):
        parser.error("The smoke harness only accepts a local HTTP API")
    if (
        args.limit is not None
        and args.limit < 1
        or not 1 <= args.concurrency <= 3
        or args.timeout <= 0
        or args.poll_interval <= 0
    ):
        parser.error("Expected positive limit/timeout/poll interval and concurrency from 1 to 3")
    categories = set(args.categories.split(",")) if args.categories else set()
    cases = load_cases(args.corpus, categories, args.limit)
    if not cases:
        parser.error("No cases selected")
    try:
        results = asyncio.run(
            run_cases(cases, args.base_url, args.timeout, args.poll_interval, args.concurrency)
        )
    except (httpx.HTTPError, RuntimeError) as exc:
        # Authentication and startup failures must not reveal response bodies or cookies.
        parser.exit(2, f"API setup failed: {type(exc).__name__}\n")
    report = {
        "total": len(results),
        "passed": sum(item["status"] == "pass" for item in results),
        "failed": sum(item["status"] == "fail" for item in results),
        "results": results,
    }
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{report['passed']}/{report['total']} passed; {report['failed']} failed")
    print(f"Report: {args.report}")
    return 1 if report["failed"] or any(item["status"] == "skipped" for item in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
