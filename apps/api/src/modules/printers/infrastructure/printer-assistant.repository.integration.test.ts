import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrinterCatalogRepository } from "./printer-catalog.repository.ts";

describe.skipIf(!process.env.DATABASE_URL)("assistant public printer DB reads", () => {
  let pool: Pool;
  let client: PoolClient;
  let repository: PrinterCatalogRepository;
  const suffix = randomUUID().slice(0, 8);
  const slugs = [`assistant-k1-${suffix}-alpha`, `assistant-k1-${suffix}-beta`, `assistant-k1-${suffix}-hidden`];
  let firstId: string;
  let p1sId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    const database = (await client.query<{ name: string }>("select current_database() as name")).rows[0]!.name;
    if (!/^(sandbox_|sbx_|portal_test)/.test(database)) throw new Error("Assistant printer tests require an isolated test database");
    await client.query("begin");
    const inserted = await client.query<{ id: string }>(
      `insert into printers
         (slug,brand,model,aliases,status,sources,price_ru_rub,price_ru_updated_at,specs,field_provenance,confidence,reviewed_by,verified)
       values
         ($1,'Creality',$4,array[$4],'shipping',array['https://safe.example/k1-alpha'],55000,'2026-01-01',
          '{"build_volume":{"x":220,"y":220,"z":250}}',
          '{"price.ru_rub":{"source_url":"https://safe.example/k1-alpha","ts":"2026-01-01T00:00:00Z"}}','high','reviewer',true),
         ($2,'Creality',$5,array[$4],'announced',array['https://safe.example/k1-beta'],null,null,'{}','{}','medium',null,false),
         ($3,'Creality',$6,array[$4],'shipping','{}',49000,'2026-09-01','{}','{}','high','reviewer',true)
       returning id`,
      [slugs[0], slugs[1], slugs[2], `K1 ${suffix}`, `K1 ${suffix} Max`, `K1 ${suffix} Hidden`],
    );
    firstId = inserted.rows[0]!.id;
    p1sId = (
      await client.query<{ id: string }>(
        `insert into printers (slug,brand,model,aliases,status,sources,price_ru_rub,price_ru_updated_at,specs,field_provenance,confidence,reviewed_by,verified)
         values ($1,'Bambu Lab',$2,'{}','shipping',array['https://safe.example/p1s'],75000,'2026-09-10','{}','{}','high','reviewer',true)
         returning id`,
        [`assistant-p1s-${suffix}`, `P1S ${suffix}`],
      )
    ).rows[0]!.id;
    repository = new PrinterCatalogRepository({ query: client.query.bind(client) } as unknown as Pool);
  });

  afterAll(async () => {
    if (client) {
      await client.query("rollback");
      client.release();
    }
    await pool?.end();
  });

  it("keeps ambiguity bounded and deterministic while excluding source-less rows", async () => {
    const query = `K1 ${suffix}`;
    const first = await repository.assistantSearch({ reference: query, limit: 10 });
    const second = await repository.assistantSearch({ reference: query, limit: 10 });
    expect(first).toEqual(second);
    expect(first.kind).toBe("ambiguous");
    if (first.kind !== "ambiguous") throw new Error("expected ambiguity");
    expect(first.candidates.map((candidate) => candidate.title)).toEqual([`Creality K1 ${suffix}`, `Creality K1 ${suffix} Max`]);
    expect(first.candidates).toHaveLength(2);
    await expect(repository.assistantDetail({ reference: slugs[2]! })).resolves.toEqual({ kind: "not_found" });
  });

  it("resolves an exact id and exposes missing requested fields plus stale price independently", async () => {
    const result = await repository.assistantSearch({ reference: firstId, requested_fields: ["chamber_temperature_c"] });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("expected exact resolution");
    expect(result.evidence.missing_fields).toContain("chamber_temperature_c");
    expect(result.evidence.facts.build_volume_mm).toEqual({ x: 220, y: 220, z: 250 });
    expect(result.evidence.freshness).toBe("stale");
  });

  it("resolves two names inside one comparison and preserves their input order", async () => {
    const result = await repository.assistantCompare({ references: [`P1S ${suffix}`, `K1 ${suffix} Max`] });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("expected resolved comparison");
    expect(result.evidence.facts.printer_ids[0]).toBe(p1sId);
    expect(result.evidence.facts.printer_ids[1]).not.toBe(firstId);
    expect(result.evidence.facts.rows).toHaveLength(14);
  });
});
