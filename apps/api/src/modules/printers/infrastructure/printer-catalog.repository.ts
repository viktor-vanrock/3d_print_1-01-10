import { Inject, Injectable } from "@nestjs/common";
import { ASSISTANT_COMPARISON_FIELDS, ASSISTANT_EVIDENCE_LIMITS, isAssistantEvidenceTimestamp, isAssistantEvidenceUrl } from "@portal/contracts/http/assistant";
import type { AssistantComparisonCell, AssistantComparisonField } from "@portal/contracts/http/assistant";
import type { Pool } from "pg";
import {
  CatalogCursorError,
  decodePrinterCatalogCursor,
  encodePrinterCatalogCursor,
  fingerprintPrinterCatalogQuery,
  InvalidPrinterCatalogQueryError,
  normalizePrinterCatalogQuery,
} from "../../catalog/public/index.ts";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type {
  AssistantPrinterComparisonEvidence,
  AssistantPrinterComparisonInput,
  AssistantPrinterComparisonResult,
  AssistantPrinterEvidence,
  AssistantPrinterLookupInput,
  AssistantPrinterLookupResult,
  PrinterCatalogDetailResponse,
  PrinterCatalogListItem,
  PrinterCatalogListResponse,
  PrinterCatalogPrinter,
  PrinterCatalogReadPort,
  PrinterJsonValue,
} from "../public/index.ts";
import { serializeCatalogCapabilities, serializePrinter, type PrinterRow } from "./serialize.ts";

const BOOLEAN_FACETS = {
  ams: "multimaterial_supported",
  laser: "has_laser",
  cnc: "has_cnc",
  enclosed: "enclosed",
  hardened: "hotend_hardened",
  moonraker: "moonraker",
  lan_mode: "lan_mode",
} as const;

type PrinterSort = "recommended" | "relevant" | "new" | "price_asc" | "price_desc" | "build_volume";
type CursorValue = string | number | boolean | null;

interface CursorRow extends PrinterRow {
  readonly cursor_released_at: string;
  readonly cursor_updated_at: string;
  readonly cursor_price_is_null: boolean;
  readonly cursor_price: string;
  readonly cursor_volume_is_null: boolean;
  readonly cursor_volume: string;
}

interface CursorKey {
  readonly expression: string;
  readonly cast: string;
  readonly direction: "asc" | "desc";
  readonly read: (row: CursorRow) => CursorValue;
  readonly validate: (value: unknown) => boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
const ASSISTANT_PRINTER_LIMIT = 10;
const RUB_PRICE_FRESHNESS_DAYS = 30;

function boundedComparisonText(value: string): string {
  return Array.from(value).slice(0, ASSISTANT_EVIDENCE_LIMITS.text).join("");
}

function latestTimestamp(values: readonly (string | null)[]): string | null {
  return (
    values
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null
  );
}

function comparisonValue(evidence: AssistantPrinterEvidence, field: AssistantComparisonField): Omit<AssistantComparisonCell, "state"> {
  const facts = evidence.facts;
  const plain = (value: string | number | boolean | null, display = value === null ? null : String(value), unit: AssistantComparisonCell["unit"] = null) => ({
    normalized_value: typeof value === "string" ? boundedComparisonText(value) : value,
    display_value: display === null ? null : boundedComparisonText(display),
    unit,
  });
  switch (field) {
    case "identity":
      return plain(`${facts.brand ?? ""} ${facts.model ?? ""}`.trim() || null);
    case "release": {
      const values = [facts.product_status, facts.release_date].filter((value): value is string => Boolean(value));
      return plain(values.length > 0 ? values.join(" · ") : null);
    }
    case "price_ru_rub": {
      const amount = facts.price_ru_rub?.amount ?? null;
      return {
        ...plain(amount, amount === null ? null : `${amount} ₽`, "RUB"),
        price_updated_at: evidence.price_updated_at,
        freshness: amount === null ? "unknown" : (evidence.freshness ?? "unknown"),
        freshness_reason: amount === null ? "RUB price is unavailable" : (evidence.freshness_reason ?? "RUB price observation date is unavailable"),
      };
    }
    case "price_msrp_usd": {
      const amount = facts.price_msrp_usd?.amount ?? null;
      return {
        ...plain(amount, amount === null ? null : `$${amount}`, "USD"),
        price_updated_at: null,
        freshness: "unknown",
        freshness_reason: "price_msrp_has_no_observation_date",
      };
    }
    case "print_type":
      return plain(facts.print_type ?? null);
    case "kinematics":
      return plain(facts.kinematics ?? null);
    case "enclosed":
      return plain(facts.enclosed ?? null, facts.enclosed == null ? null : facts.enclosed ? "Да" : "Нет");
    case "build_volume_mm": {
      const value = facts.build_volume_mm;
      return plain(value == null ? null : `${value.x}x${value.y}x${value.z}`, value == null ? null : `${value.x} × ${value.y} × ${value.z}`, "mm");
    }
    case "max_hotend_temperature_c":
      return plain(facts.max_hotend_temperature_c ?? null, facts.max_hotend_temperature_c == null ? null : `${facts.max_hotend_temperature_c} °C`, "C");
    case "max_bed_temperature_c":
      return plain(facts.max_bed_temperature_c ?? null, facts.max_bed_temperature_c == null ? null : `${facts.max_bed_temperature_c} °C`, "C");
    case "nozzle": {
      const values = [facts.nozzle_material, facts.nozzle_replaceable == null ? null : facts.nozzle_replaceable ? "replaceable" : "fixed"].filter(
        (value): value is string => value != null,
      );
      return plain(values.length > 0 ? values.join(" · ") : null);
    }
    case "multimaterial_supported":
      return plain(facts.multimaterial_supported ?? null, facts.multimaterial_supported == null ? null : facts.multimaterial_supported ? "Да" : "Нет");
    case "supported_materials": {
      const value =
        facts.supported_materials
          ?.map((item) => item.trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, "en")) ?? [];
      return plain(value.length > 0 ? value.join(", ") : null);
    }
    case "portal_support": {
      const values = [facts.support_level, facts.public_firmware_ready == null ? null : facts.public_firmware_ready ? "firmware-ready" : "firmware-not-ready"].filter(
        (value): value is string => value != null,
      );
      return plain(values.length > 0 ? values.join(" · ") : null);
    }
  }
}

function comparisonRow(evidence: readonly AssistantPrinterEvidence[], field: AssistantComparisonField) {
  const values = evidence.map((item) => comparisonValue(item, field));
  const present = values.filter((value) => value.normalized_value !== null);
  const equal = present.length === values.length && present.every((value) => value.normalized_value === present[0]?.normalized_value);
  return {
    field,
    cells: values.map((value): AssistantComparisonCell => ({
      ...value,
      state: value.normalized_value === null ? "missing" : field === "price_ru_rub" && value.freshness === "stale" ? "stale" : equal ? "equal" : "different",
    })),
  };
}

export function mapAssistantPrinterComparison(evidence: readonly AssistantPrinterEvidence[]): AssistantPrinterComparisonEvidence {
  const printerIds = evidence.map((item) => item.entity_id);
  const rows = ASSISTANT_COMPARISON_FIELDS.map((field) => comparisonRow(evidence, field));
  const sources = new Map<string, AssistantPrinterEvidence["source_refs"][number]>();
  for (const item of evidence) for (const source of item.source_refs) sources.set(`${source.label}\u0000${source.url ?? ""}`, source);
  const qualityOrder = ["verified", "reported", "inferred", "unknown"] as const;
  const quality = qualityOrder[Math.max(...evidence.map((item) => qualityOrder.indexOf(item.quality)))]!;
  const missingFields = rows.filter((row) => row.cells.some((cell) => cell.state === "missing")).map((row) => row.field);
  const title = boundedComparisonText(evidence.map((item) => item.title).join(" vs "));
  const entityId = boundedComparisonText(`comparison:${printerIds.join(":")}`);
  return {
    evidence_id: entityId,
    entity_type: "comparison",
    entity_id: entityId,
    title,
    snippet: `Сравнение ${evidence.length} принтеров по фиксированным полям`,
    canonical_url: null,
    facts: { kind: "comparison", printer_ids: printerIds, rows },
    source_refs: [...sources.values()].slice(0, ASSISTANT_EVIDENCE_LIMITS.sourceRefs),
    source_published_at: null,
    observed_at: latestTimestamp(evidence.map((item) => item.observed_at)),
    updated_at: latestTimestamp(evidence.map((item) => item.updated_at)),
    price_updated_at: null,
    quality,
    missing_fields: missingFields,
  };
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year!, month! - 1, day);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

function isNumeric(value: unknown): value is string {
  return typeof value === "string" && NUMERIC_RE.test(value);
}

function cursorKeys(sort: PrinterSort, currency: string): readonly CursorKey[] {
  const dateKey = (expression: string, direction: CursorKey["direction"], read: CursorKey["read"]): CursorKey => ({ expression, cast: "date", direction, read, validate: isDate });
  const timestampKey = (expression: string, direction: CursorKey["direction"], read: CursorKey["read"]): CursorKey => ({
    expression,
    cast: "timestamptz",
    direction,
    read,
    validate: isTimestamp,
  });
  const uuidKey = (direction: CursorKey["direction"]): CursorKey => ({
    expression: "id",
    cast: "uuid",
    direction,
    read: (row) => row.id,
    validate: (value) => typeof value === "string" && UUID_RE.test(value),
  });
  const booleanKey = (expression: string, direction: CursorKey["direction"], read: CursorKey["read"]): CursorKey => ({
    expression,
    cast: "boolean",
    direction,
    read,
    validate: (value) => typeof value === "boolean",
  });
  const numericKey = (expression: string, direction: CursorKey["direction"], read: CursorKey["read"]): CursorKey => ({
    expression,
    cast: "numeric",
    direction,
    read,
    validate: isNumeric,
  });
  switch (sort) {
    case "new":
      return [
        dateKey("coalesce(released_at, '0001-01-01'::date)", "desc", (row) => row.cursor_released_at),
        timestampKey("updated_at", "desc", (row) => row.cursor_updated_at),
        uuidKey("desc"),
      ];
    case "price_asc":
      return [
        numericKey(`case when ${currency} is null then 1 else 0 end`, "asc", (row) => (row.cursor_price_is_null ? "1" : "0")),
        numericKey(`coalesce(${currency}, 0)`, "asc", (row) => row.cursor_price),
        uuidKey("asc"),
      ];
    case "price_desc":
      return [
        numericKey(`case when ${currency} is null then 1 else 0 end`, "asc", (row) => (row.cursor_price_is_null ? "1" : "0")),
        numericKey(`coalesce(${currency}, 0)`, "desc", (row) => row.cursor_price),
        uuidKey("desc"),
      ];
    case "build_volume":
      return [
        numericKey("case when build_volume_x is null or build_volume_y is null or build_volume_z is null then 1 else 0 end", "asc", (row) =>
          row.cursor_volume_is_null ? "1" : "0",
        ),
        numericKey("coalesce(build_volume_x * build_volume_y * build_volume_z, 0)", "desc", (row) => row.cursor_volume),
        uuidKey("desc"),
      ];
    default:
      return [
        booleanKey("verified", "desc", (row) => row.verified),
        booleanKey("coalesce(confidence = 'high', false)", "desc", (row) => row.confidence === "high"),
        timestampKey("updated_at", "desc", (row) => row.cursor_updated_at),
        uuidKey("desc"),
      ];
  }
}

function catalogItem(row: PrinterRow): PrinterCatalogListItem {
  return {
    id: row.id,
    slug: row.slug,
    brand: row.brand,
    model: row.model,
    status: row.status,
    verified: row.verified,
    image_url: (row.media as { hero?: string | null } | null)?.hero ?? null,
    price: {
      rub: typeof row.price_ru_rub === "string" ? Number(row.price_ru_rub) : row.price_ru_rub,
      usd: typeof row.price_msrp_usd === "string" ? Number(row.price_msrp_usd) : row.price_msrp_usd,
      rub_updated_at: row.price_ru_updated_at,
    },
    build_volume_mm: {
      x: typeof row.build_volume_x === "string" ? Number(row.build_volume_x) : row.build_volume_x,
      y: typeof row.build_volume_y === "string" ? Number(row.build_volume_y) : row.build_volume_y,
      z: typeof row.build_volume_z === "string" ? Number(row.build_volume_z) : row.build_volume_z,
    },
    kinematics: row.kinematics,
    capabilities: serializeCatalogCapabilities(row),
  };
}

function normalizeAssistantReference(value: string): string | null {
  try {
    return normalizePrinterCatalogQuery({ q: value, limit: "1" }).q;
  } catch (error) {
    if (error instanceof InvalidPrinterCatalogQueryError) return null;
    throw error;
  }
}

function assistantLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return ASSISTANT_PRINTER_LIMIT;
  return Math.max(2, Math.min(ASSISTANT_PRINTER_LIMIT, Math.trunc(value)));
}

function isoTimestamp(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  if (DATE_RE.test(value)) return isDate(value) ? `${value}T00:00:00.000Z` : null;
  if (!isAssistantEvidenceTimestamp(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function boundedFactText(value: string | null): string | null {
  return value === null ? null : Array.from(value).slice(0, ASSISTANT_EVIDENCE_LIMITS.text).join("");
}

function canonicalPrinterUrl(slug: string): string | null {
  return slug.length > 0 && Array.from(slug).length <= 200 && !/[\\\s#]/u.test(slug) ? `/printers/${encodeURIComponent(slug)}` : null;
}

function provenanceRecords(printer: PrinterCatalogPrinter): ReadonlyArray<Readonly<Record<string, PrinterJsonValue>>> {
  return Object.values(printer.field_sources)
    .slice(0, 32)
    .filter((value): value is Readonly<Record<string, PrinterJsonValue>> => value !== null && typeof value === "object" && !Array.isArray(value));
}

function printerSourceRefs(printer: PrinterCatalogPrinter): AssistantPrinterEvidence["source_refs"] {
  const urls = new Set<string>();
  for (const source of printer.sources) if (isAssistantEvidenceUrl(source)) urls.add(source);
  for (const record of provenanceRecords(printer)) {
    const sourceUrl = record.source_url;
    if (typeof sourceUrl === "string" && isAssistantEvidenceUrl(sourceUrl)) urls.add(sourceUrl);
  }
  return [...urls].slice(0, ASSISTANT_EVIDENCE_LIMITS.sourceRefs).map((url) => ({ label: new URL(url).hostname, url }));
}

function observedAt(printer: PrinterCatalogPrinter): string | null {
  let latest: string | null = null;
  for (const record of provenanceRecords(printer)) {
    const timestamp = typeof record.ts === "string" ? isoTimestamp(record.ts) : null;
    if (timestamp !== null && (latest === null || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

function evidenceQuality(printer: PrinterCatalogPrinter): AssistantPrinterEvidence["quality"] {
  if (printer._meta.verified) return "verified";
  if (printer._meta.reviewed_by !== null || printer._meta.confidence === "high" || printer._meta.confidence === "medium") return "reported";
  if (printer._meta.confidence === "low") return "inferred";
  return "unknown";
}

function rubFreshness(
  printer: PrinterCatalogPrinter,
  now: Date,
): Pick<AssistantPrinterEvidence, "price_updated_at"> & Partial<Pick<AssistantPrinterEvidence, "freshness" | "freshness_reason">> {
  const rub = printer.price.ru_rub;
  const priceUpdatedAt = isoTimestamp(printer.price.ru_updated_at);
  const hasUsd = printer.price.msrp_usd !== null;
  if (rub === null && hasUsd) return { freshness: "unknown", freshness_reason: "price_msrp_has_no_observation_date", price_updated_at: null };
  if (rub === null) return { price_updated_at: null };
  if (priceUpdatedAt === null) return { freshness: "unknown", freshness_reason: "RUB price observation date is unavailable", price_updated_at: null };
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = Math.floor((today - new Date(priceUpdatedAt).getTime()) / 86_400_000);
  const freshness = ageDays > RUB_PRICE_FRESHNESS_DAYS ? "stale" : "fresh";
  return {
    freshness,
    freshness_reason: `RUB price observed ${printer.price.ru_updated_at}; fixed ${RUB_PRICE_FRESHNESS_DAYS}-day freshness window${hasUsd ? "; USD MSRP has no dated freshness" : ""}`,
    price_updated_at: priceUpdatedAt,
  };
}

function missingPrinterFields(printer: PrinterCatalogPrinter, requestedFields: readonly string[]): string[] {
  const fields: string[] = [];
  const add = (field: string, missing: boolean) => {
    if (missing && !fields.includes(field)) fields.push(field);
  };
  add("release_date", printer.released_at === null);
  add("price_ru_rub", printer.price.ru_rub === null);
  add("price_msrp_usd", printer.price.msrp_usd === null);
  add("print_type", printer.type === null);
  add("kinematics", printer.kinematics === null);
  add("enclosed", printer.enclosed === null);
  add("build_volume_mm", printer.build_volume.x === null || printer.build_volume.y === null || printer.build_volume.z === null);
  add("max_hotend_temperature_c", printer.hotend.max_temp_c === null);
  add("max_bed_temperature_c", printer.bed.max_temp_c === null);
  add("nozzle_material", printer.hotend.material === null);
  add("nozzle_replaceable", printer.hotend.nozzle_swappable === null);
  add("supported_materials", printer.materials_supported.length === 0);
  add("support_level", printer.support_level === null);
  for (const field of requestedFields) if (field === "chamber_temperature_c") add(field, true);
  return fields.slice(0, ASSISTANT_EVIDENCE_LIMITS.missingFields);
}

export function mapAssistantPrinterEvidence(
  printer: PrinterCatalogPrinter,
  options: { readonly now?: Date; readonly requestedFields?: readonly string[] } = {},
): AssistantPrinterEvidence {
  const volume = printer.build_volume;
  return {
    evidence_id: `printer:${printer.id}`,
    entity_type: "printer",
    entity_id: printer.id,
    title: Array.from(`${printer.brand} ${printer.model}`.trim()).slice(0, ASSISTANT_EVIDENCE_LIMITS.title).join(""),
    snippet: Array.from(`${printer.brand} ${printer.model} · ${printer.status}`.trim()).slice(0, ASSISTANT_EVIDENCE_LIMITS.snippet).join(""),
    canonical_url: canonicalPrinterUrl(printer.slug),
    facts: {
      kind: "printer",
      brand: boundedFactText(printer.brand),
      model: boundedFactText(printer.model),
      product_status: boundedFactText(printer.status),
      release_date: boundedFactText(printer.released_at),
      price_ru_rub: printer.price.ru_rub === null ? null : { amount: printer.price.ru_rub, currency: "RUB" },
      price_msrp_usd: printer.price.msrp_usd === null ? null : { amount: printer.price.msrp_usd, currency: "USD" },
      print_type: boundedFactText(printer.type),
      kinematics: boundedFactText(printer.kinematics),
      enclosed: printer.enclosed,
      build_volume_mm: volume.x !== null && volume.y !== null && volume.z !== null ? { x: volume.x, y: volume.y, z: volume.z } : null,
      max_hotend_temperature_c: printer.hotend.max_temp_c,
      max_bed_temperature_c: printer.bed.max_temp_c,
      nozzle_material: boundedFactText(printer.hotend.material),
      nozzle_hardened: printer.hotend.hardened,
      nozzle_replaceable: printer.hotend.nozzle_swappable,
      multimaterial_supported: printer.multimaterial.supported,
      supported_materials: printer.materials_supported.slice(0, ASSISTANT_EVIDENCE_LIMITS.factItems).map((material) => boundedFactText(material)!),
      unique_features: printer.unique_features.slice(0, 6).map((feature) => boundedFactText(feature)!),
      support_level: boundedFactText(printer.support_level),
      public_firmware_ready: printer.firmware_public,
    },
    source_refs: printerSourceRefs(printer),
    source_published_at: null,
    observed_at: observedAt(printer),
    updated_at: isoTimestamp(printer._meta.updated_at),
    ...rubFreshness(printer, options.now ?? new Date()),
    quality: evidenceQuality(printer),
    missing_fields: missingPrinterFields(printer, options.requestedFields ?? []),
  };
}

@Injectable()
export class PrinterCatalogRepository implements PrinterCatalogReadPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(input: Readonly<Record<string, unknown>>): Promise<{ readonly ok: true; readonly body: PrinterCatalogListResponse } | { readonly ok: false }> {
    let query: ReturnType<typeof normalizePrinterCatalogQuery>;
    try {
      query = normalizePrinterCatalogQuery({ ...input });
    } catch (error) {
      if (error instanceof InvalidPrinterCatalogQueryError) return { ok: false };
      throw error;
    }
    const fingerprint = fingerprintPrinterCatalogQuery(query);
    const conditions: string[] = ["cardinality(sources) > 0"];
    const params: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("?", `$${params.length}`));
    };
    const pushList = (column: string, values: readonly string[]) => {
      if (values.length > 0) push(`${column} = any(?::text[])`, values);
    };
    pushList("status", query.status);
    pushList("lower(brand)", query.brand);
    pushList("kinematics", query.kinematics);
    pushList("type", query.type);
    pushList("support_level", query.support_level);
    if (query.q !== null) {
      params.push(`%${query.q}%`);
      conditions.push(`(brand ilike $${params.length} or model ilike $${params.length} or exists (select 1 from unnest(aliases) a where a ilike $${params.length}))`);
    }
    const currency = query.currency === "usd" ? "price_msrp_usd" : "price_ru_rub";
    if (query.price_min !== null) push(`${currency} >= ?`, query.price_min);
    if (query.price_max !== null) push(`${currency} <= ?`, query.price_max);
    if (query.fits_x !== null) push("build_volume_x >= ?", query.fits_x);
    if (query.fits_y !== null) push("build_volume_y >= ?", query.fits_y);
    if (query.fits_z !== null) push("build_volume_z >= ?", query.fits_z);
    if (query.hotend_min !== null) push("hotend_max_temp_c >= ?", query.hotend_min);
    if (query.bed_min !== null) push("bed_max_temp_c >= ?", query.bed_min);
    if (query.flow_min !== null) push("hotend_max_flow_mm3s >= ?", query.flow_min);
    if (query.speed_min !== null) push("coalesce((specs->'speed'->>'max_mm_s')::numeric, 0) >= ?", query.speed_min);
    if (query.swappable_nozzle === true) conditions.push("nozzle_swappable = true");
    const activeBooleanFacets: Array<{ readonly key: keyof typeof BOOLEAN_FACETS; readonly column: string }> = [];
    for (const [key, column] of Object.entries(BOOLEAN_FACETS) as Array<[keyof typeof BOOLEAN_FACETS, string]>)
      if (query.capabilities.includes(key)) {
        conditions.push(`${column} = true`);
        activeBooleanFacets.push({ key, column });
      }
    if (query.capabilities.includes("auto_leveling")) conditions.push("bed_auto_leveling is not null and bed_auto_leveling <> 'none'");
    const keys = cursorKeys(query.sort, currency);
    const orderBy = keys.map((key) => `${key.expression} ${key.direction}`).join(", ");
    const filterConditions = [...conditions];
    const filterParams = [...params];
    if (input.cursor !== undefined) {
      let cursorValues: readonly CursorValue[];
      try {
        const decoded = decodePrinterCatalogCursor(input.cursor, { fingerprint });
        cursorValues = decoded.position;
        if (cursorValues.length !== keys.length || !cursorValues.every((value, index) => keys[index]!.validate(value))) throw new CatalogCursorError();
      } catch (error) {
        if (error instanceof CatalogCursorError) return { ok: false };
        throw error;
      }
      const cursorStart = params.length + 1;
      const predicates = keys.map((key, index) => {
        const prefix = keys
          .slice(0, index)
          .map((item, prefixIndex) => `${item.expression} = $${cursorStart + prefixIndex}::${item.cast}`)
          .join(" and ");
        return `(${prefix ? `${prefix} and ` : ""}${key.expression} ${key.direction === "desc" ? "<" : ">"} $${cursorStart + index}::${key.cast})`;
      });
      conditions.push(`(${predicates.join(" or ")})`);
      params.push(...cursorValues);
    }
    params.push(query.limit + 1);
    const result = await this.pool.query<CursorRow>(
      `select printers.*,coalesce(released_at,'0001-01-01'::date)::text cursor_released_at,updated_at::text cursor_updated_at,(${currency} is null) cursor_price_is_null,coalesce(${currency},0)::text cursor_price,(build_volume_x is null or build_volume_y is null or build_volume_z is null) cursor_volume_is_null,coalesce(build_volume_x*build_volume_y*build_volume_z,0)::text cursor_volume from printers where ${conditions.join(" and ")} order by ${orderBy} limit $${params.length}`,
      params,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const last = rows.at(-1);
    const nextCursor = hasMore && last !== undefined ? encodePrinterCatalogCursor({ fingerprint, position: keys.map((key) => key.read(last)) }) : null;
    const gapCounts: Record<string, number> = {};
    for (const { key, column } of activeBooleanFacets) {
      const gapConditions = filterConditions.filter((condition) => condition !== `${column} = true`);
      gapConditions.push(`${column} is null`);
      const gap = await this.pool.query<{ count: string }>(`select count(*) count from printers where ${gapConditions.join(" and ")}`, filterParams);
      gapCounts[key] = Number(gap.rows[0]?.count ?? 0);
    }
    return {
      ok: true,
      body: {
        contract_version: "printers.catalog.v1",
        items: rows.map(catalogItem),
        printers: rows.map((row) => serializePrinter(row)),
        has_more: hasMore,
        next_cursor: nextCursor,
        gap_counts: gapCounts,
      },
    };
  }

  async detail(slug: string): Promise<PrinterCatalogDetailResponse | null> {
    const row = (await this.pool.query<PrinterRow>(`select * from printers where slug=$1`, [slug])).rows[0];
    return row === undefined || row.sources.length === 0 ? null : { printer: serializePrinter(row) };
  }

  async assistantSearch(input: AssistantPrinterLookupInput): Promise<AssistantPrinterLookupResult> {
    const reference = normalizeAssistantReference(input.reference);
    if (reference === null) return { kind: "not_found" };
    const exact = await this.assistantExact(reference);
    if (exact !== null) return { kind: "resolved", evidence: mapAssistantPrinterEvidence(serializePrinter(exact), { requestedFields: input.requested_fields }) };

    const limit = assistantLimit(input.limit);
    let rows = (
      await this.pool.query<PrinterRow>(
        `select * from printers
         where cardinality(sources) > 0
           and (brand ilike $2 or model ilike $2 or concat_ws(' ',brand,model) ilike $2
             or exists (select 1 from unnest(aliases) alias where alias ilike $2))
         order by
           case
             when lower(model)=$1 then 0
             when lower(concat_ws(' ',brand,model))=$1 then 1
             when exists (select 1 from unnest(aliases) alias where lower(alias)=$1) then 2
             when lower(model) like $1 || '%' then 3
             else 4
           end,
           lower(brand), lower(model), id
         limit $3`,
        [reference, `%${reference.replace(/[\\%_]/g, "\\$&")}%`, limit],
      )
    ).rows;
    if (rows.length === 0) {
      const lastToken = reference.match(/[a-z0-9][a-z0-9._-]*/g)?.at(-1);
      if (lastToken && /^(?=.*[a-z])(?=.*\d)[a-z0-9._-]{2,}$/.test(lastToken)) {
        rows = (
          await this.pool.query<PrinterRow>(
            `select * from printers
             where cardinality(sources) > 0 and lower(model)=$1
             order by lower(brand), lower(model), id
             limit $2`,
            [lastToken, limit],
          )
        ).rows;
      }
    }
    if (rows.length === 0) return { kind: "not_found" };
    const evidence = rows.map((row) => mapAssistantPrinterEvidence(serializePrinter(row), { requestedFields: input.requested_fields }));
    return evidence.length === 1 ? { kind: "resolved", evidence: evidence[0]! } : { kind: "ambiguous", candidates: evidence };
  }

  async assistantDetail(input: AssistantPrinterLookupInput): Promise<AssistantPrinterLookupResult> {
    const reference = normalizeAssistantReference(input.reference);
    if (reference === null) return { kind: "not_found" };
    const row = await this.assistantExact(reference);
    return row === null ? { kind: "not_found" } : { kind: "resolved", evidence: mapAssistantPrinterEvidence(serializePrinter(row), { requestedFields: input.requested_fields }) };
  }

  async assistantCompare(input: AssistantPrinterComparisonInput): Promise<AssistantPrinterComparisonResult> {
    if (input.references.length < 2 || input.references.length > 4) return { kind: "not_found" };
    const results = await Promise.all(input.references.map((reference) => this.assistantSearch({ reference, limit: ASSISTANT_PRINTER_LIMIT })));
    if (results.some((result) => result.kind === "not_found")) return { kind: "not_found" };
    const ambiguous = results.flatMap((result) => (result.kind === "ambiguous" ? result.candidates : []));
    if (ambiguous.length > 0) {
      const unique = new Map(ambiguous.map((candidate) => [candidate.entity_id, candidate]));
      return { kind: "ambiguous", candidates: [...unique.values()].slice(0, ASSISTANT_PRINTER_LIMIT) };
    }
    const resolved = results.flatMap((result) => (result.kind === "resolved" ? [result.evidence] : []));
    if (new Set(resolved.map((item) => item.entity_id)).size !== resolved.length) {
      const unique = new Map(resolved.map((candidate) => [candidate.entity_id, candidate]));
      return { kind: "ambiguous", candidates: [...unique.values()] };
    }
    return { kind: "resolved", evidence: mapAssistantPrinterComparison(resolved) };
  }

  private async assistantExact(reference: string): Promise<PrinterRow | null> {
    if (UUID_RE.test(reference)) {
      const byId = (await this.pool.query<PrinterRow>(`select * from printers where id=$1::uuid and cardinality(sources) > 0`, [reference])).rows[0];
      if (byId !== undefined) return byId;
    }
    return (await this.pool.query<PrinterRow>(`select * from printers where lower(slug)=$1 and cardinality(sources) > 0`, [reference])).rows[0] ?? null;
  }
}
