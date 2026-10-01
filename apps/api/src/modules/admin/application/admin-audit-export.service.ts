import { BadRequestException, ConflictException, GoneException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { AdminAuditCursorError, decodeAdminAuditCursor, encodeAdminAuditCursor, type AdminAuditFilter, type AdminAuditPosition } from "./admin-audit.cursor.ts";
import { projectAdminAuditRow, type AdminAuditProjection, type AdminAuditRow } from "./admin-audit-read.service.ts";

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
const TTL_MS = 15 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AdminAuditExportQuery {
  readonly from?: string; readonly to?: string; readonly action?: string; readonly targetType?: string;
  readonly actorId?: string; readonly targetId?: string; readonly cursor?: string;
}
export interface StoredAdminAuditExport {
  readonly id: string; readonly actorId: UserId; readonly payload: Buffer; readonly sha256: string;
  readonly eventCount: number; readonly byteSize: number; readonly truncated: boolean;
  readonly createdAt: Date; readonly expiresAt: Date;
}
export interface AdminAuditExportRepository {
  readRows(input: { readonly filter: AdminAuditFilter; readonly position: AdminAuditPosition | null; readonly limit: number }): Promise<readonly AdminAuditRow[]>;
  store(input: StoredAdminAuditExport & { readonly rangeFrom: Date; readonly rangeTo: Date }): Promise<void>;
  findForDownload(id: string, actorId: UserId): Promise<StoredAdminAuditExport | null>;
  countOutstanding(actorId: UserId): Promise<number>;
  recordDownloadStarted(id: string, actorId: UserId): Promise<void>;
}

function date(value: string | undefined): Date | null { if (value === undefined) return null; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; }
function validateText(value: string | undefined, max: number): string | null { if (value === undefined) return null; if (value.length === 0 || value.length > max) throw new BadRequestException("invalid audit export filter"); return value; }

@Injectable()
export class AdminAuditExportService {
  constructor(
    @Inject("ADMIN_AUDIT_EXPORT_REPOSITORY") private readonly repository: AdminAuditExportRepository,
    @Optional() @Inject("ADMIN_AUDIT_CLOCK") private readonly clock?: () => Date,
  ) {}

  async create(actorId: UserId, query: AdminAuditExportQuery) {
    if (await this.repository.countOutstanding(actorId) >= 3) throw new HttpException("too many outstanding audit exports", HttpStatus.TOO_MANY_REQUESTS);
    const { filter, position } = this.resolve(actorId, query);
    const rows = await this.repository.readRows({ filter, position, limit: MAX_EVENTS + 1 });
    const id = randomUUID();
    const now = this.clock?.() ?? new Date();
    const expiresAt = new Date(now.getTime() + TTL_MS);
    const projected = rows.slice(0, MAX_EVENTS).map(projectAdminAuditRow);
    let low = 0; let high = projected.length;
    while (low < high) {
      const count = Math.ceil((low + high) / 2); const lastCandidate = projected[count - 1];
      if (lastCandidate === undefined) { high = count - 1; continue; }
      const cursor = encodeAdminAuditCursor(filter, { createdAt: lastCandidate.created_at, id: lastCandidate.id });
      if (this.serialize(id, now, expiresAt, filter, projected.slice(0, count), true, cursor).byteLength <= MAX_BYTES) low = count;
      else high = count - 1;
    }
    const included: readonly AdminAuditProjection[] = projected.slice(0, low);
    const byteLimited = included.length < projected.length;
    const truncated = byteLimited || rows.length > included.length;
    const last = included.at(-1);
    if (truncated && last === undefined) throw new ConflictException("one audit event exceeds export size limit");
    const nextCursor = truncated && last !== undefined
      ? encodeAdminAuditCursor(filter, { createdAt: last.created_at, id: last.id }) : null;
    const payload = this.serialize(id, now, expiresAt, filter, included, truncated, nextCursor);
    if (payload.byteLength > MAX_BYTES) throw new ConflictException("audit export metadata exceeds size limit");
    const stored: StoredAdminAuditExport = {
      id, actorId, payload, sha256: createHash("sha256").update(payload).digest("hex"), eventCount: included.length,
      byteSize: payload.byteLength, truncated, createdAt: now, expiresAt,
    };
    await this.repository.store({ ...stored, rangeFrom: new Date(filter.from), rangeTo: new Date(filter.to) });
    return { id, status: "ready" as const, event_count: stored.eventCount, byte_size: stored.byteSize, truncated, sha256: stored.sha256, created_at: now.toISOString(), expires_at: expiresAt.toISOString(), download_url: `/v1/admin/audit/exports/${id}/download`, next_cursor: nextCursor };
  }

  async download(id: string, actorId: UserId): Promise<StoredAdminAuditExport> {
    const found = await this.repository.findForDownload(id, actorId);
    if (found === null) throw new NotFoundException();
    if (found.expiresAt <= (this.clock?.() ?? new Date())) throw new GoneException("audit export expired");
    await this.repository.recordDownloadStarted(id, actorId);
    return found;
  }

  private resolve(actorId: UserId, query: AdminAuditExportQuery): { readonly filter: AdminAuditFilter; readonly position: AdminAuditPosition | null } {
    if (query.cursor !== undefined) {
      try { return decodeAdminAuditCursor(query.cursor, actorId, { action: query.action, targetType: query.targetType, actorId: query.actorId, targetId: query.targetId, from: query.from, to: query.to }); }
      catch (error) { if (error instanceof AdminAuditCursorError) throw new BadRequestException("invalid cursor"); throw error; }
    }
    const now = this.clock?.() ?? new Date(); const from = date(query.from); const to = date(query.to);
    if (from === null || to === null || from > to || to > now || to.getTime() - from.getTime() > MAX_RANGE_MS) throw new BadRequestException("invalid audit export range");
    if (query.actorId !== undefined && !UUID_RE.test(query.actorId)) throw new BadRequestException("invalid actor id");
    if (query.targetId !== undefined && !UUID_RE.test(query.targetId)) throw new BadRequestException("invalid target id");
    return { filter: { actorId, action: validateText(query.action, 160), targetType: validateText(query.targetType, 80), actorFilter: query.actorId ?? null, targetFilter: query.targetId ?? null, from: from.toISOString(), to: to.toISOString(), limit: 100 }, position: null };
  }

  private serialize(id: string, createdAt: Date, expiresAt: Date, filter: AdminAuditFilter, events: readonly AdminAuditProjection[], truncated: boolean, nextCursor: string | null): Buffer {
    return Buffer.from(JSON.stringify({ schema_version: "admin-audit-export.v1", export_id: id, created_at: createdAt.toISOString(), expires_at: expiresAt.toISOString(), range: { from: filter.from, to: filter.to }, event_count: events.length, truncated, next_cursor: nextCursor, events }), "utf8");
  }
}
