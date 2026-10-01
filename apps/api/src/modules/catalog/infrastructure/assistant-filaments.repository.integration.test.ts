import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CatalogReadRepository } from "./catalog-read.repository.ts";

describe.skipIf(!process.env.DATABASE_URL)("assistant published filament DB reads", () => {
  let pool: Pool;
  let client: PoolClient;
  let repository: CatalogReadRepository;
  const suffix = randomUUID().replaceAll("-", "");
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const variant = randomUUID();
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    const database = (await client.query<{ name: string }>("select current_database() as name")).rows[0]!.name;
    if (!/^(sandbox_|sbx_|portal_test)/.test(database)) throw new Error("Assistant filament tests require an isolated test database");
    await client.query("begin");
    const vendor = randomUUID(), family = randomUUID();
    await client.query("insert into vendors(id,slug,name) values($1,$2,$2)", [vendor, suffix]);
    await client.query("insert into material_types(id,slug,name) values($1,$2,$2)", [family, suffix]);
    for (const [index, status] of ["published", "draft", "archived", "published"].entries()) {
      await client.query(`insert into materials(id,vendor_id,material_type_id,slug,name,status,kind,archived_at)
        values($1,$2,$3,$4,$5,$6,$7,case when $6 = 'archived' then now() else null end)`,
      [ids[index], vendor, family, `${suffix}-${index}`, suffix, status, index === 3 ? "resin" : "filament"]);
    }
    await client.query("insert into material_variants(id,material_id,color_name,diameter_mm) values($1,$2,'White',1.75),($3,$4,'Foreign',2.85)", [variant, ids[0], randomUUID(), ids[1]]);
    repository = new CatalogReadRepository({ query: client.query.bind(client) } as unknown as Pool);
  });
  afterAll(async () => {
    if (client) { await client.query("rollback"); client.release(); }
    await pool?.end();
  });
  it("excludes draft, archived and resin even by exact id", async () => {
    expect((await repository.assistantFilaments({ query: suffix })).map((row) => row.id)).toEqual([ids[0]]);
    expect((await repository.assistantMaterialTypeFilaments({ types: [suffix] })).map((row) => row.id)).toEqual([ids[0]]);
    expect((await repository.assistantFilaments({ query: `Покажи филаменты из ${suffix}` })).map((row) => row.id)).toEqual([ids[0]]);
    expect((await repository.assistantFilaments({ material_type: suffix.toUpperCase() })).map((row) => row.id)).toEqual([ids[0]]);
    for (const id of ids.slice(1)) expect(await repository.assistantFilaments({ query: id })).toEqual([]);
  });
  it("selects only a variant belonging to the published parent and parameterizes diameter", async () => {
    expect(await repository.assistantFilaments({ query: suffix, diameter_mm: 2.85 })).toEqual([]);
    const rows = await repository.assistantFilaments({ query: suffix, diameter_mm: 1.75 });
    expect(rows[0]).toMatchObject({ id: ids[0], variant_id: variant, diameter_mm: 1.75 });
    expect(await repository.assistantFilaments({ query: "' or true --" })).toEqual([]);
  });
  it("matches only a canonical color belonging to the published material", async () => {
    expect((await repository.assistantFilaments({ query: suffix, color: "white" })).map((row) => row.id)).toEqual([ids[0]]);
    expect(await repository.assistantFilaments({ query: suffix, color: "Foreign" })).toEqual([]);
    expect(await repository.assistantFilaments({ query: suffix, color: "' or true --" })).toEqual([]);
  });
  it("revalidation rejects a published material after its kind changes away from filament", async () => {
    expect(await repository.filamentExists(ids[0]!)).toBe(true);
    await client.query("update materials set kind = 'resin' where id = $1", [ids[0]]);
    expect(await repository.materialExists(ids[0]!)).toBe(true);
    expect(await repository.filamentExists(ids[0]!)).toBe(false);
  });
});
