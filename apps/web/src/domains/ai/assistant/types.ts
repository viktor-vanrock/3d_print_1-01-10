import type {
  AssistantComparisonField,
  AssistantEvidenceFreshness,
} from "@portal/contracts/http/assistant";

// Реальные типы треда/сообщения/run'а — packages/contracts/http/assistant.ts (assistant.v1,
// MF-1997/MF-1999). Этот файл держит только UI-хелперы поверх контракта, не переопределяет форму
// данных (см. историю: до 2026-07-20 здесь была отдельная fixture-модель с полями status/mode/
// query/messages[]/generation_id, которых на сервере нет — заменено на assistantapi.ts).

export { formatThreadUpdatedAt } from "@shared/lib";

export type AssistantMode = "giga" | "research" | "make";

export function assistantModeUnavailableMessage(mode: AssistantMode): string | null {
  if (mode === "research") return "Исследование появится позже: внешний поиск пока не запускается.";
  return null;
}

const FRESHNESS_LABELS: Record<AssistantEvidenceFreshness, string> = {
  fresh: "Данные актуальны",
  stale: "Цена устарела",
  unknown: "Актуальность неизвестна",
};

export const COMPARISON_FIELD_LABELS: Record<AssistantComparisonField, string> = {
  identity: "Модель",
  release: "Выпуск",
  price_ru_rub: "Цена в России",
  price_msrp_usd: "Рекомендованная цена",
  print_type: "Тип печати",
  kinematics: "Кинематика",
  enclosed: "Закрытый корпус",
  build_volume_mm: "Область печати",
  max_hotend_temperature_c: "Температура сопла",
  max_bed_temperature_c: "Температура стола",
  nozzle: "Сопло",
  multimaterial_supported: "Мультиматериал",
  supported_materials: "Материалы",
  portal_support: "Поддержка портала",
};

export function evidenceFreshnessLabel(freshness: AssistantEvidenceFreshness): string {
  return FRESHNESS_LABELS[freshness];
}
