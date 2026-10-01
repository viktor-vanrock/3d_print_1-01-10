import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { UserId as parseUserId } from "../../_kernel/brandedIds.ts";
import type { AdminAuditFilter, AdminAuditPosition } from "../application/admin-audit.cursor.ts";
import type { AdminAuditRow } from "../application/admin-audit-read.service.ts";

interface AuditRow {
  readonly id: string; readonly actor_user_id: string; readonly action: string; readonly target_type: string;
  readonly target_id: string; readonly details: unknown; readonly created_at: Date;
}

function details(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}

@Injectable()
export class AdminAuditRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async record(input: {
    readonly actorId: UserId;
    readonly action: "admin.users.browsed" | "admin.users.searched" | "admin.user.viewed" | "admin.user.identity_lookup"
      | "admin.user.identities_viewed" | "admin.user.credentials_viewed" | "admin.user.sanctions_viewed"
      | "admin.user.sessions_viewed" | "admin.user.api_keys_viewed";
    readonly targetType: "user_directory" | "user";
    readonly targetId: UserId;
    readonly details: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    await this.pool.query(
      `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
       values($1,$2,$3,$4,$5,$6,now())`,
      [randomUUID(), input.actorId, input.action, input.targetType, input.targetId, JSON.stringify(input.details)],
    );
  }

  async read(input: { readonly filter: AdminAuditFilter; readonly position: AdminAuditPosition | null }): Promise<readonly AdminAuditRow[]> {
    const params: unknown[] = [input.filter.from, input.filter.to];
    const conditions = ["created_at >= $1", "created_at <= $2"];
    const add = (sql: string, value: unknown) => { params.push(value); conditions.push(sql.replace("?", `$${params.length}`)); };
    if (input.filter.action !== null) add("action = ?", input.filter.action);
    if (input.filter.targetType !== null) add("target_type = ?", input.filter.targetType);
    if (input.filter.actorFilter !== null) add("actor_user_id = ?", input.filter.actorFilter);
    if (input.filter.targetFilter !== null) add("target_id = ?", input.filter.targetFilter);
    if (input.position !== null) {
      params.push(input.position.createdAt, input.position.id);
      conditions.push(`(created_at,id) < ($${params.length - 1}::timestamptz,$${params.length}::uuid)`);
    }
    params.push(input.filter.limit + 1);
    const result = await this.pool.query<AuditRow>(
      `select id,actor_user_id,action,target_type,target_id,details,created_at from audit_log
       where ${conditions.join(" and ")} order by created_at desc,id desc limit $${params.length}`,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id, actorUserId: parseUserId(row.actor_user_id), action: row.action, targetType: row.target_type,
      targetId: row.target_id, details: details(row.details), createdAt: row.created_at,
    }));
  }

  async recordAuditBrowse(input: { readonly actorId: UserId; readonly returned: number; readonly hasMore: boolean }): Promise<void> {
    await this.pool.query(
      `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
       values($1,$2,'admin.audit.browsed','audit_log',$2,$3,now())`,
      [randomUUID(), input.actorId, JSON.stringify({ count: input.returned, has_more: input.hasMore })],
    );
  }

}
