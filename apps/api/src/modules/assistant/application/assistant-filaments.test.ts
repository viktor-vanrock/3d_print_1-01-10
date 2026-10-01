import { describe, expect, it } from "vitest";
import { isAssistantEvidenceCitation } from "@portal/contracts/http/assistant";
import type { AssistantFilamentRecord, CatalogJsonObject } from "../../catalog/public/index.ts";
import { filamentCompatibility, filamentEvidence, rankFilaments } from "./assistant-filaments.ts";

const material: AssistantFilamentRecord = {
  id: "00000000-0000-4000-8000-000000000001", slug: "pla", name: "PLA", brand: "Example", material_type: "pla",
  specs: { fill_type: "none" }, source: "manual", created_at: new Date("2026-09-01"), updated_at: new Date("2026-09-02"),
  variant_id: "00000000-0000-4000-8000-000000000002", color: "white", diameter_mm: 1.75,
  default_extruder_temp_c: 220, requires_chamber: false, requires_direct_drive: false, requires_drying: false,
};
const machine: CatalogJsonObject = { max_hotend_temp_c: 300, filament_dia_mm: 1.75, nozzle_hardened: true, chamber: "none", extruder_drive: "bowden" };

describe("assistant filament compatibility adapter", () => {
  it("only confirms complete known critical facts", () => {
    expect(filamentCompatibility(material, machine)).toEqual({ state: "compatible", missing: [], reasons: [] });
    expect(filamentCompatibility(material, null).state).toBe("insufficient_data");
    expect(filamentCompatibility(material, {}).missing).toContain("machine.max_hotend_temp_c");
    expect(filamentCompatibility({ ...material, specs: {}, default_extruder_temp_c: null }, machine).missing).toEqual(["material.extruder_temp_max_c", "material.fill_type"]);
  });
  it("preserves abrasive rule codes, unknown hardness and brass blocking", () => {
    const abrasive = { ...material, specs: { fill_type: "carbon" } };
    const { nozzle_hardened: _, ...unknownNozzle } = machine;
    const unknown = filamentCompatibility(abrasive, unknownNozzle);
    expect(unknown.state).toBe("insufficient_data");
    expect(unknown.missing).toEqual(["machine.nozzle_hardened"]);
    expect(unknown.reasons[0]?.code).toBe("abrasive_nozzle_unknown");
    expect(filamentCompatibility(abrasive, { ...unknownNozzle, nozzle_material: "brass" }).state).toBe("blocked");
    expect(filamentCompatibility(abrasive, { ...machine, nozzle_hardened: false }).reasons[0]?.code).toBe("abrasive_requires_hardened_nozzle");
    expect(rankFilaments([abrasive], { ...machine, nozzle_hardened: false }, {})).toEqual([]);
  });
  it.each([
    [{ ...material, diameter_mm: 2.85 }, "filament_diameter_mismatch"],
    [{ ...material, specs: { fill_type: "none", extruder_temp_max_c: 350 } }, "hotend_max_temp_exceeded"],
  ])("excludes blocked diameter/temperature: %s", (row, code) => {
    expect(filamentCompatibility(row, machine).state).toBe("blocked");
    expect(filamentCompatibility(row, machine).reasons[0]?.code).toBe(code);
    expect(rankFilaments([row], machine, {})).toEqual([]);
  });
  it("keeps chamber, bowden and drying warnings conditional when facts are known", () => {
    const result = filamentCompatibility({ ...material, requires_chamber: true, requires_direct_drive: true, requires_drying: true }, machine);
    expect(result.state).toBe("conditional");
    expect(result.reasons.map((reason) => reason.code)).toEqual(["chamber_recommended", "direct_drive_recommended", "drying_recommended"]);
    const { chamber: _, extruder_drive: __, ...incomplete } = machine;
    expect(filamentCompatibility({ ...material, requires_chamber: true, requires_direct_drive: true }, incomplete).state).toBe("insufficient_data");
  });
  it("ranks at most five products with byte-equivalent output independent of input order", () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({ ...material, id: String(index), name: `Product ${index}` }));
    rows[0] = { ...rows[0]!, specs: {} };
    const first = rankFilaments(rows, machine, {});
    expect(first).toHaveLength(5);
    expect(first[0]?.entity_id).toBe("1");
    expect(JSON.stringify(first)).toBe(JSON.stringify(rankFilaments([...rows].reverse(), machine, {})));
    expect(first.every(isAssistantEvidenceCitation)).toBe(true);
    expect(first.every((entry) => entry.freshness === undefined)).toBe(true);
  });
  it("emits only safe typed evidence and structural printer references", () => {
    const evidence = filamentEvidence(material, filamentCompatibility(material, machine), { machineId: "machine", userPrinterId: "owned" });
    expect(isAssistantEvidenceCitation(evidence)).toBe(true);
    expect(evidence.facts).toMatchObject({ variant_id: material.variant_id, machine_id: "machine", user_printer_id: "owned", compatibility: "compatible" });
    expect(evidence.observed_at).toBe("2026-09-01T00:00:00.000Z");
    const sparse = filamentEvidence({ ...material, specs: {}, diameter_mm: null, default_extruder_temp_c: null });
    expect(sparse.snippet).not.toContain("material.");
    expect(sparse.snippet).not.toContain("insufficient_data");
  });
});
