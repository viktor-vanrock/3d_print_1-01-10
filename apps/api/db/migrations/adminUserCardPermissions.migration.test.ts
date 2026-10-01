import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

const migrationPath = fileURLToPath(new URL("./20260924200000_admin_user_card_permissions.sql", import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL;

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [up, down] = sql.split("-- migrate:down");
  if (up === undefined || down === undefined) throw new Error("Step 5 migration sections missing");
  return { up: up.replace("-- migrate:up", "").trim(), down: down.trim() };
}

describe("Step 5 admin user card permissions migration", () => {
  it("extends only the permission constraint and protects rollback history", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const permission of ["user.view_permissions", "user.view_identities", "user.view_credentials", "moderation.view_sanctions"]) {
      expect(sql).toContain(`'${permission}'`);
    }
    expect(sql.toLowerCase()).not.toMatch(/(?:insert|update|delete)\s+(?:into\s+)?public\.(?:permission_grants|audit_log)/);
    expect(sql).toContain("refusing rollback: Step 5 read grants exist");
  });

  it.skipIf(!DATABASE_URL || process.env.STEP5_SCHEMA_TEST !== "1")("replays and refuses rollback after a Step 5 grant exists", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    const userId = randomUUID();
    try {
      const name = (await client.query<{ name: string }>("select current_database() as name")).rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) throw new Error(`refusing Step 5 migration test against '${name}'`);
      await client.query("begin");
      await client.query(down);
      await client.query(up);
      await client.query(up);
      await client.query("insert into users(id,username,status) values($1,$2,'active')", [userId, `step5-${userId}`]);
      await client.query("insert into permission_grants(user_id,permission,granted_by,reason) values($1,'user.view_credentials',$1,'rollback fixture')", [userId]);
      await client.query("savepoint rollback_attempt");
      await expect(client.query(down)).rejects.toThrow("refusing rollback");
      await client.query("rollback to savepoint rollback_attempt");
      expect((await client.query("select 1 from permission_grants where user_id=$1 and permission='user.view_credentials'", [userId])).rowCount).toBe(1);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
