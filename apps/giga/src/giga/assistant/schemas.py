"""Контракт RAG/clarification runner'а (MF-2000): `giga.assistant-run.v1`.

Каноническая TS-форма опубликована в
`packages/contracts/http/assistant.ts::AssistantRunResult`; эта Pydantic-схема
типизирует тот же discriminated union на стороне Giga runtime.

Дискриминатор `kind` — тот же приём, что различает результат на четыре формы
без отдельных эндпоинтов: LLM решает только между `answer`/`clarification`/
`generation_offer` (не может выбрать `error` — это код-уровня результат,
LLM никогда не значит "у меня ошибка", `error` строится только `router.py`
на таймаут/невалидный ответ провайдера, а не как выбор модели).
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import parse_qsl, unquote, urlsplit

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_serializer,
    model_validator,
)

ASSISTANT_RUN_CONTRACT_VERSION = "giga.assistant-run.v1"
ASSISTANT_EVIDENCE_CONTRACT_VERSION = "assistant.evidence.v2"

# Тот же словарь веток, что `generations.branch` (MF-351/apps/api/db baseline) —
# generation_offer предлагает конкретную ветку генерации, не абстрактную "да".
GenerationBranch = Literal["openscad", "kzd", "hueforge", "trellis", "rudalle"]

ErrorCode = Literal["provider_timeout", "provider_error", "tool_error", "invalid_output"]

EvidenceEntityType = Literal[
    "model", "printer", "comparison", "machine", "user_printer", "material", "news"
]
EvidenceFreshness = Literal["fresh", "stale", "unknown"]
EvidenceQuality = Literal["verified", "reported", "inferred", "unknown"]


class StrictEvidenceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_max_length=300, allow_inf_nan=False)


EVIDENCE_TITLE_MAX = 300
EVIDENCE_SNIPPET_MAX = 2000
EVIDENCE_SOURCE_REFS_MAX = 8
EVIDENCE_MISSING_FIELDS_MAX = 32
EVIDENCE_FACT_ITEMS_MAX = 32
COMPARISON_FIELDS = (
    "identity",
    "release",
    "price_ru_rub",
    "price_msrp_usd",
    "print_type",
    "kinematics",
    "enclosed",
    "build_volume_mm",
    "max_hotend_temperature_c",
    "max_bed_temperature_c",
    "nozzle",
    "multimaterial_supported",
    "supported_materials",
    "portal_support",
)


def _valid_public_url(value: str, *, allow_relative: bool) -> bool:
    if not value or re.search(r"[\\\s#]", value) or re.search(r"%(?![0-9a-fA-F]{2})", value):
        return False
    decoded = unquote(value)
    if re.search(r"[\\\s#]", decoded):
        return False
    if allow_relative and (not value.startswith("/") or decoded.startswith("//")):
        return False
    try:
        parsed = urlsplit("https://portal.invalid" + value if allow_relative else value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
        ):
            return False
        if parsed.port is not None and not 0 <= parsed.port <= 65535:
            return False
        return not any(
            re.search(
                r"token|api.?key|^key$|signature|^sig$|auth|password|passwd|secret|credential|session|cookie",
                key,
                re.I,
            )
            for key, _ in parse_qsl(parsed.query, keep_blank_values=True)
        )
    except ValueError:
        return False


def _validate_timestamp(value: str | None) -> str | None:
    if value is None:
        return None
    if not re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)",
        value,
    ):
        raise ValueError("timestamp must be timezone-qualified RFC3339")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("timestamp must be a real calendar date") from exc
    return value


def _validate_price_freshness(
    freshness: str | None, reason: str | None, updated_at: str | None, *, usd_only: bool
) -> None:
    if freshness is None:
        raise ValueError("price requires freshness")
    if usd_only:
        if (
            freshness != "unknown"
            or updated_at is not None
            or reason != "price_msrp_has_no_observation_date"
        ):
            raise ValueError("USD MSRP has no observation date")
    elif freshness != "unknown" and (updated_at is None or not reason):
        raise ValueError("fresh/stale price requires date and reason")


class EvidenceSourceRef(StrictEvidenceModel):
    label: str
    url: str | None

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str | None) -> str | None:
        if value is not None and not _valid_public_url(value, allow_relative=False):
            raise ValueError("source URL must be credential-free HTTP(S)")
        return value


class EvidencePriceFact(StrictEvidenceModel):
    amount: float
    currency: Literal["RUB", "USD"]


class ModelFacts(StrictEvidenceModel):
    kind: Literal["model"]
    format: str | None = None


class PrinterBuildVolume(StrictEvidenceModel):
    x: float
    y: float
    z: float


class PrinterFacts(StrictEvidenceModel):
    kind: Literal["printer"]
    brand: str | None = None
    model: str | None = None
    product_status: str | None = None
    release_date: str | None = None
    price_ru_rub: EvidencePriceFact | None = None
    price_msrp_usd: EvidencePriceFact | None = None
    print_type: str | None = None
    kinematics: str | None = None
    enclosed: bool | None = None
    build_volume_mm: PrinterBuildVolume | None = None
    max_hotend_temperature_c: float | None = None
    max_bed_temperature_c: float | None = None
    nozzle_material: str | None = None
    nozzle_hardened: bool | None = None
    nozzle_replaceable: bool | None = None
    multimaterial_supported: bool | None = None
    supported_materials: list[str] = Field(default_factory=list, max_length=EVIDENCE_FACT_ITEMS_MAX)
    unique_features: list[str] = Field(default_factory=list, max_length=EVIDENCE_FACT_ITEMS_MAX)
    support_level: str | None = None
    public_firmware_ready: bool | None = None

    @model_validator(mode="after")
    def validate_price_currencies(self) -> PrinterFacts:
        if self.price_ru_rub is not None and self.price_ru_rub.currency != "RUB":
            raise ValueError("price_ru_rub must use RUB")
        if self.price_msrp_usd is not None and self.price_msrp_usd.currency != "USD":
            raise ValueError("price_msrp_usd must use USD")
        return self


class MachineFacts(StrictEvidenceModel):
    kind: Literal["machine"]
    brand: str | None = None
    model: str | None = None
    active: bool | None = None
    nozzle_material: str | None = None
    nozzle_diameter_mm: float | None = None
    enclosed: bool | None = None
    direct_drive: bool | None = None


class UserPrinterFacts(StrictEvidenceModel):
    kind: Literal["user_printer"]
    display_name: str | None = None
    primary: bool | None = None
    catalog_printer_id: str | None = None
    machine_id: str | None = None


class CompatibilityReason(StrictEvidenceModel):
    code: str
    severity: Literal["warn", "blocked"]
    message: str


class FilamentPrinterCapabilities(StrictEvidenceModel):
    max_hotend_temp_c: float | None = Field(default=None, gt=0)
    filament_dia_mm: float | None = Field(default=None, gt=0)
    nozzle_hardened: bool | None = None
    chamber: Literal["none", "passive", "active"] | None = None
    extruder_drive: Literal["direct", "bowden"] | None = None

    @model_serializer(mode="wrap")
    def serialize(self, handler):
        return {key: value for key, value in handler(self).items() if value is not None}


class MaterialFacts(StrictEvidenceModel):
    kind: Literal["material"]
    printer_label: str | None = None
    printer_capabilities: FilamentPrinterCapabilities | None = None
    variant_id: str | None = None
    machine_id: str | None = None
    catalog_printer_id: str | None = None
    user_printer_id: str | None = None
    compatibility: Literal["compatible", "conditional", "insufficient_data"] | None = None
    compatibility_reasons: list[CompatibilityReason] = Field(default_factory=list, max_length=32)
    ranking_criterion: str | None = None
    brand: str | None = None
    name: str | None = None
    material_type: str | None = None
    color: str | None = None
    diameter_mm: float | None = None
    abrasive: bool | None = None
    price_ru_rub: EvidencePriceFact | None = None

    @model_serializer(mode="wrap")
    def serialize(self, handler):
        data = handler(self)
        for field in (
            "variant_id",
            "machine_id",
            "catalog_printer_id",
            "user_printer_id",
            "compatibility",
            "compatibility_reasons",
            "ranking_criterion",
            "printer_label",
            "printer_capabilities",
        ):
            if field not in self.model_fields_set:
                data.pop(field, None)
        return data

    @model_validator(mode="after")
    def validate_price_currency(self) -> MaterialFacts:
        if self.price_ru_rub is not None and self.price_ru_rub.currency != "RUB":
            raise ValueError("price_ru_rub must use RUB")
        return self


class NewsFacts(StrictEvidenceModel):
    kind: Literal["news"]
    effective_published_at: str | None = None
    topic: str | None = None

    _validate_published_at = field_validator("effective_published_at")(_validate_timestamp)


class ComparisonCell(StrictEvidenceModel):
    state: Literal["equal", "different", "missing", "stale"]
    normalized_value: str | float | bool | None
    display_value: str | None
    unit: Literal["RUB", "USD", "mm", "C"] | None
    price_updated_at: str | None = None
    freshness: EvidenceFreshness | None = None
    freshness_reason: str | None = None

    _validate_price_updated_at = field_validator("price_updated_at")(_validate_timestamp)

    @model_serializer(mode="wrap")
    def serialize(self, handler):
        data = handler(self)
        for key in ("price_updated_at", "freshness", "freshness_reason"):
            if key not in self.model_fields_set:
                data.pop(key, None)
        return data


class ComparisonRow(StrictEvidenceModel):
    field: Literal[
        "identity",
        "release",
        "price_ru_rub",
        "price_msrp_usd",
        "print_type",
        "kinematics",
        "enclosed",
        "build_volume_mm",
        "max_hotend_temperature_c",
        "max_bed_temperature_c",
        "nozzle",
        "multimaterial_supported",
        "supported_materials",
        "portal_support",
    ]
    cells: list[ComparisonCell] = Field(min_length=2, max_length=4)


class ComparisonFacts(StrictEvidenceModel):
    kind: Literal["comparison"]
    printer_ids: list[Annotated[str, Field(min_length=1)]] = Field(min_length=2, max_length=4)
    rows: list[ComparisonRow] = Field(
        min_length=len(COMPARISON_FIELDS), max_length=len(COMPARISON_FIELDS)
    )

    @model_validator(mode="after")
    def validate_matrix(self) -> ComparisonFacts:
        if len(set(self.printer_ids)) != len(self.printer_ids):
            raise ValueError("comparison printer IDs must be distinct")
        if tuple(row.field for row in self.rows) != COMPARISON_FIELDS:
            raise ValueError("comparison requires the fixed ordered fields")
        for row in self.rows:
            if len(row.cells) != len(self.printer_ids):
                raise ValueError("comparison cells must match ordered printer IDs")
            unit = {
                "price_ru_rub": "RUB",
                "price_msrp_usd": "USD",
                "build_volume_mm": "mm",
                "max_hotend_temperature_c": "C",
                "max_bed_temperature_c": "C",
            }.get(row.field)
            for cell in row.cells:
                if cell.unit != unit or (cell.state == "missing") != (
                    cell.normalized_value is None
                ):
                    raise ValueError("comparison unit/value does not match field/state")
                if unit in {"RUB", "USD"}:
                    if (
                        not {"price_updated_at", "freshness", "freshness_reason"}
                        <= cell.model_fields_set
                    ):
                        raise ValueError("price cell requires dated freshness metadata")
                    _validate_price_freshness(
                        cell.freshness,
                        cell.freshness_reason,
                        cell.price_updated_at,
                        usd_only=unit == "USD",
                    )
                    if (cell.state == "stale") != (cell.freshness == "stale") or (
                        cell.state == "missing" and cell.freshness != "unknown"
                    ):
                        raise ValueError("comparison price state and freshness disagree")
                elif (
                    cell.state == "stale"
                    or {"price_updated_at", "freshness", "freshness_reason"} & cell.model_fields_set
                ):
                    raise ValueError("static cells omit freshness")
        return self


EvidenceFacts = Annotated[
    ModelFacts
    | PrinterFacts
    | ComparisonFacts
    | MachineFacts
    | UserPrinterFacts
    | MaterialFacts
    | NewsFacts,
    Field(discriminator="kind"),
]


class Citation(BaseModel):
    """Собирается ИСКЛЮЧИТЕЛЬНО из наших же `evidence.Evidence` по `model_id`,
    который LLM разрешено выбрать — текст сниппета/название/ссылка берутся из
    нашей evidence-записи, не из того, что дописала модель в ответе (модель
    не может подменить контент цитаты, только выбрать/отбросить id — см.
    `router._citations_from_ids`)."""

    model_id: str
    title: str
    snippet: str
    score: float
    source_url: str | None = None


class EvidenceCitation(StrictEvidenceModel):
    """`assistant.evidence.v2`: server-owned citation safe for provider/UI transport."""

    evidence_id: str = Field(min_length=1)
    entity_type: EvidenceEntityType
    entity_id: str = Field(min_length=1)
    title: str = Field(max_length=EVIDENCE_TITLE_MAX)
    snippet: str = Field(max_length=EVIDENCE_SNIPPET_MAX)
    canonical_url: str | None
    facts: EvidenceFacts
    source_refs: list[EvidenceSourceRef] = Field(max_length=EVIDENCE_SOURCE_REFS_MAX)
    source_published_at: str | None
    observed_at: str | None
    updated_at: str | None
    price_updated_at: str | None
    freshness: EvidenceFreshness | None = None
    freshness_reason: str | None = None
    quality: EvidenceQuality
    missing_fields: list[str] = Field(max_length=EVIDENCE_MISSING_FIELDS_MAX)

    _validate_source_published_at = field_validator("source_published_at")(_validate_timestamp)
    _validate_observed_at = field_validator("observed_at")(_validate_timestamp)
    _validate_updated_at = field_validator("updated_at")(_validate_timestamp)
    _validate_price_updated_at = field_validator("price_updated_at")(_validate_timestamp)

    @field_validator("canonical_url")
    @classmethod
    def validate_canonical_url(cls, value: str | None) -> str | None:
        if value is not None and not _valid_public_url(value, allow_relative=True):
            raise ValueError("canonical URL must be a safe portal-relative path")
        return value

    @model_validator(mode="after")
    def validate_entity_and_freshness(self) -> EvidenceCitation:
        if self.entity_type != self.facts.kind:
            raise ValueError("facts.kind must match entity_type")
        rub = getattr(self.facts, "price_ru_rub", None) is not None
        usd = getattr(self.facts, "price_msrp_usd", None) is not None
        if isinstance(self.facts, NewsFacts):
            if (
                self.price_updated_at is not None
                or self.freshness is None
                or not self.freshness_reason
            ):
                raise ValueError("news requires freshness and reason, without price date")
            if self.facts.effective_published_at is None and (
                self.freshness != "unknown"
                or self.freshness_reason != "news_missing_effective_published_at"
            ):
                raise ValueError("undated news requires unknown freshness and missing-date reason")
        elif rub or usd:
            if "freshness_reason" not in self.model_fields_set:
                raise ValueError("price requires freshness_reason")
            _validate_price_freshness(
                self.freshness,
                self.freshness_reason,
                self.price_updated_at,
                usd_only=not rub and usd,
            )
        elif (
            self.price_updated_at is not None
            or {"freshness", "freshness_reason"} & self.model_fields_set
        ):
            raise ValueError("static evidence omits freshness")
        return self

    @model_serializer(mode="wrap")
    def serialize(self, handler):
        data = handler(self)
        if "freshness" not in self.model_fields_set:
            data.pop("freshness", None)
            data.pop("freshness_reason", None)
        return data


class AssistantAnswer(BaseModel):
    kind: Literal["answer"] = "answer"
    text: str
    citations: list[Citation | EvidenceCitation] = Field(default_factory=list)
    note: str | None = None


class AssistantClarification(BaseModel):
    """Одно поле `question` — не список: схема сама структурно не даёт LLM
    задать больше одного уточнения за раз (MF-2000 «Готово когда»: обычно не
    более одного полезного уточнения)."""

    kind: Literal["clarification"] = "clarification"
    question: str
    reason: str | None = None


class AssistantGenerationOffer(BaseModel):
    """Только предложение — сама генерация НЕ запускается отсюда. Side effect
    (реальный `generations`-job) создаёт `POST /assistant/threads/:id/generations`
    (MF-1997, Back) отдельным явным подтверждением пользователя, эта форма —
    просто описание, что можно было бы сгенерировать."""

    kind: Literal["generation_offer"] = "generation_offer"
    branch: GenerationBranch
    prompt_summary: str
    note: str | None = None


class AssistantError(BaseModel):
    kind: Literal["error"] = "error"
    code: ErrorCode
    message: str
    retryable: bool


AssistantResult = Annotated[
    AssistantAnswer | AssistantClarification | AssistantGenerationOffer | AssistantError,
    Field(discriminator="kind"),
]


class AssistantRunRequest(BaseModel):
    thread_id: str = Field(min_length=1)
    message: str = Field(min_length=1, max_length=4000)
    evidence_limit: int = Field(default=6, ge=0, le=20)


class AssistantRunResponse(BaseModel):
    contract_version: str = ASSISTANT_RUN_CONTRACT_VERSION
    thread_id: str
    result: AssistantResult
