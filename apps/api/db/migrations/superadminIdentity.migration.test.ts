import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.SUPERADMIN_IDENTITY_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260924130000_superadmin_identity.sql", import.meta.url));

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("superadmin identity migration must contain up and down sections");
  return { up: upSection.replace("-- migrate:up", "").trim(), down: down.trim() };
}

describe("platform superadmin identity migration", () => {
  it("creates only the marker schema and never binds a user implicitly", async () => {
    const { up } = sections(await readFile(migrationPath, "utf8"));
    expect(up.toLowerCase()).toContain("create table public.platform_superadmin_identity");
    expect(up.toLowerCase()).toContain("create view public.superadmin_identity_read_v1");
    expect(up.toLowerCase()).not.toContain("insert into public.platform_superadmin_identity");
    expect(up).toContain("ON DELETE RESTRICT");
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("enforces singleton shape, FK protection and guarded rollback", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    const userId = randomUUID();
    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const name = database.rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) throw new Error(`refusing superadmin identity migration test against non-disposable database '${name}'`);

      await client.query("begin");
      await client.query(down);
      await client.query(up);
      expect((await client.query("select 1 from platform_superadmin_identity")).rowCount).toBe(0);
      await client.query("insert into users(id,username,status) values($1,$2,'active')", [userId, `superadmin-marker-${userId}`]);
      await client.query("insert into platform_superadmin_identity(identity_key,user_id,binding_mode) values('superadmin',$1,'existing_installation')", [userId]);
      await expect(client.query("delete from users where id=$1", [userId])).rejects.toMatchObject({ code: "23503" });
      await client.query("rollback");

      await client.query("begin");
      await client.query(down);
      await client.query(up);
      await client.query(down);
      await client.query(up);
      expect((await client.query("select 1 from platform_superadmin_identity")).rowCount).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
      await pool.end();
    }
  });
});
