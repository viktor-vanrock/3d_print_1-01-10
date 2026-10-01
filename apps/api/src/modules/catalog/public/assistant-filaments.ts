import type { CatalogJsonObject } from "./index.ts";

export const ASSISTANT_FILAMENT_RECOMMENDATION_PAGE_SIZE = 100;
export const ASSISTANT_MATERIAL_COMPARISON_MAX_CANDIDATES = 500;

export interface AssistantFilamentCursor {
  readonly name: string;
  readonly id: string;
}

export interface AssistantFilamentSearch {
  readonly query?: string;
  readonly material_type?: string;
  readonly diameter_mm?: number;
  readonly color?: string;
  readonly limit?: number;
  /** Enables bounded keyset pages used only by recommendation tools. */
  readonly recommendation_candidate_scan?: true;
  readonly recommendation_cursor?: AssistantFilamentCursor;
}

/** One deterministically selected matching variant per published product. */
export interface AssistantFilamentRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly brand: string;
  readonly material_type: string;
  readonly specs: CatalogJsonObject;
  readonly source: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly variant_id: string | null;
  readonly color: string | null;
  readonly diameter_mm: number | null;
  readonly default_extruder_temp_c: number | null;
  readonly requires_chamber: boolean;
  readonly requires_drying: boolean;
  readonly requires_direct_drive: boolean;
}

export interface AssistantMaterialTypeComparisonInput {
  readonly types: readonly string[];
}
