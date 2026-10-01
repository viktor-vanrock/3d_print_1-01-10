import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { isAssistantEvidenceCitation } from "@portal/contracts/http/assistant";
import { PrinterCatalogRepository, mapAssistantPrinterComparison, mapAssistantPrinterEvidence } from "./printer-catalog.repository.ts";
import { serializePrinter, type PrinterRow } from "./serialize.ts";

function row(overrides: Partial<PrinterRow> = {}): PrinterRow {
  return {
    id: randomUUID(),
    slug: "creality.k1",
    brand: "Creality",
    model: "K1",
    aliases: [],
    released_at: "2023-01-01",
    status: "shipping",
    kinematics: "corexy",
    type: "fdm",
    enclosed: true,
    build_volume_x: 220,
    build_volume_y: 220,
    build_volume_z: 250,
    hotend_max_temp_c: 300,
    hotend_max_flow_mm3s: 32,
    hotend_hardened: false,
    bed_max_temp_c: 100,
    bed_auto_leveling: "strain-gauge",
    multimaterial_supported: false,
    has_laser: false,
    has_cnc: false,
    nozzle_swappable: true,
    moonraker: false,
    lan_mode: true,
    price_msrp_usd: 599,
    price_ru_rub: 55_000,
    price_ru_updated_at: "2026-09-01",
    support_level: "list",
    firmware_ready: false,
    firmware_public: false,
    connector_type: "vendor-cloud",
    firmware_repo: null,
    pilot_status: null,
    specs: { hotend: { material: "brass" }, materials_supported: ["PLA", "PETG"] },
    media: {},
    sources: ["https://www.creality.com/products/k1-speedy-3d-printer"],
    field_provenance: {
      build_volume: { source_url: "https://www.creality.com/products/k1-speedy-3d-printer", ts: "2026-09-10T08:30:00Z" },
    },
    confidence: "high",
    filled_by: "researcher",
    reviewed_by: "reviewer",
    gaps: [],
    verified: true,
    schema_version: "1.0",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-09-10T09:00:00Z",
    ...overrides,
  };
}

function repositoryWithRows(...responses: readonly PrinterRow[][]) {
  const query = vi.fn();
  for (const rows of responses) query.mockResolvedValueOnce({ rows });
  return { repository: new PrinterCatalogRepository({ query } as unknown as Pool), query };
}

describe("assistant public printer reads", () => {
  it("returns bounded distinguishing candidates for an ambiguous K1 name", async () => {
    const k1 = row();
    const k1Max = row({ id: randomUUID(), slug: "creality.k1-max", model: "K1 Max" });
    const { repository, query } = repositoryWithRows([], [k1, k1Max]);

    const result = await repository.assistantSearch({ reference: "  K1  ", limit: 99 });

    expect(result).toMatchObject({
      kind: "ambiguous",
      candidates: [
        { entity_id: k1.id, title: "Creality K1", facts: { brand: "Creality", model: "K1", product_status: "shipping" } },
        { entity_id: k1Max.id, title: "Creality K1 Max", facts: { brand: "Creality", model: "K1 Max", product_status: "shipping" } },
      ],
    });
    expect(query.mock.calls[1]?.[1]).toEqual(["k1", "%k1%", 10]);
  });

  it("does not hide ambiguity when the caller asks for one result", async () => {
    const k1 = row();
    const k1Max = row({ id: randomUUID(), slug: "creality.k1-max", model: "K1 Max" });
    const { repository, query } = repositoryWithRows([], [k1, k1Max]);

    const result = await repository.assistantSearch({ reference: "K1", limit: 1 });

    expect(result.kind).toBe("ambiguous");
    expect(query.mock.calls[1]?.[1]).toEqual(["k1", "%k1%", 2]);
  });

  it("finds a uniquely named model after an imprecise brand and keeps source filtering", async () => {
    const p1s = row({ slug: "bambulab.p1s", brand: "Bambu Lab", model: "P1S" });
    const { repository, query } = repositoryWithRows([], [], [p1s]);

    await expect(repository.assistantSearch({ reference: "bamboo p1s" })).resolves.toMatchObject({
      kind: "resolved",
      evidence: { entity_id: p1s.id },
    });
    expect(query.mock.calls[2]?.[1]).toEqual(["p1s", 10]);
    expect(query.mock.calls[2]?.[0]).toContain("cardinality(sources) > 0");
  });

  it("does not reduce a multi-word model to an unrelated shorter model", async () => {
    const { repository, query } = repositoryWithRows([], []);
    await expect(repository.assistantSearch({ reference: "unknown K1 Max" })).resolves.toEqual({ kind: "not_found" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("lets an exact UUID or slug win before text and excludes source-less rows in SQL", async () => {
    const exact = row();
    const byId = repositoryWithRows([exact]);
    await expect(byId.repository.assistantSearch({ reference: exact.id })).resolves.toMatchObject({ kind: "resolved", evidence: { entity_id: exact.id } });
    expect(byId.query).toHaveBeenCalledTimes(1);
    expect(byId.query.mock.calls[0]?.[0]).toContain("id=$1::uuid and cardinality(sources) > 0");

    const bySlug = repositoryWithRows([exact]);
    await expect(bySlug.repository.assistantDetail({ reference: "CREALITY.K1" })).resolves.toMatchObject({ kind: "resolved" });
    expect(bySlug.query.mock.calls[0]?.[1]).toEqual(["creality.k1"]);
    expect(bySlug.query.mock.calls[0]?.[0]).toContain("lower(slug)=$1 and cardinality(sources) > 0");

    const hidden = repositoryWithRows([]);
    await expect(hidden.repository.assistantDetail({ reference: "hidden.k1" })).resolves.toEqual({ kind: "not_found" });
  });
});

describe("assistant printer evidence", () => {
  it("keeps absent chamber temperature unknown and marks only an old RUB price stale", () => {
    const evidence = mapAssistantPrinterEvidence(serializePrinter(row({ price_ru_updated_at: "2026-07-01" })), {
      now: new Date("2026-09-21T12:00:00Z"),
      requestedFields: ["chamber_temperature_c"],
    });

    expect(evidence).toMatchObject({
      freshness: "stale",
      price_updated_at: "2026-07-01T00:00:00.000Z",
      facts: { build_volume_mm: { x: 220, y: 220, z: 250 }, price_ru_rub: { amount: 55_000, currency: "RUB" } },
    });
    expect(evidence.missing_fields).toContain("chamber_temperature_c");
    expect(evidence.freshness_reason).toContain("fixed 30-day freshness window");
    expect(evidence.freshness_reason).toContain("USD MSRP has no dated freshness");
  });

  it("emits only portal-relative canonical URLs and sanitized server provenance", () => {
    const evidence = mapAssistantPrinterEvidence(
      serializePrinter(
        row({
          slug: "creality.k1-max",
          sources: ["https://safe.example/printer", "https://safe.example/private?token=secret", "javascript:alert(1)"],
          field_provenance: {
            safe: { source_url: "https://docs.example/k1", ts: "2026-09-18T10:00:00+03:00" },
            unsafe: { source_url: "https://docs.example/k1?api_key=secret", ts: "not-a-date" },
          },
        }),
      ),
      { now: new Date("2026-09-21T12:00:00Z") },
    );

    expect(evidence.canonical_url).toBe("/printers/creality.k1-max");
    expect(evidence.source_refs).toEqual([
      { label: "safe.example", url: "https://safe.example/printer" },
      { label: "docs.example", url: "https://docs.example/k1" },
    ]);
    expect(evidence.observed_at).toBe("2026-09-18T07:00:00.000Z");
    expect(evidence.updated_at).toBe("2026-09-10T09:00:00.000Z");
    expect(isAssistantEvidenceCitation(evidence)).toBe(true);
  });

  it("passes through confirmed nozzle hardening and bounded printer features", () => {
    const evidence = mapAssistantPrinterEvidence(serializePrinter(row({
      hotend_hardened: true,
      specs: { hotend: { hardened: true }, unique_features: ["Закрытый корпус", "Автокалибровка"] },
    })));

    expect(evidence.facts).toMatchObject({ nozzle_hardened: true, unique_features: ["Автокалибровка", "Закрытый корпус"] });
    expect(evidence.facts.nozzle_material).toBeNull();
    expect(isAssistantEvidenceCitation(evidence)).toBe(true);
  });

  it("uses fixed USD-only freshness and omits freshness when no price exists", () => {
    const usdOnly = mapAssistantPrinterEvidence(serializePrinter(row({ price_ru_rub: null, price_ru_updated_at: null })));
    expect(usdOnly).toMatchObject({ freshness: "unknown", freshness_reason: "price_msrp_has_no_observation_date", price_updated_at: null });
    expect(isAssistantEvidenceCitation(usdOnly)).toBe(true);

    const noPrice = mapAssistantPrinterEvidence(serializePrinter(row({ price_ru_rub: null, price_ru_updated_at: null, price_msrp_usd: null })));
    expect(noPrice.price_updated_at).toBeNull();
    expect(noPrice).not.toHaveProperty("freshness");
    expect(noPrice).not.toHaveProperty("freshness_reason");
    expect(isAssistantEvidenceCitation(noPrice)).toBe(true);

    const unsafeSlug = mapAssistantPrinterEvidence(serializePrinter(row({ slug: "unsafe slug" })));
    expect(unsafeSlug.canonical_url).toBeNull();
    expect(isAssistantEvidenceCitation(unsafeSlug)).toBe(true);
  });

  it("bounds oversized catalog strings and material lists to the evidence contract", () => {
    const oversized = "😀".repeat(301);
    const evidence = mapAssistantPrinterEvidence(
      serializePrinter(
        row({
          brand: oversized,
          model: oversized,
          specs: {
            hotend: { material: oversized },
            materials_supported: Array.from({ length: 33 }, (_, index) => `${oversized}${index}`),
          },
        }),
      ),
    );

    expect(Array.from(evidence.facts.brand ?? "")).toHaveLength(300);
    expect(evidence.facts.supported_materials).toHaveLength(32);
    expect(evidence.facts.supported_materials?.every((material) => Array.from(material).length <= 300)).toBe(true);
    expect(isAssistantEvidenceCitation(evidence)).toBe(true);
  });

  it("does not normalize invalid calendar dates into fabricated freshness", () => {
    const evidence = mapAssistantPrinterEvidence(
      serializePrinter(
        row({
          price_ru_updated_at: "2026-02-30",
          field_provenance: {
            invalid: { source_url: "https://safe.example/printer", ts: "2026-02-30T12:00:00Z" },
          },
        }),
      ),
    );

    expect(evidence.observed_at).toBeNull();
    expect(evidence.price_updated_at).toBeNull();
    expect(evidence.freshness).toBe("unknown");
    expect(isAssistantEvidenceCitation(evidence)).toBe(true);
  });
});

describe("assistant printer comparison", () => {
  it("preserves input order and emits the fixed valid matrix with stale and missing cells", () => {
    const first = mapAssistantPrinterEvidence(serializePrinter(row({ model: "K1", price_ru_updated_at: "2026-07-01" })), {
      now: new Date("2026-09-21T12:00:00Z"),
    });
    const second = mapAssistantPrinterEvidence(
      serializePrinter(row({ id: randomUUID(), slug: "bambu.p1s", brand: "Bambu Lab", model: "P1S", price_ru_rub: null, price_ru_updated_at: null })),
      { now: new Date("2026-09-21T12:00:00Z") },
    );

    const comparison = mapAssistantPrinterComparison([first, second]);

    expect(comparison.facts.printer_ids).toEqual([first.entity_id, second.entity_id]);
    expect(comparison.facts.rows.map((item) => item.field)).toEqual([
      "identity",
      "release",
      "price_ru_rub",
      "price_msrp_usd",
      "print_type",
      "kinematics",
      "enclosed",
      "build_volume_mm",
      "max_hotend_temperature_c",
      "max_bed_temperature_c",
      "nozzle",
      "multimaterial_supported",
      "supported_materials",
      "portal_support",
    ]);
    expect(comparison.facts.rows[2]?.cells.map((cell) => cell.state)).toEqual(["stale", "missing"]);
    expect(comparison.facts.rows[6]?.cells.map((cell) => cell.state)).toEqual(["equal", "equal"]);
    expect(isAssistantEvidenceCitation(comparison)).toBe(true);
  });

  it("uses no more than four shared resolver calls and caps all ambiguity candidates at ten", async () => {
    const { repository } = repositoryWithRows();
    const candidates = Array.from({ length: 12 }, (_, index) =>
      mapAssistantPrinterEvidence(serializePrinter(row({ id: randomUUID(), slug: `printer.${index}`, model: `Printer ${index}` }))),
    );
    const resolver = vi.spyOn(repository, "assistantSearch").mockResolvedValue({ kind: "ambiguous", candidates });

    const result = await repository.assistantCompare({ references: ["one", "two", "three", "four"] });

    expect(resolver).toHaveBeenCalledTimes(4);
    expect(resolver.mock.calls.every((call) => call[0].limit === 10)).toBe(true);
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("expected ambiguity");
    expect(result.candidates).toHaveLength(10);
  });
});
