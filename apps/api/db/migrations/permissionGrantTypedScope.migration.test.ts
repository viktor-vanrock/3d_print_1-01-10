import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.PERMISSION_SCOPE_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260923160000_permission_grants_typed_scope.sql", import.meta.url));

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("typed permission scope migration must contain up and down sections");
  return { up: upSection.replace("-- migrate:up", "").trim(), down: down.trim() };
}

async function expectScopeViolation(client: PoolClient, userId: string, scope: unknown): Promise<void> {
  await client.query("savepoint invalid_scope");
  try {
    await expect(
      client.query(
        `insert into permission_grants(user_id,permission,scope,granted_by,reason)
         values($1,'catalog.edit_any',$2::jsonb,$1,'invalid typed scope')`,
        [userId, JSON.stringify(scope)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  } finally {
    await client.query("rollback to savepoint invalid_scope");
    await client.query("release savepoint invalid_scope");
  }
}

describe("permission grant typed scope migration", () => {
  it("backfills legacy global grants before installing the strict default and constraint", async () => {
    const { up } = sections(await readFile(migrationPath, "utf8"));
    const updatePosition = up.indexOf("UPDATE public.permission_grants");
    const defaultPosition = up.indexOf("SET DEFAULT");
    const constraintPosition = up.indexOf("permission_grants_scope_shape_check");

    expect(updatePosition).toBeGreaterThan(-1);
    expect(defaultPosition).toBeGreaterThan(updatePosition);
    expect(constraintPosition).toBeGreaterThan(defaultPosition);
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("backfills global grants and enforces every typed scope shape", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    const userId = randomUUID();
    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const name = database.rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) throw new Error(`refusing permission scope test against non-disposable database '${name}'`);

      await client.query("begin");
      await client.query(down);
      await client.query("insert into users(id,username,status) values($1,$2,'active')", [userId, `typed-scope-${userId}`]);
      const existingTypedGrant = await client.query<{ id: string }>(
        `insert into permission_grants(user_id,permission,scope,granted_by,reason)
         values($1,'catalog.edit_any','{"kind":"global"}'::jsonb,$1,'existing typed global grant') returning id`,
        [userId],
      );
      await client.query(
        `insert into permission_grants(user_id,permission,scope,granted_by,reason)
         values($1,'catalog.edit_any','{"catalog_id":"catalog-1"}'::jsonb,$1,'unsupported legacy scope')`,
        [userId],
      );
      await client.query("savepoint unsupported_legacy_scope");
      await expect(client.query(up)).rejects.toThrow("permission_grants contains unsupported legacy scopes");
      await client.query("rollback to savepoint unsupported_legacy_scope");
      await client.query("release savepoint unsupported_legacy_scope");
      await client.query("delete from permission_grants where user_id=$1 and reason='unsupported legacy scope'", [userId]);

      const legacyGrant = await client.query<{ id: string }>(
        `insert into permission_grants(user_id,permission,granted_by,reason)
         values($1,'catalog.edit_any',$1,'legacy global grant') returning id`,
        [userId],
      );

      await client.query(up);
      const migrated = await client.query<{ id: string; scope: unknown; revoked_at: Date | null; revoke_reason: string | null }>(
        "select id,scope,revoked_at,revoke_reason from permission_grants where id=any($1::uuid[]) order by id",
        [[legacyGrant.rows[0]?.id, existingTypedGrant.rows[0]?.id]],
      );
      expect(migrated.rows).toHaveLength(2);
      expect(migrated.rows.every((row) => JSON.stringify(row.scope) === JSON.stringify({ kind: "global" }))).toBe(true);
      const active = migrated.rows.filter((row) => row.revoked_at === null);
      const reconciled = migrated.rows.filter((row) => row.revoked_at !== null);
      expect(active).toHaveLength(1);
      expect(reconciled).toHaveLength(1);
      expect(reconciled[0]?.revoke_reason).toBe("automatic duplicate grant reconciliation");
      const reconciliationAudit = await client.query(
        `select 1 from audit_log
         where action='permission.revoked' and target_type='permission_grant' and target_id=$1
           and details->>'initiated_by'='migration'`,
        [reconciled[0]?.id],
      );
      expect(reconciliationAudit.rowCount).toBe(1);

      const validScopes = [
        { kind: "global" },
        { kind: "community", communityId: "community-1" },
        { kind: "vendor", vendorId: "vendor-1" },
        { kind: "catalog", catalog: "materials" },
        { kind: "catalog", catalog: "printers" },
        { kind: "user", userId: "user-1" },
      ];
      for (const scope of validScopes) {
        await client.query(
          `insert into permission_grants(user_id,permission,scope,granted_by,reason)
           values($1,'catalog.edit_any',$2::jsonb,$1,'valid typed scope')`,
          [userId, JSON.stringify(scope)],
        );
      }

      for (const scope of [
        {},
        { kind: "unknown" },
        { kind: "global", extra: true },
        { kind: "community" },
        { kind: "community", communityId: "" },
        { kind: "vendor", vendorId: 42 },
        { kind: "catalog", catalog: "models" },
        { kind: "user", userId: " ", extra: true },
      ]) {
        await expectScopeViolation(client, userId, scope);
      }

      await client.query("savepoint unsafe_rollback");
      await expect(client.query(down)).rejects.toThrow("cannot roll back typed permission scopes while resource-scoped grants exist");
      await client.query("rollback to savepoint unsafe_rollback");
      await client.query("release savepoint unsafe_rollback");

      await client.query("delete from permission_grants where user_id=$1 and scope->>'kind' <> 'global'", [userId]);
      await client.query(down);
      const rolledBack = await client.query<{ scope: unknown }>("select scope from permission_grants where id=$1", [legacyGrant.rows[0]?.id]);
      expect(rolledBack.rows[0]?.scope).toEqual({});
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
