"""Closed, typed read handlers. Adding a tool requires an explicit code change."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ASSISTANT_SKILLS_CONTRACT_VERSION = "giga.assistant-skills.v2"
AssistantMode = Literal["page", "global", "assistant"]
ASSISTANT_MODES: tuple[AssistantMode, ...] = ("page", "global", "assistant")
SCOPE_CATALOG_READ = "catalog:read"
SCOPE_FEED_READ = "feed:read"
SCOPE_GENERATION_PROPOSE = "generation:propose"
# Compatibility constant for offline callers; lifecycle always supplies live API scopes.
DEFAULT_SCOPES = frozenset({SCOPE_CATALOG_READ, SCOPE_FEED_READ, SCOPE_GENERATION_PROPOSE})


class ReadInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)
    requested_fields: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(
        default_factory=list, max_length=32
    )


class SearchPrintersInput(ReadInput):
    query: str = Field(min_length=1, max_length=200)
    limit: int = Field(default=6, ge=1, le=10)


class GetPrinterInput(ReadInput):
    printer_id: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, min_length=1, max_length=200)

    @model_validator(mode="after")
    def one_reference(self) -> GetPrinterInput:
        if (self.printer_id is None) == (self.slug is None):
            raise ValueError("exactly one printer reference is required")
        return self


class ComparePrintersInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)
    references: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(
        min_length=2, max_length=4
    )
    criteria: str | None = Field(default=None, min_length=1, max_length=300)


class CompareMaterialTypesInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)
    types: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(
        min_length=2, max_length=4
    )

    @model_validator(mode="after")
    def distinct_types(self) -> CompareMaterialTypesInput:
        if len({value.casefold() for value in self.types}) != len(self.types):
            raise ValueError("material types must be distinct")
        return self


class SearchFilamentsInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)
    query: str | None = Field(default=None, min_length=1, max_length=200)
    material_type: str | None = Field(default=None, min_length=1, max_length=100)
    diameter_mm: float | None = Field(default=None, gt=0, le=10)
    color: str | None = Field(default=None, min_length=1, max_length=100)
    limit: int = Field(default=10, ge=1, le=10)


class RecommendFilamentsInput(SearchFilamentsInput):
    printer_id: str | None = Field(default=None, min_length=1, max_length=200)
    user_printer_id: str | None = Field(default=None, min_length=1, max_length=200)

    @model_validator(mode="after")
    def one_printer(self) -> RecommendFilamentsInput:
        if self.printer_id is not None and self.user_printer_id is not None:
            raise ValueError("at most one printer reference is allowed")
        return self


class ListNewsInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, str_strip_whitespace=True, populate_by_name=True
    )
    from_: str | None = Field(default=None, alias="from", min_length=10, max_length=40)
    to: str | None = Field(default=None, min_length=10, max_length=40)
    topic: str | None = Field(default=None, min_length=1, max_length=120)
    limit: int = Field(default=10, ge=1, le=10)

    @model_validator(mode="after")
    def complete_range(self) -> ListNewsInput:
        if (self.from_ is None) != (self.to is None):
            raise ValueError("from and to must be supplied together")
        return self


@dataclass(frozen=True)
class AssistantSkillSpec:
    name: str
    description: str
    input_schema: dict
    example_request: str
    example_params: dict
    required_scope: str
    mutating: bool = False
    modes: frozenset[AssistantMode] = frozenset(ASSISTANT_MODES)


# The same fixed map validates and dispatches reads; no dynamic registration/imports.
READ_INPUTS = MappingProxyType(
    {
        "search_printers": SearchPrintersInput,
        "get_printer": GetPrinterInput,
        "compare_printers": ComparePrintersInput,
        "compare_material_types": CompareMaterialTypesInput,
        "search_filaments": SearchFilamentsInput,
        "recommend_filaments": RecommendFilamentsInput,
        "list_news": ListNewsInput,
    }
)
SKILL_REGISTRY = MappingProxyType(
    {
        **{
            name: AssistantSkillSpec(
                name=name,
                description={
                    "search_printers": "Поиск публичных принтеров по имени или модели.",
                    "get_printer": "Публичная карточка принтера по точному id или slug.",
                    "search_filaments": (
                        "Поиск опубликованного филамента по явному семейству, диаметру и цвету. "
                        "Не выводите material_type из назначения: сначала уточните семейство."
                    ),
                    "recommend_filaments": (
                        "Подбор до пяти филаментов по серверным правилам совместимости. "
                        "printer_id — публичный принтер; "
                        "user_printer_id — свой экземпляр или primary. "
                        "Если нужный принтер неоднозначен, сначала уточните его."
                        " Если указано только назначение без явного material_type, "
                        "задайте один вопрос о семействе; не выводите его из знаний модели."
                    ),
                    "compare_printers": (
                        "Детерминированное сравнение 2–4 публичных принтеров по id, slug "
                        "или названию. Не выбирает лучший принтер без явного критерия."
                    ),
                    "compare_material_types": (
                        "Сравнение 2–4 семейств филамента по опубликованным товарам портала: "
                        "температуры сопла и стола, требования к закрытому корпусу. "
                        "Семейства передаются как slug, например abs и pla. "
                        "Это не сравнение конкретных брендов."
                    ),
                    "list_news": (
                        "Список видимых опубликованных новостей портала за точный период. "
                        "Без периода сервер использует последние 30 календарных дней."
                    ),
                }[name],
                input_schema=input_model.model_json_schema(),
                example_request={
                    "search_printers": "Найди принтер Bambu Lab P1S.",
                    "get_printer": "Покажи карточку принтера bambu-lab-p1s.",
                    "search_filaments": "Найди PLA-филамент диаметром 1,75 мм.",
                    "recommend_filaments": "Подбери PLA для принтера bambu-lab-p1s.",
                    "compare_printers": "Сравни Bambu Lab P1S и Creality K1 по цене.",
                    "compare_material_types": (
                        "Сравни ABS и PLA по температуре и простоте печати."
                    ),
                    "list_news": "Что нового в 3D-печати?",
                }[name],
                example_params={
                    "search_printers": {"query": "Bambu Lab P1S"},
                    "get_printer": {"slug": "bambu-lab-p1s"},
                    "search_filaments": {"material_type": "PLA"},
                    "recommend_filaments": {
                        "material_type": "PLA",
                        "printer_id": "bambu-lab-p1s",
                    },
                    # IFT `/functions/validate` rejects array values inside
                    # few-shot params even though the function schema supports
                    # them. Keep the request example and let the authoritative
                    # schema describe the required references array.
                    "compare_printers": {},
                    "compare_material_types": {},
                    "list_news": {"topic": "3D-печать"},
                }[name],
                required_scope=(SCOPE_FEED_READ if name == "list_news" else SCOPE_CATALOG_READ),
            )
            for name, input_model in READ_INPUTS.items()
        },
        "generation_offer": AssistantSkillSpec(
            name="generation_offer",
            description="Только предложение генерации, требующее отдельного подтверждения.",
            input_schema={"type": "object", "properties": {}},
            example_request="Предложи создать простую подставку.",
            example_params={},
            required_scope=SCOPE_GENERATION_PROPOSE,
            mutating=True,
            modes=frozenset({"global", "assistant"}),
        ),
    }
)


def skills_for(mode: AssistantMode, scopes: frozenset[str]) -> list[AssistantSkillSpec]:
    return [s for s in SKILL_REGISTRY.values() if mode in s.modes and s.required_scope in scopes]
