import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.ADMIN_PORTAL_ACCESS_RENAME_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260924120000_admin_portal_access_rename.sql", import.meta.url));

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("admin portal access rename migration must contain up and down sections");
  return { up: upSection.replace("-- migrate:up", "").trim(), down: down.trim() };
}

describe("admin.portal.access permission rename migration", () => {
  it("renames grants in place without rewriting audit history", async () => {
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    expect(up).toContain("admin.portal.access");
    expect(up.toLowerCase()).not.toContain("insert into public.permission_grants");
    expect(up.toLowerCase()).not.toContain("update public.audit_log");
    expect(down.toLowerCase()).not.toContain("update public.audit_log");
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("preserves active, expired and revoked grant records across up/down and repeat execution", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    const userId = randomUUID();
    const grantIds = [randomUUID(), randomUUID(), randomUUID()];
    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const name = database.rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) throw new Error(`refusing admin portal access rename test against non-disposable database '${name}'`);

      await client.query("begin");
      await client.query(down);
      await client.query("insert into users(id,username,status) values($1,$2,'active')", [userId, `admin-portal-${userId}`]);
      await client.query(
        `insert into permission_grants(id,user_id,permission,scope,granted_by,reason,granted_at,expires_at,revoked_at,revoked_by,revoke_reason)
         values
           ($2,$1,'admin.access',$4,$1,'active reason','2026-09-01T00:00:00Z',null,null,null,null),
           ($3,$1,'admin.access',$4,$1,'expired reason','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z',null,null,null),
           ($5,$1,'admin.access',$4,$1,'revoked reason','2026-09-01T00:00:00Z',null,'2026-09-03T00:00:00Z',$1,'revoked for test')`,
        [userId, grantIds[0], grantIds[1], JSON.stringify({ kind: "global" }), grantIds[2]],
      );
      await client.query(
        `insert into audit_log(actor_user_id,action,target_type,target_id,details)
         values($1,'permission.granted','permission_grant',$2,$3)`,
        [userId, grantIds[0], JSON.stringify({ permission: "admin.access" })],
      );

      await client.query(up);
      await client.query(up);
      const renamed = await client.query<{
        id: string; permission: string; scope: object; reason: string; expires_at: Date | null; revoked_at: Date | null; revoked_by: string | null; revoke_reason: string | null;
      }>(`select id,permission,scope,reason,expires_at,revoked_at,revoked_by,revoke_reason from permission_grants where id=any($1::uuid[]) order by reason`, [grantIds]);
      expect(renamed.rows).toHaveLength(3);
      expect(renamed.rows.every((row) => row.permission === "admin.portal.access")).toBe(true);
      expect(renamed.rows.map((row) => row.id).sort()).toEqual([...grantIds].sort());
      expect(renamed.rows.find((row) => row.reason === "expired reason")?.expires_at).not.toBeNull();
      expect(renamed.rows.find((row) => row.reason === "revoked reason")).toMatchObject({ revoked_by: userId, revoke_reason: "revoked for test" });
      expect((await client.query("select 1 from permission_grants where permission='admin.access'")).rowCount).toBe(0);
      expect((await client.query("select details from audit_log where target_id=$1", [grantIds[0]])).rows[0]?.details).toEqual({ permission: "admin.access" });
      await client.query("savepoint old_key_rejected");
      await expect(client.query(`insert into permission_grants(user_id,permission,granted_by,reason) values($1,'admin.access',$1,'old synonym')`, [userId])).rejects.toMatchObject({ code: "23514" });
      await client.query("rollback to savepoint old_key_rejected");

      await client.query(down);
      await client.query(down);
      expect((await client.query("select 1 from permission_grants where id=any($1::uuid[]) and permission='admin.access'", [grantIds])).rowCount).toBe(3);
      await client.query("savepoint new_key_rejected");
      await expect(client.query(`insert into permission_grants(user_id,permission,granted_by,reason) values($1,'admin.portal.access',$1,'new key after down')`, [userId])).rejects.toMatchObject({ code: "23514" });
      await client.query("rollback to savepoint new_key_rejected");
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
