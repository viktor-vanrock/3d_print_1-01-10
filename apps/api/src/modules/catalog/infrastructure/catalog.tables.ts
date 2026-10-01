import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const catalogTables: DomainTableManifest = {
  owns: [
    "machine_candidates",
    "machines",
    "material_candidates",
    "materials",
    "material_types",
    "material_variants",
    "printer_machine_links",
    "release_events",
    "vendors",
  ],
  readsForeignViews: [],
};
