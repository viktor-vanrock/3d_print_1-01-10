import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantEvidenceCitation } from "@portal/contracts/http/assistant";
import { describe, expect, it, vi } from "vitest";
import { ASSISTANT_CONTEXT_UNAVAILABLE_MARKER, buildAssistantContext, type AssistantContextReference } from "./assistant-context.ts";

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../../../packages/contracts/http/fixtures/assistant.evidence.v2.json"), "utf8"),
) as { readonly legacy: Record<string, unknown>; readonly v2: readonly AssistantEvidenceCitation[] };
const printer = fixture.v2[1]!;
const comparison = fixture.v2[6]!;

function answer(text: string, citations: readonly unknown[] = [printer]) {
  return { kind: "answer", text, citations };
}

function printerCitation(id: string): AssistantEvidenceCitation {
  return { ...printer, evidence_id: `printer:${id}`, entity_id: id, canonical_url: `/printers/${id}` };
}

describe("assistant provider context", () => {
  it("keeps completed turns chronological and preserves visible comparison wording and order", async () => {
    const visible = vi.fn<(_reference: AssistantContextReference) => Promise<boolean>>(async () => true);
    const built = await buildAssistantContext(
      {
        total: 2,
        turns: [
          { user_content: "а второй дешевле?", result_type: "answer", result: answer("Да, второй дешевле.", [comparison]) },
          { user_content: "сравни P1S и K1", result_type: "answer", result: answer("Сначала P1S, затем K1.", [comparison]) },
        ],
      },
      "а камера есть?",
      visible,
    );

    expect(built).toEqual({
      currentMessage: "а камера есть?",
      messages: [
        { role: "user", content: "сравни P1S и K1" },
        { role: "assistant", content: "Сначала P1S, затем K1." },
        { role: "user", content: "а второй дешевле?" },
        { role: "assistant", content: "Да, второй дешевле." },
      ],
      truncated: false,
      omittedTurns: 0,
    });
    expect(visible.mock.calls.map(([reference]) => reference)).toEqual([
      { entityType: "printer", entityId: "bambu-lab-p1s" },
      { entityType: "printer", entityId: "creality-k1" },
    ]);
  });

  it("replaces the entire answer when one reference is hidden without replaying facts or source labels", async () => {
    const built = await buildAssistantContext(
      {
        total: 1,
        turns: [{ user_content: "Расскажи", result_type: "answer", result: answer("Секретный факт Bambu Lab P1S", [printer, { ...comparison, title: "unsafe label" }]) }],
      },
      "Продолжай",
      async (reference) => reference.entityId === printer.entity_id,
    );
    expect(built.messages).toEqual([
      { role: "user", content: "Расскажи" },
      { role: "assistant", content: ASSISTANT_CONTEXT_UNAVAILABLE_MARKER },
    ]);
    expect(JSON.stringify(built.messages)).not.toContain("Секретный факт");
    expect(JSON.stringify(built.messages)).not.toContain("unsafe label");
    expect(JSON.stringify(built.messages)).not.toContain("example.com");
  });

  it("omits unverifiable legacy answers but retains their owned user messages", async () => {
    const visible = vi.fn(async () => true);
    const built = await buildAssistantContext(
      { total: 1, turns: [{ user_content: "Найди модель", result_type: "answer", result: answer("Старый ответ", [fixture.legacy]) }] },
      "Дальше",
      visible,
    );
    expect(built.messages).toEqual([{ role: "user", content: "Найди модель" }]);
    expect(visible).not.toHaveBeenCalled();
  });

  it("uses a neutral marker for malformed or unsupported factual references", async () => {
    const malformed = { ...printer, source_refs: [{ label: "attack", url: "javascript:alert(1)" }] };
    const built = await buildAssistantContext(
      { total: 1, turns: [{ user_content: "Что там?", result_type: "answer", result: answer("Не отправлять", [malformed]) }] },
      "Продолжай",
      async () => true,
    );
    expect(built.messages.at(-1)).toEqual({ role: "assistant", content: ASSISTANT_CONTEXT_UNAVAILABLE_MARKER });
  });

  it("deduplicates printer and expanded comparison references before visibility reads", async () => {
    const visible = vi.fn<(_reference: AssistantContextReference) => Promise<boolean>>(async () => true);
    const built = await buildAssistantContext(
      { total: 1, turns: [{ user_content: "Сравни", result_type: "answer", result: answer("Порядок сохранён", [printer, printer, comparison, comparison]) }] },
      "Продолжай",
      visible,
    );
    expect(visible.mock.calls.map(([reference]) => reference)).toEqual([
      { entityType: "printer", entityId: "bambu-lab-p1s" },
      { entityType: "printer", entityId: "creality-k1" },
    ]);
    expect(built.messages.at(-1)).toEqual({ role: "assistant", content: "Порядок сохранён" });
  });

  it("fails the whole answer closed when expanded unique entity references exceed twenty", async () => {
    const visible = vi.fn<(_reference: AssistantContextReference) => Promise<boolean>>(async () => true);
    const citations = [...Array.from({ length: 19 }, (_, index) => printerCitation(`printer-${index}`)), comparison];
    const built = await buildAssistantContext(
      { total: 1, turns: [{ user_content: "Много принтеров", result_type: "answer", result: answer("Не отправлять", citations) }] },
      "Продолжай",
      visible,
    );
    expect(visible).not.toHaveBeenCalled();
    expect(built.messages.at(-1)).toEqual({ role: "assistant", content: ASSISTANT_CONTEXT_UNAVAILABLE_MARKER });
  });

  it("does not read references from turns removed by the character budget", async () => {
    const visible = vi.fn<(_reference: AssistantContextReference) => Promise<boolean>>(async () => true);
    const built = await buildAssistantContext(
      {
        total: 2,
        turns: [
          { user_content: "я".repeat(4_000), result_type: "clarification", result: { kind: "clarification", question: "ё".repeat(4_000) } },
          { user_content: "старый", result_type: "answer", result: answer("старый ответ", [printer]) },
        ],
      },
      "ж".repeat(4_000),
      visible,
    );
    expect(visible).not.toHaveBeenCalled();
    expect(built).toMatchObject({ truncated: true, omittedTurns: 1 });
  });

  it("retains newest whole turns at the exact 12,000 Unicode-character boundary", async () => {
    const built = await buildAssistantContext(
      {
        total: 2,
        turns: [
          { user_content: "я".repeat(4_000), result_type: "answer", result: answer("ё".repeat(4_000)) },
          { user_content: "старый", result_type: "clarification", result: { kind: "clarification", question: "ответ" } },
        ],
      },
      "ж".repeat(4_000),
      async () => true,
    );
    expect(built.messages).toHaveLength(2);
    expect(built.messages[0]?.content).toHaveLength(4_000);
    expect(built.messages[1]?.content).toHaveLength(4_000);
    expect(built).toMatchObject({ truncated: true, omittedTurns: 1 });
  });

  it("reports turns beyond the eight-turn limit and handles empty history", async () => {
    const turns = Array.from({ length: 9 }, (_, index) => ({
      user_content: `user-${index}`,
      result_type: "clarification" as const,
      result: { kind: "clarification", question: `assistant-${index}` },
    }));
    expect(await buildAssistantContext({ total: 0, turns: [] }, " текущий\r\nвопрос ", async () => true)).toEqual({
      currentMessage: "текущий\nвопрос",
      messages: [],
      truncated: false,
      omittedTurns: 0,
    });
    const built = await buildAssistantContext({ total: 9, turns }, "текущий", async () => true);
    expect(built.messages).toHaveLength(16);
    expect(built.messages[0]).toEqual({ role: "user", content: "user-7" });
    expect(built.messages.at(-1)).toEqual({ role: "assistant", content: "assistant-0" });
    expect(built).toMatchObject({ truncated: true, omittedTurns: 1 });
  });
});
