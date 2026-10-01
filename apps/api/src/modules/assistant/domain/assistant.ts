import {
  isAssistantEvidenceCitation,
  isAssistantEvidenceFacts,
  isAssistantEvidenceUrl,
  ASSISTANT_EVIDENCE_LIMITS,
  ASSISTANT_ERROR_CODES,
  type AssistantErrorCode,
  type AssistantCitation,
  type AssistantEvidenceCitation,
  type AssistantEvidenceFacts,
  type AssistantRunEvent,
} from "@portal/contracts/http/assistant";

export const THREAD_TITLE_MAX_LENGTH = 200;
export const MESSAGE_CONTENT_MAX_LENGTH = 4000;
export const CLIENT_REQUEST_ID_MAX_LENGTH = 200;
export const RUN_STATUSES = ["queued", "running", "done", "error"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_RESULT_TYPES = ["answer", "clarification", "generation_offer", "error"] as const;
export type RunResultType = (typeof RUN_RESULT_TYPES)[number];
export type MessageRole = "user" | "assistant";

export interface AssistantThreadRow {
  readonly id: string;
  readonly owner_id: string;
  readonly title: string | null;
  readonly kind: "chat" | "device_incident";
  readonly device_id: string | null;
  readonly severity: "info" | "warning" | "critical" | null;
  readonly incident_status: "open" | "acknowledged" | "resolved" | null;
  readonly read_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface AssistantMessageRow {
  readonly id: string;
  readonly thread_id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly client_request_id: string | null;
  readonly run_id: string | null;
  readonly created_at: Date;
}

export interface AssistantRunRow {
  readonly id: string;
  readonly thread_id: string;
  readonly triggering_message_id: string;
  readonly user_id: string;
  readonly message: string;
  readonly status: RunStatus;
  readonly result_type: RunResultType | null;
  readonly result: Record<string, unknown>;
  readonly error_code: string | null;
  readonly confirmed_generation_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export type AssistantRunEventRow = AssistantRunEvent;

export interface RunQueueInfo {
  readonly position: number;
  readonly eta_seconds: number;
}

export interface AssistantThreadResponse {
  readonly id: string;
  readonly title: string | null;
  readonly kind: "chat" | "device_incident";
  readonly device_id: string | null;
  readonly severity: "info" | "warning" | "critical" | null;
  readonly incident_status: "open" | "acknowledged" | "resolved" | null;
  readonly read_at: Date | null;
  readonly unread: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}
export interface AssistantMessageResponse {
  readonly id: string;
  readonly thread_id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly run_id: string | null;
  readonly created_at: Date;
}
export type AssistantCitationResponse = AssistantCitation;
export type AssistantRunResultResponse =
  | { readonly kind: "answer"; readonly text: string; readonly citations: readonly AssistantCitationResponse[]; readonly note: string | null }
  | { readonly kind: "clarification"; readonly question: string; readonly reason: string | null }
  | { readonly kind: "generation_offer"; readonly offer_id: string; readonly branch: string | null; readonly prompt_summary: string; readonly note: string | null }
  | { readonly kind: "error"; readonly code: AssistantErrorCode; readonly message: string; readonly retryable: boolean }
  | { readonly kind?: undefined };
export interface AssistantRunResponse {
  readonly id: string;
  readonly thread_id: string;
  readonly triggering_message_id: string;
  readonly status: RunStatus;
  readonly result_type: RunResultType | null;
  readonly result: AssistantRunResultResponse;
  readonly error_code: string | null;
  readonly confirmed_generation_id: string | null;
  readonly queue_position: number | null;
  readonly eta_seconds: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}

export function assistantMessageQuotaHourly(): number {
  return positiveIntEnv("ASSISTANT_MESSAGE_QUOTA_HOURLY", 30);
}
export function assistantMessageQuotaDaily(): number {
  return positiveIntEnv("ASSISTANT_MESSAGE_QUOTA_DAILY", 150);
}
export const ASSISTANT_MAX_ACTIVE_RUNS_PER_USER = 1;
export function assistantGlobalQueuedRunsLimit(): number {
  return positiveIntEnv("ASSISTANT_GLOBAL_QUEUED_RUNS_LIMIT", 50);
}
export function assistantRunEtaSecondsPerJob(): number {
  return positiveIntEnv("ASSISTANT_RUN_ETA_SECONDS_PER_JOB", 20);
}
export function assistantRunStaleTimeoutMinutes(): number {
  return positiveIntEnv("ASSISTANT_RUN_STALE_TIMEOUT_MINUTES", 15);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseLimit(raw: unknown, fallback: number, maximum: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

export function deriveResultKind(row: AssistantRunRow): RunResultType | null {
  const kind = (row.result as { readonly kind?: unknown } | null)?.kind;
  return typeof kind === "string" && (RUN_RESULT_TYPES as readonly string[]).includes(kind) ? (kind as RunResultType) : row.result_type;
}

export function deriveErrorCode(row: AssistantRunRow): string | null {
  return row.error_code ?? (row.status === "error" ? "provider_error" : null);
}

function safePublicUrl(value: unknown, allowRelative = false): string | null {
  return typeof value === "string" && isAssistantEvidenceUrl(value, allowRelative) ? value : null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function nullableBoolean(value: unknown): boolean | null | undefined {
  return value === null || typeof value === "boolean" ? value : undefined;
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null ? null : finiteNumber(value);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function sanitizePriceFact(value: unknown, currency: "RUB" | "USD"): { readonly amount: number; readonly currency: "RUB" | "USD" } | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const amount = finiteNumber(raw.amount);
  return amount !== undefined && raw.currency === currency ? { amount, currency } : undefined;
}

function sanitizeEvidenceFacts(raw: unknown): AssistantEvidenceFacts | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  switch (value.kind) {
    case "model":
      return compact({ kind: "model" as const, format: nullableString(value.format) });
    case "printer": {
      const volumeRaw =
        typeof value.build_volume_mm === "object" && value.build_volume_mm !== null && !Array.isArray(value.build_volume_mm)
          ? (value.build_volume_mm as Record<string, unknown>)
          : null;
      const x = finiteNumber(volumeRaw?.x);
      const y = finiteNumber(volumeRaw?.y);
      const z = finiteNumber(volumeRaw?.z);
      const buildVolume = value.build_volume_mm === null ? null : x !== undefined && y !== undefined && z !== undefined ? { x, y, z } : undefined;
      return compact({
        kind: "printer" as const,
        brand: nullableString(value.brand),
        model: nullableString(value.model),
        product_status: nullableString(value.product_status),
        release_date: nullableString(value.release_date),
        price_ru_rub: sanitizePriceFact(value.price_ru_rub, "RUB"),
        price_msrp_usd: sanitizePriceFact(value.price_msrp_usd, "USD"),
        print_type: nullableString(value.print_type),
        kinematics: nullableString(value.kinematics),
        enclosed: nullableBoolean(value.enclosed),
        build_volume_mm: buildVolume,
        max_hotend_temperature_c: nullableNumber(value.max_hotend_temperature_c),
        max_bed_temperature_c: nullableNumber(value.max_bed_temperature_c),
        nozzle_material: nullableString(value.nozzle_material),
        nozzle_hardened: nullableBoolean(value.nozzle_hardened),
        nozzle_replaceable: nullableBoolean(value.nozzle_replaceable),
        multimaterial_supported: nullableBoolean(value.multimaterial_supported),
        supported_materials: Array.isArray(value.supported_materials) ? value.supported_materials.filter((item): item is string => typeof item === "string") : undefined,
        unique_features: Array.isArray(value.unique_features) ? value.unique_features.filter((item): item is string => typeof item === "string") : undefined,
        support_level: nullableString(value.support_level),
        public_firmware_ready: nullableBoolean(value.public_firmware_ready),
      });
    }
    case "comparison": {
      if (!Array.isArray(value.rows) || value.rows.length !== 14) return null;
      const candidate = {
        kind: "comparison",
        printer_ids: value.printer_ids,
        rows: value.rows.map((rawRow) => {
          if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) return null;
          const row = rawRow as Record<string, unknown>;
          return {
            field: row.field,
            cells: Array.isArray(row.cells) ? row.cells.map((rawCell) => {
              if (!rawCell || typeof rawCell !== "object" || Array.isArray(rawCell)) return null;
              const cell = rawCell as Record<string, unknown>;
              return compact({ state: cell.state, normalized_value: cell.normalized_value, display_value: cell.display_value,
                unit: cell.unit, price_updated_at: cell.price_updated_at, freshness: cell.freshness, freshness_reason: cell.freshness_reason });
            }) : null,
          };
        }),
      };
      return isAssistantEvidenceFacts(candidate) ? candidate : null;
    }
    case "machine":
      return compact({
        kind: "machine" as const,
        brand: nullableString(value.brand),
        model: nullableString(value.model),
        active: nullableBoolean(value.active),
        nozzle_material: nullableString(value.nozzle_material),
        nozzle_diameter_mm: nullableNumber(value.nozzle_diameter_mm),
        enclosed: nullableBoolean(value.enclosed),
        direct_drive: nullableBoolean(value.direct_drive),
      });
    case "user_printer":
      return compact({
        kind: "user_printer" as const,
        display_name: nullableString(value.display_name),
        primary: nullableBoolean(value.primary),
        catalog_printer_id: nullableString(value.catalog_printer_id),
        machine_id: nullableString(value.machine_id),
      });
    case "material": {
      const capabilities =
        typeof value.printer_capabilities === "object" && value.printer_capabilities !== null && !Array.isArray(value.printer_capabilities)
          ? (value.printer_capabilities as Record<string, unknown>)
          : undefined;
      const candidate = compact({
        kind: "material" as const,
        printer_label: nullableString(value.printer_label),
        printer_capabilities:
          capabilities === undefined
            ? undefined
            : compact({
                max_hotend_temp_c: finiteNumber(capabilities.max_hotend_temp_c),
                filament_dia_mm: finiteNumber(capabilities.filament_dia_mm),
                nozzle_hardened: typeof capabilities.nozzle_hardened === "boolean" ? capabilities.nozzle_hardened : undefined,
                chamber: typeof capabilities.chamber === "string" ? capabilities.chamber : undefined,
                extruder_drive: typeof capabilities.extruder_drive === "string" ? capabilities.extruder_drive : undefined,
              }),
        variant_id: nullableString(value.variant_id),
        machine_id: nullableString(value.machine_id),
        catalog_printer_id: nullableString(value.catalog_printer_id),
        user_printer_id: nullableString(value.user_printer_id),
        compatibility: typeof value.compatibility === "string" ? value.compatibility : undefined,
        compatibility_reasons: Array.isArray(value.compatibility_reasons)
          ? value.compatibility_reasons.map((reason) => {
              if (typeof reason !== "object" || reason === null || Array.isArray(reason)) return null;
              const raw = reason as Record<string, unknown>;
              return compact({
                code: typeof raw.code === "string" ? raw.code : undefined,
                severity: typeof raw.severity === "string" ? raw.severity : undefined,
                message: typeof raw.message === "string" ? raw.message : undefined,
              });
            })
          : undefined,
        ranking_criterion: nullableString(value.ranking_criterion),
        brand: nullableString(value.brand),
        name: nullableString(value.name),
        material_type: nullableString(value.material_type),
        color: nullableString(value.color),
        diameter_mm: nullableNumber(value.diameter_mm),
        abrasive: nullableBoolean(value.abrasive),
        price_ru_rub: sanitizePriceFact(value.price_ru_rub, "RUB"),
      });
      return isAssistantEvidenceFacts(candidate) ? candidate : null;
    }
    case "news":
      return compact({ kind: "news" as const, effective_published_at: nullableString(value.effective_published_at), topic: nullableString(value.topic) });
    default:
      return null;
  }
}

function sanitizeEvidenceCitation(value: Record<string, unknown>): AssistantEvidenceCitation | null {
  const facts = sanitizeEvidenceFacts(value.facts);
  if (facts === null || (Array.isArray(value.source_refs) && value.source_refs.length > ASSISTANT_EVIDENCE_LIMITS.sourceRefs) ||
      (Array.isArray(value.missing_fields) && value.missing_fields.length > ASSISTANT_EVIDENCE_LIMITS.missingFields)) return null;
  const sourceRefs = Array.isArray(value.source_refs)
    ? value.source_refs.flatMap((source) => {
        if (typeof source !== "object" || source === null || Array.isArray(source)) return [];
        const item = source as Record<string, unknown>;
        if (typeof item.label !== "string") return [];
        return [{ label: item.label, url: safePublicUrl(item.url) }];
      })
    : [];
  const hasFreshness = facts.kind === "news" || ("price_ru_rub" in facts && facts.price_ru_rub != null) ||
    ("price_msrp_usd" in facts && facts.price_msrp_usd != null);
  const candidate = {
    evidence_id: value.evidence_id,
    entity_type: value.entity_type,
    entity_id: value.entity_id,
    title: value.title,
    snippet: value.snippet,
    canonical_url: safePublicUrl(value.canonical_url, true),
    facts,
    source_refs: sourceRefs,
    source_published_at: nullableString(value.source_published_at) ?? null,
    observed_at: nullableString(value.observed_at) ?? null,
    updated_at: nullableString(value.updated_at) ?? null,
    price_updated_at: nullableString(value.price_updated_at) ?? null,
    ...(hasFreshness ? { freshness: value.freshness, freshness_reason: nullableString(value.freshness_reason) ?? null } : {}),
    quality: value.quality,
    missing_fields: Array.isArray(value.missing_fields) ? value.missing_fields.filter((field): field is string => typeof field === "string") : [],
  };
  return isAssistantEvidenceCitation(candidate) ? candidate : null;
}

export function sanitizeCitation(raw: unknown): AssistantCitationResponse | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.model_id === "string" && typeof value.title === "string" && typeof value.snippet === "string") {
    return {
      model_id: value.model_id,
      title: value.title,
      snippet: value.snippet,
      score: finiteNumber(value.score) ?? 0,
      source_url: safePublicUrl(value.source_url, typeof value.source_url === "string" && value.source_url.startsWith("/")),
    };
  }
  return sanitizeEvidenceCitation(value);
}

export function sanitizeRunResult(result: unknown, kind: RunResultType | null, runId: string): AssistantRunResultResponse {
  if (kind === null || typeof result !== "object" || result === null) return {};
  const value = result as Record<string, unknown>;
  switch (kind) {
    case "answer":
      return {
        kind,
        text: typeof value.text === "string" ? value.text : "",
        citations: Array.isArray(value.citations) ? value.citations.map(sanitizeCitation).filter((item) => item !== null) : [],
        note: typeof value.note === "string" ? value.note : null,
      };
    case "clarification":
      return { kind, question: typeof value.question === "string" ? value.question : "", reason: typeof value.reason === "string" ? value.reason : null };
    case "generation_offer":
      return {
        kind,
        offer_id: typeof value.offer_id === "string" && value.offer_id.length > 0 ? value.offer_id : runId,
        branch: typeof value.branch === "string" ? value.branch : null,
        prompt_summary: typeof value.prompt_summary === "string" ? value.prompt_summary : typeof value.prompt === "string" ? value.prompt : "",
        note: typeof value.note === "string" ? value.note : null,
      };
    case "error": {
      const code = ASSISTANT_ERROR_CODES.find((candidate) => candidate === value.code) ?? "provider_error";
      return {
        kind,
        code,
        message: code === "tool_error" ? "Инструмент каталога недоступен. Поиск не завершён; это не отсутствие результатов." : "Не удалось получить ответ AI-провайдера.",
        retryable: typeof value.retryable === "boolean" ? value.retryable : true,
      };
    }
  }
}

export function toThreadResponse(row: AssistantThreadRow): AssistantThreadResponse {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    device_id: row.device_id,
    severity: row.severity,
    incident_status: row.incident_status,
    read_at: row.read_at,
    unread: row.kind === "device_incident" && row.read_at === null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toMessageResponse(row: AssistantMessageRow): AssistantMessageResponse {
  return { id: row.id, thread_id: row.thread_id, role: row.role, content: row.content, run_id: row.run_id, created_at: row.created_at };
}

export function toRunResponse(row: AssistantRunRow, queue: RunQueueInfo | null = null): AssistantRunResponse {
  const kind = deriveResultKind(row);
  return {
    id: row.id,
    thread_id: row.thread_id,
    triggering_message_id: row.triggering_message_id,
    status: row.status,
    result_type: kind,
    result: sanitizeRunResult(row.result, kind, row.id),
    error_code: deriveErrorCode(row),
    confirmed_generation_id: row.confirmed_generation_id,
    queue_position: queue?.position ?? null,
    eta_seconds: queue?.eta_seconds ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toRunSseFrame(row: AssistantRunEventRow): string {
  return `id: ${row.seq}\nevent: ${row.event_type}\ndata: ${JSON.stringify(row.payload)}\n\n`;
}

export function toThreadSseFrame(row: { readonly seq: number; readonly event_type: string; readonly payload: Record<string, unknown> }): string {
  return `id: ${row.seq}\nevent: ${row.event_type}\ndata: ${JSON.stringify(row.payload)}\n\n`;
}
