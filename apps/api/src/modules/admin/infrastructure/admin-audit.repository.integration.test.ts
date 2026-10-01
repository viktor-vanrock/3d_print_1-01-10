import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { UserId } from "../../_kernel/brandedIds.ts";
import { AdminAuditRepository } from "./admin-audit.repository.ts";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("AdminAuditRepository PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const repository = new AdminAuditRepository(pool);
  const actorId = UserId(randomUUID());
  const targetId = randomUUID();

  beforeAll(async () => {
    const name = (await pool.query<{ name: string }>("select current_database() name")).rows[0]?.name ?? "";
    if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) throw new Error(`refusing audit integration test against '${name}'`);
    await pool.query(`insert into users(id,username) values($1,$2)`, [actorId, `audit-${actorId}`]);
    await pool.query(
      `insert into audit_log(actor_user_id,action,target_type,target_id,details,created_at) values
       ($1,'admin.user.viewed','user',$2,'{}',now()-interval '2 minutes'),
       ($1,'admin.user.viewed','user',$2,'{}',now()-interval '1 minute')`,
      [actorId, targetId],
    );
  });

  afterAll(async () => {
    await pool.query(`delete from audit_log where actor_user_id=$1`, [actorId]);
    await pool.query(`delete from users where id=$1`, [actorId]);
    await pool.end();
  });

  it("uses stable created_at/id keyset ordering and bounded filters", async () => {
    const filter = {
      actorId, action: "admin.user.viewed", targetType: "user", actorFilter: actorId, targetFilter: targetId,
      from: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(), to: new Date().toISOString(), limit: 1,
    };
    const first = await repository.read({ filter, position: null });
    expect(first).toHaveLength(2);
    const head = first[0];
    if (head === undefined) throw new Error("missing first audit row");
    const second = await repository.read({ filter, position: { createdAt: head.createdAt.toISOString(), id: head.id } });
    expect(second).toHaveLength(1);
    expect(second[0]?.id).not.toBe(head.id);
  });
});
