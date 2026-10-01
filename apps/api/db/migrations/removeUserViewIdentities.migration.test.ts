import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL("./20260929100000_remove_user_view_identities.sql", import.meta.url));
const obsoleteMigrationPath = fileURLToPath(new URL("./20260928140000_remove_obsolete_admin_permissions.sql", import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.REMOVE_USER_VIEW_IDENTITIES_SCHEMA_TEST === "1";

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("user.view_identities retirement migration must contain up and down sections");
  return { up: upSection.replace(/^.*-- migrate:up/s, "").trim(), down: down.trim() };
}

describe("user.view_identities retirement migration", () => {
  it("revokes active grants and consumes pending confirmations without destructive rollback", async () => {
    const { up, down } = sections(await readFile(migrationPath, "utf8"));

    expect(up).toContain("permission = 'user.view_identities'");
    expect(up).toContain("payload->>'permission' = 'user.view_identities'");
    expect(up).toContain("revoked_at = COALESCE(revoked_at, now())");
    expect(up).toContain("revoked_by = '00000000-0000-0000-0000-000000000001'::uuid");
    expect(up).toContain("consumed_at = COALESCE(consumed_at, now())");
    expect(down.toLowerCase()).not.toMatch(/\b(update|delete|insert|alter|drop|truncate)\b/);
  });

  it("uses the system actor for revocations in both retirement migrations", async () => {
    const obsolete = sections(await readFile(obsoleteMigrationPath, "utf8")).up;
    const identities = sections(await readFile(migrationPath, "utf8")).up;
    for (const sql of [obsolete, identities]) {
      expect(sql).toMatch(/revoked_at\s*=\s*coalesce\(revoked_at,\s*now\(\)\)/i);
      expect(sql).toMatch(/revoked_by\s*=\s*'00000000-0000-0000-0000-000000000001'::uuid/i);
      expect(sql).toMatch(/revoke_reason\s*=\s*coalesce\(revoke_reason,/i);
    }
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("retires existing grants and confirmations on a disposable database", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up } = sections(await readFile(migrationPath, "utf8"));
    const actorId = randomUUID();
    const targetId = randomUUID();
    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const name = database.rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) {
        throw new Error(`refusing user.view_identities migration test against non-disposable database '${name}'`);
      }

      await client.query("begin");
      await client.query("insert into users(id,username,status) values($1,$2,'active'),($3,$4,'active')", [
        actorId, `identity-retirement-actor-${actorId}`, targetId, `identity-retirement-target-${targetId}`,
      ]);
      const grant = await client.query<{ id: string }>(
        `insert into permission_grants(user_id,permission,granted_by,reason)
         values($1,'user.view_identities',$2,'retirement migration test') returning id`,
        [targetId, actorId],
      );
      const confirmation = await client.query<{ id: string }>(
        `insert into permission_change_confirmations(
           actor_user_id,target_user_id,session_fingerprint,session_version,action,payload,payload_hash,expires_at
         ) values($1,$2,repeat('a',64),0,'grant_permission',$3,repeat('b',64),now()+interval '5 minutes') returning id`,
        [actorId, targetId, JSON.stringify({ permission: "user.view_identities" })],
      );

      await client.query(up);

      const revoked = (await client.query<{ revoked_at: Date | null; revoked_by: string | null; revoke_reason: string | null }>(
        "select revoked_at,revoked_by,revoke_reason from permission_grants where id=$1", [grant.rows[0]?.id],
      )).rows[0];
      expect(revoked?.revoked_at).toBeInstanceOf(Date);
      expect(revoked?.revoked_by).toBe("00000000-0000-0000-0000-000000000001");
      expect(revoked?.revoke_reason).toBe("Permission retired from Administration");
      expect((await client.query<{ consumed_at: Date | null }>("select consumed_at from permission_change_confirmations where id=$1", [confirmation.rows[0]?.id])).rows[0]?.consumed_at).toBeInstanceOf(Date);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
