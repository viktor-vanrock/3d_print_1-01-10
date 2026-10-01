import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.ADMIN_PERMISSION_MANAGEMENT_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260924180000_admin_permission_management.sql", import.meta.url));

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("admin permission migration must contain up and down sections");
  return { up: upSection.replace("-- migrate:up", "").trim(), down: down.trim() };
}

describe("admin permission management migration", () => {
  it("adds versioned provenance, one-time confirmation storage and guarded rollback", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("preset_version");
    expect(sql).toContain("direct_existing");
    expect(sql).toContain("session_fingerprint");
    expect(sql).toContain("refusing rollback");
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("replays up/down and refuses a lossy rollback", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    const actorId = randomUUID();
    try {
      const database = (await client.query<{ name: string }>("select current_database() name")).rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(database)) throw new Error(`refusing schema test against '${database}'`);
      await client.query("begin");
      await client.query(down);
      await client.query(up);
      await client.query(`insert into users(id,username,status) values($1,$2,'active')`, [actorId, `step4-${actorId}`]);
      await client.query(
        `insert into permission_grants(user_id,permission,granted_by,reason) values($1,'user.assign_admin',$1,'migration fixture')`,
        [actorId],
      );
      await client.query("savepoint lossy_rollback");
      await expect(client.query(down)).rejects.toThrow(/refusing rollback/);
      await client.query("rollback to savepoint lossy_rollback");
      await client.query(`delete from permission_grants where user_id=$1`, [actorId]);
      await client.query(`delete from users where id=$1`, [actorId]);
      await client.query(down);
      await client.query(up);
      expect((await client.query(`select to_regclass('public.admin_permission_assignments') name`)).rows[0]?.name).toBe(
        "admin_permission_assignments",
      );
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
