from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from giga.assistant.schemas import (
    ASSISTANT_EVIDENCE_CONTRACT_VERSION,
    AssistantAnswer,
    AssistantError,
    Citation,
    EvidenceCitation,
)

_FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "contracts"
    / "http"
    / "fixtures"
    / "assistant.evidence.v2.json"
)
_FIXTURE = json.loads(_FIXTURE_PATH.read_text(encoding="utf-8"))


def test_accepts_legacy_and_all_v2_entity_types() -> None:
    assert ASSISTANT_EVIDENCE_CONTRACT_VERSION == "assistant.evidence.v2"
    legacy = Citation.model_validate(_FIXTURE["legacy"])
    citations = [EvidenceCitation.model_validate(value) for value in _FIXTURE["v2"]]

    assert legacy.model_id == _FIXTURE["legacy"]["model_id"]
    assert [citation.entity_type for citation in citations] == [
        "model",
        "printer",
        "machine",
        "user_printer",
        "material",
        "news",
        "comparison",
    ]
    answer = AssistantAnswer(text="ok", citations=[legacy, *citations])
    assert len(answer.citations) == 8


@pytest.mark.parametrize("field", ["entity_type", "freshness", "quality"])
def test_rejects_invented_enum_values(field: str) -> None:
    payload = {**_FIXTURE["v2"][0], field: "invented"}
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate(payload)


def test_rejects_unknown_fields_mismatched_facts_and_unsafe_urls() -> None:
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate(
            {**_FIXTURE["v2"][0], "facts": {"kind": "model", "secret": "value"}}
        )
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate({**_FIXTURE["v2"][0], "facts": {"kind": "news"}})
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate(
            {**_FIXTURE["v2"][0], "canonical_url": "javascript:alert(1)"}
        )
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate(
            {
                **_FIXTURE["v2"][0],
                "source_refs": [
                    {"label": "bad", "url": "https://user:password@example.com/private"}
                ],
            }
        )


def test_round_trips_all_provenance_timestamps_without_reformatting() -> None:
    timestamp_fields = (
        "source_published_at",
        "observed_at",
        "updated_at",
        "price_updated_at",
    )
    for payload in _FIXTURE["v2"]:
        dumped = EvidenceCitation.model_validate(payload).model_dump(mode="json")
        for field in timestamp_fields:
            assert dumped[field] == payload[field]


def test_enforces_price_and_news_freshness_semantics() -> None:
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate(
            {
                **_FIXTURE["v2"][0],
                "freshness": "fresh",
                "freshness_reason": "recent",
            }
        )
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate({**_FIXTURE["v2"][1], "price_updated_at": None})


@pytest.mark.parametrize("url", _FIXTURE["invalid_urls"])
def test_rejects_secret_bearing_source_urls(url: str) -> None:
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate(
            {**_FIXTURE["v2"][0], "source_refs": [{"label": "source", "url": url}]}
        )


@pytest.mark.parametrize("url", _FIXTURE["invalid_portal_urls"])
def test_requires_safe_portal_relative_canonical_url(url: str) -> None:
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate({**_FIXTURE["v2"][0], "canonical_url": url})


@pytest.mark.parametrize("timestamp", _FIXTURE["invalid_timestamps"])
def test_rejects_non_rfc3339_or_impossible_dates(timestamp: str) -> None:
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate({**_FIXTURE["v2"][0], "observed_at": timestamp})


@pytest.mark.parametrize("timestamp", _FIXTURE["valid_timestamps"])
def test_preserves_timezone_and_fraction(timestamp: str) -> None:
    citation = EvidenceCitation.model_validate({**_FIXTURE["v2"][0], "observed_at": timestamp})
    assert citation.model_dump()["observed_at"] == timestamp


def test_static_serialization_omits_freshness_and_news_requires_effective_date() -> None:
    static = EvidenceCitation.model_validate(_FIXTURE["v2"][0]).model_dump()
    assert "freshness" not in static and "freshness_reason" not in static
    news = {**_FIXTURE["v2"][5], "facts": {"kind": "news"}}
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate(news)
    EvidenceCitation.model_validate(
        {**news, "freshness": "unknown", "freshness_reason": "news_missing_effective_published_at"}
    )
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate(
            {**news, "freshness": "unknown", "freshness_reason": "recent"}
        )


def test_usd_msrp_cannot_claim_dated_freshness() -> None:
    usd = {
        **_FIXTURE["v2"][1],
        "facts": {"kind": "printer", "price_msrp_usd": {"amount": 599, "currency": "USD"}},
    }
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate(usd)
    EvidenceCitation.model_validate(
        {
            **usd,
            "price_updated_at": None,
            "freshness": "unknown",
            "freshness_reason": "price_msrp_has_no_observation_date",
        }
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("title", "x" * 301),
        ("snippet", "x" * 2001),
        ("source_refs", [{"label": "s", "url": None}] * 9),
        ("missing_fields", ["x"] * 33),
    ],
)
def test_envelope_bounds(field, value) -> None:
    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate({**_FIXTURE["v2"][0], field: value})


def test_fact_and_comparison_bounds_and_order() -> None:
    from copy import deepcopy

    with pytest.raises(ValidationError):
        EvidenceCitation.model_validate(
            {**_FIXTURE["v2"][1], "facts": {"kind": "printer", "supported_materials": ["PLA"] * 33}}
        )
    for mutation in ("ids", "order", "cells", "metadata", "unit"):
        value = deepcopy(_FIXTURE["v2"][6])
        facts = value["facts"]
        if mutation == "ids":
            facts["printer_ids"] *= 3
        elif mutation == "order":
            facts["rows"].reverse()
        elif mutation == "cells":
            facts["rows"][0]["cells"].pop()
        elif mutation == "metadata":
            facts["rows"][0]["cells"][0]["private"] = "secret"
        else:
            facts["rows"][2]["cells"][0]["unit"] = "USD"
        with pytest.raises(ValidationError):
            EvidenceCitation.model_validate(value)
    dumped = EvidenceCitation.model_validate(_FIXTURE["v2"][6]).model_dump()
    assert dumped == _FIXTURE["v2"][6]


_RESULT_FIXTURE = json.loads(
    (_FIXTURE_PATH.parent / "assistant.v1.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("payload", _RESULT_FIXTURE["tool_errors"])
def test_shared_tool_error_fixture_preserves_code_message_and_retryability(payload):
    assert AssistantError.model_validate(payload).model_dump() == payload


def test_error_schema_rejects_invented_code():
    with pytest.raises(ValidationError):
        AssistantError.model_validate({**_RESULT_FIXTURE["tool_errors"][0], "code": "invented"})
