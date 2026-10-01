import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

const migrationPath = fileURLToPath(new URL("./20260924213000_defer_admin_device_permissions.sql", import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL;

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [up, down] = sql.split("-- migrate:down");
  if (up === undefined || down === undefined) throw new Error("deferred device migration sections missing");
  return { up: up.replace("-- migrate:up", "").trim(), down: down.trim() };
}

describe("deferred device administration forward migration", () => {
  it("fails closed on active authority while retaining only existing revoked tombstones", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("active deferred device-admin grants exist");
    expect(sql).toContain("active deferred device-admin confirmation intents exist");
    expect(sql).not.toContain("delete from public.permission_grants");
    expect(sql).not.toContain("delete from public.audit_log");
    expect(sql).toContain("DROP CONSTRAINT permission_grants_permission_check");
    expect(sql).toContain("reject_deferred_device_permission_grant");
    expect(sql).toContain("AND revoked_at IS NOT NULL");
  });

  it.skipIf(!DATABASE_URL || process.env.STEP6_DEFER_DEVICE_SCHEMA_TEST !== "1")("upgrades the applied Step 6 schema, replays cleanly and preserves revoked history", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    const userId = randomUUID();
    try {
      const name = (await client.query<{ name: string }>("select current_database() as name")).rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) throw new Error(`refusing deferred device migration test against '${name}'`);
      await client.query("begin");
      await client.query("insert into users(id,username) values($1,$2)", [userId, `defer-device-${userId}`]);
      await client.query(
        `insert into permission_grants(user_id,permission,granted_by,reason,revoked_at,revoked_by,revoke_reason)
         values($1,'support.revoke_device',$1,'historical',now(),$1,'deferred')`,
        [userId],
      );
      await client.query(up);
      await client.query(up);
      await client.query(down);
      expect((await client.query("select 1 from permission_grants where user_id=$1 and permission='support.revoke_device'", [userId])).rowCount).toBe(1);
      await client.query("savepoint active_tombstone");
      await expect(client.query(
        `insert into permission_grants(user_id,permission,granted_by,reason)
         values($1,'support.rotate_device_credentials',$1,'active fixture')`, [userId],
      )).rejects.toThrow("deferred device-admin permissions cannot be granted");
      await client.query("rollback to savepoint active_tombstone");
      await client.query("savepoint fabricated_tombstone");
      await expect(client.query(
        `insert into permission_grants(user_id,permission,granted_by,reason,revoked_at,revoked_by,revoke_reason)
         values($1,'support.rotate_device_credentials',$1,'fabricated history',now(),$1,'already revoked')`, [userId],
      )).rejects.toThrow("deferred device-admin permissions cannot be granted");
      await client.query("rollback to savepoint fabricated_tombstone");
      await expect(client.query(
        `insert into permission_grants(user_id,permission,granted_by,reason)
         values($1,'support.manage_devices',$1,'supported fixture')`, [userId],
      )).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
