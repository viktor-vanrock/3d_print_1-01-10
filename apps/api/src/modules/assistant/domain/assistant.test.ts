import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isAssistantError } from "@portal/contracts/http/assistant";
import { sanitizeCitation, sanitizeRunResult } from "./assistant.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "../../../../../../packages/contracts/http/fixtures/assistant.evidence.v2.json"), "utf8")) as {
  readonly legacy: Record<string, unknown>;
  readonly v2: readonly Record<string, unknown>[];
  readonly invalid_urls: readonly string[];
  readonly invalid_portal_urls: readonly string[];
  readonly invalid_timestamps: readonly string[];
  readonly valid_timestamps: readonly string[];
};

describe("assistant citation sanitization", () => {
  it("keeps legacy citations readable while stripping unknown and unsafe fields", () => {
    expect(
      sanitizeCitation({
        ...fixture.legacy,
        source_url: "javascript:alert(1)",
        provider_secret: "must-not-leak",
      }),
    ).toEqual({
      model_id: fixture.legacy.model_id,
      title: fixture.legacy.title,
      snippet: fixture.legacy.snippet,
      score: fixture.legacy.score,
      source_url: null,
    });
  });

  it("exposes only the evidence.v2 allow-list and removes unsafe URLs", () => {
    const raw = fixture.v2[1]!;
    const sanitized = sanitizeCitation({
      ...raw,
      canonical_url: "data:text/html,unsafe",
      provider_secret: "must-not-leak",
      facts: { ...(raw.facts as Record<string, unknown>), internal_notes: "private" },
      source_refs: [
        { label: "safe", url: "https://example.com/printer", auth_header: "secret" },
        { label: "unsafe", url: "https://user:password@example.com/private" },
      ],
    });

    expect(sanitized).not.toBeNull();
    expect(sanitized).not.toHaveProperty("provider_secret");
    expect(sanitized).not.toHaveProperty("facts.internal_notes");
    expect(sanitized).toMatchObject({
      evidence_id: raw.evidence_id,
      canonical_url: null,
      source_refs: [
        { label: "safe", url: "https://example.com/printer" },
        { label: "unsafe", url: null },
      ],
    });
  });

  it("drops citations with invented enum values or invalid timestamps", () => {
    expect(sanitizeCitation({ ...fixture.v2[0], quality: "trusted_by_model" })).toBeNull();
    expect(sanitizeCitation({ ...fixture.v2[0], observed_at: "yesterday" })).toBeNull();
  });

  it("sanitizes mixed legacy/v2 persisted answers without changing timestamps", () => {
    const result = sanitizeRunResult({ kind: "answer", text: "ok", citations: [fixture.legacy, ...fixture.v2], ignored: "value" }, "answer", "run-1");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("expected answer");
    expect(result.citations).toHaveLength(8);
    expect(result.citations[1]).toMatchObject({
      observed_at: fixture.v2[0]?.observed_at,
      updated_at: fixture.v2[0]?.updated_at,
      source_published_at: fixture.v2[0]?.source_published_at,
      price_updated_at: fixture.v2[0]?.price_updated_at,
    });
    expect(result.citations[2]).toMatchObject({
      facts: { nozzle_hardened: true, unique_features: ["Закрытый корпус", "Автокалибровка"] },
    });
  });
});

describe("evidence v2 sanitizer security", () => {
  it.each(fixture.invalid_urls)("removes source URL %s", (url) => {
    expect(sanitizeCitation({ ...fixture.v2[0], source_refs: [{ label: "s", url }] })).toMatchObject({ source_refs: [{ label: "s", url: null }] });
  });
  it.each(fixture.invalid_portal_urls)("removes canonical URL %s", (canonical_url) => {
    expect(sanitizeCitation({ ...fixture.v2[0], canonical_url })).toMatchObject({ canonical_url: null });
  });
  it.each(fixture.invalid_timestamps)("drops invalid date %s", (observed_at) => {
    expect(sanitizeCitation({ ...fixture.v2[0], observed_at })).toBeNull();
  });
  it("removes static freshness and bounds unsafe envelopes", () => {
    const sanitized = sanitizeCitation({ ...fixture.v2[0], freshness: "unknown", freshness_reason: null });
    expect(sanitized).not.toBeNull();
    expect(sanitized).not.toHaveProperty("freshness");
    expect(sanitizeCitation({ ...fixture.v2[0], title: "x".repeat(301) })).toBeNull();
    expect(sanitizeCitation({ ...fixture.v2[0], snippet: "x".repeat(2001) })).toBeNull();
    expect(sanitizeCitation({ ...fixture.v2[0], source_refs: Array(9).fill({ label: "s", url: null }) })).toBeNull();
    expect(sanitizeCitation({ ...fixture.v2[0], missing_fields: Array(33).fill("x") })).toBeNull();
  });
  it("preserves fixed comparison values and removes nested private fields", () => {
    const comparison = structuredClone(fixture.v2[6]!);
    const facts = comparison.facts as { rows: { cells: Record<string, unknown>[] }[] };
    facts.rows[0]!.cells[0]!.private = "secret";
    expect(sanitizeCitation(comparison)).toEqual(fixture.v2[6]);
  });
  it("preserves allow-listed compatibility facts while dropping private material fields", () => {
    const material = structuredClone(fixture.v2[4]!);
    const facts = material.facts as Record<string, unknown>;
    Object.assign(facts, {
      compatibility: "compatible",
      compatibility_reasons: [],
      ranking_criterion: "compatibility_state,name_asc",
      printer_label: "Smoke Printer",
      printer_capabilities: { max_hotend_temp_c: 300, filament_dia_mm: 1.75 },
      machine_id: "00000000-0000-4000-8000-000000000044",
      private_connection: "192.0.2.10",
    });
    const sanitized = sanitizeCitation(material);
    expect(sanitized).toMatchObject({
      facts: {
        compatibility: "compatible",
        compatibility_reasons: [],
        ranking_criterion: "compatibility_state,name_asc",
        printer_label: "Smoke Printer",
        printer_capabilities: { max_hotend_temp_c: 300, filament_dia_mm: 1.75 },
        machine_id: "00000000-0000-4000-8000-000000000044",
      },
    });
    expect(sanitized).not.toHaveProperty("facts.private_connection");
  });
});

const resultFixture = JSON.parse(readFileSync(join(here, "../../../../../../packages/contracts/http/fixtures/assistant.v1.json"), "utf8")) as {
  readonly error: Record<string, unknown>;
  readonly tool_errors: readonly Record<string, unknown>[];
};

describe("assistant error sanitization", () => {
  it.each(resultFixture.tool_errors)("preserves stable tool error and retryability: $retryable", (result) => {
    expect(sanitizeRunResult({ ...result, message: "raw provider secret", secret: "hidden" }, "error", "run-1")).toEqual(result);
  });
  it("keeps legacy provider errors readable and rejects invented codes", () => {
    const legacy = sanitizeRunResult({ kind: "error", code: "provider_timeout", retryable: true }, "error", "run-1");
    expect(legacy).toMatchObject({ kind: "error", code: "provider_timeout", retryable: true });
    const unknown = sanitizeRunResult({ kind: "error", code: "invented" }, "error", "run-1");
    expect(unknown).toMatchObject({ kind: "error", code: "provider_error" });
    expect(isAssistantError(legacy)).toBe(true);
    expect(isAssistantError(unknown)).toBe(true);
  });
});
