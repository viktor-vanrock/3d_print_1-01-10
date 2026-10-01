import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { UserId as parseUserId, type UserId } from "../../_kernel/brandedIds.ts";
import type { AdminAuditFilter, AdminAuditPosition } from "../application/admin-audit.cursor.ts";
import type { AdminAuditRow } from "../application/admin-audit-read.service.ts";
import type { AdminAuditExportRepository, StoredAdminAuditExport } from "../application/admin-audit-export.service.ts";

interface ExportRow { readonly id: string; readonly actor_user_id: string; readonly payload: Buffer; readonly payload_sha256: Buffer; readonly event_count: number; readonly byte_size: number; readonly truncated: boolean; readonly created_at: Date; readonly expires_at: Date }
interface AuditRow { readonly id: string; readonly actor_user_id: string; readonly action: string; readonly target_type: string; readonly target_id: string; readonly details: unknown; readonly created_at: Date }
function details(value: unknown): Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}; }

@Injectable()
export class AdminAuditExportPostgresRepository implements AdminAuditExportRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}
  async readRows(input: { readonly filter: AdminAuditFilter; readonly position: AdminAuditPosition | null; readonly limit: number }): Promise<readonly AdminAuditRow[]> {
    const params: unknown[] = [input.filter.from, input.filter.to]; const conditions = ["created_at >= $1", "created_at <= $2"];
    const add = (sql: string, value: unknown) => { params.push(value); conditions.push(sql.replace("?", `$${params.length}`)); };
    if (input.filter.action !== null) add("action = ?", input.filter.action); if (input.filter.targetType !== null) add("target_type = ?", input.filter.targetType);
    if (input.filter.actorFilter !== null) add("actor_user_id = ?", input.filter.actorFilter); if (input.filter.targetFilter !== null) add("target_id = ?", input.filter.targetFilter);
    if (input.position !== null) { params.push(input.position.createdAt, input.position.id); conditions.push(`(created_at,id) < ($${params.length - 1}::timestamptz,$${params.length}::uuid)`); }
    params.push(input.limit);
    const result = await this.pool.query<AuditRow>(`select id,actor_user_id,action,target_type,target_id,details,created_at from audit_log where ${conditions.join(" and ")} order by created_at desc,id desc limit $${params.length}`, params);
    return result.rows.map((row) => ({ id: row.id, actorUserId: parseUserId(row.actor_user_id), action: row.action, targetType: row.target_type, targetId: row.target_id, details: details(row.details), createdAt: row.created_at }));
  }
  async countOutstanding(actorId: UserId): Promise<number> { const result = await this.pool.query<{ count: string }>("select count(*) count from admin_audit_exports where actor_user_id=$1 and expires_at>now()", [actorId]); return Number(result.rows[0]?.count ?? 0); }
  async store(input: StoredAdminAuditExport & { readonly rangeFrom: Date; readonly rangeTo: Date }): Promise<void> {
    const client = await this.pool.connect(); try { await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`admin-audit-export:${input.actorId}`]);
      const count = await client.query<{ count: string }>("select count(*) count from admin_audit_exports where actor_user_id=$1 and expires_at>now()", [input.actorId]);
      if (Number(count.rows[0]?.count ?? 0) >= 3) throw new Error("too many outstanding audit exports");
      await client.query(`insert into admin_audit_exports(id,actor_user_id,payload,payload_sha256,event_count,byte_size,truncated,range_from,range_to,created_at,expires_at) values($1,$2,$3,decode($4,'hex'),$5,$6,$7,$8,$9,$10,$11)`, [input.id,input.actorId,input.payload,input.sha256,input.eventCount,input.byteSize,input.truncated,input.rangeFrom,input.rangeTo,input.createdAt,input.expiresAt]);
      await this.audit(client, input.actorId, "admin.audit_export.created", input.id, { count: input.eventCount, truncated: input.truncated }); await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
  async findForDownload(id: string, actorId: UserId): Promise<StoredAdminAuditExport | null> { const result = await this.pool.query<ExportRow>("select id,actor_user_id,payload,payload_sha256,event_count,byte_size,truncated,created_at,expires_at from admin_audit_exports where id=$1 and actor_user_id=$2", [id,actorId]); const row=result.rows[0]; return row === undefined ? null : { id:row.id,actorId:parseUserId(row.actor_user_id),payload:row.payload,sha256:row.payload_sha256.toString("hex"),eventCount:row.event_count,byteSize:row.byte_size,truncated:row.truncated,createdAt:row.created_at,expiresAt:row.expires_at }; }
  async recordDownloadStarted(id: string, actorId: UserId): Promise<void> { await this.audit(this.pool, actorId, "admin.audit_export.download_started", id, {}); }
  async deleteExpired(limit: number): Promise<number> { const result = await this.pool.query(`delete from admin_audit_exports where id in (select id from admin_audit_exports where expires_at<=now() order by expires_at,id limit $1 for update skip locked)`, [limit]); return result.rowCount ?? 0; }
  private async audit(client: Pick<PoolClient,"query"> | Pick<Pool,"query">, actorId: UserId, action: string, targetId: string, value: Readonly<Record<string,unknown>>): Promise<void> { await client.query("insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at) values($1,$2,$3,'admin_audit_export',$4,$5,now())", [randomUUID(),actorId,action,targetId,JSON.stringify(value)]); }
}
