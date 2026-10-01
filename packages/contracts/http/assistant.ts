/**
 * Приватные assistant threads/messages/runs — `assistant.v1` (MF-1999, поверх фактической
 * реализации MF-1997/apps/api/src/assistant + MF-2000/apps/giga/src/giga/assistant). Продюсер —
 * новый домен `apps/api/src/assistant` (owner AI, см. CODEOWNERS); консюмер — `apps/web`
 * (экран «ассистент сборки»). CRUD threads/messages/runs — cursor-пагинация (`AssistantCursorPage`),
 * идемпотентность создания через обязательный `client_request_id` в body.
 *
 * Result union (дискриминант `kind` — то же имя поля, что реально пишет
 * `apps/giga/src/giga/assistant/schemas.py::AssistantResult`, а не `type` из первоначального
 * текста решения MF-1999 — здесь контракт документирует форму, которая уже сериализуется в
 * `assistant_runs.result` jsonb, а не переизобретает имя поля). `search_results`/
 * `generation_progress` — часть контракта (будущие продюсеры, см. MF-1998/MF-2001), сегодняшний
 * `assistant-run.v1` (giga RAG-раннер) — заведомое подмножество:
 * `answer|clarification|generation_offer|error`, см. `docs/contracts/assistant.run.v1.md`
 * § «Соответствие полей».
 */

// `packages/contracts` не импортирует из apps/* (зависимость только в одну сторону — apps/api и
// apps/web зависят от @portal/contracts, не наоборот, см. apps/api/package.json). Поэтому
// GENERATION_BRANCHES/PROMPT_MAX_LENGTH/PARAMS_MAX_JSON_BYTES здесь НЕ копируются повторно —
// единственный источник истины остаётся apps/api/src/generations/contract.ts, и обе точки
// реального рантайм-использования offer'а (apps/api/src/generations/create.ts — уже сегодня;
// apps/api/src/assistant/generations.ts — при подтверждении offer'а) импортируют его оттуда
// напрямую (тот же app, без layering-нарушения). Guard ниже проверяет только форму/непустоту.
export type GenerationBranch = string;

export const ASSISTANT_CONTRACT_VERSION = "assistant.v1" as const;
export const ASSISTANT_EVIDENCE_CONTRACT_VERSION =
  "assistant.evidence.v2" as const;

export const ASSISTANT_MESSAGE_ROLES = ["user", "assistant"] as const;
export type AssistantMessageRole = (typeof ASSISTANT_MESSAGE_ROLES)[number];

export const ASSISTANT_RUN_STATUSES = [
  "queued",
  "running",
  "done",
  "error",
] as const;
export type AssistantRunStatus = (typeof ASSISTANT_RUN_STATUSES)[number];

// Полный дискриминант union'а результата (§2 контракт-решения MF-1999). result_type — эхо
// result.kind на строке assistant_runs (см. isAssistantRunResult ниже) — колонка ограничена тем
// же словарём. search_results/generation_progress сегодня не эмитятся ни одним продюсером
// (giga.assistant-run.v1 — подмножество из 4), но входят в контракт, а не только в реализацию.
export const ASSISTANT_RESULT_KINDS = [
  "search_results",
  "clarification",
  "answer",
  "generation_offer",
  "generation_progress",
  "error",
] as const;
export type AssistantResultKind = (typeof ASSISTANT_RESULT_KINDS)[number];

/** Подмножество, которое реально может записать giga.assistant-run.v1 (jobs/giga.ts). */
export const ASSISTANT_RUN_RESULT_TYPES = [
  "answer",
  "clarification",
  "generation_offer",
  "error",
] as const;
export type AssistantRunResultType =
  (typeof ASSISTANT_RUN_RESULT_TYPES)[number];

export const ASSISTANT_ERROR_CODES = [
  "provider_timeout",
  "provider_error",
  "tool_error",
  "invalid_output",
] as const;
export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];

export interface AssistantThread {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssistantMessage {
  id: string;
  thread_id: string;
  role: AssistantMessageRole;
  content: string;
  run_id: string | null;
  created_at: string;
}

/**
 * Ссылка на элемент результата поиска — тот же тип, что элемент `http/search.ts::model-search.v1`
 * (MF-2013, ещё не смёржен). До появления файла держим минимальную структурную форму здесь;
 * когда `http/search.ts` landится — это поле переключается на импорт, не копию (§2 решения).
 */
export interface AssistantSearchResultItem {
  model_id: string;
  title: string;
  relevance_rank: number;
}

export interface AssistantSearchResults {
  kind: "search_results";
  query: string;
  items: AssistantSearchResultItem[];
}

export interface AssistantClarification {
  kind: "clarification";
  /** Одно поле, не список — структурно не более одного уточнения за раз. */
  question: string;
  reason?: string | null;
}

export interface AssistantLegacyCitation {
  model_id: string;
  evidence_id?: never;
  entity_type?: never;
  entity_id?: never;
  title: string;
  snippet: string;
  score: number;
  source_url?: string | null;
}

export const ASSISTANT_EVIDENCE_ENTITY_TYPES = [
  "model",
  "printer",
  "comparison",
  "machine",
  "user_printer",
  "material",
  "news",
] as const;
export type AssistantEvidenceEntityType =
  (typeof ASSISTANT_EVIDENCE_ENTITY_TYPES)[number];

export const ASSISTANT_EVIDENCE_FRESHNESS_VALUES = [
  "fresh",
  "stale",
  "unknown",
] as const;
export type AssistantEvidenceFreshness =
  (typeof ASSISTANT_EVIDENCE_FRESHNESS_VALUES)[number];

export const ASSISTANT_EVIDENCE_QUALITY_VALUES = [
  "verified",
  "reported",
  "inferred",
  "unknown",
] as const;
export type AssistantEvidenceQuality =
  (typeof ASSISTANT_EVIDENCE_QUALITY_VALUES)[number];

// Bounds are mirrored by the Python evidence schema; fixtures exercise both validators.
export const ASSISTANT_EVIDENCE_LIMITS = {
  title: 300, snippet: 2000, text: 300, sourceRefs: 8, missingFields: 32, factItems: 32,
  printers: 4,
} as const;
export const ASSISTANT_COMPARISON_FIELDS = [
  "identity", "release", "price_ru_rub", "price_msrp_usd", "print_type", "kinematics",
  "enclosed", "build_volume_mm", "max_hotend_temperature_c", "max_bed_temperature_c",
  "nozzle", "multimaterial_supported", "supported_materials", "portal_support",
] as const;
export type AssistantComparisonField = (typeof ASSISTANT_COMPARISON_FIELDS)[number];
export interface AssistantComparisonCell {
  state: "equal" | "different" | "missing" | "stale";
  normalized_value: string | number | boolean | null;
  display_value: string | null;
  unit: "RUB" | "USD" | "mm" | "C" | null;
  price_updated_at?: string | null;
  freshness?: AssistantEvidenceFreshness;
  freshness_reason?: string | null;
}
export interface AssistantComparisonFacts {
  kind: "comparison";
  /** Columns preserve the caller's order; every row has one cell per printer. */
  printer_ids: string[];
  rows: { field: AssistantComparisonField; cells: AssistantComparisonCell[] }[];
}

export interface AssistantEvidenceSourceRef {
  label: string;
  url: string | null;
}

export interface AssistantEvidencePriceFact {
  amount: number;
  currency: "RUB" | "USD";
}

export interface AssistantModelFacts {
  kind: "model";
  format?: string | null;
}

export interface AssistantPrinterFacts {
  kind: "printer";
  brand?: string | null;
  model?: string | null;
  product_status?: string | null;
  release_date?: string | null;
  price_ru_rub?: AssistantEvidencePriceFact | null;
  price_msrp_usd?: AssistantEvidencePriceFact | null;
  print_type?: string | null;
  kinematics?: string | null;
  enclosed?: boolean | null;
  build_volume_mm?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  } | null;
  max_hotend_temperature_c?: number | null;
  max_bed_temperature_c?: number | null;
  nozzle_material?: string | null;
  nozzle_hardened?: boolean | null;
  nozzle_replaceable?: boolean | null;
  multimaterial_supported?: boolean | null;
  supported_materials?: string[];
  unique_features?: string[];
  support_level?: string | null;
  public_firmware_ready?: boolean | null;
}

export interface AssistantMachineFacts {
  kind: "machine";
  brand?: string | null;
  model?: string | null;
  active?: boolean | null;
  nozzle_material?: string | null;
  nozzle_diameter_mm?: number | null;
  enclosed?: boolean | null;
  direct_drive?: boolean | null;
}

export interface AssistantUserPrinterFacts {
  kind: "user_printer";
  display_name?: string | null;
  primary?: boolean | null;
  catalog_printer_id?: string | null;
  machine_id?: string | null;
}

export interface AssistantFilamentPrinterCapabilities {
  max_hotend_temp_c?: number;
  filament_dia_mm?: number;
  nozzle_hardened?: boolean;
  chamber?: "none" | "passive" | "active";
  extruder_drive?: "direct" | "bowden";
}

export interface AssistantMaterialFacts {
  kind: "material";
  printer_label?: string;
  printer_capabilities?: AssistantFilamentPrinterCapabilities;
  variant_id?: string;
  machine_id?: string;
  catalog_printer_id?: string;
  user_printer_id?: string;
  compatibility?: "compatible" | "conditional" | "insufficient_data";
  compatibility_reasons?: { code: string; severity: "warn" | "blocked"; message: string }[];
  ranking_criterion?: string;
  brand?: string | null;
  name?: string | null;
  material_type?: string | null;
  color?: string | null;
  diameter_mm?: number | null;
  abrasive?: boolean | null;
  price_ru_rub?: AssistantEvidencePriceFact | null;
}

export interface AssistantNewsFacts {
  kind: "news";
  effective_published_at?: string | null;
  topic?: string | null;
}

/** Закрытый union: новые предметные поля добавляются явно вместе с обоими consumers. */
export type AssistantEvidenceFacts =
  | AssistantModelFacts
  | AssistantPrinterFacts
  | AssistantComparisonFacts
  | AssistantMachineFacts
  | AssistantUserPrinterFacts
  | AssistantMaterialFacts
  | AssistantNewsFacts;

export interface AssistantEvidenceCitation {
  model_id?: never;
  evidence_id: string;
  entity_type: AssistantEvidenceEntityType;
  entity_id: string;
  title: string;
  snippet: string;
  canonical_url: string | null;
  facts: AssistantEvidenceFacts;
  source_refs: AssistantEvidenceSourceRef[];
  source_published_at: string | null;
  observed_at: string | null;
  updated_at: string | null;
  price_updated_at: string | null;
  freshness?: AssistantEvidenceFreshness;
  freshness_reason?: string | null;
  quality: AssistantEvidenceQuality;
  missing_fields: string[];
}

export type AssistantCitation =
  AssistantLegacyCitation | AssistantEvidenceCitation;

export interface AssistantAnswer {
  kind: "answer";
  text: string;
  citations: AssistantCitation[];
  note?: string | null;
}

/**
 * Только предложение — инертна, не запускает генерацию. `offer_id` — идентичность подтверждения
 * (`ConfirmAssistantGenerationRequest.run_id`), сегодня 1:1 с породившим run — отдельного
 * synthetic id продюсер не заводит. `prompt_summary` — то, что реально пишет
 * `AssistantGenerationOffer` (giga/assistant/schemas.py); `POST /assistant/threads/:id/generations`
 * передаёт его как `prompt` в `createGeneration` (apps/api/src/generations/create.ts), где он же
 * проходит `PROMPT_MAX_LENGTH`. `params` — опционален, giga-раннер сегодня его не заполняет
 * (default `{}`), но поле часть контракта на будущее (напр. structured branch params).
 */
export interface AssistantGenerationOffer {
  kind: "generation_offer";
  offer_id: string;
  branch: GenerationBranch;
  prompt_summary: string;
  params?: Record<string, unknown>;
  note?: string | null;
}

/** Тонкий passthrough — assistant не владеет состоянием генерации, только ссылается на неё. */
export interface AssistantGenerationProgress {
  kind: "generation_progress";
  generation_id: string;
  status: string;
}

export interface AssistantError {
  kind: "error";
  code: AssistantErrorCode;
  message: string;
  retryable?: boolean;
}

export type AssistantRunResult =
  | AssistantSearchResults
  | AssistantClarification
  | AssistantAnswer
  | AssistantGenerationOffer
  | AssistantGenerationProgress
  | AssistantError;

// Amendment к MF-1999 §2/§4 (комментарий Contract Architect на MF-1999, «run/generation progress
// snapshot + SSE»): позиция ВНУТРИ генерации, осмысленна только при status='running' и только для
// run'ов, реально идущих через генерацию (generate_3d/revise_3d) — для clarify/answer нет фазы,
// AssistantRun.progress остаётся null. Отдельная ось от status (грубый жизненный цикл run'а) и от
// верхнеуровневых queue_position/eta_seconds на AssistantRun (те — позиция во внешней очереди
// job'а целиком, до старта генерации, живой read-time расчёт из assistant/queue.ts).
//
// Правка MF-2014 (второй проход Contract Architect): queue_position убран отсюда — на AssistantRun
// это read-time позиция во внешней очереди, здесь был бы второй, потенциально расходящийся
// источник тех же данных, который писала бы другая часть воркера. eta_seconds ОСТАЁТСЯ — это не
// дубликат верхнеуровневого поля (то — только пока status='queued', это — только пока
// status='running', пересечения по времени нет), а гранулярная оценка "сколько ещё осталось" уже
// идущему пайплайну генерации; это ровно то, что реально пишет apps/giga (MF-2001,
// generations.eta_seconds — БД-колонка, apps/api/src/generations/contract.ts::generationProgress).
export const RUN_PHASES = [
  "queued",
  "loading",
  "draft",
  "geometry",
  "validation",
  "export",
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

/**
 * Жёсткое правило (та же дисциплина, что search-score в §1 решения MF-1999): только сервер
 * публикует progress/eta_seconds — фронт НЕ интерполирует и не дорисовывает процент/оставшееся
 * время между снапшотами. `progress: null` — фаза без осмысленного процента (напр. `queued`);
 * `estimate_updated_at: null` — сервер ещё не публиковал оценку.
 */
export interface RunProgressSnapshot {
  phase: RunPhase;
  progress: number | null;
  eta_seconds: number | null;
  estimate_updated_at: string | null;
}

export interface AssistantRun {
  id: string;
  thread_id: string;
  triggering_message_id: string;
  status: AssistantRunStatus;
  result_type: AssistantResultKind | null;
  result: Record<string, unknown>;
  error_code: string | null;
  confirmed_generation_id: string | null;
  // Живая позиция в очереди / грубая оценка ожидания (только пока status='queued', иначе null) —
  // считается на лету из БД, не из памяти соединения, поэтому одинаково доступна и в SSE-снапшоте,
  // и в обычном поллинге после deep-link восстановления без открытого SSE (см. apps/api/src/
  // assistant/queue.ts).
  queue_position: number | null;
  eta_seconds: number | null;
  // Присутствует только пока run реально идёт через генерацию — null для clarify/answer и пока
  // генерация не началась. См. RunProgressSnapshot выше.
  progress?: RunProgressSnapshot | null;
  created_at: string;
  updated_at: string;
}

// SSE-события GET /assistant/runs/:id/events (apps/api/src/assistant/events.ts). Сегодня один
// run даёт максимум одно 'assistant.delta' (воркер MF-2000 пишет результат атомарно, не
// построково) + ровно одно терминальное событие; формат уже рассчитан на будущий построковый
// стриминг — тогда один run будет давать много 'assistant.delta' подряд, контракт не меняется.
export const ASSISTANT_RUN_EVENT_TYPES = [
  "assistant.delta",
  "assistant.completed",
  "assistant.error",
] as const;
export type AssistantRunEventType = (typeof ASSISTANT_RUN_EVENT_TYPES)[number];

// seq — монотонный per-run счётчик, стартует с 1; это же значение отправляется как SSE `id:` и
// принимается сервером обратно в заголовке `Last-Event-ID` при reconnect (браузерный EventSource
// делает это автоматически). Сервер отдаёт только seq строго больше присланного — дублей на
// reconnect не бывает, т.к. лог append-only и seq не переиспользуется.
export interface AssistantRunEvent {
  seq: number;
  event_type: AssistantRunEventType;
  payload: Record<string, unknown>;
}

// Первое, что видит свежее (без Last-Event-ID) SSE-подключение — снапшот текущего состояния run'а,
// той же формы, что GET /assistant/threads/:id/runs/:runId (оба читателя согласованы, оба берут
// живое состояние из БД). При изменении статуса и reconnect с Last-Event-ID сервер шлёт
// assistant.updated с актуальным run, затем доигрывает сохранённые события с seq > Last-Event-ID.
export interface AssistantRunSnapshotEvent {
  run: AssistantRun;
}

export interface CreateAssistantThreadRequest {
  title?: string;
}

export interface CreateAssistantMessageRequest {
  content: string;
  // Идемпотентность: повтор одного client_request_id в одном thread'е не создаёт вторую
  // message/run — отдаёт уже созданную пару. Тот же ключ + другой body → 409
  // assistant_idempotency_conflict.
  client_request_id: string;
}

export interface CreateAssistantMessageResponse {
  message: AssistantMessage;
  run: AssistantRun;
}

// Подтверждение generation_offer конкретного run'а — переиспользует очередь /generations
// (apps/api/src/generations), не заводит вторую. Ответ — тот же GenerationResponse, что
// POST /generations уже отдаёт (apps/api/src/generations/contract.ts::toGenerationResponse).
export interface ConfirmAssistantGenerationRequest {
  run_id: string;
}

export const ASSISTANT_LIST_DEFAULT_LIMIT = 24;
export const ASSISTANT_MESSAGES_DEFAULT_LIMIT = 30;

export interface AssistantCursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * История треда возвращает run'ы только для user-сообщений текущей страницы. Это позволяет
 * восстановить терминальные ответы и polling активного run после reload без клиентского cache.
 */
export interface AssistantMessagesPage extends AssistantCursorPage<AssistantMessage> {
  runs: AssistantRun[];
}

export const ASSISTANT_ERROR_RESPONSE_CODES = [
  "unauthorized",
  "assistant_thread_not_found",
  "assistant_run_not_found",
  "assistant_idempotency_conflict",
  "assistant_rate_limited",
  "assistant_run_failed",
  "assistant_contract_version_unsupported",
] as const;
export type AssistantErrorResponseCode =
  (typeof ASSISTANT_ERROR_RESPONSE_CODES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowList = new Set(allowed);
  return Object.keys(value).every((key) => allowList.has(key));
}

export function isAssistantEvidenceUrl(value: unknown, portalOnly = false): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length === 0 || Array.from(value).length > ASSISTANT_EVIDENCE_LIMITS.text || /[\\\s#]/u.test(value)) return false;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  if (/[\\\s#]/u.test(decoded)) return false;
  if (portalOnly && (!value.startsWith("/") || decoded.startsWith("//"))) return false;
  try {
    const parsed = portalOnly ? new URL(value, "https://portal.invalid") : new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return false;
    return !Array.from(parsed.searchParams.keys()).some((key) =>
      /(?:token|api.?key|^key$|signature|^sig$|auth|password|passwd|secret|credential|session|cookie)/i.test(key));
  } catch { return false; }
}

function isNullableHttpUrl(value: unknown, allowRelative = false): value is string | null {
  return isAssistantEvidenceUrl(value, allowRelative && typeof value === "string" && value.startsWith("/"));
}

export function isAssistantEvidenceTimestamp(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  if (!year || !month || !day || month > 12 || hour! > 23 || minute! > 59 || second! > 59) return false;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]!) return false;
  const zone = parts[7]!;
  return zone === "Z" || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) <= 59);
}
const isNullableTimestamp = isAssistantEvidenceTimestamp;
function boundedString(value: unknown, limit: number = ASSISTANT_EVIDENCE_LIMITS.text): value is string {
  return typeof value === "string" && Array.from(value).length <= limit;
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || boundedString(value);
}

function isOptionalNullableNumber(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isOptionalNullableBoolean(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "boolean";
}

function isEvidencePriceFact(
  value: unknown,
  currency: "RUB" | "USD",
): value is AssistantEvidencePriceFact {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["amount", "currency"]) &&
    typeof value.amount === "number" &&
    Number.isFinite(value.amount) &&
    value.currency === currency
  );
}

const PRINTER_FACT_KEYS = [
  "kind",
  "brand",
  "model",
  "product_status",
  "release_date",
  "price_ru_rub",
  "price_msrp_usd",
  "print_type",
  "kinematics",
  "enclosed",
  "build_volume_mm",
  "max_hotend_temperature_c",
  "max_bed_temperature_c",
  "nozzle_material",
  "nozzle_hardened",
  "nozzle_replaceable",
  "multimaterial_supported",
  "supported_materials",
  "unique_features",
  "support_level",
  "public_firmware_ready",
] as const;

export function isAssistantEvidenceFacts(
  value: unknown,
  entityType?: AssistantEvidenceEntityType,
): value is AssistantEvidenceFacts {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (entityType !== undefined && value.kind !== entityType) return false;
  switch (value.kind) {
    case "model":
      return (
        hasOnlyKeys(value, ["kind", "format"]) &&
        isOptionalNullableString(value.format)
      );
    case "printer": {
      if (!hasOnlyKeys(value, PRINTER_FACT_KEYS)) return false;
      if (
        ![
          value.brand,
          value.model,
          value.product_status,
          value.release_date,
          value.print_type,
          value.kinematics,
          value.nozzle_material,
          value.support_level,
        ].every(isOptionalNullableString)
      )
        return false;
      if (
        ![
          value.enclosed,
          value.nozzle_hardened,
          value.nozzle_replaceable,
          value.multimaterial_supported,
          value.public_firmware_ready,
        ].every(isOptionalNullableBoolean)
      )
        return false;
      if (
        ![value.max_hotend_temperature_c, value.max_bed_temperature_c].every(
          isOptionalNullableNumber,
        )
      )
        return false;
      if (
        value.price_ru_rub !== undefined &&
        value.price_ru_rub !== null &&
        !isEvidencePriceFact(value.price_ru_rub, "RUB")
      )
        return false;
      if (
        value.price_msrp_usd !== undefined &&
        value.price_msrp_usd !== null &&
        !isEvidencePriceFact(value.price_msrp_usd, "USD")
      )
        return false;
      if (
        value.supported_materials !== undefined &&
        (!Array.isArray(value.supported_materials) ||
          value.supported_materials.length > ASSISTANT_EVIDENCE_LIMITS.factItems ||
          !value.supported_materials.every((item) => boundedString(item)))
      )
        return false;
      if (
        value.unique_features !== undefined &&
        (!Array.isArray(value.unique_features) ||
          value.unique_features.length > ASSISTANT_EVIDENCE_LIMITS.factItems ||
          !value.unique_features.every((item) => boundedString(item)))
      )
        return false;
      if (
        value.build_volume_mm !== undefined &&
        value.build_volume_mm !== null
      ) {
        if (
          !isRecord(value.build_volume_mm) ||
          !hasOnlyKeys(value.build_volume_mm, ["x", "y", "z"])
        )
          return false;
        if (
          ![
            value.build_volume_mm.x,
            value.build_volume_mm.y,
            value.build_volume_mm.z,
          ].every((item) => typeof item === "number" && Number.isFinite(item))
        )
          return false;
      }
      return true;
    }
    case "comparison": {
      if (!hasOnlyKeys(value, ["kind", "printer_ids", "rows"]) || !Array.isArray(value.printer_ids) ||
          value.printer_ids.length < 2 || value.printer_ids.length > ASSISTANT_EVIDENCE_LIMITS.printers ||
          !value.printer_ids.every((id) => boundedString(id) && id.length > 0) ||
          new Set(value.printer_ids).size !== value.printer_ids.length || !Array.isArray(value.rows) ||
          value.rows.length !== ASSISTANT_COMPARISON_FIELDS.length) return false;
      const width = value.printer_ids.length;
      return value.rows.every((row, index) => {
        if (!isRecord(row) || !hasOnlyKeys(row, ["field", "cells"]) || row.field !== ASSISTANT_COMPARISON_FIELDS[index] ||
            !Array.isArray(row.cells) || row.cells.length !== width) return false;
        return row.cells.every((cell) => {
          if (!isRecord(cell) || !hasOnlyKeys(cell, ["state", "normalized_value", "display_value", "unit", "price_updated_at", "freshness", "freshness_reason"]) ||
              !["equal", "different", "missing", "stale"].includes(cell.state as string) ||
              !(cell.normalized_value === null || boundedString(cell.normalized_value) || typeof cell.normalized_value === "boolean" ||
                (typeof cell.normalized_value === "number" && Number.isFinite(cell.normalized_value))) ||
              !(cell.display_value === null || boundedString(cell.display_value))) return false;
          const unit = row.field === "price_ru_rub" ? "RUB" : row.field === "price_msrp_usd" ? "USD" :
            row.field === "build_volume_mm" ? "mm" : ["max_hotend_temperature_c", "max_bed_temperature_c"].includes(row.field as string) ? "C" : null;
          if (cell.unit !== unit || (cell.state === "missing") !== (cell.normalized_value === null)) return false;
          const price = unit === "RUB" || unit === "USD";
          if (!price) return cell.state !== "stale" && cell.price_updated_at === undefined && cell.freshness === undefined && cell.freshness_reason === undefined;
          if (!isNullableTimestamp(cell.price_updated_at) || !isPriceFreshness(cell, unit === "USD")) return false;
          return (cell.state === "stale") === (cell.freshness === "stale") && (cell.state !== "missing" || cell.freshness === "unknown");
        });
      });
    }
    case "machine":
      return (
        hasOnlyKeys(value, [
          "kind",
          "brand",
          "model",
          "active",
          "nozzle_material",
          "nozzle_diameter_mm",
          "enclosed",
          "direct_drive",
        ]) &&
        [value.brand, value.model, value.nozzle_material].every(
          isOptionalNullableString,
        ) &&
        [value.active, value.enclosed, value.direct_drive].every(
          isOptionalNullableBoolean,
        ) &&
        isOptionalNullableNumber(value.nozzle_diameter_mm)
      );
    case "user_printer":
      return (
        hasOnlyKeys(value, [
          "kind",
          "display_name",
          "primary",
          "catalog_printer_id",
          "machine_id",
        ]) &&
        [value.display_name, value.catalog_printer_id, value.machine_id].every(
          isOptionalNullableString,
        ) &&
        isOptionalNullableBoolean(value.primary)
      );
    case "material":
      return (
        hasOnlyKeys(value, [
          "kind",
          "variant_id", "machine_id", "catalog_printer_id", "user_printer_id", "compatibility", "compatibility_reasons", "ranking_criterion", "printer_label", "printer_capabilities",
          "brand",
          "name",
          "material_type",
          "color",
          "diameter_mm",
          "abrasive",
          "price_ru_rub",
        ]) &&
        [value.brand, value.name, value.material_type, value.color, value.variant_id, value.machine_id, value.catalog_printer_id, value.user_printer_id, value.ranking_criterion, value.printer_label].every(
          isOptionalNullableString,
        ) &&
        (value.printer_capabilities === undefined || (isRecord(value.printer_capabilities) &&
          hasOnlyKeys(value.printer_capabilities, ["max_hotend_temp_c", "filament_dia_mm", "nozzle_hardened", "chamber", "extruder_drive"]) &&
          [value.printer_capabilities.max_hotend_temp_c, value.printer_capabilities.filament_dia_mm].every((field) => field === undefined || (typeof field === "number" && Number.isFinite(field) && field > 0)) &&
          (value.printer_capabilities.nozzle_hardened === undefined || typeof value.printer_capabilities.nozzle_hardened === "boolean") &&
          (value.printer_capabilities.chamber === undefined || ["none", "passive", "active"].includes(String(value.printer_capabilities.chamber))) &&
          (value.printer_capabilities.extruder_drive === undefined || ["direct", "bowden"].includes(String(value.printer_capabilities.extruder_drive))))) &&
        (value.compatibility === undefined || ["compatible", "conditional", "insufficient_data"].includes(String(value.compatibility))) &&
        (value.compatibility_reasons === undefined || (Array.isArray(value.compatibility_reasons) && value.compatibility_reasons.length <= 32 && value.compatibility_reasons.every((reason) =>
          isRecord(reason) && hasOnlyKeys(reason, ["code", "severity", "message"]) && boundedString(reason.code) && boundedString(reason.message) && (reason.severity === "warn" || reason.severity === "blocked")))) &&
        isOptionalNullableNumber(value.diameter_mm) &&
        isOptionalNullableBoolean(value.abrasive) &&
        (value.price_ru_rub === undefined ||
          value.price_ru_rub === null ||
          isEvidencePriceFact(value.price_ru_rub, "RUB"))
      );
    case "news":
      return (
        hasOnlyKeys(value, ["kind", "effective_published_at", "topic"]) &&
        isOptionalNullableString(value.topic) &&
        (value.effective_published_at === undefined ||
          isNullableTimestamp(value.effective_published_at))
      );
    default:
      return false;
  }
}

export function isAssistantLegacyCitation(
  value: unknown,
): value is AssistantLegacyCitation {
  return (
    isRecord(value) &&
    typeof value.model_id === "string" &&
    typeof value.title === "string" &&
    typeof value.snippet === "string" &&
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    (value.source_url === undefined ||
      isNullableHttpUrl(value.source_url, true))
  );
}

function isPriceFreshness(value: Record<string, unknown>, usdOnly: boolean): boolean {
  if (!(ASSISTANT_EVIDENCE_FRESHNESS_VALUES as readonly unknown[]).includes(value.freshness) ||
      !(value.freshness_reason === null || boundedString(value.freshness_reason))) return false;
  if (usdOnly) return value.freshness === "unknown" && value.price_updated_at === null && value.freshness_reason === "price_msrp_has_no_observation_date";
  return value.freshness === "unknown" || (value.price_updated_at !== null && typeof value.freshness_reason === "string" && value.freshness_reason.length > 0);
}

export function isAssistantEvidenceCitation(
  value: unknown,
): value is AssistantEvidenceCitation {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "evidence_id",
      "entity_type",
      "entity_id",
      "title",
      "snippet",
      "canonical_url",
      "facts",
      "source_refs",
      "source_published_at",
      "observed_at",
      "updated_at",
      "price_updated_at",
      "freshness",
      "freshness_reason",
      "quality",
      "missing_fields",
    ])
  )
    return false;
  if (
    typeof value.evidence_id !== "string" ||
    value.evidence_id.length === 0 || !boundedString(value.evidence_id) ||
    typeof value.entity_id !== "string" ||
    value.entity_id.length === 0 || !boundedString(value.entity_id)
  )
    return false;
  if (
    !(ASSISTANT_EVIDENCE_ENTITY_TYPES as readonly unknown[]).includes(
      value.entity_type,
    )
  )
    return false;
  const entityType = value.entity_type as AssistantEvidenceEntityType;
  if (
    !boundedString(value.title, ASSISTANT_EVIDENCE_LIMITS.title) ||
    !boundedString(value.snippet, ASSISTANT_EVIDENCE_LIMITS.snippet) ||
    !isAssistantEvidenceUrl(value.canonical_url, true)
  )
    return false;
  if (!isAssistantEvidenceFacts(value.facts, entityType)) return false;
  if (
    !Array.isArray(value.source_refs) ||
    value.source_refs.length > ASSISTANT_EVIDENCE_LIMITS.sourceRefs ||
    !value.source_refs.every(
      (source) =>
        isRecord(source) &&
        hasOnlyKeys(source, ["label", "url"]) &&
        boundedString(source.label) &&
        isNullableHttpUrl(source.url),
    )
  )
    return false;
  if (
    ![
      value.source_published_at,
      value.observed_at,
      value.updated_at,
      value.price_updated_at,
    ].every(isNullableTimestamp)
  )
    return false;
  if (!(ASSISTANT_EVIDENCE_QUALITY_VALUES as readonly unknown[]).includes(value.quality) ||
      !Array.isArray(value.missing_fields) || value.missing_fields.length > ASSISTANT_EVIDENCE_LIMITS.missingFields ||
      !value.missing_fields.every((field) => boundedString(field))) return false;
  const facts = value.facts as AssistantEvidenceFacts;
  const rub = "price_ru_rub" in facts && facts.price_ru_rub != null;
  const usd = "price_msrp_usd" in facts && facts.price_msrp_usd != null;
  if (facts.kind === "news") {
    if (value.price_updated_at !== null || !(ASSISTANT_EVIDENCE_FRESHNESS_VALUES as readonly unknown[]).includes(value.freshness) ||
        !boundedString(value.freshness_reason) || value.freshness_reason.length === 0) return false;
    if (facts.effective_published_at == null) return value.freshness === "unknown" && value.freshness_reason === "news_missing_effective_published_at";
  } else if (rub || usd) {
    if (!isPriceFreshness(value, !rub && usd)) return false;
  } else if (value.price_updated_at !== null || "freshness" in value || "freshness_reason" in value) return false;

  return true;
}

export function isAssistantCitation(
  value: unknown,
): value is AssistantCitation {
  return isAssistantLegacyCitation(value) || isAssistantEvidenceCitation(value);
}

export function isAssistantSearchResults(
  value: unknown,
): value is AssistantSearchResults {
  if (!isRecord(value) || value.kind !== "search_results") return false;
  if (typeof value.query !== "string") return false;
  if (!Array.isArray(value.items)) return false;
  return value.items.every(
    (item) =>
      isRecord(item) &&
      typeof item.model_id === "string" &&
      typeof item.title === "string" &&
      typeof item.relevance_rank === "number",
  );
}

export function isAssistantClarification(
  value: unknown,
): value is AssistantClarification {
  if (!isRecord(value) || value.kind !== "clarification") return false;
  return (
    typeof value.question === "string" &&
    value.question.length > 0 &&
    isNullableString(value.reason)
  );
}

export function isAssistantAnswer(value: unknown): value is AssistantAnswer {
  if (!isRecord(value) || value.kind !== "answer") return false;
  if (typeof value.text !== "string") return false;
  if (!Array.isArray(value.citations)) return false;
  const citationsValid = value.citations.every(isAssistantCitation);
  return citationsValid && isNullableString(value.note);
}

/**
 * Только структурная форма — branch/prompt_summary/params ДЛИНЫ проверяет
 * apps/api/src/generations/contract.ts на реальном рантайм-пути (create.ts/assistant/
 * generations.ts), этот guard намеренно не дублирует те лимиты (см. комментарий у
 * `GenerationBranch` выше про layering).
 */
export function isAssistantGenerationOffer(
  value: unknown,
): value is AssistantGenerationOffer {
  if (!isRecord(value) || value.kind !== "generation_offer") return false;
  if (typeof value.offer_id !== "string" || value.offer_id.length === 0)
    return false;
  if (typeof value.branch !== "string" || value.branch.length === 0)
    return false;
  if (
    typeof value.prompt_summary !== "string" ||
    value.prompt_summary.trim().length === 0
  )
    return false;
  if (value.params !== undefined && !isRecord(value.params)) return false;
  return isNullableString(value.note);
}

export function isAssistantGenerationProgress(
  value: unknown,
): value is AssistantGenerationProgress {
  if (!isRecord(value) || value.kind !== "generation_progress") return false;
  return (
    typeof value.generation_id === "string" && typeof value.status === "string"
  );
}

export function isAssistantError(value: unknown): value is AssistantError {
  if (!isRecord(value) || value.kind !== "error") return false;
  if (
    !(ASSISTANT_ERROR_CODES as readonly string[]).includes(value.code as string)
  )
    return false;
  if (typeof value.message !== "string") return false;
  return value.retryable === undefined || typeof value.retryable === "boolean";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

/**
 * Структурная форма ТОЛЬКО — не проверяет и не может проверить дисциплину «сервер не
 * интерполирует»: это свойство продюсера (нет вычисляемых/интерполированных значений между
 * снапшотами), а не что-то, что видно в форме одного снапшота. Contract test фиксирует принцип
 * через fixtures (см. assistant.test.ts) — снапшот либо содержит то, что реально пришло с
 * сервера, либо `null`, третьего (клиентского домысливания) в этом типе нет.
 */
export function isRunProgressSnapshot(
  value: unknown,
): value is RunProgressSnapshot {
  if (!isRecord(value)) return false;
  if (!(RUN_PHASES as readonly string[]).includes(value.phase as string))
    return false;
  // Все три поля обязательные-но-nullable — undefined (отсутствующий ключ) не годится, это не
  // то же самое, что явный null (см. isNullableString/isNullableNumber, которые пропускают
  // undefined для действительно опциональных полей вроде note/reason выше).
  return (
    isNullableNumber(value.progress) &&
    isNullableNumber(value.eta_seconds) &&
    (value.estimate_updated_at === null ||
      typeof value.estimate_updated_at === "string")
  );
}

export function isAssistantRunResult(
  value: unknown,
): value is AssistantRunResult {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "search_results":
      return isAssistantSearchResults(value);
    case "clarification":
      return isAssistantClarification(value);
    case "answer":
      return isAssistantAnswer(value);
    case "generation_offer":
      return isAssistantGenerationOffer(value);
    case "generation_progress":
      return isAssistantGenerationProgress(value);
    case "error":
      return isAssistantError(value);
    default:
      return false;
  }
}

export function isCreateAssistantMessageRequest(
  value: unknown,
): value is CreateAssistantMessageRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.content === "string" &&
    value.content.length > 0 &&
    typeof value.client_request_id === "string" &&
    value.client_request_id.length > 0
  );
}

export function isConfirmAssistantGenerationRequest(
  value: unknown,
): value is ConfirmAssistantGenerationRequest {
  return (
    isRecord(value) &&
    typeof value.run_id === "string" &&
    value.run_id.length > 0
  );
}

export function isCreateAssistantThreadRequest(
  value: unknown,
): value is CreateAssistantThreadRequest {
  return isRecord(value) && isOptionalString(value.title);
}
