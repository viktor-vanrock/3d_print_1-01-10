import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_EVIDENCE_CONTRACT_VERSION,
  ASSISTANT_RESULT_KINDS,
  RUN_PHASES,
  isAssistantCitation,
  isAssistantEvidenceCitation,
  isAssistantError,
  isAssistantRunResult,
  isConfirmAssistantGenerationRequest,
  isCreateAssistantMessageRequest,
  isRunProgressSnapshot,
  type AssistantMessagesPage,
} from "./assistant.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures/assistant.v1.json"), "utf8"),
);
const evidenceFixture = JSON.parse(
  readFileSync(join(here, "fixtures/assistant.evidence.v2.json"), "utf8"),
) as {
  readonly legacy: Record<string, unknown>;
  readonly v2: readonly Record<string, unknown>[];
  readonly invalid_urls: readonly string[];
  readonly invalid_portal_urls: readonly string[];
  readonly invalid_timestamps: readonly string[];
  readonly valid_timestamps: readonly string[];
};

describe("assistant.evidence.v2", () => {
  it("validates bounded filament target labels and allow-listed capabilities", () => {
    const shared = JSON.parse(readFileSync(join(here, "../fixtures/assistant-filament-tool.v1.json"), "utf8")).result.evidence[0];
    const facts = { ...shared.facts, printer_label: "Example Printer", printer_capabilities: { max_hotend_temp_c: 300, filament_dia_mm: 1.75 } };
    expect(isAssistantEvidenceCitation({ ...shared, facts })).toBe(true);
    expect(isAssistantEvidenceCitation({ ...shared, facts: { ...facts, printer_label: "x".repeat(301) } })).toBe(false);
    expect(isAssistantEvidenceCitation({ ...shared, facts: { ...facts, printer_capabilities: { lan_endpoint: "private" } } })).toBe(false);
    expect(isAssistantEvidenceCitation({ ...shared, facts: { ...facts, printer_capabilities: { filament_dia_mm: -1 } } })).toBe(false);
  });
  it("publishes the evidence contract version", () => {
    expect(ASSISTANT_EVIDENCE_CONTRACT_VERSION).toBe("assistant.evidence.v2");
  });

  it("accepts the persisted legacy citation and every supported v2 entity", () => {
    expect(isAssistantCitation(evidenceFixture.legacy)).toBe(true);
    expect(evidenceFixture.v2.map((citation) => citation.entity_type)).toEqual([
      "model",
      "printer",
      "machine",
      "user_printer",
      "material",
      "news",
      "comparison",
    ]);
    expect(evidenceFixture.v2.every(isAssistantEvidenceCitation)).toBe(true);
  });

  it.each(["entity_type", "freshness", "quality"])(
    "rejects an invented %s",
    (field) => {
      expect(
        isAssistantEvidenceCitation({
          ...evidenceFixture.v2[0],
          [field]: "invented",
        }),
      ).toBe(false);
    },
  );

  it("rejects facts from a different entity and unknown fact fields", () => {
    expect(
      isAssistantEvidenceCitation({
        ...evidenceFixture.v2[0],
        facts: { kind: "news" },
      }),
    ).toBe(false);
    expect(
      isAssistantEvidenceCitation({
        ...evidenceFixture.v2[0],
        facts: { kind: "model", secret: "value" },
      }),
    ).toBe(false);
  });

  it("rejects unsafe URLs and preserves every provenance timestamp", () => {
    expect(
      isAssistantEvidenceCitation({
        ...evidenceFixture.v2[0],
        canonical_url: "javascript:alert(1)",
      }),
    ).toBe(false);
    expect(
      isAssistantEvidenceCitation({
        ...evidenceFixture.v2[0],
        source_refs: [
          { label: "bad", url: "https://user:password@example.com/private" },
        ],
      }),
    ).toBe(false);
    for (const citation of evidenceFixture.v2) {
      const timestamps = [
        "source_published_at",
        "observed_at",
        "updated_at",
        "price_updated_at",
      ] as const;
      for (const key of timestamps)
        expect(JSON.parse(JSON.stringify(citation))[key]).toBe(citation[key]);
    }
  });

  it("enforces price/news-only freshness semantics", () => {
    expect(
      isAssistantEvidenceCitation({
        ...evidenceFixture.v2[0],
        freshness: "fresh",
        freshness_reason: "recent",
      }),
    ).toBe(false);
    expect(
      isAssistantEvidenceCitation({
        ...evidenceFixture.v2[1],
        price_updated_at: null,
      }),
    ).toBe(false);
  });
});

describe("assistant.v1 result union", () => {
  it("links message history to bounded run snapshots for reload recovery", () => {
    const page: AssistantMessagesPage = {
      items: [{
        id: "9c1f2e10-1111-4a11-8a11-000000000001",
        thread_id: "9c1f2e10-1111-4a11-8a11-000000000002",
        role: "user",
        content: "Что нового?",
        run_id: null,
        created_at: "2026-09-21T10:00:00.000Z",
      }],
      runs: [{
        id: "9c1f2e10-1111-4a11-8a11-000000000003",
        thread_id: "9c1f2e10-1111-4a11-8a11-000000000002",
        triggering_message_id: "9c1f2e10-1111-4a11-8a11-000000000001",
        status: "done",
        result_type: "answer",
        result: { kind: "answer", text: "Ответ", citations: [] },
        error_code: null,
        confirmed_generation_id: null,
        queue_position: null,
        eta_seconds: null,
        created_at: "2026-09-21T10:00:00.000Z",
        updated_at: "2026-09-21T10:00:01.000Z",
      }],
      next_cursor: null,
    };
    expect(page.runs[0]?.triggering_message_id).toBe(page.items[0]?.id);
  });

  it.each(ASSISTANT_RESULT_KINDS)("accepts the %s fixture", (kind) => {
    expect(isAssistantRunResult(fixture[kind])).toBe(true);
    expect(fixture[kind].kind).toBe(kind);
  });

  it("rejects a result with an unknown kind", () => {
    expect(isAssistantRunResult({ ...fixture.answer, kind: "made_up" })).toBe(
      false,
    );
  });

  it("rejects an answer missing text", () => {
    const { text: _removed, ...incomplete } = fixture.answer;
    expect(isAssistantRunResult(incomplete)).toBe(false);
  });

  it("rejects a clarification with an empty question", () => {
    expect(
      isAssistantRunResult({ ...fixture.clarification, question: "" }),
    ).toBe(false);
  });

  it("rejects a generation_offer missing offer_id", () => {
    const { offer_id: _removed, ...incomplete } = fixture.generation_offer;
    expect(isAssistantRunResult(incomplete)).toBe(false);
  });

  it("rejects a generation_offer with oversized params (not an object)", () => {
    expect(
      isAssistantRunResult({
        ...fixture.generation_offer,
        params: "not-an-object",
      }),
    ).toBe(false);
  });

  it("rejects a generation_progress missing generation_id", () => {
    const { generation_id: _removed, ...incomplete } =
      fixture.generation_progress;
    expect(isAssistantRunResult(incomplete)).toBe(false);
  });

  it("accepts retryable and non-retryable tool errors as distinct structured results", () => {
    expect(fixture.tool_errors.map((result: { retryable: boolean }) => result.retryable)).toEqual([false, true]);
    for (const result of fixture.tool_errors) {
      expect(isAssistantError(result)).toBe(true);
      expect(isAssistantRunResult(result)).toBe(true);
      expect(result.code).toBe("tool_error");
    }
  });

  it("rejects an error with an unknown code", () => {
    expect(isAssistantRunResult({ ...fixture.error, code: "made_up" })).toBe(
      false,
    );
  });

  it("documents the idempotency-conflict response shape", () => {
    expect(fixture.idempotency_conflict.status).toBe(409);
    expect(fixture.idempotency_conflict.body.error).toBe(
      "assistant_idempotency_conflict",
    );
  });
});

describe("run progress snapshot (MF-1999 amendment)", () => {
  it.each(RUN_PHASES)("accepts the %s phase fixture", (phase) => {
    expect(isRunProgressSnapshot(fixture.run_progress[phase])).toBe(true);
    expect(fixture.run_progress[phase].phase).toBe(phase);
  });

  it("queued phase has no meaningful percent (progress: null)", () => {
    expect(fixture.run_progress.queued.progress).toBeNull();
  });

  it("non-queued phases carry a numeric progress, not an interpolated guess", () => {
    for (const phase of RUN_PHASES.filter((p) => p !== "queued")) {
      expect(typeof fixture.run_progress[phase].progress).toBe("number");
    }
  });

  it("rejects an unknown phase", () => {
    expect(
      isRunProgressSnapshot({
        ...fixture.run_progress.draft,
        phase: "made_up",
      }),
    ).toBe(false);
  });

  it("rejects a snapshot missing estimate_updated_at", () => {
    const { estimate_updated_at: _removed, ...incomplete } =
      fixture.run_progress.draft;
    expect(isRunProgressSnapshot(incomplete)).toBe(false);
  });

  it("a run mid-generation carries a progress snapshot", () => {
    expect(fixture.run_with_progress.status).toBe("running");
    expect(isRunProgressSnapshot(fixture.run_with_progress.progress)).toBe(
      true,
    );
  });

  it("a clarify/answer run has no progress (null, not fabricated)", () => {
    expect(fixture.run_without_progress.status).toBe("done");
    expect(fixture.run_without_progress.progress).toBeNull();
  });
});

describe("request guards", () => {
  it("accepts a well-formed create-message request", () => {
    expect(
      isCreateAssistantMessageRequest({
        content: "сделай куб",
        client_request_id: "req-1",
      }),
    ).toBe(true);
  });

  it("rejects a create-message request without client_request_id", () => {
    expect(isCreateAssistantMessageRequest({ content: "сделай куб" })).toBe(
      false,
    );
  });

  it("accepts a well-formed confirm-generation request", () => {
    expect(
      isConfirmAssistantGenerationRequest({
        run_id: "9c1f2e10-1111-4a11-8a11-000000000001",
      }),
    ).toBe(true);
  });

  it("rejects a confirm-generation request without run_id", () => {
    expect(isConfirmAssistantGenerationRequest({})).toBe(false);
  });
});

describe("evidence v2 boundary parity", () => {
  it.each(evidenceFixture.invalid_urls)("rejects source URL %s", (url) => {
    expect(isAssistantEvidenceCitation({ ...evidenceFixture.v2[0], source_refs: [{ label: "source", url }] })).toBe(false);
  });
  it.each(evidenceFixture.invalid_portal_urls)("rejects canonical URL %s", (canonical_url) => {
    expect(isAssistantEvidenceCitation({ ...evidenceFixture.v2[0], canonical_url })).toBe(false);
  });
  it.each(evidenceFixture.invalid_timestamps)("rejects timestamp %s", (observed_at) => {
    expect(isAssistantEvidenceCitation({ ...evidenceFixture.v2[0], observed_at })).toBe(false);
  });
  it.each(evidenceFixture.valid_timestamps)("accepts RFC3339 %s", (observed_at) => {
    expect(isAssistantEvidenceCitation({ ...evidenceFixture.v2[0], observed_at })).toBe(true);
  });
  it("omits static freshness and requires effective news dates", () => {
    expect(evidenceFixture.v2[0]).not.toHaveProperty("freshness");
    expect(isAssistantEvidenceCitation({ ...evidenceFixture.v2[0], freshness: "unknown", freshness_reason: null })).toBe(false);
    const news = { ...evidenceFixture.v2[5], facts: { kind: "news" } };
    expect(isAssistantEvidenceCitation(news)).toBe(false);
    expect(isAssistantEvidenceCitation({ ...news, freshness: "unknown", freshness_reason: "news_missing_effective_published_at" })).toBe(true);
    expect(isAssistantEvidenceCitation({ ...news, freshness: "unknown", freshness_reason: "recent" })).toBe(false);
  });
  it("keeps USD MSRP freshness unknown and undated", () => {
    const usd = { ...evidenceFixture.v2[1], facts: { kind: "printer", price_msrp_usd: { amount: 599, currency: "USD" } } };
    expect(isAssistantEvidenceCitation(usd)).toBe(false);
    expect(isAssistantEvidenceCitation({ ...usd, price_updated_at: null, freshness: "unknown", freshness_reason: "price_msrp_has_no_observation_date" })).toBe(true);
  });
  it.each([
    ["title", "x".repeat(301)], ["snippet", "x".repeat(2001)],
    ["source_refs", Array.from({ length: 9 }, () => ({ label: "s", url: null }))], ["missing_fields", Array(33).fill("x")],
  ])("bounds %s", (field, value) => {
    expect(isAssistantEvidenceCitation({ ...evidenceFixture.v2[0], [field as string]: value })).toBe(false);
  });
  it("bounds fact arrays, comparison dimensions and ordered fields", () => {
    expect(isAssistantEvidenceCitation({ ...evidenceFixture.v2[1], facts: { kind: "printer", supported_materials: Array(33).fill("PLA") } })).toBe(false);
    const comparison = evidenceFixture.v2[6]!;
    const facts = comparison.facts as { printer_ids: string[]; rows: { field: string; cells: Record<string, unknown>[] }[] };
    for (const invalid of [
      { ...facts, printer_ids: Array(5).fill("id") },
      { ...facts, rows: [...facts.rows].reverse() },
      { ...facts, rows: facts.rows.map((row, i) => i ? row : { ...row, cells: row.cells.slice(0, 1) }) },
      { ...facts, rows: facts.rows.map((row, i) => i ? row : { ...row, cells: row.cells.map((cell) => ({ ...cell, private: "secret" })) }) },
    ]) expect(isAssistantEvidenceCitation({ ...comparison, facts: invalid })).toBe(false);
  });
});

describe("evidence v2 OpenAPI shape", () => {
  it("publishes bounded comparison facts and optional freshness", () => {
    const doc = JSON.parse(readFileSync(join(here, "openapi.v1.json"), "utf8"));
    const schemas = doc.components.schemas;
    const citation = schemas.AssistantEvidenceCitationDto;
    expect(citation.required).not.toContain("freshness");
    expect(citation.required).not.toContain("freshness_reason");
    expect(citation.properties.title.maxLength).toBe(300);
    expect(citation.properties.snippet.maxLength).toBe(2000);
    expect(citation.properties.source_refs.maxItems).toBe(8);
    expect(citation.properties.missing_fields.maxItems).toBe(32);
    expect(citation.properties.facts.oneOf).toContainEqual({ $ref: "#/components/schemas/AssistantComparisonFactsDto" });
    expect(schemas.AssistantComparisonFactsDto.properties.printer_ids).toMatchObject({ minItems: 2, maxItems: 4 });
    expect(schemas.AssistantComparisonFactsDto.properties.rows).toMatchObject({ minItems: 14, maxItems: 14 });
    expect(schemas.AssistantComparisonRowDto.properties.cells).toMatchObject({ minItems: 2, maxItems: 4 });
    expect(schemas.AssistantPrinterFactsDto.properties.supported_materials.maxItems).toBe(32);
  });
});
