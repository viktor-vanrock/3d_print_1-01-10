"""Bounded printer orchestration over server-owned context, evidence and read tools."""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field, replace

from pydantic import ValidationError

from . import hyperpc_client
from ._prompts import load_router_system_prompt
from .evidence import Evidence
from .hyperpc_provider import HyperpcProvider
from .provider import (
    AssistantProvider,
    ProviderFunctionCall,
    ProviderFunctionResult,
    ProviderMessage,
    ProviderRequest,
)
from .schemas import (
    AssistantAnswer,
    AssistantClarification,
    AssistantError,
    AssistantGenerationOffer,
    AssistantResult,
    Citation,
    EvidenceCitation,
)
from .skills import DEFAULT_SCOPES, READ_INPUTS, AssistantMode, skills_for
from .tool_gateway import MaterialComparison, ToolGatewayError, ToolResult

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)```", re.DOTALL)
_SECRET_RE = re.compile(
    r"(?i)\b(?:authorization|cookie)[\"']?\s*[:=]\s*[^\r\n]+"
    r"|\bbearer\s+\S+"
    r"|\b(?:password|secret|token|api[_-]?key)[\"']?\s*[:=]\s*[\"']?[^\s,;\"']+"
    r"|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}"
)
_URL_RE = re.compile(r"(?i)(?:[a-z][a-z0-9+.-]*://|www\.)\S+")
_GENERATION_BRANCHES = frozenset({"openscad", "kzd", "hueforge", "trellis", "rudalle"})
_OUT_OF_SCOPE_TEXT = (
    "Я отвечаю на вопросы о 3D-печати по доступным данным портала. "
    "Уточните запрос в этой области."
)
_WEATHER_REQUEST_RE = re.compile(
    r"^(?:(?:какая|какую|какой|скажи|подскажи|напиши|дай|покажи|расскажи|узнай)\s+"
    r"(?:(?:мне|сегодня|завтра|какая|какой)\s+){0,2})?"
    r"(?:погода|погоду|прогноз\s+погоды)\b"
    r"|^(?:weather\s+forecast|what(?:'s| is)\s+the\s+weather)\b",
    re.IGNORECASE,
)
_CODE_REQUEST_RE = re.compile(
    r"^(?:напиши|написать|сгенерируй|создай|сделай|write|generate|create)\s+"
    r"(?:(?:мне|a|an|the)\s+)?"
    r"(?:(?:python|javascript|js|typescript|bash|shell)\s*[- ]\s*)?"
    r"(?:код|скрипт|программу|функцию|code|script|program|function)\b"
    r"|^(?:напиши|написать|сгенерируй|создай|сделай)\s+"
    r"(?:мне\s+)?на\s+(?:python|javascript|typescript|bash)\s+"
    r"(?:код|скрипт|программу|функцию)\b",
    re.IGNORECASE,
)
_POLICY_OVERRIDE_RE = re.compile(
    r"^(?:игнорируй|забудь|отмени|раскрой|покажи|показать|выведи|вывести)\s+"
    r"(?:(?:все|мои|свои|твои|предыдущие|системные|скрытые)\s+){1,3}"
    r"(?:инструкции|правила|ограничения|промпт)\b"
    r"|^обойди\s+(?:эти\s+|свои\s+|твои\s+)?ограничения\b"
    r"|^(?:ignore|forget|bypass|override)\s+(?:all\s+)?(?:previous\s+|system\s+)?"
    r"(?:instructions|rules|restrictions)\b",
    re.IGNORECASE,
)
_CODE_NOUN_RE = re.compile(
    r"\b(?:python|javascript|typescript|bash|js)[- ]?(?:скрипт|script)\b"
    r"|\b(?:код(?!\s+ошибки)|скрипт|программу|функцию|code|script|program|function)\b",
    re.IGNORECASE,
)
_CODE_INTENT_RE = re.compile(
    r"\b(?:напиши|написать|сгенерируй|создай|сделай|write|generate|create)\b",
    re.IGNORECASE,
)
_SCRIPT_NEED_RE = re.compile(
    r"\b(?:нужен|нужна|требуется|need)\s+"
    r"(?:(?:python|javascript|typescript|bash|js)[- ]?)?"
    r"(?:скрипт|программа|script|program)\b",
    re.IGNORECASE,
)
_MATERIAL_ALIASES = {
    "abs": "abs", "абс": "abs", "pla": "pla", "пла": "pla",
    "petg": "petg", "пэтг": "petg", "tpu": "tpu", "тпу": "tpu",
    "asa": "asa", "аса": "asa", "pa": "pa", "pc": "pc",
}
EvidenceItem = Evidence | EvidenceCitation
ToolExecutor = Callable[[str, dict], ToolResult]


class RouterOutputError(Exception):
    pass


class BudgetExpired(Exception):
    pass


class LeaseLost(Exception):
    pass


@dataclass
class BudgetLedger:
    deadline: float = field(default_factory=lambda: time.monotonic() + 45.0)
    lease_lost: Callable[[], bool] = field(default=lambda: False, repr=False)
    # The isolated worker observes attempts to enforce a hard wall-clock cutoff.
    on_attempt: Callable[[float], None] | None = field(default=None, repr=False)
    tool_calls: int = 0
    retries: int = 0

    def check(self) -> None:
        if self.lease_lost():
            raise LeaseLost("assistant lease lost")
        if time.monotonic() >= self.deadline:
            raise BudgetExpired("assistant deadline exhausted")

    def attempt_deadline(self) -> float:
        self.check()
        deadline = min(self.deadline, time.monotonic() + 20.0)
        if self.on_attempt is not None:
            self.on_attempt(deadline)
        return deadline

    def finish_attempt(self, attempt_deadline: float) -> None:
        self.check()
        if time.monotonic() >= attempt_deadline:
            raise BudgetExpired("assistant attempt exhausted")
        if self.on_attempt is not None:
            self.on_attempt(self.deadline)

    def retry(self) -> bool:
        self.check()
        if self.retries:
            return False
        self.retries += 1
        return True


def _redact(value):
    if isinstance(value, str):
        return _SECRET_RE.sub("[redacted]", value)
    if isinstance(value, list):
        return [_redact(item) for item in value]
    if isinstance(value, dict):
        return {key: _redact(item) for key, item in value.items()}
    return value


def _id(item: EvidenceItem) -> str:
    return item.evidence_id if isinstance(item, EvidenceCitation) else item.model_id


def _citation(item: EvidenceItem) -> Citation | EvidenceCitation:
    if isinstance(item, EvidenceCitation):
        return EvidenceCitation.model_validate(_redact(item.model_dump()))
    return Citation(
        model_id=item.model_id,
        title=_redact(item.title),
        snippet=_redact(item.snippet),
        score=item.score,
        source_url=item.source_url,
    )


def _payload(item: EvidenceItem) -> dict:
    data = _redact(_citation(item).model_dump())
    if data.get("entity_type") == "material":
        for key in ("machine_id", "catalog_printer_id", "user_printer_id"):
            data["facts"].pop(key, None)
    return data


def _merge_evidence(original: list[EvidenceItem], extra: list[EvidenceItem]) -> list[EvidenceItem]:
    # Replace a search record with the freshly fetched detail of the same evidence id.
    merged = {_id(item): item for item in original[:20]}
    for item in extra[:10]:
        if _id(item) in merged or len(merged) < 20:
            merged[_id(item)] = item
    return list(merged.values())


def _citations_from_ids(ids: list[str], evidence_by_id: dict[str, EvidenceItem]):
    return [_citation(evidence_by_id[key]) for key in dict.fromkeys(ids) if key in evidence_by_id]


def _text(value: object) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > 8000
        or _URL_RE.search(value)
    ):
        raise RouterOutputError("invalid terminal text")
    return _redact(value.strip())


def _parse_response(
    response: str,
    evidence_by_id: dict[str, EvidenceItem],
    *,
    tool_callable_names: frozenset[str],
    generation_allowed: bool,
) -> AssistantResult | ProviderFunctionCall:
    match = _JSON_FENCE_RE.search(response)
    try:
        payload = json.loads(match.group(1).strip() if match else response.strip())
    except (ValueError, TypeError):
        raise RouterOutputError("invalid JSON") from None
    if not isinstance(payload, dict):
        raise RouterOutputError("invalid result")
    kind = payload.get("kind")
    if kind == "tool_call":
        if set(payload) - {"kind", "skill", "args"}:
            raise RouterOutputError("unknown tool fields")
        call = ProviderFunctionCall(payload.get("skill"), payload.get("args"))
        return _validate_call(call, tool_callable_names)
    if kind == "out_of_scope":
        # The terminal schema permits common fields for all kinds; ignore them.
        return _out_of_scope_answer()
    if kind == "answer":
        if set(payload) - {"kind", "text", "citation_ids"}:
            raise RouterOutputError("unknown answer fields")
        ids = payload.get("citation_ids", [])
        if not isinstance(ids, list) or not all(isinstance(key, str) for key in ids):
            raise RouterOutputError("invalid citation ids")
        return AssistantAnswer(
            text=_text(payload.get("text")), citations=_citations_from_ids(ids, evidence_by_id)
        )
    if kind == "clarification":
        if set(payload) - {"kind", "question", "reason"}:
            raise RouterOutputError("unknown clarification fields")
        return AssistantClarification(
            question=_text(payload.get("question")),
            reason=_text(payload["reason"]) if payload.get("reason") else None,
        )
    if kind == "generation_offer":
        if (
            not generation_allowed
            or set(payload) - {"kind", "branch", "prompt_summary", "note"}
            or not isinstance(payload.get("branch"), str)
            or payload.get("branch") not in _GENERATION_BRANCHES
        ):
            raise RouterOutputError("generation offer unavailable")
        return AssistantGenerationOffer(
            branch=payload["branch"],
            prompt_summary=_text(payload.get("prompt_summary")),
            note=_text(payload["note"]) if payload.get("note") else None,
        )
    raise RouterOutputError("unknown result kind")


def _validate_call(call: ProviderFunctionCall, allowed: frozenset[str]) -> ProviderFunctionCall:
    if not isinstance(call.name, str) or call.name not in allowed or call.name not in READ_INPUTS:
        raise RouterOutputError("tool unavailable")
    try:
        args = (
            READ_INPUTS[call.name]
            .model_validate(call.arguments)
            .model_dump(exclude_none=True, by_alias=True)
        )
    except ValidationError:
        raise RouterOutputError("invalid tool arguments") from None
    return ProviderFunctionCall(call.name, _redact(args))


def _degraded_answer(evidence: list[EvidenceItem]) -> AssistantAnswer:
    return AssistantAnswer(
        text="AI-провайдер недоступен. Найденные в каталоге записи: "
        + "; ".join(_redact(e.title) for e in evidence),
        citations=[_citation(item) for item in evidence],
        note="Показаны данные каталога без AI-синтеза ответа.",
    )


def _capabilities_answer(message: str, allowed: frozenset[str]) -> AssistantAnswer | None:
    question = " ".join(re.sub(r"[!?.,]+", " ", message.casefold()).split())
    if question not in {
        "что ты умеешь",
        "что умеешь",
        "чем ты можешь помочь",
        "чем можешь помочь",
        "какие у тебя возможности",
        "привет",
        "здравствуйте",
        "добрый день",
        "привет чем можешь помочь на этом портале",
    }:
        return None
    capabilities = []
    if {"search_printers", "get_printer"} & allowed:
        capabilities.append("найти описание публичного принтера")
    if "compare_printers" in allowed:
        capabilities.append("сравнить принтеры по доступным характеристикам")
    if {"search_filaments", "recommend_filaments"} & allowed:
        capabilities.append("найти или подобрать филамент")
    if "compare_material_types" in allowed:
        capabilities.append("сравнить семейства филамента по каталогу")
    if "list_news" in allowed:
        capabilities.append("показать опубликованные новости портала")
    if not capabilities:
        return None
    return AssistantAnswer(text="Могу " + ", ".join(capabilities) + ". Что вас интересует?")


def _out_of_scope_answer() -> AssistantAnswer:
    return AssistantAnswer(text=_OUT_OF_SCOPE_TEXT)


def _ungrounded_answer() -> AssistantAnswer:
    return AssistantAnswer(
        text="Не могу подтвердить ответ данными портала. "
        "Уточните, какой принтер, филамент или новость вас интересует."
    )


def _empty_news_answer(results: list[ProviderFunctionResult]) -> AssistantAnswer | None:
    for item in reversed(results):
        if item.call.name != "list_news" or item.result.get("resolution") != "resolved":
            continue
        if item.result.get("evidence_ids") != []:
            continue
        period = item.result.get("period")
        if not isinstance(period, dict) or not all(
            isinstance(period.get(key), str) for key in ("from", "to")
        ):
            continue
        text = f"За период с {period['from']} по {period['to']} ничего не опубликовано."
        if period.get("bounded") is True:
            text += " Период ограничен сервером до 365 дней."
        return AssistantAnswer(text=text)
    return None


def _explicitly_out_of_scope(message: str) -> bool:
    # Quoted titles and snippets are search data. Inspect each unquoted clause
    # so polite prefixes and a second instruction cannot hide a direct request.
    unquoted = re.sub(r"«[^»]*»|\"[^\"]*\"|`[^`]*`", " ", message.casefold())
    if not unquoted.strip():
        unquoted = message.strip().casefold()
        if len(unquoted) >= 2 and (unquoted[0], unquoted[-1]) in {
            ("«", "»"), ('"', '"'), ("`", "`")
        }:
            unquoted = unquoted[1:-1]
    for clause in re.split(r"[,.!?;\n]+", unquoted):
        request = re.sub(
            r"^(?:(?:пожалуйста|прошу)[,\s]+|можешь(?: ли)?\s+|please\s+|could you\s+)+",
            "",
            clause.strip(" \t\r-"),
        )
        if re.search(r"\b(?:печать|печати|принтер|филамент|abs|pla|petg|tpu)\b", request):
            # Weather-like wording can refer to printing conditions or a portal item.
            weather_request = False
        else:
            weather_request = bool(_WEATHER_REQUEST_RE.match(request))
        # Creation verbs belong to the supported 3D-generation flow when the
        # request names a model/object; the generation path offers a bounded
        # branch and never returns source code directly.
        code_request = bool(_CODE_REQUEST_RE.match(request)) or (
            _CODE_NOUN_RE.search(request) and _CODE_INTENT_RE.search(request)
        ) or _SCRIPT_NEED_RE.search(request)
        if (
            code_request and not _generation_requested(request)
        ) or weather_request or _POLICY_OVERRIDE_RE.match(request):
            return True
    return False


def _generation_requested(message: str) -> bool:
    text = message.casefold()
    if (
        _CODE_REQUEST_RE.match(text)
        or _SCRIPT_NEED_RE.search(text)
        or re.search(r"\b(?:погода|погоду|прогноз погоды)\b", text)
        or re.search(r"(?:внешн\w*\s+сервис|отправ\w*\s+.*сервис)", text)
    ):
        return False
    explicit_request = re.match(
        r"^\s*(?:сгенерируй|смоделируй)\s+(?:мне\s+)?[а-яёa-z0-9]",
        text,
    )
    qualified_request = re.match(
        r"^\s*(?:создай|сделай|нарисуй)\s+(?:мне\s+)?(?:3d|3д|модел\w*|stl|изображени\w*)\b",
        text,
    )
    return bool(explicit_request or qualified_request)


def _provider_error(code: str = "provider_error") -> AssistantError:
    return AssistantError(
        code="provider_timeout" if code == "provider_timeout" else "provider_error",
        message="AI-провайдер временно недоступен. Повторите запрос.",
        retryable=True,
    )


def _tool_error(*, retryable: bool) -> AssistantError:
    return AssistantError(
        code="tool_error",
        message=(
            "Инструмент каталога недоступен. Поиск не завершён; это не отсутствие результатов."
        ),
        retryable=retryable,
    )


def _mentioned_material_types(value: str) -> list[str]:
    words = re.findall(r"[a-zа-яё0-9]+", value.casefold())
    return list(
        dict.fromkeys(_MATERIAL_ALIASES[word] for word in words if word in _MATERIAL_ALIASES)
    )


def _material_comparison_types(
    message: str, context: tuple[ProviderMessage, ...]
) -> list[str]:
    types = _mentioned_material_types(message)
    last_assistant = next(
        (item.content for item in reversed(context) if item.role == "assistant"), ""
    )
    wants_comparison = bool(re.search(r"сравн|отлич|разниц", message.casefold()))
    if not wants_comparison and len(types) >= 2:
        wants_comparison = bool(re.search(r"сравн|отлич|разниц", last_assistant.casefold()))
    if not wants_comparison:
        return []
    if not types and re.search(r"\bвс[её]|возможно|доступн", message.casefold()):
        previous = next((item.content for item in reversed(context) if item.role == "user"), "")
        types = _mentioned_material_types(previous)
    elif len(types) == 1 and re.search(r"\b(?:его|её|этот|ним)\b", message.casefold()):
        for item in reversed(context):
            if item.role != "user":
                continue
            prior = _mentioned_material_types(item.content)
            if len(prior) == 1 and prior[0] != types[0]:
                types.insert(0, prior[0])
            break
    return types if 2 <= len(types) <= 4 else []


def _comparison_fallback(
    comparison: MaterialComparison, evidence: list[EvidenceItem]
) -> AssistantAnswer:
    def temperature(stats) -> str | None:
        if (
            stats.sample_count == 0
            or stats.median_listed_min_c is None
            or stats.median_listed_max_c is None
        ):
            return None
        return f"{stats.median_listed_min_c:g}–{stats.median_listed_max_c:g} °C"

    def enclosure(stats) -> str | None:
        if stats.required_count and stats.not_required_count:
            return "Зависит от товара"
        if stats.required_count:
            return "Указан необходимым"
        if stats.not_required_count:
            return "Указан необязательным"
        return None

    families = comparison.families
    rows = [
        ("Температура сопла", [temperature(family.nozzle_temp_c) for family in families]),
        ("Температура стола", [temperature(family.bed_temp_c) for family in families]),
        ("Закрытый корпус", [enclosure(family.enclosure) for family in families]),
    ]
    available = [(label, values) for label, values in rows if any(values)]
    lines = ["Сравнение материалов", ""]
    if len(available) >= 2:
        lines.extend([
            "| Характеристика | " + " | ".join(f.material_type.upper() for f in families) + " |",
            "| --- | " + " | ".join("---" for _ in families) + " |",
        ])
        lines.extend(
            "| " + label + " | " + " | ".join(value or "—" for value in values) + " |"
            for label, values in available
        )
    elif available:
        for index, family in enumerate(families):
            details = [
                f"{label.lower()}: {values[index]}"
                for label, values in available if values[index]
            ]
            if details:
                lines.append(f"- **{family.material_type.upper()}** — " + "; ".join(details) + ".")
    else:
        lines.append("В опубликованных карточках нет сопоставимых характеристик.")

    if any(label.startswith("Температура") for label, _ in available):
        lines.extend(["", "Температуры — медианы диапазонов из заполненных карточек портала."])
    if any(label == "Закрытый корпус" for label, _ in available):
        lines.append("Сведения о корпусе относятся только к карточкам, где это требование указано.")
    lines.append("Простоту печати каталог напрямую не оценивает.")
    return AssistantAnswer(
        text="\n".join(lines), citations=[_citation(item) for item in evidence[:4]]
    )


def _ambiguous_printer(evidence: list[EvidenceCitation]) -> AssistantClarification:
    def safe_label(value: str) -> str:
        value = _URL_RE.sub("", _redact(value))
        value = re.sub(r"[\x00-\x1f\x7f<>\[\]`*_\\]", " ", value)
        return " ".join(value.split())[:80] or "Без названия"

    items = evidence[:10]
    fact_labels = []
    for item in items:
        facts = item.facts
        if getattr(facts, "kind", None) == "printer":
            identity = " ".join(
                value
                for value in (getattr(facts, "brand", None), getattr(facts, "model", None))
                if value
            )
            status = getattr(facts, "product_status", None)
            fact_labels.append(safe_label(f"{identity} ({status})" if status else identity))
        else:
            fact_labels.append("")
    duplicates = {label for label in fact_labels if fact_labels.count(label) > 1}
    titles = [
        f"«{safe_label(item.title) if not label or label in duplicates else label}»"
        for item, label in zip(items, fact_labels, strict=True)
    ]
    choices = ": " + "; ".join(titles) if titles else ""
    return AssistantClarification(
        question=f"Какой принтер вы имеете в виду{choices}?",
        reason="В каталоге найдено несколько подходящих принтеров.",
    )


def _function_schema(skill) -> dict:
    # Native GigaChat accepts optional scalar fields, but not JSON Schema unions.
    # Strict Pydantic validation remains authoritative before dispatch.
    schema = json.loads(json.dumps(skill.input_schema))
    schema.pop("additionalProperties", None)
    for prop in schema["properties"].values():
        if "anyOf" in prop:
            choices = [part for part in prop.pop("anyOf") if part.get("type") != "null"]
            prop.update(choices[0])
    return {
        "name": skill.name,
        "description": skill.description,
        "parameters": schema,
        "few_shot_examples": [
            {"request": skill.example_request, "params": skill.example_params}
        ],
    }


def input_characters(request: ProviderRequest) -> int:
    # Bound the serialized provider envelope, including JSON escaping of the
    # untrusted JSON payload inside message.content. Unicode uses code points.
    user = json.loads(request.user_payload())
    history = [
        {"name": r.call.name, "arguments": r.call.arguments, "result": r.result}
        for r in request.function_results
    ]
    messages = [
        {"role": "system", "content": request.system_prompt},
        {"role": "user", "content": request.user_payload()},
    ]
    for item in history:
        messages.extend(
            [
                {
                    "role": "assistant",
                    "function_call": {"name": item["name"], "arguments": item["arguments"]},
                },
                {
                    "role": "function",
                    "name": item["name"],
                    "content": json.dumps(item["result"], ensure_ascii=False),
                },
            ]
        )
    native = {"messages": messages, "functions": request.functions}
    if history:
        user["tool_results"] = history
        user["tool_call_used"] = True
    rollback = {
        "messages": [messages[0], {"role": "user", "content": json.dumps(user, ensure_ascii=False)}]
    }
    # Includes fixed SDK/model/options overhead without relying on a provider's
    # current JSON whitespace choices or its schema projection reducing size.
    return (
        max(len(json.dumps(payload, ensure_ascii=False)) for payload in (native, rollback)) + 1024
    )


def _bounded_request(request: ProviderRequest) -> ProviderRequest | None:
    while input_characters(request) > 24000:
        if request.context:
            # Drop the oldest complete turn (user plus following assistant).
            end = next(
                (i for i, m in enumerate(request.context[1:], 1) if m.role == "user"),
                len(request.context),
            )
            request = replace(request, context=request.context[end:])
        elif request.evidence:
            request = replace(request, evidence=request.evidence[:-1])
        else:
            return None
    return request


def route_message(
    hyperpc_config: hyperpc_client.HyperpcConfig | None,
    message: str,
    evidence: list[EvidenceItem],
    *,
    max_response_tokens: int = 800,
    mode: AssistantMode = "global",
    scopes: frozenset[str] = DEFAULT_SCOPES,
    provider: AssistantProvider | None = None,
    context: tuple[ProviderMessage, ...] = (),
    allowed_tools: frozenset[str] = frozenset(),
    execute_tool: ToolExecutor | None = None,
    on_tool_call: Callable[[str], None] | None = None,
    budget: BudgetLedger | None = None,
    correlation_id: str | None = None,
) -> AssistantResult:
    budget = budget or BudgetLedger()
    provider = provider if provider is not None else HyperpcProvider(hyperpc_config)
    available = skills_for(mode, scopes)
    allowed = frozenset(
        s.name
        for s in available
        if not s.mutating and s.name in allowed_tools and execute_tool is not None
    )
    capabilities = _capabilities_answer(message, allowed)
    if capabilities is not None:
        return capabilities
    if _explicitly_out_of_scope(message):
        return _out_of_scope_answer()
    generation_allowed = _generation_requested(message) and any(
        s.name == "generation_offer" for s in available
    )
    if generation_allowed:
        # Creating a new object does not require catalog reads.
        allowed = frozenset()
        evidence = []
    else:
        evidence = list({_id(item): item for item in evidence[:20]}.values())
    results: list[ProviderFunctionResult] = []
    repair = False
    try:
        compared_types = (
            _material_comparison_types(message, context)
            if "compare_material_types" in allowed else []
        )
        if compared_types:
            budget.tool_calls += 1
            attempt = budget.attempt_deadline()
            if on_tool_call is not None:
                on_tool_call("compare_material_types")
            try:
                compared = execute_tool("compare_material_types", {"types": compared_types})
            except ToolGatewayError as exc:
                return _tool_error(retryable=exc.retryable)
            budget.finish_attempt(attempt)
            if compared.resolution == "not_found":
                return AssistantClarification(
                    question="Одно из семейств филамента не найдено среди опубликованных товаров. "
                    "Уточните названия материалов."
                )
            evidence = compared.evidence[:20]
            comparison = compared.material_comparison
            if comparison is None:
                return _tool_error(retryable=False)
            return _comparison_fallback(comparison, evidence)
        # At most three normal provider steps (two reads), plus one shared retry/repair.
        for _ in range(4):
            attempt = budget.attempt_deadline()
            functions = (
                tuple(_function_schema(s) for s in available if s.name in allowed)
                if budget.tool_calls < 2 and not repair
                else ()
            )
            system = load_router_system_prompt() + (
                "\nGeneration offer is allowed."
                if generation_allowed
                else "\nGeneration offer is forbidden."
            )
            if repair:
                system += (
                    "\nRepair: return the allowed terminal JSON or permitted function call. "
                    "Do not return URLs or extra fields."
                )
            request = _bounded_request(
                ProviderRequest(
                    system_prompt=system,
                    message=_redact(message),
                    context=tuple(ProviderMessage(m.role, _redact(m.content)) for m in context),
                    evidence=tuple(_payload(item) for item in evidence),
                    functions=functions,
                    generation_offer_allowed=generation_allowed,
                    # The terminal pass sends normalized tool metadata as user
                    # data, preserving exact periods without native call history.
                    function_results=tuple(results),
                    max_tokens=max(1, min(800, max_response_tokens)),
                    deadline=attempt,
                    timeout_seconds=min(20.0, attempt - time.monotonic()),
                    correlation_id=correlation_id,
                )
            )
            if request is None:
                return AssistantClarification(
                    question="Уточните запрос: доступный контекст превышает лимит."
                )
            # A model can select only evidence actually sent in this pass.
            visible = {e.get("evidence_id", e.get("model_id")) for e in request.evidence}
            by_id = {_id(item): item for item in evidence if _id(item) in visible}
            turn = provider.complete(request)
            budget.finish_attempt(attempt)
            if turn.kind == "error":
                error = turn.error
                if error is not None and error.code == "invalid_output":
                    if budget.retry():
                        repair = True
                        continue
                    return AssistantError(
                        code="invalid_output",
                        message="Некорректный ответ AI-провайдера.",
                        retryable=False,
                    )
                if error is not None and error.retryable and budget.retry():
                    continue
                return (
                    _degraded_answer(evidence)
                    if evidence
                    else _provider_error(error.code if error else "provider_error")
                )
            try:
                parsed = (
                    _validate_call(turn.function_call, allowed)
                    if turn.kind == "function_call" and turn.function_call is not None
                    else _parse_response(
                        turn.text or "",
                        by_id,
                        tool_callable_names=allowed,
                        generation_allowed=generation_allowed,
                    )
                )
            except RouterOutputError:
                if budget.retry():
                    repair = True
                    continue
                return AssistantError(
                    code="invalid_output",
                    message="Некорректный ответ AI-провайдера.",
                    retryable=False,
                )
            if not isinstance(parsed, ProviderFunctionCall):
                budget.check()
                if isinstance(parsed, AssistantAnswer) and parsed.text == _OUT_OF_SCOPE_TEXT:
                    return parsed
                if (
                    isinstance(parsed, AssistantClarification)
                    and not evidence
                    and not results
                    and not generation_allowed
                ):
                    return AssistantClarification(
                        question="Уточните, какой принтер, филамент или новость портала "
                        "вас интересует."
                    )
                if (
                    isinstance(parsed, AssistantAnswer)
                    and not parsed.citations
                    and results
                    and len(evidence) == 1
                ):
                    return AssistantAnswer(
                        text="Найдена запись портала. Подробности в источнике.",
                        citations=[_citation(evidence[0])],
                    )
                if (
                    isinstance(parsed, AssistantAnswer)
                    and not evidence
                    and results
                    and all(item.call.name != "list_news" for item in results)
                ):
                    return AssistantClarification(
                        question="Не нашёл подтверждённых записей по запросу. "
                        "Уточните название принтера или семейство филамента."
                    )
                if isinstance(parsed, AssistantAnswer) and not parsed.citations:
                    return (
                        _empty_news_answer(results) if not evidence else None
                    ) or _ungrounded_answer()
                return parsed
            if budget.tool_calls >= 2:
                return (
                    AssistantAnswer(
                        text="Лимит поиска достигнут. Записи каталога приведены в источниках.",
                        citations=[_citation(e) for e in evidence],
                    )
                    if evidence
                    else AssistantClarification(
                        question="Уточните название принтера для следующего поиска."
                    )
                )
            while True:
                budget.tool_calls += 1
                attempt = budget.attempt_deadline()
                if on_tool_call is not None:
                    on_tool_call(parsed.name)
                try:
                    result = execute_tool(parsed.name, parsed.arguments)
                except ToolGatewayError as exc:
                    return _tool_error(retryable=exc.retryable)
                budget.finish_attempt(attempt)
                if parsed.name == "compare_material_types":
                    if result.material_comparison is None:
                        return _tool_error(retryable=False)
                    return _comparison_fallback(result.material_comparison, result.evidence)
                if result.resolution == "ambiguous":
                    return _ambiguous_printer(result.evidence)
                evidence = _merge_evidence(evidence, result.evidence)
                results.append(
                    ProviderFunctionResult(
                        parsed,
                        {
                            "resolution": result.resolution,
                            "evidence_ids": [_id(e) for e in result.evidence[:10]],
                            **(
                                {"period": result.period.model_dump(by_alias=True)}
                                if result.period is not None
                                else {}
                            ),
                        },
                    )
                )
                if (
                    parsed.name == "get_printer"
                    and result.resolution == "not_found"
                    and "search_printers" in allowed
                    and budget.tool_calls < 2
                ):
                    reference = parsed.arguments.get("slug") or parsed.arguments["printer_id"]
                    search_args = {"query": reference}
                    if "requested_fields" in parsed.arguments:
                        search_args["requested_fields"] = parsed.arguments["requested_fields"]
                    parsed = ProviderFunctionCall("search_printers", search_args)
                    continue
                break
        return AssistantError(
            code="invalid_output", message="Некорректный ответ AI-провайдера.", retryable=False
        )
    except BudgetExpired:
        return _provider_error("provider_timeout")
