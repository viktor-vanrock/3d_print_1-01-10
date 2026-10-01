import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";

const path = fileURLToPath(new URL("./20260925090000_admin_audit_read_index.sql", import.meta.url));
const databaseUrl = process.env.DATABASE_URL;

function sections(sql: string) {
  const [up, down] = sql.split("-- migrate:down");
  if (up === undefined || down === undefined) throw new Error("Step 8A migration sections missing");
  return { up: up.replace("-- migrate:up", "").trim(), down: down.trim() };
}

describe("Step 8A audit read index migration", () => {
  it("adds only the chronological UUID-tiebreaker index", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toContain("audit_log_created_id_idx");
    expect(sql).toContain("created_at DESC, id DESC");
    expect(sql.toLowerCase()).not.toMatch(/\b(?:insert|update|delete|truncate)\b/);
  });

  it.skipIf(!databaseUrl || process.env.STEP8A_SCHEMA_TEST !== "1")("supports up/down and replay on a disposable database", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      const name = (await client.query<{ name: string }>("select current_database() as name")).rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) throw new Error(`refusing Step 8A migration test against '${name}'`);
      const { up, down } = sections(await readFile(path, "utf8"));
      await client.query(down);
      await client.query(up);
      await client.query(up);
      expect((await client.query(`select 1 from pg_indexes where schemaname='public' and indexname='audit_log_created_id_idx'`)).rowCount).toBe(1);
      await client.query(down);
      expect((await client.query(`select 1 from pg_indexes where schemaname='public' and indexname='audit_log_created_id_idx'`)).rowCount).toBe(0);
      await client.query(up);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
