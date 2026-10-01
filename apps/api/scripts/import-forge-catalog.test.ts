import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { loadMachines, machineContentHash, publicPrinterType } from "./forge-catalog/machines.ts";
import { loadMaterials, snapshotMaterialKind } from "./forge-catalog/materials.ts";
import { importNews, loadNews } from "./forge-catalog/news.ts";
import { loadOfdMaterials } from "./forge-catalog/ofd-materials.ts";
import { loadHistory } from "./forge-catalog/history.ts";
import { canRemoveImportedDescription, importEnrichment, materialLineKeys, normalizeBrand, verifiedDescriptionTarget } from "./forge-catalog/enrichment.ts";
import { parseOptions } from "./import-forge-catalog.ts";

const snapshot = new URL("../../../migration/forge-catalog", import.meta.url).pathname;

describe("forge catalog snapshot", () => {
  it("requires a reviewed source URL and exactly one target card", () => {
    const key = "describe-material:stereotech:ABS:enduse";
    const url = "https://3dvision.su/product/plastik-stereotech-enduse-abs/";
    expect(verifiedDescriptionTarget(key, new Map([[url, ["card"]]]))).toEqual({ status: "verified", id: "card", url });
    expect(verifiedDescriptionTarget(key, new Map())).toEqual({ status: "missing_source", url });
    expect(verifiedDescriptionTarget(key, new Map([[url, ["a", "b"]]]))).toEqual({ status: "ambiguous_source", url });
    expect(verifiedDescriptionTarget("similar unreviewed name", new Map([[url, ["card"]]]))).toEqual({ status: "unreviewed" });
  });
  it.each(["missing_source", "ambiguous_source"])("reports %s and never applies an invalid reviewed binding", async (status) => {
    const url = "https://3dvision.su/product/plastik-stereotech-enduse-abs/";
    const statements: string[] = [];
    const parameters: Array<readonly unknown[]> = [];
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      statements.push(sql);
      parameters.push(values ?? []);
      if (sql.includes("select m.id, v.name")) {
        return { rows: status === "ambiguous_source" ? ["a", "b"].map((id) => ({ id, brand: "Stereotech", family: "ABS", name: "Enduse", specs: { forge_snapshot: { source_url: url } } })) : [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = { query } as unknown as PoolClient;
    const report = await importEnrichment(client, snapshot);
    const reason = `verified_description_binding:${status}; expected source_url=${url}`;
    expect(parameters.some((values) => values[1] === "describe-material:stereotech:ABS:enduse" && values[4] === "quarantined" && values[7] === reason)).toBe(true);
    expect(report.warnings.some((warning) => warning.includes(reason))).toBe(true);
    expect(statements.some((sql) => sql.includes("update materials set specs=jsonb_set(specs,'{ai_description}'"))).toBe(false);
  });
  it("removes only descriptions matching the imported audit provenance", () => {
    const payload = { description_ai: "Transparent ABS, 1.75 mm, 1 kg", extractor: "chat", verifier: "verify", ts: "2026-09-04" };
    const imported = { text: payload.description_ai, generated: true, extractor: payload.extractor, verifier: payload.verifier, generated_at: payload.ts };
    expect(canRemoveImportedDescription(imported, payload)).toBe(true);
    expect(canRemoveImportedDescription({ ...imported, text: "Manually corrected" }, payload)).toBe(false);
    expect(canRemoveImportedDescription({ ...imported, generated: false }, payload)).toBe(false);
    expect(canRemoveImportedDescription({ ...imported, generated_at: "other" }, payload)).toBe(false);
    expect(canRemoveImportedDescription(null, payload)).toBe(false);
  });
  it("normalizes only confirmed brand spellings", () => {
    expect(normalizeBrand("Filamentarno!")).toBe(normalizeBrand("Filamentarno"));
    expect(normalizeBrand("eSUN 3D")).toBe(normalizeBrand("eSUN"));
    expect(normalizeBrand("U3Print")).not.toBe(normalizeBrand("PrintProduct"));
  });

  it("matches full material line names without erasing product distinctions", () => {
    expect(materialLineKeys("Bambu Lab", "PETG", "Basic")).toContain(materialLineKeys("Bambu Lab", "PETG", "PETG Basic")[0]);
    expect(materialLineKeys("Bambu Lab", "PLA", "Silk+")).not.toContain(materialLineKeys("Bambu Lab", "PLA", "Silk")[0]);
    expect(materialLineKeys("Bambu Lab", "ASA", "CF")).not.toContain(materialLineKeys("Bambu Lab", "ASA", "ASA")[0]);
  });

  it("scopes confirmed line aliases to the brand and family", () => {
    const target = materialLineKeys("Filamentarno", "PLA", "PLA+ Standart")[0];
    expect(materialLineKeys("Filamentarno!", "PLA", "+ standart")).toContain(target);
    expect(materialLineKeys("Filamentarno", "PLA", "standart +")).toContain(materialLineKeys("Filamentarno", "PLA", "STANDART PLA+")[0]);
    expect(materialLineKeys("Other", "PLA", "+ standart")).not.toContain(materialLineKeys("Other", "PLA", "PLA+ Standart")[0]);
    expect(materialLineKeys("Filamentarno", "ABS", "+ standart")).not.toContain(materialLineKeys("Filamentarno", "ABS", "PLA+ Standart")[0]);
    expect(materialLineKeys("Filamentarno", "PLA", "+ standart")).not.toContain(materialLineKeys("Filamentarno", "PLA", "PLA Standart")[0]);
  });

  it("parses CLI in safe dry-run mode by default", () => {
    const options = parseOptions(["--source-dir", snapshot, "--sections", "machines"]);
    expect(options.apply).toBe(false);
    expect([...options.sections]).toEqual(["machines"]);
    expect(options.newsStatus).toBe("draft");
  });

  it("requires an explicit valid news publication status", () => {
    expect(parseOptions(["--source-dir", snapshot, "--news-status", "visible"]).newsStatus).toBe("visible");
    expect(() => parseOptions(["--source-dir", snapshot, "--news-status", "published"])).toThrow("--news-status");
  });

  it("keeps community optional in CLI options", () => {
    const options = parseOptions(["--source-dir", snapshot, "--sections", "news", "--author-id", "00000000-0000-0000-0000-000000000001"]);
    expect(options.authorId).toBe("00000000-0000-0000-0000-000000000001");
    expect(options.communityId).toBeNull();
  });

  it("accepts the complete catalog section set", () => {
    expect([...parseOptions(["--source-dir", snapshot, "--sections", "machines,materials,ofd,history,enrichment"]).sections]).toEqual(["machines", "materials", "ofd", "history", "enrichment"]);
  });

  it("validates every machine card", async () => {
    const loaded = await loadMachines(snapshot);
    expect(loaded.records).toHaveLength(296);
    expect(loaded.rejected).toBe(0);
  });

  it("changes the machine content hash when specs change", async () => {
    const loaded = await loadMachines(snapshot);
    const machine = loaded.records[0];
    expect(machine).toBeDefined();
    if (!machine) return;
    const changed = { ...machine, specs: { ...machine.specs, max_speed_mms: 123 } };
    expect(machineContentHash(changed).equals(machineContentHash(machine))).toBe(false);
    expect(machineContentHash(machine).equals(machineContentHash(machine))).toBe(true);
  });

  it("projects only 3D printers into the public printer catalog", () => {
    expect(publicPrinterType("fdm_printer")).toBe("fdm");
    expect(publicPrinterType("sla_printer")).toBe("resin-sla");
    expect(publicPrinterType("cnc_router")).toBeNull();
    expect(publicPrinterType("cnc_lathe")).toBeNull();
    expect(publicPrinterType("laser_cutter")).toBeNull();
  });

  it("keeps every valid material row as static data", async () => {
    const loaded = await loadMaterials(snapshot);
    expect(loaded.found).toBe(899);
    expect(loaded.records).toHaveLength(899);
    expect(loaded.rejected).toBe(0);
  });

  it("loads the complete OFD catalog including Bambu Lab", async () => {
    const loaded = await loadOfdMaterials(snapshot);
    expect(loaded.records).toHaveLength(2058);
    expect(loaded.rejected).toBe(0);
    expect(loaded.records.filter((record) => record.vendor.slug === "bambu-lab")).toHaveLength(49);
  });

  it("loads all historical machines", async () => {
    const loaded = await loadHistory(snapshot);
    expect(loaded.records).toHaveLength(39);
    expect(loaded.rejected).toBe(0);
  });

  it("reports every enrichment record in dry-run", async () => {
    const report = await importEnrichment(null, snapshot);
    expect(report.found).toBe(1277);
    expect(report.unchanged).toBe(1277);
  });

  it("accepts only filament snapshots until other mappings exist", () => {
    expect(snapshotMaterialKind(undefined)).toBe("filament");
    expect(snapshotMaterialKind("filament")).toBe("filament");
    expect(snapshotMaterialKind("resin")).toBeNull();
    expect(snapshotMaterialKind("aluminum")).toBeNull();
  });

  it("validates all news records", async () => {
    const loaded = await loadNews(snapshot);
    expect(loaded.records).toHaveLength(1881);
    expect(loaded.rejected).toBe(0);
  });

  it("serializes and skips a repeated news import without community", async () => {
    const statements: string[] = [];
    const parameters: Array<readonly unknown[]> = [];
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      statements.push(sql);
      parameters.push(values ?? []);
      if (sql.includes("select 1 from feed_posts")) return { rows: [{ exists: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const client = { query } as unknown as PoolClient;

    const report = await importNews(client, snapshot, "00000000-0000-0000-0000-000000000001", null, "visible");

    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements.filter((sql) => sql.includes("insert into feed_posts"))).toHaveLength(0);
    expect(statements.filter((sql) => sql.includes("select 1 from feed_posts"))).toHaveLength(1881);
    expect(parameters[1]).toEqual([expect.stringMatching(/^sha256:/), null]);
    expect(report.inserted).toBe(0);
    expect(report.unchanged).toBe(1881);
  });
});
