import type { AssistantEvidenceCitation, AssistantMaterialFacts } from "@portal/contracts/http/assistant";
import type { AssistantFilamentRecord, AssistantFilamentSearch, CatalogJsonObject } from "../../catalog/public/index.ts";
import { compatCheck, type CompatFilamentInput, type CompatPrinterInput } from "../../models/public/index.ts";

export const FILAMENT_RANKING = "compatibility_state,constraints_satisfied_desc,name_asc,id_asc";
const number = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

/** Adapt known facts only. No family heuristics or duplicate compatibility rules. */
export function filamentCompatibility(material: AssistantFilamentRecord, specs: CatalogJsonObject | null) {
  const machine = specs ?? {};
  const fill = material.specs.fill_type;
  const fillType = typeof fill === "string" && ["carbon", "glass", "wood", "metal", "glitter", "ceramic"].includes(fill) ? fill as CompatFilamentInput["fillType"] : undefined;
  const nozzleHardened = typeof machine.nozzle_hardened === "boolean" ? machine.nozzle_hardened : machine.nozzle_material === "brass" ? false : undefined;
  const printer: CompatPrinterInput = {
    // No model geometry is evaluated by filament tools; this unused required field is not evidence.
    buildVolumeMm: { x: 0, y: 0, z: 0 },
    ...(nozzleHardened === undefined ? {} : { nozzleHardened }),
    ...(number(machine.max_hotend_temp_c) === undefined ? {} : { maxHotendTempC: number(machine.max_hotend_temp_c)! }),
    ...(typeof machine.chamber === "string" && ["none", "passive", "active"].includes(machine.chamber) ? { chamber: machine.chamber as NonNullable<CompatPrinterInput["chamber"]> } : {}),
    ...(typeof machine.extruder_drive === "string" && ["direct", "bowden"].includes(machine.extruder_drive) ? { extruderDrive: machine.extruder_drive as NonNullable<CompatPrinterInput["extruderDrive"]> } : {}),
    ...(number(machine.filament_dia_mm) === undefined ? {} : { filamentDiameterMm: number(machine.filament_dia_mm)! }),
  };
  const temp = number(material.specs.extruder_temp_max_c) ?? number(material.default_extruder_temp_c);
  const filament: CompatFilamentInput = {
    materialFamily: material.material_type,
    ...(fillType === undefined ? {} : { fillType }),
    needsChamber: material.requires_chamber,
    needsDirectDrive: material.requires_direct_drive,
    needsDrying: material.requires_drying,
    ...(temp === undefined ? {} : { extruderTempMaxC: temp }),
    ...(number(material.diameter_mm) === undefined ? {} : { diameterMm: number(material.diameter_mm)! }),
  };
  const result = compatCheck(printer, filament);
  const missing: string[] = [];
  if (specs === null) missing.push("confirmed_machine");
  if (printer.maxHotendTempC === undefined) missing.push("machine.max_hotend_temp_c");
  if (printer.filamentDiameterMm === undefined) missing.push("machine.filament_dia_mm");
  if (filament.extruderTempMaxC === undefined) missing.push("material.extruder_temp_max_c");
  if (filament.diameterMm === undefined) missing.push("material.diameter_mm");
  if (fillType === undefined && fill !== "none") missing.push("material.fill_type");
  if ((fill === "carbon" || fill === "glass") && printer.nozzleHardened === undefined) missing.push("machine.nozzle_hardened");
  if (filament.needsChamber && printer.chamber === undefined) missing.push("machine.chamber");
  if (filament.needsDirectDrive && printer.extruderDrive === undefined) missing.push("machine.extruder_drive");
  const state = result.verdict === "blocked" ? "blocked" : missing.length > 0 ? "insufficient_data" : result.verdict === "warn" ? "conditional" : "compatible";
  return { state, reasons: result.reasons, missing } as const;
}

export interface FilamentPrinterReference {
  readonly machineId?: string;
  readonly catalogPrinterId?: string;
  readonly userPrinterId?: string;
  readonly printerLabel?: string;
}

export function filamentEvidence(material: AssistantFilamentRecord, compatibility?: ReturnType<typeof filamentCompatibility>, reference: FilamentPrinterReference = {}, specs: CatalogJsonObject | null = null): AssistantEvidenceCitation {
  const missing = compatibility?.missing ?? filamentCompatibility(material, null).missing.filter((field) => field.startsWith("material."));
  const facts: AssistantMaterialFacts = {
    kind: "material", brand: material.brand.slice(0, 300), name: material.name.slice(0, 300), material_type: material.material_type.slice(0, 300),
    color: material.color?.slice(0, 300) ?? null, diameter_mm: material.diameter_mm,
    abrasive: material.specs.fill_type === "carbon" || material.specs.fill_type === "glass" ? true : typeof material.specs.fill_type === "string" && ["none", "wood", "metal", "glitter", "ceramic"].includes(material.specs.fill_type) ? false : null,
    ...(material.variant_id === null ? {} : { variant_id: material.variant_id }),
    ...(compatibility === undefined || compatibility.state === "blocked" ? {} : {
      compatibility: compatibility.state, compatibility_reasons: compatibility.reasons,
      ranking_criterion: FILAMENT_RANKING,
      ...(reference.printerLabel === undefined ? {} : { printer_label: reference.printerLabel.slice(0, 300) }),
      ...(specs === null ? {} : { printer_capabilities: {
        ...(number(specs.max_hotend_temp_c) === undefined ? {} : { max_hotend_temp_c: number(specs.max_hotend_temp_c)! }),
        ...(number(specs.filament_dia_mm) === undefined ? {} : { filament_dia_mm: number(specs.filament_dia_mm)! }),
        ...((material.specs.fill_type === "carbon" || material.specs.fill_type === "glass") && (typeof specs.nozzle_hardened === "boolean" || specs.nozzle_material === "brass") ? { nozzle_hardened: typeof specs.nozzle_hardened === "boolean" ? specs.nozzle_hardened : false } : {}),
        ...(material.requires_chamber && (specs.chamber === "none" || specs.chamber === "passive" || specs.chamber === "active") ? { chamber: specs.chamber } : {}),
        ...(material.requires_direct_drive && (specs.extruder_drive === "direct" || specs.extruder_drive === "bowden") ? { extruder_drive: specs.extruder_drive } : {}),
      } }),
      ...(reference.machineId === undefined ? {} : { machine_id: reference.machineId }),
      ...(reference.catalogPrinterId === undefined ? {} : { catalog_printer_id: reference.catalogPrinterId }),
      ...(reference.userPrinterId === undefined ? {} : { user_printer_id: reference.userPrinterId }),
    }),
  };
  const canonical = `/materials/${encodeURIComponent(material.id)}`;
  return {
    evidence_id: `material:${material.id}`, entity_type: "material", entity_id: material.id,
    title: `${material.brand} ${material.name}`.slice(0, 300),
    snippet: [material.material_type.toUpperCase(), material.color ? `Цвет: ${material.color}` : null,
      number(material.diameter_mm) === undefined ? null : `Диаметр: ${material.diameter_mm} мм`].filter(Boolean).join("; ").slice(0, 2000),
    canonical_url: canonical, facts, source_refs: [{ label: `Каталог портала (${material.source})`, url: null }],
    source_published_at: null, observed_at: material.created_at.toISOString(), updated_at: material.updated_at.toISOString(),
    price_updated_at: null, quality: "reported", missing_fields: missing,
  };
}

export function rankFilaments(materials: readonly AssistantFilamentRecord[], specs: CatalogJsonObject | null, input: AssistantFilamentSearch, reference: FilamentPrinterReference = {}) {
  return rankedFilamentCandidates(materials, specs, input)
    .slice(0, 5)
    .map(({ material, compatibility }) => filamentEvidence(material, compatibility, reference, specs));
}

function rankedFilamentCandidates(materials: readonly AssistantFilamentRecord[], specs: CatalogJsonObject | null, input: AssistantFilamentSearch) {
  const states = { compatible: 0, conditional: 1, insufficient_data: 2 };
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return materials.map((material) => ({ material, compatibility: filamentCompatibility(material, specs) }))
    .filter((candidate) => candidate.compatibility.state !== "blocked")
    .map(({ material, compatibility }) => {
      const constraints = Number(input.material_type !== undefined && material.material_type === input.material_type) + Number(input.diameter_mm !== undefined && material.diameter_mm === input.diameter_mm)
        + Number(input.color !== undefined && material.color?.toLowerCase() === input.color.trim().toLowerCase());
      return { material, compatibility, constraints, state: states[compatibility.state as keyof typeof states], name: material.name, id: material.id };
    })
    .sort((a, b) => a.state - b.state || b.constraints - a.constraints || compare(a.name, b.name) || compare(a.id, b.id));
}

/** Retain only the global top five while processing bounded repository pages. */
export function retainTopFilaments(current: readonly AssistantFilamentRecord[], page: readonly AssistantFilamentRecord[], specs: CatalogJsonObject | null, input: AssistantFilamentSearch): readonly AssistantFilamentRecord[] {
  return rankedFilamentCandidates([...current, ...page], specs, input)
    .slice(0, 5)
    .map(({ material }) => material);
}
