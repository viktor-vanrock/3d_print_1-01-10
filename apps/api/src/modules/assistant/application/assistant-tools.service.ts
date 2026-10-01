import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { FeedPostId, SYSTEM_USER_ID, UserId } from "../../_kernel/brandedIds.ts";
import { CATALOG_EXTERNAL_PORT, CATALOG_READ_PORT, PRINTER_MACHINE_LINKS_PORT, type AssistantFilamentRecord, type CatalogExternalPort, type CatalogReadPort, type PrinterMachineLinksPort, type AssistantFilamentSearch } from "../../catalog/public/index.ts";
import { ASSISTANT_FILAMENT_RECOMMENDATION_PAGE_SIZE, ASSISTANT_MATERIAL_COMPARISON_MAX_CANDIDATES } from "../../catalog/public/assistant-filaments.ts";
import { FEED_ASSISTANT_NEWS_PORT, type FeedAssistantNewsPort } from "../../feed/public/index.ts";
import { PROFILE_AUTH_PORT, type ProfileAuthPort } from "../../profile/public/index.ts";
import { ASSISTANT_OWNED_PRINTER_PORT, type AssistantOwnedPrinterPort } from "../../printers/public/index.ts";
import { SANCTIONS_READ_PORT, type SanctionsReadPort } from "../../sanctions/public/index.ts";
import type { AssistantLeaseClaim, AssistantRunContext, AssistantScope, AssistantToolResponse, AssistantToolResult } from "../domain/assistant-internal.ts";
import { isUuid } from "../domain/assistant.ts";
import { AssistantRepository, type AssistantRunIdentity } from "../infrastructure/assistant.repository.ts";
import { ASSISTANT_CONTEXT_MAX_TURNS, buildAssistantContext } from "./assistant-context.ts";
import { filamentEvidence, rankFilaments, retainTopFilaments } from "./assistant-filaments.ts";

// Deliberately closed: future packets bind each implemented read to its domain public port.
type ReadToolName = "search_printers" | "get_printer" | "compare_printers" | "search_filaments" | "compare_material_types" | "recommend_filaments" | "list_news";
interface FilamentRecommendationCandidateSearch extends AssistantFilamentSearch {
  readonly recommendation_candidate_scan: true;
}
interface ReadHandler {
  readonly scopes: readonly AssistantScope[];
  readonly validate: (args: Readonly<Record<string, unknown>>) => boolean;
  readonly execute: (identity: AssistantRunIdentity, args: Readonly<Record<string, unknown>>, correlationId: string) => Promise<AssistantToolResult>;
}

function hasOnlyKeys(args: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(args).every((key) => keys.has(key));
}

function failureStatus(error: unknown): number {
  return error instanceof HttpException ? error.getStatus() : 500;
}

function failureReason(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.constructor.name) ? error.constructor.name : "unknown";
}

function validRequestedFields(value: unknown): value is readonly string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.length <= 32 && value.every((field) => typeof field === "string" && field.length > 0 && field.length <= 100));
}

function validSearchPrinterArgs(args: Readonly<Record<string, unknown>>): boolean {
  return (
    hasOnlyKeys(args, ["query", "limit", "requested_fields"]) &&
    typeof args.query === "string" &&
    args.query.trim().length > 0 &&
    Array.from(args.query).length <= 200 &&
    (args.limit === undefined || (typeof args.limit === "number" && Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 10)) &&
    validRequestedFields(args.requested_fields)
  );
}

function validGetPrinterArgs(args: Readonly<Record<string, unknown>>): boolean {
  if (!hasOnlyKeys(args, ["printer_id", "slug", "requested_fields"]) || !validRequestedFields(args.requested_fields)) return false;
  const references = [args.printer_id, args.slug].filter((value) => value !== undefined);
  return references.length === 1 && typeof references[0] === "string" && references[0].trim().length > 0 && Array.from(references[0]).length <= 200;
}

function validComparePrintersArgs(args: Readonly<Record<string, unknown>>): boolean {
  return (
    hasOnlyKeys(args, ["references", "criteria"]) &&
    Array.isArray(args.references) &&
    args.references.length >= 2 &&
    args.references.length <= 4 &&
    args.references.every((reference) => typeof reference === "string" && reference.trim().length > 0 && Array.from(reference).length <= 200) &&
    (args.criteria === undefined || (typeof args.criteria === "string" && args.criteria.trim().length > 0 && Array.from(args.criteria).length <= 300))
  );
}

function validListNewsArgs(args: Readonly<Record<string, unknown>>): boolean {
  if (!hasOnlyKeys(args, ["from", "to", "topic", "limit"])) return false;
  if ((args.from === undefined) !== (args.to === undefined)) return false;
  return (
    (args.from === undefined || (typeof args.from === "string" && args.from.length > 0 && args.from.length <= 40)) &&
    (args.to === undefined || (typeof args.to === "string" && args.to.length > 0 && args.to.length <= 40)) &&
    (args.topic === undefined || (typeof args.topic === "string" && args.topic.trim().length > 0 && Array.from(args.topic).length <= 120)) &&
    (args.limit === undefined || (typeof args.limit === "number" && Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 10))
  );
}

function validFilamentArgs(args: Readonly<Record<string, unknown>>, recommend = false): boolean {
  return hasOnlyKeys(args, ["query", "material_type", "diameter_mm", "color", "limit", ...(recommend ? ["printer_id", "user_printer_id"] : [])]) &&
    (args.color === undefined || (typeof args.color === "string" && args.color.trim().length > 0 && Array.from(args.color).length <= 100)) &&
    [args.query, args.material_type, args.printer_id, args.user_printer_id].every((value) => value === undefined || (typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 200)) &&
    !(args.printer_id !== undefined && args.user_printer_id !== undefined) &&
    (args.diameter_mm === undefined || (typeof args.diameter_mm === "number" && Number.isFinite(args.diameter_mm) && args.diameter_mm > 0 && args.diameter_mm <= 10)) &&
    (args.limit === undefined || (typeof args.limit === "number" && Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 10));
}

const MATERIAL_TYPE_ALIASES: Readonly<Record<string, string>> = Object.freeze({ "абс": "abs", "пла": "pla" });
const MATERIAL_TYPE_RE = /^[a-z0-9][a-z0-9+._-]{0,63}$/;
const ASSISTANT_FILAMENT_RECOMMENDATION_MAX_CANDIDATES = 2_000;

function normalizedFilamentSearch(args: Readonly<Record<string, unknown>>): AssistantFilamentSearch {
  const query = typeof args.query === "string" ? args.query.trim() : undefined;
  const familyQuery = query?.toLowerCase().match(/^(?:(?:найди|покажи)\s+)?(?:(?:пластик|филамент)\s+)?(абс|пла|abs|pla)$/u)?.[1];
  const explicitFamily = typeof args.material_type === "string" ? args.material_type.trim().toLowerCase() : undefined;
  const family = explicitFamily ?? familyQuery;
  const sameFamily = familyQuery === undefined || explicitFamily === undefined ||
    (MATERIAL_TYPE_ALIASES[explicitFamily] ?? explicitFamily) === (MATERIAL_TYPE_ALIASES[familyQuery] ?? familyQuery);
  return {
    ...args as AssistantFilamentSearch,
    ...(family === undefined ? {} : { material_type: MATERIAL_TYPE_ALIASES[family] ?? family }),
    ...(familyQuery === undefined || !sameFamily ? {} : { query: undefined }),
  };
}

function normalizedMaterialTypes(args: Readonly<Record<string, unknown>>): readonly string[] | null {
  if (!hasOnlyKeys(args, ["types"]) || !Array.isArray(args.types) || args.types.length < 2 || args.types.length > 4) return null;
  const types = args.types.map((value) => typeof value === "string" ? (MATERIAL_TYPE_ALIASES[value.trim().toLowerCase()] ?? value.trim().toLowerCase()) : "");
  return types.every((value) => MATERIAL_TYPE_RE.test(value)) && new Set(types).size === types.length ? types : null;
}

function validMaterialTypeComparisonArgs(args: Readonly<Record<string, unknown>>): boolean {
  return normalizedMaterialTypes(args) !== null;
}

function numberInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function pairedTemperature(record: AssistantFilamentRecord, prefix: "nozzle" | "bed"): readonly [number, number] | null {
  const min = numberInRange(record.specs[`${prefix}_temp_min_c`], prefix === "nozzle" ? 100 : 0, prefix === "nozzle" ? 500 : 200);
  const max = numberInRange(record.specs[`${prefix}_temp_max_c`], prefix === "nozzle" ? 100 : 0, prefix === "nozzle" ? 500 : 200);
  return min !== null && max !== null && min <= max ? [min, max] : null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function temperatureSummary(records: readonly AssistantFilamentRecord[], prefix: "nozzle" | "bed") {
  const pairs = records.map((record) => pairedTemperature(record, prefix)).filter((pair): pair is readonly [number, number] => pair !== null);
  return { median_listed_min_c: median(pairs.map(([value]) => value)), median_listed_max_c: median(pairs.map(([, value]) => value)), sample_count: pairs.length };
}

function representativeFilament(records: readonly AssistantFilamentRecord[]): AssistantFilamentRecord {
  return [...records].sort((a, b) => {
    const score = (record: AssistantFilamentRecord) => Number(pairedTemperature(record, "nozzle") !== null) + Number(pairedTemperature(record, "bed") !== null);
    return score(b) - score(a) || a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en");
  })[0]!;
}

@Injectable()
export class AssistantToolsService {
  private readonly handlers: Readonly<Partial<Record<ReadToolName, ReadHandler>>>;

  constructor(
    @Inject(AssistantRepository) private readonly repository: AssistantRepository,
    @Inject(PROFILE_AUTH_PORT) private readonly profiles: ProfileAuthPort,
    @Inject(SANCTIONS_READ_PORT) private readonly sanctions: SanctionsReadPort,
    @Inject(CATALOG_EXTERNAL_PORT) private readonly catalog: CatalogExternalPort,
    @Inject(FEED_ASSISTANT_NEWS_PORT) private readonly news: FeedAssistantNewsPort,
    @Inject(CATALOG_READ_PORT) private readonly catalogReads: CatalogReadPort,
    @Inject(PRINTER_MACHINE_LINKS_PORT) private readonly links: PrinterMachineLinksPort,
    @Inject(ASSISTANT_OWNED_PRINTER_PORT) private readonly ownedPrinters: AssistantOwnedPrinterPort,
    @Inject(RuntimeLogger) private readonly runtimeLogger: RuntimeLogger,
  ) {
    this.handlers = Object.freeze({
      search_printers: {
        scopes: ["catalog:read"],
        validate: validSearchPrinterArgs,
        execute: async (_identity, args) => {
          const result = await this.catalog.searchAssistantPrinters({
            reference: args.query as string,
            ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
            ...(Array.isArray(args.requested_fields) ? { requested_fields: args.requested_fields as string[] } : {}),
          });
          return result.kind === "resolved"
            ? { resolution: "resolved", evidence: [result.evidence] }
            : result.kind === "ambiguous"
              ? { resolution: "ambiguous", evidence: result.candidates }
              : { resolution: "not_found", evidence: [] };
        },
      },
      get_printer: {
        scopes: ["catalog:read"],
        validate: validGetPrinterArgs,
        execute: async (_identity, args) => {
          const result = await this.catalog.getAssistantPrinter({
            reference: (args.printer_id ?? args.slug) as string,
            ...(Array.isArray(args.requested_fields) ? { requested_fields: args.requested_fields as string[] } : {}),
          });
          return result.kind === "resolved" ? { resolution: "resolved", evidence: [result.evidence] } : { resolution: "not_found", evidence: [] };
        },
      },
      compare_printers: {
        scopes: ["catalog:read"],
        validate: validComparePrintersArgs,
        execute: async (_identity, args) => {
          const result = await this.catalog.compareAssistantPrinters({ references: args.references as string[] });
          return result.kind === "resolved"
            ? { resolution: "resolved", evidence: [result.evidence] }
            : result.kind === "ambiguous"
              ? { resolution: "ambiguous", evidence: result.candidates.slice(0, 10) }
              : { resolution: "not_found", evidence: [] };
        },
      },
      search_filaments: {
        scopes: ["catalog:read"],
        validate: validFilamentArgs,
        execute: async (_identity, args) => ({ resolution: "resolved", evidence: (await this.catalogReads.assistantFilaments(normalizedFilamentSearch(args))).map((row) => filamentEvidence(row)) }),
      },
      compare_material_types: {
        scopes: ["catalog:read"],
        validate: validMaterialTypeComparisonArgs,
        execute: async (_identity, args) => {
          const types = normalizedMaterialTypes(args)!;
          const records = await this.catalogReads.assistantMaterialTypeFilaments({ types });
          if (records.length > ASSISTANT_MATERIAL_COMPARISON_MAX_CANDIDATES) {
            throw new UnprocessableEntityException("Material comparison candidate scan exceeded its safety limit");
          }
          const byType = new Map(types.map((type) => [type, records.filter((record) => record.material_type.toLowerCase() === type)]));
          if (types.some((type) => byType.get(type)!.length === 0)) return { resolution: "not_found", evidence: [] };
          return {
            resolution: "resolved",
            evidence: types.map((type) => filamentEvidence(representativeFilament(byType.get(type)!))),
            material_comparison: {
              families: types.map((type) => {
                const family = byType.get(type)!;
                const required = family.filter((record) => record.specs.needs_enclosure === true).length;
                const notRequired = family.filter((record) => record.specs.needs_enclosure === false).length;
                return {
                  material_type: type,
                  published_products: family.length,
                  nozzle_temp_c: temperatureSummary(family, "nozzle"),
                  bed_temp_c: temperatureSummary(family, "bed"),
                  enclosure: { required_count: required, not_required_count: notRequired, unknown_count: family.length - required - notRequired },
                };
              }),
            },
          };
        },
      },
      recommend_filaments: {
        scopes: ["catalog:read", "profile:printers:read"],
        validate: (args) => validFilamentArgs(args, true),
        execute: async (identity, args) => {
          let machineId: string | undefined;
          let catalogPrinterId: string | undefined;
          let userPrinterId: string | undefined;
          let printerLabel: string | undefined;
          if (typeof args.user_printer_id === "string") {
            const owned = await this.ownedPrinters.resolveOwnedReference(UserId(identity.userId), args.user_printer_id);
            if (owned === null) return { resolution: "not_found", evidence: [] };
            const resolution = await this.links.resolveOwnedReferences({ catalogPrinterId: owned.catalog_printer_id, machineId: owned.printer_id });
            if (resolution.kind === "conflict") return { resolution: "data_quality_conflict", evidence: [] };
            userPrinterId = owned.id;
            printerLabel = [owned.brand, owned.model].filter(Boolean).join(" ").slice(0, 300);
            machineId = resolution.kind === "none" ? undefined : resolution.machineId;
            // A private reference never makes an inaccessible public card visible.
            if (owned.catalog_printer_id !== null) {
              const publicPrinter = await this.catalog.getAssistantPrinter({ reference: owned.catalog_printer_id });
              if (publicPrinter.kind === "resolved") {
                catalogPrinterId = publicPrinter.evidence.entity_id;
                printerLabel = publicPrinter.evidence.title;
              }
            }
          }
          if (typeof args.printer_id === "string") {
            const printer = await this.catalog.getAssistantPrinter({ reference: args.printer_id });
            if (printer.kind !== "resolved") return { resolution: "not_found", evidence: [] };
            catalogPrinterId = printer.evidence.entity_id;
            printerLabel = printer.evidence.title;
            machineId = (await this.links.confirmedLinkForPrinter(printer.evidence.entity_id))?.machineId;
          }
          const machine = machineId === undefined ? null : await this.catalogReads.machineForSlicer(machineId);
          const search = normalizedFilamentSearch(args);
          let cursor: AssistantFilamentSearch["recommendation_cursor"];
          let top: readonly AssistantFilamentRecord[] = [];
          let scannedCandidates = 0;
          const seenCandidateIds = new Set<string>();
          while (scannedCandidates < ASSISTANT_FILAMENT_RECOMMENDATION_MAX_CANDIDATES) {
            const page = await this.catalogReads.assistantFilaments({
              ...search,
              recommendation_candidate_scan: true,
              ...(cursor === undefined ? {} : { recommendation_cursor: cursor }),
            } satisfies FilamentRecommendationCandidateSearch);
            scannedCandidates += page.length;
            const unseen = page.filter((candidate) => {
              if (seenCandidateIds.has(candidate.id)) return false;
              seenCandidateIds.add(candidate.id);
              return true;
            });
            top = retainTopFilaments(top, unseen, machine?.specs ?? null, search);
            const last = page.at(-1);
            if (page.length < ASSISTANT_FILAMENT_RECOMMENDATION_PAGE_SIZE || last === undefined) break;
            const nextCursor = { name: last.name, id: last.id };
            if (unseen.length === 0 || (cursor?.name === nextCursor.name && cursor.id === nextCursor.id)) {
              throw new UnprocessableEntityException("Filament recommendation candidate scan did not advance");
            }
            cursor = nextCursor;
          }
          if (scannedCandidates >= ASSISTANT_FILAMENT_RECOMMENDATION_MAX_CANDIDATES) {
            const probe = await this.catalogReads.assistantFilaments({
              ...search,
              limit: 1,
              ...(cursor === undefined ? {} : { recommendation_cursor: cursor }),
            } satisfies AssistantFilamentSearch);
            if (probe.length > 0) throw new UnprocessableEntityException("Filament recommendation candidate scan exceeded its safety limit");
          }
          return { resolution: "resolved", evidence: rankFilaments(top, machine?.specs ?? null, search, {
            ...(machine === null ? {} : { machineId: machine.id }), ...(catalogPrinterId === undefined ? {} : { catalogPrinterId }),
            ...(userPrinterId === undefined ? {} : { userPrinterId }),
            ...(printerLabel === undefined ? {} : { printerLabel }),
          }) };
        },
      },
      list_news: {
        scopes: ["feed:read"],
        validate: validListNewsArgs,
        execute: async (_identity, args) => {
          const result = await this.news.listAssistantNews({
            ...(typeof args.from === "string" ? { from: args.from } : {}),
            ...(typeof args.to === "string" ? { to: args.to } : {}),
            ...(typeof args.topic === "string" ? { topic: args.topic } : {}),
            ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
          });
          return { resolution: "resolved", evidence: result.evidence, period: result.period };
        },
      },
    });
  }

  async context(runId: string, claim: AssistantLeaseClaim, correlationId: string): Promise<AssistantRunContext> {
    const started = performance.now();
    try {
      const { identity, scopes } = await this.authorize(runId, claim);
      const context = await this.visibilityCheckedContext(identity);
      const response: AssistantRunContext = {
        run_id: identity.runId,
        thread_id: identity.threadId,
        message: { id: identity.messageId, content: context.currentMessage },
        mode: "global",
        scopes,
        tools: Object.entries(this.handlers)
          .filter(([, handler]) => handler.scopes.every((scope) => scopes.includes(scope)))
          .map(([name]) => name),
        context: context.messages,
        context_truncated: context.truncated,
        context_omitted_turns: context.omittedTurns,
        correlation_id: correlationId,
      };
      this.runtimeLogger.info(
        {
          event: "assistant.context.completed.v1",
          request_id: correlationId,
          contract_version: "assistant.evidence.v2",
          tool_count: response.tools.length,
          context_truncated: response.context_truncated,
          result_kind: "context",
        },
        "assistant context completed",
      );
      return response;
    } catch (error) {
      const status = failureStatus(error);
      this.runtimeLogger.warn(
        { event: "assistant.context.failed.v1", request_id: correlationId, status_code: status, error_code: `http_${status}`, reason: failureReason(error), latency_ms: Math.round(performance.now() - started) },
        "assistant context failed",
      );
      throw error;
    }
  }

  async execute(runId: string, claim: AssistantLeaseClaim, toolName: string, args: unknown, correlationId: string): Promise<AssistantToolResponse> {
    const handler = Object.hasOwn(this.handlers, toolName) ? this.handlers[toolName as ReadToolName] : undefined;
    const started = performance.now();
    let resultKind = "error";
    let evidenceCount = 0;
    let statusCode: number | null = null;
    let reason: string | null = null;
    try {
      // Re-read account/sanctions and run lifecycle even after a successful context request.
      const { identity, scopes } = await this.authorize(runId, claim);
      if (handler === undefined) throw new NotFoundException();
      if (!handler.scopes.every((scope) => scopes.includes(scope))) throw new ForbiddenException();
      if (args === null || typeof args !== "object" || Array.isArray(args) || !handler.validate(args as Record<string, unknown>)) throw new UnprocessableEntityException();
      // Revalidate bounded historical references at every tool boundary as well as before provider serialization.
      await this.visibilityCheckedContext(identity);
      const result = await handler.execute(identity, args as Record<string, unknown>, correlationId);
      resultKind = result.resolution;
      evidenceCount = result.evidence.length;
      return { run_id: identity.runId, tool: toolName, result, correlation_id: correlationId };
    } catch (error) {
      statusCode = failureStatus(error);
      reason = failureReason(error);
      throw error;
    } finally {
      const record = {
        event: statusCode === null ? "assistant.tool.completed.v1" : "assistant.tool.failed.v1",
        request_id: correlationId,
        contract_version: "assistant.evidence.v2",
        tool_name: Object.hasOwn(this.handlers, toolName) ? toolName : "unknown",
        tool_count: 1,
        evidence_count: evidenceCount,
        latency_ms: Math.round(performance.now() - started),
        result_kind: resultKind,
        ...(statusCode === null ? {} : { status_code: statusCode, error_code: `http_${statusCode}`, reason: reason ?? "unknown" }),
      };
      const message = statusCode === null ? "assistant tool completed" : "assistant tool failed";
      if (statusCode === null) this.runtimeLogger.info(record, message);
      else this.runtimeLogger.warn(record, message);
    }
  }

  private async visibilityCheckedContext(identity: AssistantRunIdentity) {
    const completed = await this.repository.completedTurns(identity, ASSISTANT_CONTEXT_MAX_TURNS);
    return buildAssistantContext(completed, identity.message, async (reference) => {
      if (reference.entityType === "news") return isUuid(reference.entityId) && this.news.isAssistantNewsVisible(FeedPostId(reference.entityId));
      if (reference.entityType === "material") return isUuid(reference.entityId) && this.catalogReads.filamentExists(reference.entityId);
      if (reference.entityType === "machine") return isUuid(reference.entityId) && (await this.catalogReads.machineForSlicer(reference.entityId)) !== null;
      if (reference.entityType === "user_printer") return isUuid(reference.entityId) && (await this.ownedPrinters.resolveOwnedReference(UserId(identity.userId), reference.entityId)) !== null;
      const result = await this.catalog.getAssistantPrinter({ reference: reference.entityId });
      return result.kind === "resolved" && result.evidence.entity_id === reference.entityId;
    });
  }

  private async authorize(runId: string, claim: AssistantLeaseClaim): Promise<{ readonly identity: AssistantRunIdentity; readonly scopes: readonly AssistantScope[] }> {
    if (!isUuid(runId)) throw new NotFoundException();
    if (
      typeof claim.ownerId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(claim.ownerId) ||
      typeof claim.generation !== "string" ||
      !/^[1-9][0-9]{0,18}$/.test(claim.generation) ||
      BigInt(claim.generation) > 9223372036854775807n
    )
      throw new BadRequestException();
    const identity = await this.repository.activeRunIdentity(runId, claim);
    if (identity === null) throw new NotFoundException();
    if (identity.userId === SYSTEM_USER_ID) throw new ForbiddenException();
    const userId = UserId(identity.userId);
    const state = await this.profiles.loadOwnerAuthState(userId);
    if (state?.status !== "active" || (await this.sanctions.findActiveForUser(userId)) !== null) throw new ForbiddenException();
    // These public reads and owned-profile/generation proposals use active-user access today,
    // not staff grants. Domain handlers still enforce entity visibility and ownership.
    // generation:propose only allows an offer; the public confirmation route owns mutation.
    return { identity, scopes: ["catalog:read", "feed:read", "profile:printers:read", "generation:propose"] };
  }
}
