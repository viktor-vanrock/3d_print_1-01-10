import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.USER_LOOKUP_IDENTITY_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260924160000_user_lookup_identity_permission.sql", import.meta.url));

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("user.lookup_identity migration must contain up and down sections");
  return { up: upSection.replace("-- migrate:up", "").trim(), down: down.trim() };
}

describe("user.lookup_identity migration", () => {
  it("does not grant permissions or rewrite audit history", async () => {
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    expect(up.toLowerCase()).not.toMatch(/(?:insert|update|delete)\s+(?:into\s+)?public\.permission_grants/);
    expect(`${up}\n${down}`.toLowerCase()).not.toMatch(/(?:insert|update|delete)\s+(?:into\s+)?public\.audit_log/);
    expect(down).toContain("refusing rollback");
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("replays and refuses rollback while any historical lookup grant exists", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    const userId = randomUUID();
    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const name = database.rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) {
        throw new Error(`refusing user.lookup_identity migration test against non-disposable database '${name}'`);
      }

      await client.query("begin");
      await client.query(down);
      await client.query(up);
      await client.query(up);
      expect((await client.query("select 1 from permission_grants where permission='user.lookup_identity'")).rowCount).toBe(0);

      await client.query("insert into users(id,username,status) values($1,$2,'active')", [userId, `identity-lookup-${userId}`]);
      const grant = await client.query<{ id: string }>(
        `insert into permission_grants(user_id,permission,granted_by,reason)
         values($1,'user.lookup_identity',$1,'migration rollback fixture') returning id`,
        [userId],
      );
      const grantId = grant.rows[0]?.id;
      if (grantId === undefined) throw new Error("lookup grant fixture was not created");
      await client.query(
        `insert into audit_log(actor_user_id,action,target_type,target_id,details)
         values($1,'permission.granted','permission_grant',$2,'{}'::jsonb)`,
        [userId, grantId],
      );

      await client.query("savepoint rollback_attempt");
      await expect(client.query(down)).rejects.toThrow("refusing rollback");
      await client.query("rollback to savepoint rollback_attempt");
      expect((await client.query("select 1 from permission_grants where id=$1", [grantId])).rowCount).toBe(1);
      expect((await client.query("select 1 from audit_log where target_id=$1", [grantId])).rowCount).toBe(1);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
