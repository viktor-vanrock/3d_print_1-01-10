import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.PRINTER_MACHINE_LINKS_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260921120100_printer_machine_links.sql", import.meta.url));

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("printer-machine link migration requires up and down sections");
  return { up: upSection.replace("-- migrate:up", "").trim(), down: down.trim() };
}

async function expectRejected(client: PoolClient, sql: string, params: readonly unknown[]): Promise<void> {
  await client.query("savepoint expected_rejection");
  await expect(client.query(sql, [...params])).rejects.toBeDefined();
  await client.query("rollback to savepoint expected_rejection");
}

describe("printer_machine_links migration", () => {
  it("defines a confirmed-only link and a non-destructive rollback", async () => {
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    expect(up).toContain("printer_id uuid NOT NULL REFERENCES printers(id)");
    expect(up).toContain("machine_id uuid NOT NULL REFERENCES machines(id)");
    expect(up).toContain("CONSTRAINT printer_machine_links_printer_unique UNIQUE (printer_id)");
    expect(up).not.toMatch(/unique\s*\(machine_id\)/i);
    expect(up).toContain("reviewed_by text NOT NULL");
    expect(up).toContain("reviewed_at timestamptz NOT NULL");
    expect(up).not.toMatch(/candidate|rejected|status/i);
    expect(down.trim()).toBe("DROP TABLE printer_machine_links;");
    expect(down).not.toMatch(/delete\s+from\s+(?:printers|machines)/i);
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("enforces one link per printer while allowing a shared machine", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    const printerA = randomUUID();
    const printerB = randomUUID();
    const machineA = randomUUID();
    const machineB = randomUUID();
    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const name = database.rows[0]?.name ?? "";
      if (["portal", "portal_dev", "postgres"].includes(name) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(name)) {
        throw new Error(`refusing printer-machine migration test against non-disposable database '${name}'`);
      }
      await client.query("begin");
      if ((await client.query("select to_regclass('public.printer_machine_links') as table_name")).rows[0]?.table_name !== null) {
        await client.query(down);
      }
      await client.query(up);
      await client.query(
        `insert into printers(id,slug,brand,model,sources) values
         ($1,$2,'Test','A',array['fixture']),($3,$4,'Test','B',array['fixture'])`,
        [printerA, `link-a-${printerA}`, printerB, `link-b-${printerB}`],
      );
      await client.query(
        `insert into machines(id,kind,model,status) values
         ($1,'fdm_printer','A','active'),($2,'fdm_printer','B','active')`,
        [machineA, machineB],
      );
      await client.query(
        `insert into printer_machine_links(printer_id,machine_id,source,reviewed_by,reviewed_at)
         values($1,$3,'fixture','reviewer',now()),($2,$3,'fixture','reviewer',now())`,
        [printerA, printerB, machineA],
      );
      expect((await client.query("select machine_id from printer_machine_links order by printer_id")).rows).toHaveLength(2);
      await expectRejected(
        client,
        `insert into printer_machine_links(printer_id,machine_id,source,reviewed_by,reviewed_at)
         values($1,$2,'fixture','reviewer',now())`,
        [printerA, machineB],
      );
      await expectRejected(
        client,
        `insert into printer_machine_links(printer_id,machine_id,source,reviewed_by,reviewed_at)
         values($1,$2,'','reviewer',now())`,
        [randomUUID(), machineA],
      );
      await client.query(down);
      expect((await client.query("select 1 from printers where id = any($1::uuid[])", [[printerA, printerB]])).rowCount).toBe(2);
      expect((await client.query("select 1 from machines where id = any($1::uuid[])", [[machineA, machineB]])).rowCount).toBe(2);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
