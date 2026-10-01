import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.RESEARCHER_PERMISSION_CUTOVER_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260924170000_researcher_permission_cutover.sql", import.meta.url));

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("researcher cutover migration must contain up and down sections");
  return { up: upSection.replace("-- migrate:up", "").trim(), down: down.trim() };
}

describe("researcher permission cutover", () => {
  it("keeps legacy columns and records grant/revoke audit", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).not.toMatch(/drop\s+column\s+(?:role|is_staff)/i);
    expect(sql).toContain("permission.granted");
    expect(sql).toContain("permission.revoked");
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("preserves researcher access and is idempotent in both directions", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const userId = randomUUID();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    try {
      const name = (await client.query<{ name: string }>("select current_database() name")).rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) throw new Error(`refusing researcher cutover test against '${name}'`);
      await client.query("begin");
      await client.query("insert into users(id,username,role,status) values($1,$2,'researcher','active')", [userId, `researcher-${userId}`]);
      await client.query(up);
      await client.query(up);
      expect((await client.query(`select 1 from permission_grants where user_id=$1 and permission='research.manage_printers' and revoked_at is null`, [userId])).rowCount).toBe(1);
      expect((await client.query(`select count(*)::int count from audit_log where actor_user_id=$1 and action='permission.granted'`, [userId])).rows[0]?.count).toBe(1);
      await client.query(down);
      await client.query(down);
      expect((await client.query(`select 1 from permission_grants where user_id=$1 and permission='research.manage_printers' and revoked_at is null`, [userId])).rowCount).toBe(0);
      expect((await client.query(`select count(*)::int count from audit_log where actor_user_id=$1 and action='permission.revoked'`, [userId])).rows[0]?.count).toBe(1);
      expect((await client.query(`select role from users where id=$1`, [userId])).rows[0]).toEqual({ role: "researcher" });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
