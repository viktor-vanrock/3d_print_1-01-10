import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@shared/types";
import evidenceFixture from "../../../../../../packages/contracts/http/fixtures/assistant.evidence.v2.json";
import { stashPendingRun } from "./assistantapi.ts";
import { AssistantWorkshopScreen } from "./workshop.tsx";
import { completeAssistantStreamsOnCreate, MockEventSource } from "./eventsource.test-helper.ts";

const user: SessionUser = {
  id: "maker-queue",
  username: "maker",
  display_name: "Maker",
  avatar_url: null,
  handle_confirmed: true,
  role: "user",
};

const THREAD_ID = "thread-1";
const RUN_ID = "run-1";
const MESSAGE_ID = "message-1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function baseThread() {
  return { id: THREAD_ID, title: "органайзер для свёрл", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

function baseMessages(content = "органайзер для свёрл", runs: readonly Record<string, unknown>[] = []) {
  return {
    items: [
      { id: MESSAGE_ID, thread_id: THREAD_ID, role: "user", content, run_id: null, created_at: new Date().toISOString() },
    ],
    runs,
    next_cursor: null,
  };
}

function doneRun(result: Record<string, unknown>, errorCode: string | null = null) {
  return {
    id: RUN_ID,
    thread_id: THREAD_ID,
    triggering_message_id: MESSAGE_ID,
    status: "done",
    result_type: result.kind,
    result,
    error_code: errorCode,
    confirmed_generation_id: null,
    queue_position: null,
    eta_seconds: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function evidence(entityType: string): Record<string, unknown> {
  const citation = evidenceFixture.v2.find((item) => item.entity_type === entityType);
  if (!citation) throw new Error(`missing ${entityType} fixture`);
  return citation;
}

function renderRun(result: Record<string, unknown>, question = "Расскажи подробнее", errorCode: string | null = null) {
  stashPendingRun(THREAD_ID, RUN_ID);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/assistant/threads/thread-1/runs/")) return jsonResponse({ run: doneRun(result, errorCode) });
      if (url.includes("/assistant/threads/thread-1/messages")) return jsonResponse(baseMessages(question));
      if (url.includes("/assistant/threads/thread-1")) return jsonResponse({ thread: baseThread() });
      return jsonResponse({}, 404);
    }),
  );
  render(<AssistantWorkshopScreen user={user} threadId={THREAD_ID} />);
}

function doneOfferRun(generationId: string) {
  return {
    id: RUN_ID,
    thread_id: THREAD_ID,
    triggering_message_id: MESSAGE_ID,
    status: "done",
    result_type: "generation_offer",
    result: { kind: "generation_offer", offer_id: RUN_ID, branch: "openscad", prompt_summary: "органайзер для свёрл" },
    error_code: null,
    confirmed_generation_id: generationId,
    queue_position: null,
    eta_seconds: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  MockEventSource.reset();
  completeAssistantStreamsOnCreate();
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  document.body.classList.remove("assistantWorkspaceMounted");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AssistantWorkshopScreen wait states", () => {
  it("восстанавливает завершённый ответ после reload без sessionStorage", async () => {
    const run = doneRun({ kind: "answer", text: "Исторический ответ восстановлен.", citations: [] });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/assistant/threads/thread-1/messages")) return jsonResponse(baseMessages("Что было раньше?", [run]));
      if (url.includes("/assistant/threads/thread-1")) return jsonResponse({ thread: baseThread() });
      return jsonResponse({}, 404);
    }));

    render(<AssistantWorkshopScreen user={user} threadId={THREAD_ID} />);

    expect(await screen.findByText("Исторический ответ восстановлен.")).toBeTruthy();
  });

  it.each(["queued", "running"] as const)("возобновляет SSE %s run после reload", async (status) => {
    const active = { ...doneRun({ kind: "answer", text: "", citations: [] }), status, result_type: null, result: {} };
    let runReads = 0;
    let finishRunRead!: (response: Response) => void;
    const runRead = new Promise<Response>((resolve) => { finishRunRead = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/assistant/threads/thread-1/runs/")) {
        runReads += 1;
        return runRead;
      }
      if (url.includes("/assistant/threads/thread-1/messages")) return jsonResponse(baseMessages("Продолжи", [active]));
      if (url.includes("/assistant/threads/thread-1")) return jsonResponse({ thread: baseThread() });
      return jsonResponse({}, 404);
    }));

    render(<AssistantWorkshopScreen user={user} threadId={THREAD_ID} />);

    expect(await screen.findByText("думает…")).toBeTruthy();
    expect(screen.queryByText("Не удалось разобрать ответ помощника.")).toBeNull();
    finishRunRead(jsonResponse({ run: doneRun({ kind: "answer", text: `Ответ после ${status}.`, citations: [] }) }));
    expect(await screen.findByText(`Ответ после ${status}.`)).toBeTruthy();
    expect(runReads).toBe(1);
    expect(MockEventSource.find(`/assistant/runs/${RUN_ID}/events`)?.closed).toBe(true);
  });

  it("последовательно подписывается на более старые активные runs", async () => {
    const oldMessage = { id: "message-old", thread_id: THREAD_ID, role: "user", content: "Первый вопрос", run_id: null, created_at: "2026-09-21T10:00:00.000Z" };
    const newMessage = { id: "message-new", thread_id: THREAD_ID, role: "user", content: "Второй вопрос", run_id: null, created_at: "2026-09-21T10:01:00.000Z" };
    const oldRun = { ...doneRun({}, null), id: "run-old", triggering_message_id: oldMessage.id, status: "running", result_type: null, result: {}, created_at: oldMessage.created_at };
    const newRun = { ...doneRun({}, null), id: "run-new", triggering_message_id: newMessage.id, status: "queued", result_type: null, result: {}, created_at: newMessage.created_at };
    const reads: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/assistant/threads/thread-1/runs/run-new")) {
        reads.push("run-new");
        return jsonResponse({ run: { ...doneRun({ kind: "answer", text: "Новый ответ", citations: [] }), id: "run-new", triggering_message_id: newMessage.id } });
      }
      if (url.includes("/assistant/threads/thread-1/runs/run-old")) {
        reads.push("run-old");
        return jsonResponse({ run: { ...doneRun({ kind: "answer", text: "Старый ответ", citations: [] }), id: "run-old", triggering_message_id: oldMessage.id } });
      }
      if (url.includes("/assistant/threads/thread-1/messages")) return jsonResponse({ items: [oldMessage, newMessage], runs: [oldRun, newRun], next_cursor: null });
      if (url.includes("/assistant/threads/thread-1")) return jsonResponse({ thread: baseThread() });
      return jsonResponse({}, 404);
    }));

    render(<AssistantWorkshopScreen user={user} threadId={THREAD_ID} />);

    expect(await screen.findByText("Новый ответ")).toBeTruthy();
    expect(await screen.findByText("Старый ответ")).toBeTruthy();
    expect(reads).toEqual(["run-new", "run-old"]);
    expect(MockEventSource.instances.filter((source) => source.url.includes("/assistant/runs/")).map((source) => source.url)).toEqual([
      expect.stringContaining("/assistant/runs/run-new/events"),
      expect.stringContaining("/assistant/runs/run-old/events"),
    ]);
  });

  it("восстанавливает подтверждённую генерацию после reload", async () => {
    const run = doneOfferRun("generation-history");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/assistant/threads/thread-1/messages")) return jsonResponse(baseMessages("Собери модель", [run]));
      if (url.includes("/assistant/threads/thread-1")) return jsonResponse({ thread: baseThread() });
      if (url.includes("/generations/generation-history")) {
        return jsonResponse({
          generation: {
            id: "generation-history",
            branch: "openscad",
            prompt: "органайзер",
            params: {},
            status: "queued",
            preview_url: null,
            artifact_url: null,
            error: null,
            error_code: null,
            queue_position: 2,
            eta_seconds: 80,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });
      }
      return jsonResponse({}, 404);
    }));

    render(<AssistantWorkshopScreen user={user} threadId={THREAD_ID} />);

    expect(await screen.findByRole("heading", { name: "Ваш запрос в очереди" })).toBeTruthy();
  });

  it("запускает generation offer только отдельным подтверждением", async () => {
    stashPendingRun(THREAD_ID, RUN_ID);
    let confirmations = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/assistant/threads/${THREAD_ID}/generations`) && init?.method === "POST") {
        confirmations += 1;
        return jsonResponse({
          generation: {
            id: "generation-confirmed",
            branch: "openscad",
            prompt: "органайзер",
            params: {},
            status: "queued",
            preview_url: null,
            artifact_url: null,
            error: null,
            error_code: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });
      }
      if (url.includes("/assistant/threads/thread-1/runs/")) {
        return jsonResponse({ run: doneRun({ kind: "generation_offer", offer_id: RUN_ID, branch: "openscad", prompt_summary: "органайзер" }) });
      }
      if (url.includes("/assistant/threads/thread-1/messages")) return jsonResponse(baseMessages());
      if (url.includes("/assistant/threads/thread-1")) return jsonResponse({ thread: baseThread() });
      if (url.includes("/generations/generation-confirmed")) return jsonResponse({ generation: null });
      return jsonResponse({}, 404);
    }));

    render(<AssistantWorkshopScreen user={user} threadId={THREAD_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Начать генерацию" }));
    await waitFor(() => expect(confirmations).toBe(1));
  });

  it("показывает позицию и ETA из job-контракта", async () => {
    stashPendingRun(THREAD_ID, RUN_ID);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/assistant/threads/thread-1/runs/")) return jsonResponse({ run: doneOfferRun("generation-1") });
        if (url.includes("/assistant/threads/thread-1/messages")) return jsonResponse(baseMessages());
        if (url.includes("/assistant/threads/thread-1")) return jsonResponse({ thread: baseThread() });
        if (url.includes("/generations/generation-1")) {
          return jsonResponse({
            generation: {
              id: "generation-1",
              branch: "openscad",
              prompt: "органайзер для свёрл",
              params: {},
              status: "queued",
              preview_url: null,
              artifact_url: null,
              error: null,
              error_code: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              queue_position: 3,
              eta_seconds: 170,
            },
          });
        }
        return jsonResponse({}, 404);
      }),
    );

    render(<AssistantWorkshopScreen user={user} threadId={THREAD_ID} />);

    expect(await screen.findByRole("heading", { name: "Ваш запрос в очереди" })).toBeTruthy();
    expect(screen.getByText("Перед вами 2. Как только освободится генератор, работа начнётся автоматически.")).toBeTruthy();
    expect(screen.getByText("Примерно через 3 минуты")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Прогресс генерации" })).toBeTruthy();
  });

  it("не теряет задачу при временной сетевой ошибке генерации", async () => {
    stashPendingRun(THREAD_ID, RUN_ID);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/assistant/threads/thread-1/runs/")) return jsonResponse({ run: doneOfferRun("generation-offline") });
        if (url.includes("/assistant/threads/thread-1/messages")) return jsonResponse(baseMessages());
        if (url.includes("/assistant/threads/thread-1")) return jsonResponse({ thread: baseThread() });
        if (url.includes("/generations/generation-offline")) {
          return jsonResponse({
            generation: {
              id: "generation-offline",
              branch: "openscad",
              prompt: "держатель",
              params: {},
              status: "queued",
              preview_url: null,
              artifact_url: null,
              error: null,
              error_code: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          });
        }
        return jsonResponse({}, 404);
      }),
    );

    render(<AssistantWorkshopScreen user={user} threadId={THREAD_ID} />);

    await waitFor(() => expect(MockEventSource.find("/generations/generation-offline/events")).toBeTruthy());
    MockEventSource.find("/generations/generation-offline/events")?.fail();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Связь прервалась — задача не потеряна" })).toBeTruthy();
    });
    expect(screen.getByText("Продолжаем проверять в фоне. Можно закрыть мастерскую и вернуться из раздела «Чаты».")).toBeTruthy();
  });
});

describe("AssistantWorkshopScreen portal evidence", () => {
  it("показывает сравнение материалов таблицей", async () => {
    renderRun({
      kind: "answer",
      text: "Сравнение материалов\n\n| Характеристика | ABS | PLA |\n| --- | --- | --- |\n| Температура сопла | 230–260 °C | 200–220 °C |\n\nТемпературы — медианы диапазонов из заполненных карточек портала.",
      citations: [],
    }, "Сравни ABS и PLA");

    const table = await screen.findByRole("table");
    expect(table.textContent).toContain("Температура сопла");
    expect(table.textContent).toContain("230–260 °C");
    expect(table.textContent).not.toContain("|");
  });

  it("показывает неоднозначное название как отдельное уточнение", async () => {
    renderRun({ kind: "clarification", question: "Какой K1 вы имеете в виду: Creality K1 или K1 Max?", reason: "Найдено несколько принтеров" }, "Расскажи про K1");

    expect(await screen.findByText("Нужно уточнение")).toBeTruthy();
    expect(screen.getByText("Какой K1 вы имеете в виду: Creality K1 или K1 Max?")).toBeTruthy();
    expect(screen.getByText("Найдено несколько принтеров")).toBeTruthy();
    expect(screen.getByText("Нужно уточнение").closest(".assistantMessage")?.getAttribute("data-state")).toBe("clarification");
  });

  it("сохраняет порядок сравнения в продолжении диалога", async () => {
    const comparison = evidence("comparison");
    const facts = comparison.facts as { rows: { field: string; cells: Record<string, unknown>[] }[] };
    renderRun({ kind: "answer", text: "Второй принтер дешевле.", citations: [{
      ...comparison,
      facts: {
        ...comparison.facts as Record<string, unknown>,
        rows: facts.rows.map((row) => row.field === "supported_materials" ? {
          ...row,
          cells: [
            { state: "different", normalized_value: "PLA,PETG", display_value: "PLA, PETG", unit: null },
            { state: "different", normalized_value: "ABS", display_value: "ABS", unit: null },
          ],
        } : row),
      },
      source_refs: [{ label: "3d-diy.ru", url: "https://3d-diy.ru/product/3d-printer-bambu-lab-p1s" }],
      source_published_at: "2026-09-04T00:00:00Z",
      observed_at: "2026-09-04T00:00:00Z",
      missing_fields: ["price_ru_rub", "price_msrp_usd", "max_bed_temperature_c", "nozzle", "supported_materials"],
    }] }, "А второй дешевле?");

    const table = await screen.findByRole("table", { name: "P1S и K1" });
    expect(Array.from(table.querySelectorAll("thead th"), (heading) => heading.textContent)).toEqual(["", "Bambu Lab P1S", "Creality K1"]);
    expect(table.textContent).not.toContain("Параметр");
    expect(table.textContent).toContain("89 990 ₽");
    expect(table.textContent).toContain("59 990 ₽");
    expect(table.textContent).not.toContain("Нет данных");
    expect(table.textContent).toContain("—");
    expect(table.querySelector('a[href="/materials?type=pla&kind=filament"]')?.textContent).toBe("PLA");
    expect(table.querySelector('a[href="/materials?type=petg&kind=filament"]')?.textContent).toBe("PETG");
    expect(table.querySelector('a[href="/materials?type=abs&kind=filament"]')?.textContent).toBe("ABS");
    const card = table.closest(".assistantEvidenceCard");
    expect(card?.textContent).not.toContain("Источник");
    expect(card?.textContent).not.toContain("На дату");
    expect(card?.textContent).not.toContain("Нет данных:");
    expect(card?.textContent).not.toContain("3d-diy.ru");
  });

  it("показывает основные параметры принтера без служебных полей и пустых характеристик", async () => {
    const printer = evidence("printer");
    renderRun({ kind: "answer", text: "Карточка принтера.", citations: [{
      ...printer,
      facts: {
        ...(printer.facts as Record<string, unknown>),
        max_hotend_temperature_c: 300,
        max_bed_temperature_c: 100,
        nozzle_hardened: true,
        unique_features: ["Закрытый корпус", "Автокалибровка"],
      },
      missing_fields: ["nozzle_material", "chamber_temperature_c"],
    }] });

    const card = (await screen.findByRole("link", { name: "Bambu Lab P1S" })).closest(".assistantEvidenceCard");
    expect(card?.textContent).toContain("Область печати");
    expect(card?.textContent).toContain("256 × 256 × 256 мм");
    expect(card?.textContent).toContain("Сопло до300 °C");
    expect(card?.textContent).toContain("Стол до100 °C");
    expect(card?.textContent).toContain("СоплоЗакалённое");
    expect(card?.textContent).toContain("Автокалибровка");
    expect(card?.textContent).toContain("Цена устарела");
    expect(card?.textContent).not.toContain("Источник");
    expect(card?.textContent).not.toContain("На дату");
    expect(card?.textContent).not.toContain("Качество");
    expect(card?.textContent).not.toContain("Нет данных");
    expect(screen.getByRole("link", { name: "PLA" }).getAttribute("href")).toBe("/materials?type=pla&kind=filament");
  });

  it("не превращает неполную совместимость в положительный вывод", async () => {
    renderRun({ kind: "answer", text: "Совместимость определить нельзя: недостаточно данных.", citations: [evidence("machine")] }, "Подойдёт ли абразивный пластик?");

    const answer = await screen.findByText("Совместимость определить нельзя: недостаточно данных.");
    expect(answer.closest(".assistantMessage")?.getAttribute("data-state")).toBe("incomplete");
    expect(answer.closest(".assistantMessage")?.textContent).not.toContain("Нет данных:");
    expect(screen.getByText("Совместимость определить нельзя: недостаточно данных.")).toBeTruthy();
  });

  it("показывает опубликованную новость без источника и даты", async () => {
    renderRun({ kind: "answer", text: "За период вышла одна новость.", citations: [evidence("news")] }, "Что нового?");

    expect(await screen.findByText("Новость")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Вышел новый принтер" }).getAttribute("href")).toBe("/feed/new-printer-release");
    const card = screen.getByRole("link", { name: "Вышел новый принтер" }).closest(".assistantEvidenceCard");
    expect(card?.textContent).not.toContain("Источник");
    expect(card?.textContent).not.toContain("На дату");
    expect(card?.textContent).not.toContain("Нет данных:");
    expect(screen.queryByRole("link", { name: "Оригинальная публикация" })).toBeNull();
    expect(screen.getByText("Данные актуальны")).toBeTruthy();
  });

  it("показывает карточку опубликованного филамента", async () => {
    renderRun({ kind: "answer", text: "Подходящий вариант из каталога.", citations: [evidence("material")] }, "Подбери PLA");

    expect(await screen.findByText("Филамент")).toBeTruthy();
    expect(screen.getByRole("link", { name: "PLA Basic Black" }).getAttribute("href")).toBe("/materials/pla-basic-black");
    expect(screen.getByRole("link", { name: "PLA" }).getAttribute("href")).toBe("/materials?type=pla&kind=filament");
    expect(screen.getByText("1,75 мм")).toBeTruthy();
    expect(screen.getByText("1 990 ₽")).toBeTruthy();
  });

  it("не показывает технические поля в неполной карточке филамента", async () => {
    const material = { ...evidence("material") };
    delete material.freshness;
    delete material.freshness_reason;
    renderRun({ kind: "answer", text: "Нашёл филамент.", citations: [{
      ...material,
      title: "Bestfilament ABS",
      snippet: "abs; material.extruder_temp_max_c; material.diameter_mm; material.fill_type",
      facts: { kind: "material", material_type: "abs", diameter_mm: null, color: null, price_ru_rub: null },
      price_updated_at: null,
      missing_fields: ["material.extruder_temp_max_c", "material.diameter_mm", "material.fill_type", "confirmed_machine", "machine.max_hotend_temp_c", "machine.filament_dia_mm"],
    }] }, "Найди ABS");

    const card = (await screen.findByRole("link", { name: "Bestfilament ABS" })).closest(".assistantEvidenceCard");
    expect(card?.textContent).toContain("МатериалABS");
    expect(card?.querySelector('a[href="/materials?type=abs&kind=filament"]')?.textContent).toBe("ABS");
    expect(card?.textContent).not.toContain("material.");
    expect(card?.textContent).toContain("подтверждённая модель принтера");
    expect(card?.textContent).toContain("максимальная температура сопла принтера");
    expect(card?.textContent).not.toContain("machine.");
    expect(card?.textContent).not.toContain("Нет данных");
  });

  it("компактно воспроизводит legacy citation", async () => {
    renderRun({ kind: "answer", text: "Сохранённый ответ.", citations: [evidenceFixture.legacy] });

    const title = await screen.findByText("Подставка для телефона");
    expect(title.closest(".assistantEvidenceCard")?.getAttribute("data-evidence-kind")).toBe("legacy-model");
    expect(screen.getByText("Готовая модель из каталога")).toBeTruthy();
  });
});

describe("AssistantWorkshopScreen distinct result states", () => {
  it("показывает успешный пустой диапазон новостей отдельно от ошибки", async () => {
    renderRun({ kind: "answer", text: "За выбранный период ничего не опубликовано.", citations: [] }, "Новости за неделю");

    const copy = await screen.findByText("За выбранный период ничего не опубликовано.");
    expect(copy.closest(".assistantMessage")?.getAttribute("data-state")).toBe("empty-news");
    expect(screen.getByText("Период проверен")).toBeTruthy();
  });

  it("показывает деградированный ответ только с сохранёнными доказательствами", async () => {
    renderRun({
      kind: "answer",
      text: "AI-провайдер недоступен. Найденные в каталоге записи: Bambu Lab P1S",
      citations: [evidence("printer")],
      note: "Показаны данные каталога без AI-синтеза ответа.",
    });

    expect(await screen.findByText("Источник недоступен. Показаны только найденные данные портала.")).toBeTruthy();
    expect(screen.getByText("Ответ по данным каталога")).toBeTruthy();
  });

  it("различает retryable provider error и стабильный tool error", async () => {
    renderRun({ kind: "error", code: "provider_timeout", message: "redacted", retryable: true }, "Повтори", "provider_timeout");
    expect(await screen.findByText("Источник недоступен. Попробуйте отправить вопрос ещё раз.")).toBeTruthy();
    cleanup();
    window.sessionStorage.clear();

    renderRun({ kind: "error", code: "tool_error", message: "redacted", retryable: false }, "Найди принтер", "tool_error");
    expect(await screen.findByText("Инструмент каталога недоступен. Поиск не завершён — это не означает, что данных нет.")).toBeTruthy();
    expect(screen.queryByText("За выбранный период ничего не опубликовано.")).toBeNull();
  });
});
