"""Юнит-тесты `giga.assistant.skills` — versioned server-owned реестр (MF-2046)."""

from __future__ import annotations

from giga.assistant import skills


def test_registry_entries_have_schema_scope_and_mutating_flag():
    for skill in skills.SKILL_REGISTRY.values():
        assert skill.name
        assert skill.description
        assert isinstance(skill.input_schema, dict)
        assert skill.input_schema.get("type") == "object"
        assert skill.required_scope
        assert isinstance(skill.mutating, bool)
        assert skill.modes


def test_read_skills_are_available_in_all_modes():
    assert set(skills.READ_INPUTS) == set(skills.SKILL_REGISTRY) - {"generation_offer"}
    for name in skills.READ_INPUTS:
        skill = skills.SKILL_REGISTRY[name]
        assert skill.mutating is False
        assert skill.modes == frozenset({"page", "global", "assistant"})


def test_generation_offer_is_mutating_and_not_available_on_page():
    generation_offer = skills.SKILL_REGISTRY["generation_offer"]
    assert generation_offer.mutating is True
    assert "page" not in generation_offer.modes


def test_skills_for_page_mode_excludes_mutating_generation_offer():
    result = skills.skills_for("page", skills.DEFAULT_SCOPES)
    names = {s.name for s in result}
    assert names == set(skills.READ_INPUTS)


def test_skills_for_global_mode_includes_reads_and_generation_offer():
    result = skills.skills_for("global", skills.DEFAULT_SCOPES)
    names = {s.name for s in result}
    assert names == set(skills.READ_INPUTS) | {"generation_offer"}


def test_skills_for_respects_scope_filtering_even_in_assistant_mode():
    result = skills.skills_for("assistant", frozenset({skills.SCOPE_CATALOG_READ}))
    names = {s.name for s in result}
    assert names == set(skills.READ_INPUTS) - {"list_news"}


def test_skills_for_empty_scopes_returns_nothing():
    assert skills.skills_for("global", frozenset()) == []


def test_search_printers_input_bounds_query_and_limit():
    parsed = skills.SearchPrintersInput.model_validate({"query": "дракон", "limit": 3})
    assert parsed.query == "дракон"
    assert parsed.limit == 3

    defaulted = skills.SearchPrintersInput.model_validate({"query": "дракон"})
    assert defaulted.limit == 6
