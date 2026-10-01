import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { CatalogReadRepository } from "./catalog-read.repository.ts";

describe("assistant filament repository", () => {
  it("parameterizes filters, limits to ten and binds variants to published filament parents", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new CatalogReadRepository({ query } as unknown as Pool);
    await repository.assistantFilaments({ query: "'; drop table materials; --", material_type: "pla", diameter_mm: 1.75, color: "White", limit: 999 });
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("m.kind = 'filament' and m.status = 'published'");
    expect(sql).toContain("mv.material_id = m.id");
    expect(sql).not.toContain("mv.status");
    expect(sql).not.toContain("drop table");
    expect(sql).toContain("lower(mv.color_name) = lower($6)");
    expect(parameters).toEqual(["'; drop table materials; --", "%'; drop table materials; --%", 1.75, "pla", 10, "White"]);
  });

  it("uses a bounded keyset page for recommendation scans", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new CatalogReadRepository({ query } as unknown as Pool);
    const cursor = { name: "Product 099", id: "00000000-0000-4000-8000-000000000099" };

    await repository.assistantFilaments({ material_type: "pla", recommendation_candidate_scan: true, recommendation_cursor: cursor });

    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain(`m.name collate "C" > $7::text collate "C"`);
    expect(sql).toContain("m.id > $8::uuid");
    expect(parameters).toEqual(["", "%%", null, "pla", 100, null, cursor.name, cursor.id]);
  });

  it("binds material families and exposes only published filament products", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new CatalogReadRepository({ query } as unknown as Pool);
    await repository.assistantMaterialTypeFilaments({ types: ["abs", "pla"] });
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("m.kind = 'filament' and m.status = 'published'");
    expect(sql).toContain("lower(mt.slug) = any($1::text[])");
    expect(sql).toContain("mv.material_id = m.id");
    expect(parameters).toEqual([["abs", "pla"]]);
  });
});
