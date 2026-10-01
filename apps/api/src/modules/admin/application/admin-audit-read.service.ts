import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import { ALL_PERMISSIONS } from "../../permissions/public/index.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import {
  AdminAuditCursorError,
  decodeAdminAuditCursor,
  encodeAdminAuditCursor,
  type AdminAuditFilter,
  type AdminAuditPosition,
  type AdminAuditSuppliedFilters,
} from "./admin-audit.cursor.ts";

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ACTIONS = new Set([
  "admin.users.browsed", "admin.users.searched", "admin.user.viewed", "admin.user.identity_lookup",
  "admin.user.identities_viewed", "admin.user.credentials_viewed", "admin.user.sanctions_viewed",
  "admin.user.sessions_viewed", "admin.user.api_keys_viewed", "admin.audit.browsed",
  "material.created", "material.updated", "material.published", "material.archived", "material.restored",
  "news.created", "news.updated", "news.published", "news.hidden",
]);
const SAFE_OUTCOMES = new Set(["success", "failure", "not_found", "denied", "conflict"]);
const SAFE_STATUSES = new Set(["active", "restricted", "deleted", "suspended", "blocked", "draft", "published", "hidden", "revoked", "expired"]);
const SAFE_PROVENANCE = new Set(["direct", "admin_assignment", "bootstrap", "researcher_provisioning"]);
const PERMISSIONS = new Set<string>(ALL_PERMISSIONS);

export interface AdminAuditRow {
  readonly id: string;
  readonly actorUserId: UserId;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface AdminAuditReadRepository {
  read(input: { readonly filter: AdminAuditFilter; readonly position: AdminAuditPosition | null }): Promise<readonly AdminAuditRow[]>;
  recordAuditBrowse(input: { readonly actorId: UserId; readonly returned: number; readonly hasMore: boolean }): Promise<void>;
}

export interface AdminAuditQuery extends AdminAuditSuppliedFilters { readonly cursor?: string }

function boundedText(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  return typeof value === "string" && value.length <= 100 && allowed.has(value) ? value : undefined;
}

export function safeAdminAuditMetadata(action: string, details: Readonly<Record<string, unknown>>): Readonly<Record<string, string | number>> {
  if (!SAFE_ACTIONS.has(action)) return {};
  const output: Record<string, string | number> = {};
  const outcome = boundedText(details.outcome, SAFE_OUTCOMES); if (outcome !== undefined) output.outcome = outcome;
  const status = boundedText(details.status, SAFE_STATUSES); if (status !== undefined) output.status = status;
  const permission = boundedText(details.permission, PERMISSIONS); if (permission !== undefined) output.permission = permission;
  const provenance = boundedText(details.provenance, SAFE_PROVENANCE); if (provenance !== undefined) output.provenance = provenance;
  for (const key of ["count", "created", "skipped", "version", "from_version"] as const) {
    const value = details[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000) output[key] = value;
  }
  return output;
}

export interface AdminAuditProjection {
  readonly id: string; readonly actor_user_id: UserId; readonly action: string; readonly target_type: string;
  readonly target_id: string; readonly created_at: string; readonly metadata: Readonly<Record<string, string | number>>;
  readonly details_masked: true;
}

export function projectAdminAuditRow(row: AdminAuditRow): AdminAuditProjection {
  return {
    id: row.id, actor_user_id: row.actorUserId, action: row.action, target_type: row.targetType,
    target_id: row.targetId, created_at: row.createdAt.toISOString(), metadata: safeAdminAuditMetadata(row.action, row.details), details_masked: true,
  };
}

function parseDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

@Injectable()
export class AdminAuditReadService {
  constructor(
    @Inject("ADMIN_AUDIT_READ_REPOSITORY") private readonly repository: AdminAuditReadRepository,
    @Optional() @Inject("ADMIN_AUDIT_CLOCK") private readonly clock?: () => Date,
  ) {}

  async events(actorId: UserId, query: AdminAuditQuery) {
    const { filter, position } = this.resolve(actorId, query);
    const rows = await this.repository.read({ filter, position });
    const hasMore = rows.length > filter.limit;
    const page = rows.slice(0, filter.limit);
    const last = page.at(-1);
    const nextCursor = hasMore && last !== undefined
      ? encodeAdminAuditCursor(filter, { createdAt: last.createdAt.toISOString(), id: last.id })
      : null;
    const items = page.map(projectAdminAuditRow);
    await this.repository.recordAuditBrowse({ actorId, returned: items.length, hasMore });
    return { items, next_cursor: nextCursor, range: { from: filter.from, to: filter.to } };
  }

  private resolve(actorId: UserId, query: AdminAuditQuery): { readonly filter: AdminAuditFilter; readonly position: AdminAuditPosition | null } {
    if (query.cursor !== undefined) {
      try {
        return decodeAdminAuditCursor(query.cursor, actorId, query);
      } catch (error) {
        if (error instanceof AdminAuditCursorError) throw new BadRequestException("invalid cursor");
        throw error;
      }
    }
    const now = this.clock?.() ?? new Date();
    const fromInput = parseDate(query.from);
    const toInput = parseDate(query.to);
    if ((query.from !== undefined && fromInput === null) || (query.to !== undefined && toInput === null)) throw new BadRequestException("invalid audit range");
    const to = toInput ?? now;
    const from = fromInput ?? new Date(to.getTime() - MAX_RANGE_MS);
    if (to > now || from > to || to.getTime() - from.getTime() > MAX_RANGE_MS) throw new BadRequestException("invalid audit range");
    const limit = query.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException("invalid audit limit");
    if (query.actorId !== undefined && !UUID_RE.test(query.actorId)) throw new BadRequestException("invalid actor id");
    if (query.targetId !== undefined && !UUID_RE.test(query.targetId)) throw new BadRequestException("invalid target id");
    if ((query.action?.length ?? 0) > 160 || (query.targetType?.length ?? 0) > 80) throw new BadRequestException("invalid audit filter");
    return {
      filter: {
        actorId, action: query.action ?? null, targetType: query.targetType ?? null, actorFilter: query.actorId ?? null,
        targetFilter: query.targetId ?? null, from: from.toISOString(), to: to.toISOString(), limit,
      },
      position: null,
    };
  }
}
