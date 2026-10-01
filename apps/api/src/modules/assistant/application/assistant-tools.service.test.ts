import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AssistantFilamentRecord, AssistantFilamentSearch } from "../../catalog/public/index.ts";
import type { AssistantPrinterEvidence } from "../../printers/public/index.ts";
import type { AssistantCompletedTurns } from "../domain/assistant-internal.ts";
import type { AssistantRunIdentity } from "../infrastructure/assistant.repository.ts";
import { describe, expect, it, vi } from "vitest";
import { AssistantToolsService } from "./assistant-tools.service.ts";

const RUN_ID = randomUUID();
const USER_ID = randomUUID();
const CLAIM = { ownerId: "assistant-worker-test", generation: "1" } as const;

function evidence(id: string): AssistantPrinterEvidence {
  return { entity_id: id } as AssistantPrinterEvidence;
}

const priorCitation = {
  evidence_id: "printer:one",
  entity_type: "printer",
  entity_id: "one",
  title: "Printer one",
  snippet: "Visible printer",
  canonical_url: "/printers/one",
  facts: { kind: "printer", brand: "Printer", model: "One" },
  source_refs: [],
  source_published_at: null,
  observed_at: null,
  updated_at: null,
  price_updated_at: null,
  quality: "reported",
  missing_fields: [],
} satisfies AssistantPrinterEvidence;

const priorNewsCitation = {
  evidence_id: "news:one",
  entity_type: "news",
  entity_id: "00000000-0000-4000-8000-000000000099",
  title: "Visible news",
  snippet: "Untrusted body",
  canonical_url: "/feed/p/00000000-0000-4000-8000-000000000099",
  facts: { kind: "news", effective_published_at: null, topic: null },
  source_refs: [{ label: "Original source", url: "https://example.test/news" }],
  source_published_at: null,
  observed_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  price_updated_at: null,
  freshness: "unknown",
  freshness_reason: "news_missing_effective_published_at",
  quality: "reported",
  missing_fields: ["source_published_at"],
} as const;

function setup() {
  const repository = {
    activeRunIdentity: vi.fn(async () => ({ runId: RUN_ID, threadId: randomUUID(), messageId: randomUUID(), userId: USER_ID, message: "K1" })),
    completedTurns: vi.fn<(_identity: AssistantRunIdentity, _limit: number) => Promise<AssistantCompletedTurns>>(async () => ({ turns: [], total: 0 })),
  };
  const profiles = { loadOwnerAuthState: vi.fn(async () => ({ status: "active" })) };
  const sanctions = { findActiveForUser: vi.fn(async () => null) };
  const catalog = {
    searchAssistantPrinters: vi.fn(async () => ({ kind: "ambiguous" as const, candidates: [evidence("one"), evidence("two")] })),
    getAssistantPrinter: vi.fn(async () => ({ kind: "resolved" as const, evidence: evidence("one") })),
    compareAssistantPrinters: vi.fn(async () => ({ kind: "resolved" as const, evidence: evidence("comparison") })),
  };
  const news = {
    listAssistantNews: vi.fn(async () => ({
      period: { from: "2026-08-23T00:00:00.000Z", to: "2026-09-22T00:00:00.000Z", defaulted: true, bounded: false, date_basis: "portal_published_at" as const },
      evidence: [],
    })),
    isAssistantNewsVisible: vi.fn(async () => true),
  };
  const catalogReads = {
    assistantFilaments: vi.fn<(_input: AssistantFilamentSearch) => Promise<readonly AssistantFilamentRecord[]>>(async () => []),
    assistantMaterialTypeFilaments: vi.fn(async () => []),
    filamentExists: vi.fn(async () => true),
    machineForSlicer: vi.fn(async () => ({ id: "machine", specs: {} })),
  };
  const links = { confirmedLinkForPrinter: vi.fn(async () => null), resolveOwnedReferences: vi.fn(async () => ({ kind: "none" })) };
  const ownedPrinters = { resolveOwnedReference: vi.fn(async () => null) };
  const runtimeLogger = { info: vi.fn() };
  const service = new AssistantToolsService(repository as never, profiles as never, sanctions as never, catalog as never, news as never, catalogReads as never, links as never, ownedPrinters as never, runtimeLogger as never);
  return { service, catalog, news, repository, catalogReads, links, ownedPrinters, runtimeLogger };
}

describe("AssistantToolsService printer handlers", () => {
  const materialId = "00000000-0000-4000-8000-000000000071";
  const machineId = "00000000-0000-4000-8000-000000000072";
  const ownedId = "00000000-0000-4000-8000-000000000073";
  const material = {
    id: materialId, slug: "pla", name: "PLA", brand: "Test", material_type: "pla", specs: { fill_type: "none" }, source: "manual",
    created_at: new Date("2026-09-01"), updated_at: new Date("2026-09-02"), variant_id: null, color: null, diameter_mm: 1.75,
    default_extruder_temp_c: 220, requires_chamber: false, requires_drying: false, requires_direct_drive: false,
  };
  const specs = { max_hotend_temp_c: 300, filament_dia_mm: 1.75 };

  it("emits only allow-listed context and tool observations", async () => {
    const { service, runtimeLogger } = setup();
    await service.context(RUN_ID, CLAIM, "safe-correlation");
    await service.execute(RUN_ID, CLAIM, "search_printers", { query: "private question" }, "safe-correlation");
    expect(runtimeLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "assistant.context.completed.v1",
        request_id: "safe-correlation",
        contract_version: "assistant.evidence.v2",
        context_truncated: false,
      }),
      "assistant context completed",
    );
    expect(runtimeLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "assistant.tool.completed.v1",
        request_id: "safe-correlation",
        tool_name: "search_printers",
        tool_count: 1,
        evidence_count: 2,
        result_kind: "ambiguous",
      }),
      "assistant tool completed",
    );
    expect(JSON.stringify(runtimeLogger.info.mock.calls)).not.toContain("private question");
  });

  it("produces the shared API-worker fixture through the registered service path", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../../../../../../packages/contracts/fixtures/assistant-filament-tool.v1.json", import.meta.url), "utf8"));
    const { service, catalogReads } = setup();
    catalogReads.assistantFilaments.mockResolvedValue([material] as never);
    const response = await service.execute(RUN_ID, CLAIM, "recommend_filaments", fixture.args, "fixture");
    expect(response.result).toEqual(fixture.result);
  });

  it("keeps scanning after row one hundred and promotes a later compatible filament", async () => {
    const { service, catalogReads, links } = setup();
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...material,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: `Product ${String(index).padStart(3, "0")}`,
      requires_drying: true,
    }));
    const winner = { ...material, id: "00000000-0000-4000-8000-000000000100", name: "Product 100" };
    catalogReads.assistantFilaments.mockImplementation(async (input) => input.recommendation_cursor === undefined ? firstPage : [winner]);
    links.confirmedLinkForPrinter.mockResolvedValue({ machineId } as never);
    catalogReads.machineForSlicer.mockResolvedValue({ id: machineId, specs });

    const result = (await service.execute(RUN_ID, CLAIM, "recommend_filaments", { printer_id: "one", material_type: "pla" }, "c")).result;

    expect(catalogReads.assistantFilaments).toHaveBeenCalledTimes(2);
    expect(catalogReads.assistantFilaments).toHaveBeenNthCalledWith(1, expect.objectContaining({ material_type: "pla", recommendation_candidate_scan: true }));
    expect(catalogReads.assistantFilaments).toHaveBeenNthCalledWith(2, expect.objectContaining({
      material_type: "pla",
      recommendation_candidate_scan: true,
      recommendation_cursor: { name: "Product 099", id: "00000000-0000-4000-8000-000000000099" },
    }));
    expect(result.evidence[0]?.entity_id).toBe(winner.id);
    expect(result.evidence[0]?.facts).toMatchObject({ compatibility: "compatible" });
  });

  it("passes bounded canonical color without adding purpose-based rules", async () => {
    const { service, catalogReads } = setup();
    const args = { color: "White" };
    await service.execute(RUN_ID, CLAIM, "search_filaments", args, "c");
    expect(catalogReads.assistantFilaments).toHaveBeenCalledWith(args);
    await expect(service.execute(RUN_ID, CLAIM, "search_filaments", { color: "x".repeat(101) }, "c")).rejects.toThrow();
  });

  it("resolves the Cyrillic ABS family request before the capped product search", async () => {
    const { service, catalogReads } = setup();
    await service.execute(RUN_ID, CLAIM, "search_filaments", { query: "найди пластик абс" }, "c");
    expect(catalogReads.assistantFilaments).toHaveBeenCalledWith({ query: undefined, material_type: "abs" });
    await service.execute(RUN_ID, CLAIM, "search_filaments", { query: "абс", material_type: "пла" }, "c");
    expect(catalogReads.assistantFilaments).toHaveBeenLastCalledWith({ query: "абс", material_type: "pla" });
  });

  it("compares normalized material families from published product facts", async () => {
    const { service, catalogReads } = setup();
    catalogReads.assistantMaterialTypeFilaments.mockResolvedValue([
      { ...material, id: `${materialId.slice(0, -1)}1`, material_type: "abs", name: "ABS complete", specs: { nozzle_temp_min_c: 240, nozzle_temp_max_c: 260, bed_temp_min_c: 90, bed_temp_max_c: 110, needs_enclosure: true } },
      { ...material, id: `${materialId.slice(0, -1)}2`, material_type: "pla", name: "PLA complete", specs: { nozzle_temp_min_c: 200, nozzle_temp_max_c: 220, bed_temp_min_c: 50, bed_temp_max_c: 60, needs_enclosure: false } },
      { ...material, id: `${materialId.slice(0, -1)}3`, material_type: "pla", name: "PLA second", specs: { nozzle_temp_min_c: 190, nozzle_temp_max_c: 230, bed_temp_min_c: 0, bed_temp_max_c: 60 } },
    ] as never);

    const result = (await service.execute(RUN_ID, CLAIM, "compare_material_types", { types: ["АБС", " пла "] }, "c")).result;

    expect(catalogReads.assistantMaterialTypeFilaments).toHaveBeenCalledWith({ types: ["abs", "pla"] });
    expect(result.evidence.map((entry) => entry.entity_id)).toEqual([`${materialId.slice(0, -1)}1`, `${materialId.slice(0, -1)}2`]);
    expect(result.material_comparison).toEqual({ families: [
      {
        material_type: "abs", published_products: 1,
        nozzle_temp_c: { median_listed_min_c: 240, median_listed_max_c: 260, sample_count: 1 },
        bed_temp_c: { median_listed_min_c: 90, median_listed_max_c: 110, sample_count: 1 },
        enclosure: { required_count: 1, not_required_count: 0, unknown_count: 0 },
      },
      {
        material_type: "pla", published_products: 2,
        nozzle_temp_c: { median_listed_min_c: 195, median_listed_max_c: 225, sample_count: 2 },
        bed_temp_c: { median_listed_min_c: 25, median_listed_max_c: 60, sample_count: 2 },
        enclosure: { required_count: 0, not_required_count: 1, unknown_count: 1 },
      },
    ] });
  });

  it("keeps sparse or implausible comparison facts unknown and fails closed for a missing family", async () => {
    const { service, catalogReads } = setup();
    const sparse = { ...material, material_type: "abs", specs: { nozzle_temp_min_c: 80, nozzle_temp_max_c: 900, bed_temp_min_c: 100, bed_temp_max_c: 50, needs_enclosure: "yes" } };
    catalogReads.assistantMaterialTypeFilaments.mockResolvedValue([sparse, { ...material, material_type: "pla", specs: {} }] as never);
    const result = (await service.execute(RUN_ID, CLAIM, "compare_material_types", { types: ["abs", "pla"] }, "c")).result;
    expect(result.material_comparison?.families[0]).toMatchObject({
      nozzle_temp_c: { median_listed_min_c: null, median_listed_max_c: null, sample_count: 0 },
      bed_temp_c: { median_listed_min_c: null, median_listed_max_c: null, sample_count: 0 },
      enclosure: { required_count: 0, not_required_count: 0, unknown_count: 1 },
    });

    catalogReads.assistantMaterialTypeFilaments.mockResolvedValue([sparse] as never);
    expect((await service.execute(RUN_ID, CLAIM, "compare_material_types", { types: ["abs", "pla"] }, "c")).result).toEqual({ resolution: "not_found", evidence: [] });
  });

  it.each([
    { types: ["abs"] },
    { types: ["abs", "АБС"] },
    { types: ["abs", "pla", "petg", "tpu", "pc"] },
    { types: ["abs", "bad family"] },
    { types: ["abs", "pla"], extra: true },
  ])("rejects invalid material comparison input: %j", async (args) => {
    const { service, catalogReads } = setup();
    await expect(service.execute(RUN_ID, CLAIM, "compare_material_types", args, "c")).rejects.toMatchObject({ status: 422 });
    expect(catalogReads.assistantMaterialTypeFilaments).not.toHaveBeenCalled();
  });

  it("returns insufficient data without a confirmed public machine while public description works", async () => {
    const { service, catalogReads, catalog } = setup();
    catalog.getAssistantPrinter.mockResolvedValue({ kind: "resolved", evidence: { ...priorCitation, title: "Public Printer" } });
    catalogReads.assistantFilaments.mockResolvedValue([material] as never);
    const response = await service.execute(RUN_ID, CLAIM, "recommend_filaments", { printer_id: "one" }, "c");
    expect(response.result.evidence[0]?.facts).toMatchObject({ compatibility: "insufficient_data" });
    expect(response.result.evidence[0]?.facts).toMatchObject({ printer_label: "Public Printer" });
    expect(response.result.evidence[0]?.missing_fields).toContain("confirmed_machine");
    expect((await service.execute(RUN_ID, CLAIM, "get_printer", { printer_id: "one" }, "c")).result.resolution).toBe("resolved");
  });

  it.each(["owned_machine", "confirmed_link"])("uses an owner-checked %s resolution", async (kind) => {
    const { service, catalogReads, ownedPrinters, links } = setup();
    catalogReads.assistantFilaments.mockResolvedValue([material] as never);
    catalogReads.machineForSlicer.mockResolvedValue({ id: machineId, specs });
    ownedPrinters.resolveOwnedReference.mockResolvedValue({ id: ownedId, brand: "Example", model: "Printer", printer_id: kind === "owned_machine" ? machineId : null, catalog_printer_id: null } as never);
    links.resolveOwnedReferences.mockResolvedValue({ kind, machineId } as never);
    const result = (await service.execute(RUN_ID, CLAIM, "recommend_filaments", { user_printer_id: "primary" }, "c")).result;
    expect(ownedPrinters.resolveOwnedReference).toHaveBeenCalledWith(USER_ID, "primary");
    expect(result.evidence[0]?.facts).toMatchObject({ compatibility: "compatible", machine_id: machineId, user_printer_id: ownedId });
    expect(result.evidence[0]?.facts).toMatchObject({ printer_label: "Example Printer", printer_capabilities: specs });
  });

  it("fails closed on foreign owned ids and conflicting catalog-machine references", async () => {
    const { service, ownedPrinters, links } = setup();
    expect((await service.execute(RUN_ID, CLAIM, "recommend_filaments", { user_printer_id: ownedId }, "c")).result).toEqual({ resolution: "not_found", evidence: [] });
    expect(links.resolveOwnedReferences).not.toHaveBeenCalled();
    ownedPrinters.resolveOwnedReference.mockResolvedValue({ id: ownedId, printer_id: machineId, catalog_printer_id: "one" } as never);
    links.resolveOwnedReferences.mockResolvedValue({ kind: "conflict" });
    expect((await service.execute(RUN_ID, CLAIM, "recommend_filaments", { user_printer_id: ownedId }, "c")).result).toEqual({ resolution: "data_quality_conflict", evidence: [] });
  });

  it.each(["material", "material_kind", "machine", "owned"])("revalidates %s before serializing the entire previous answer", async (hidden) => {
    const { service, repository, catalogReads, ownedPrinters, links } = setup();
    catalogReads.assistantFilaments.mockResolvedValue([material] as never);
    catalogReads.machineForSlicer.mockResolvedValue({ id: machineId, specs });
    ownedPrinters.resolveOwnedReference.mockResolvedValue({ id: ownedId, printer_id: machineId, catalog_printer_id: null } as never);
    links.resolveOwnedReferences.mockResolvedValue({ kind: "owned_machine", machineId } as never);
    const response = await service.execute(RUN_ID, CLAIM, "recommend_filaments", { user_printer_id: ownedId }, "c");
    repository.completedTurns.mockResolvedValue({ turns: [{ user_content: "Подбери PLA", result_type: "answer", result: { kind: "answer", text: "Whole private prior answer", citations: response.result.evidence } }], total: 1 });
    expect((await service.context(RUN_ID, CLAIM, "c")).context.some((turn) => turn.content === "Whole private prior answer")).toBe(true);
    if (hidden === "material" || hidden === "material_kind") catalogReads.filamentExists.mockResolvedValue(false);
    if (hidden === "machine") catalogReads.machineForSlicer.mockResolvedValue(null as never);
    if (hidden === "owned") ownedPrinters.resolveOwnedReference.mockResolvedValue(null);
    const context = await service.context(RUN_ID, CLAIM, "c");
    expect(JSON.stringify(context)).not.toContain("Whole private prior answer");
    expect(JSON.stringify(context)).toContain("Предыдущий ответ недоступен");
  });

  it("registers fixed printer reads and preserves ambiguity", async () => {
    const { service, catalog } = setup();
    const context = await service.context(RUN_ID, CLAIM, "correlation");
    expect(context.tools).toEqual(["search_printers", "get_printer", "compare_printers", "search_filaments", "compare_material_types", "recommend_filaments", "list_news"]);

    const response = await service.execute(RUN_ID, CLAIM, "search_printers", { query: " K1 ", limit: 10 }, "correlation");
    expect(response.result).toEqual({ resolution: "ambiguous", evidence: [evidence("one"), evidence("two")] });
    expect(catalog.searchAssistantPrinters).toHaveBeenCalledWith({ reference: " K1 ", limit: 10 });
  });

  it("returns successful empty news with an exact disclosed period", async () => {
    const { service, news } = setup();
    const response = await service.execute(RUN_ID, CLAIM, "list_news", {}, "correlation");
    expect(response.result).toEqual({
      resolution: "resolved",
      evidence: [],
      period: { from: "2026-08-23T00:00:00.000Z", to: "2026-09-22T00:00:00.000Z", defaulted: true, bounded: false, date_basis: "portal_published_at" },
    });
    expect(news.listAssistantNews).toHaveBeenCalledWith({});
  });

  it("binds two-to-four comparison references in one domain call", async () => {
    const { service, catalog } = setup();

    const response = await service.execute(RUN_ID, CLAIM, "compare_printers", { references: ["Bambu Lab P1S", "Creality K1"], criteria: "цена" }, "correlation");

    expect(response.result).toEqual({ resolution: "resolved", evidence: [evidence("comparison")] });
    expect(catalog.compareAssistantPrinters).toHaveBeenCalledWith({ references: ["Bambu Lab P1S", "Creality K1"] });
    await expect(service.execute(RUN_ID, CLAIM, "compare_printers", { references: ["only one"] }, "correlation")).rejects.toMatchObject({ status: 422 });
  });

  it("binds exact detail references and rejects out-of-contract limits", async () => {
    const { service, catalog } = setup();
    const response = await service.execute(RUN_ID, CLAIM, "get_printer", { slug: "creality.k1", requested_fields: ["chamber_temperature_c"] }, "correlation");
    expect(response.result).toEqual({ resolution: "resolved", evidence: [evidence("one")] });
    expect(catalog.getAssistantPrinter).toHaveBeenCalledWith({ reference: "creality.k1", requested_fields: ["chamber_temperature_c"] });
    await expect(service.execute(RUN_ID, CLAIM, "search_printers", { query: "K1", limit: 11 }, "correlation")).rejects.toMatchObject({ status: 422 });
  });

  it("supplies visible history without a tool call and rechecks it at the later tool boundary", async () => {
    const { service, catalog, repository } = setup();
    repository.completedTurns.mockResolvedValue({
      total: 1,
      turns: [{ user_content: "Расскажи о первом", result_type: "answer", result: { kind: "answer", text: "Первый доступен", citations: [priorCitation] } }],
    });

    const context = await service.context(RUN_ID, CLAIM, "correlation");
    expect(context.context).toEqual([
      { role: "user", content: "Расскажи о первом" },
      { role: "assistant", content: "Первый доступен" },
    ]);
    expect(catalog.searchAssistantPrinters).not.toHaveBeenCalled();
    expect(catalog.getAssistantPrinter).toHaveBeenCalledTimes(1);

    catalog.getAssistantPrinter.mockClear();
    await service.execute(RUN_ID, CLAIM, "search_printers", { query: "K1" }, "correlation");
    expect(catalog.getAssistantPrinter).toHaveBeenCalledTimes(1);
    expect(catalog.searchAssistantPrinters).toHaveBeenCalledTimes(1);
  });

  it("replaces the whole prior news answer after its source becomes hidden", async () => {
    const { service, news, repository } = setup();
    news.isAssistantNewsVisible.mockResolvedValue(false);
    repository.completedTurns.mockResolvedValue({
      total: 1,
      turns: [{ user_content: "Что нового?", result_type: "answer", result: { kind: "answer", text: "Скрытая новость и её опасный текст", citations: [priorNewsCitation] } }],
    });
    const context = await service.context(RUN_ID, CLAIM, "correlation");
    expect(context.context.at(-1)?.content).toBe("[Предыдущий ответ недоступен из-за изменения доступа к источникам.]");
    expect(JSON.stringify(context.context)).not.toContain("опасный текст");
    expect(news.isAssistantNewsVisible).toHaveBeenCalledWith(priorNewsCitation.entity_id);
  });
});
