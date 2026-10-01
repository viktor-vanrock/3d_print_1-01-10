import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.DROP_USERS_IS_STAFF_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260929110000_drop_users_is_staff.sql", import.meta.url));

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("is_staff removal migration must contain up and down sections");
  return { up: upSection.replace(/^.*-- migrate:up/s, "").trim(), down: down.trim() };
}

describe("users.is_staff removal migration", () => {
  it("drops the legacy flag and restores only a non-authoritative false column on rollback", async () => {
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    expect(up).toMatch(/alter table public\.users\s+drop column is_staff/i);
    expect(down).toMatch(/add column is_staff boolean not null default false/i);
    expect(down).not.toMatch(/permission_grants|update\s+public\.users/i);
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("replays in both directions on a disposable database", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    try {
      const name = (await client.query<{ name: string }>("select current_database() as name")).rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) {
        throw new Error(`refusing is_staff migration test against non-disposable database '${name}'`);
      }

      await client.query("begin");
      await client.query(up);
      expect((await client.query(
        `select 1 from information_schema.columns
         where table_schema='public' and table_name='users' and column_name='is_staff'`,
      )).rowCount).toBe(0);
      await client.query(down);
      const restored = await client.query<{ column_default: string | null; is_nullable: string }>(
        `select column_default,is_nullable from information_schema.columns
         where table_schema='public' and table_name='users' and column_name='is_staff'`,
      );
      expect(restored.rows[0]).toMatchObject({ column_default: "false", is_nullable: "NO" });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
