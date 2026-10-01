import type { AssistantEvidenceCitation } from "@portal/contracts/http/assistant";

export interface AssistantLeaseClaim {
  readonly ownerId: string;
  readonly generation: string;
}

export type AssistantScope = "catalog:read" | "feed:read" | "profile:printers:read" | "generation:propose";

export interface AssistantRunContext {
  readonly run_id: string;
  readonly thread_id: string;
  readonly message: { readonly id: string; readonly content: string };
  readonly mode: "global";
  readonly scopes: readonly AssistantScope[];
  readonly tools: readonly string[];
  readonly context: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly context_truncated: boolean;
  readonly context_omitted_turns: number;
  readonly correlation_id: string;
}

export interface AssistantCompletedTurn {
  readonly user_content: string;
  readonly result_type: "answer" | "clarification" | "generation_offer";
  readonly result: Readonly<Record<string, unknown>>;
}

export interface AssistantCompletedTurns {
  readonly turns: readonly AssistantCompletedTurn[];
  readonly total: number;
}

export interface AssistantToolResult {
  readonly resolution: "resolved" | "ambiguous" | "not_found" | "data_quality_conflict";
  readonly evidence: readonly AssistantEvidenceCitation[];
  readonly material_comparison?: {
    readonly families: readonly {
      readonly material_type: string;
      readonly published_products: number;
      readonly nozzle_temp_c: {
        readonly median_listed_min_c: number | null;
        readonly median_listed_max_c: number | null;
        readonly sample_count: number;
      };
      readonly bed_temp_c: {
        readonly median_listed_min_c: number | null;
        readonly median_listed_max_c: number | null;
        readonly sample_count: number;
      };
      readonly enclosure: {
        readonly required_count: number;
        readonly not_required_count: number;
        readonly unknown_count: number;
      };
    }[];
  };
  readonly period?: {
    readonly from: string;
    readonly to: string;
    readonly defaulted: boolean;
    readonly bounded: boolean;
    readonly date_basis: "portal_published_at";
  };
}

export interface AssistantToolResponse {
  readonly run_id: string;
  readonly tool: string;
  readonly result: AssistantToolResult;
  readonly correlation_id: string;
}
