import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bootstrapPath = fileURLToPath(new URL("../../../../docs/runbooks/printer-machine-link-bootstrap.sql", import.meta.url));

describe("printer-machine link bootstrap", () => {
  it("is bounded to one explicit id pair and dry-runs by default", async () => {
    const sql = await readFile(bootstrapPath, "utf8");
    expect(sql).toContain("values (\n  :'printer_id'::uuid,\n  :'machine_id'::uuid");
    expect(sql).toContain("\\set apply false");
    expect(sql).toContain("\\if :apply\n  commit;\n\\else\n  rollback;");
    expect(sql).not.toMatch(/brand|model|alias|similarity|candidate/i);
  });

  it("rejects missing or inactive source entities and conflicting links", async () => {
    const sql = await readFile(bootstrapPath, "utf8");
    expect(sql).toContain("cardinality(sources) > 0");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("raise exception 'printer_id is missing or not public'");
    expect(sql).toContain("raise exception 'machine_id is missing or inactive'");
    expect(sql).toContain("raise exception 'printer_id already has a conflicting confirmed link'");
  });

  it("treats an identical repeated input as an idempotent no-op", async () => {
    const sql = await readFile(bootstrapPath, "utf8");
    expect(sql).toContain("existing.source_url is not distinct from requested.source_url");
    expect(sql).toContain("on conflict (printer_id) do nothing");
    expect(sql).toContain("'already_identical'");
    expect(sql).not.toMatch(/on conflict[\s\S]*do update/i);
  });
});
