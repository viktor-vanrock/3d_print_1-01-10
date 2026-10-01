import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  isAssistantAnswer,
  isAssistantClarification,
  isAssistantEvidenceCitation,
  isAssistantError,
  isAssistantGenerationOffer,
  type AssistantCitation,
  type AssistantEvidenceCitation,
  type AssistantMessage,
  type AssistantRun,
  type AssistantThread
} from "@portal/contracts/http/assistant";
import type { SessionUser } from "@shared/types";
import { useOverlay } from "@platform/overlay";
import {
  ASSISTANT_RATE_LIMIT_MESSAGE,
  confirmGeneration,
  getRun,
  getThread,
  listMessages,
  sendMessage,
  subscribeAssistantRunEvents,
  takePendingRun,
  type ConfirmGenerationResult,
} from "./assistantapi.ts";
import {
  apiAssetUrl,
  getGeneration,
  isTerminalGeneration,
  subscribeGenerationEvents,
  type Generation,
  type GenerationPhase,
} from "../generate/generations.ts";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): ai→commerce ModelViewer (предпросмотр 3D-генерации в мастерской переиспользует вьювер моделей каталога), развязка отложена до pages/DI. См. MIGRATION.md.
import { ModelViewer } from "@domains/commerce";
import { assistantChatsPath, navigate, navigateWithTransition } from "../../../router.ts";
import { AuroraBackground, Button, MarkdownBody } from "@shared/ui";
import {
  COMPARISON_FIELD_LABELS,
  evidenceFreshnessLabel,
} from "./types.ts";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- CSS side-effect, не index.ts; легатное ребро ai→commerce (Этап 9), см. выше.
import "../../commerce/model.css";
import "./assistant.css";

type PollState = "idle" | "syncing" | "connected" | "retrying";

export function AssistantWorkshopScreen({
  user: _user,
  threadId,
  embedded = false,
}: {
  user: SessionUser;
  threadId: string;
  embedded?: boolean;
}) {
  const overlay = useOverlay();
  const [thread, setThread] = useState<AssistantThread | null | undefined>(undefined);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [runsByMessageId, setRunsByMessageId] = useState<Record<string, AssistantRun>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [generationsByRunId, setGenerationsByRunId] = useState<Record<string, Generation>>({});
  const [pollStatesByRunId, setPollStatesByRunId] = useState<Record<string, PollState>>({});
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const pendingRunIdsRef = useRef<string[]>([]);

  // Загрузка треда, истории сообщений и связанных run'ов. API — источник восстановления после
  // reload; sessionStorage остаётся только быстрым handoff для только что созданного run.
  useEffect(() => {
    let cancelled = false;
    setThread(undefined);
    setMessages([]);
    setRunsByMessageId({});
    setActiveRunId(null);
    pendingRunIdsRef.current = [];
    setGenerationsByRunId({});
    setPollStatesByRunId({});
    (async () => {
      const loaded = await getThread(threadId);
      if (cancelled) return;
      setThread(loaded);
      if (!loaded) return;
      const history = await listMessages(threadId);
      if (cancelled) return;
      const items = [...(history?.items ?? [])];
      const runs = [...(history?.runs ?? [])];
      setMessages(items);
      setRunsByMessageId(Object.fromEntries(runs.map((run) => [run.triggering_message_id, run])));
      const activeRunIds = runs.filter((run) => run.status === "queued" || run.status === "running").map((run) => run.id);
      const pendingRunId = takePendingRun(threadId);
      const pendingAlreadyLoaded = pendingRunId !== null && runs.some((run) => run.id === pendingRunId);
      if (pendingRunId && !pendingAlreadyLoaded && activeRunIds.length === 0) activeRunIds.push(pendingRunId);
      setActiveRunId(activeRunIds.pop() ?? null);
      pendingRunIdsRef.current = activeRunIds;
      for (const confirmedRun of [...runs].reverse()) {
        if (!confirmedRun.confirmed_generation_id) continue;
        const existing = await getGeneration(confirmedRun.confirmed_generation_id);
        if (cancelled) return;
        if (existing) {
          setGenerationsByRunId((current) => ({ ...current, [confirmedRun.id]: existing }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, activeRunId]);

  // Статус активного run приходит по SSE. Terminal-событие не содержит весь run,
  // поэтому после него читаем финальный снимок ровно один раз.
  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    let finalized = false;
    const runId = activeRunId;
    const finalize = async (run: AssistantRun) => {
      if (cancelled || finalized) return;
      finalized = true;
      setRunsByMessageId((current) => ({ ...current, [run.triggering_message_id]: run }));
      setActiveRunId(pendingRunIdsRef.current.pop() ?? null);
      if (run.confirmed_generation_id) {
        const existing = await getGeneration(run.confirmed_generation_id);
        if (!cancelled && existing) {
          setGenerationsByRunId((current) => ({ ...current, [run.id]: existing }));
        }
      }
    };
    const close = subscribeAssistantRunEvents(runId, {
      onSnapshot: (run) => {
        if (cancelled) return;
        setRunsByMessageId((current) => ({ ...current, [run.triggering_message_id]: run }));
        if (run.status === "done" || run.status === "error") void finalize(run);
      },
      onTerminal: () => {
        void getRun(threadId, runId).then((run) => {
          if (run) void finalize(run);
        });
      },
    });
    return () => {
      cancelled = true;
      close();
    };
  }, [activeRunId, threadId]);

  // Каждая подтверждённая генерация остаётся привязанной к своему сообщению.
  const activeGenerationKeys = Object.entries(generationsByRunId)
    .filter(([, item]) => !isTerminalGeneration(item))
    .map(([runId, item]) => `${runId}:${item.id}`)
    .join("|");

  useEffect(() => {
    const closes = Object.entries(generationsByRunId)
      .filter(([, item]) => !isTerminalGeneration(item))
      .map(([runId, item]) => {
        setPollStatesByRunId((current) => ({ ...current, [runId]: "syncing" }));
        return subscribeGenerationEvents(item.id, {
          onGeneration: (updated) => {
            setGenerationsByRunId((current) => current[runId]?.id === updated.id
              ? { ...current, [runId]: updated }
              : current);
          },
          onConnectionState: (state) => {
            setPollStatesByRunId((current) => ({
              ...current,
              [runId]: state === "retrying" ? "retrying" : state === "connected" ? "connected" : "syncing",
            }));
          },
        });
      });
    return () => { closes.forEach((close) => close()); };
    // Подписки меняются только при добавлении или завершении генерации.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGenerationKeys]);

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "user") ?? null,
    [messages],
  );
  const currentRun = lastUserMessage ? (runsByMessageId[lastUserMessage.id] ?? null) : null;
  const isThinking = activeRunId !== null;
  const generation = currentRun ? (generationsByRunId[currentRun.id] ?? null) : null;
  const pollState = currentRun ? (pollStatesByRunId[currentRun.id] ?? "idle") : "idle";

  if (thread === undefined) {
    return (
      <main className="assistantWorkshopMissing" aria-busy="true">
        <WorkshopCubeGlyph size={48} />
        <h1>Загружаем чат…</h1>
      </main>
    );
  }

  if (!thread) {
    return (
      <main className="assistantWorkshopMissing">
        <WorkshopCubeGlyph size={48} />
        <h1>Чат не найден</h1>
        <p>Он мог быть удалён или принадлежит другому аккаунту.</p>
        <Button variant="primary" icon={null} onClick={() => navigate("/")}>На главную</Button>
      </main>
    );
  }

  async function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    const value = draft.trim();
    if (!value || !thread || isThinking) return;
    setDraft("");
    const result = await sendMessage(thread.id, value);
    if ("error" in result) {
      setDraft(value);
      if (result.error === "RATE_LIMITED") {
        overlay.toast({ severity: "warn", title: "Лимит запросов к ГигаЧату", message: ASSISTANT_RATE_LIMIT_MESSAGE });
      } else {
        overlay.toast({ severity: "warn", title: "Запрос не отправился", message: "Попробуйте ещё раз." });
      }
      return;
    }
    setMessages((current) => [...current, result.message]);
    if (result.run) {
      pendingRunIdsRef.current = [];
      setActiveRunId(result.run.id);
    }
  }

  async function startGeneration(run: AssistantRun, messageId: string) {
    if (!thread || submitting || !isAssistantGenerationOffer(run.result) || run.confirmed_generation_id) return;
    setSubmitting(true);
    const result: ConfirmGenerationResult = await confirmGeneration(thread.id, run.id);
    setSubmitting(false);
    if ("error" in result) return;
    setGenerationsByRunId((current) => ({ ...current, [run.id]: result.generation }));
    setRunsByMessageId((current) => ({
      ...current,
      [messageId]: { ...run, confirmed_generation_id: result.generation.id },
    }));
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || composingRef.current) return;
    event.preventDefault();
    void submitMessage();
  }

  const title = thread.title ?? "Новый чат";
  const stageLabel = workshopStageLabel({ isThinking, currentRun, generation, pollState });

  const conversation = (
    <section className="assistantUnifiedConversation" data-embedded={embedded || undefined} aria-label="Чат с ГигаЧатом">
      <header className="assistantUnifiedHead">
        <div>
          <strong>{title}</strong>
          <span><i data-active={isThinking || (generation && generation.status !== "done") || undefined} />{stageLabel}</span>
        </div>
      </header>

      <div ref={logRef} className="assistantUnifiedLog" role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 ? (
          <p className="assistantEmptyLog">Напишите, что нужно — вопрос про принтер, проект или новая модель.</p>
        ) : null}
        {messages.map((message) => {
          const run = runsByMessageId[message.id];
          const streaming = isThinking && (run ? run.id === activeRunId : message.id === lastUserMessage?.id);
          const runGeneration = run ? generationsByRunId[run.id] : null;
          const modelTitle = run && isAssistantGenerationOffer(run.result) ? run.result.prompt_summary : title;
          return (
            <Fragment key={message.id}>
              <MessageThread message={message} run={run} streaming={streaming} />
              {run && isAssistantGenerationOffer(run.result) && !run.confirmed_generation_id ? (
                <div className="assistantOfferAction">
                  <div>
                    <strong>Можно собрать 3D-модель</strong>
                    <span>{run.result.note ?? "Сначала проверьте идею — генерация запускается отдельно."}</span>
                  </div>
                  <Button variant="primary" icon={null} onClick={() => void startGeneration(run, message.id)} disabled={submitting}>
                    {submitting ? "Запускаем…" : "Начать генерацию"}
                  </Button>
                </div>
              ) : null}
              {runGeneration?.status === "done" && (runGeneration.artifact_url || runGeneration.preview_url) ? (
                <section className="assistantInlineArtifact" aria-label="Готовая 3D-модель">
                  <div className="assistantInlineViewer">
                    <ModelViewer
                      modelId={runGeneration.id}
                      title={modelTitle}
                      previewUrl={
                        runGeneration.branch === "openscad"
                          ? runGeneration.artifact_url
                          : runGeneration.branch === "trellis" || runGeneration.branch === "rudalle"
                            ? (runGeneration.preview_url ?? runGeneration.artifact_url)
                            : runGeneration.preview_url
                      }
                      thumbUrl={null}
                      format={runGeneration.branch === "openscad" ? "stl" : "gltf"}
                    />
                  </div>
                  <div className="assistantInlineArtifactMeta">
                    <span className="assistantKicker">Готовый результат</span>
                    <strong>{modelTitle}</strong>
                    {runGeneration.artifact_url ? <a href={apiAssetUrl(runGeneration.artifact_url)} download>Скачать модель</a> : null}
                  </div>
                </section>
              ) : run && runGeneration && runGeneration.status !== "done" ? (
                <WaitingExperience generation={runGeneration} pollState={pollStatesByRunId[run.id] ?? "idle"} />
              ) : null}
            </Fragment>
          );
        })}
      </div>

      <form className="assistantUnifiedComposer" onSubmit={submitMessage}>
        <button type="button" className="assistantGigaAttach pressable" aria-label="Прикрепить файл" title="Прикрепить файл">＋</button>
        <textarea
          aria-label="Сообщение помощнику"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          placeholder={messages.length === 0 ? "Спросите ГигаЧат" : "Продолжить разговор"}
          rows={1}
          disabled={isThinking}
        />
        <button type="submit" className="assistantComposerSend pressable" aria-label="Отправить сообщение" disabled={!draft.trim() || isThinking}>↑</button>
      </form>
      <small className="assistantUnifiedDisclaimer">ГигаЧат может ошибаться — важные параметры печати лучше проверить.</small>
    </section>
  );

  if (embedded) return conversation;

  return (
    <div className="assistantConversationPage">
      <AuroraBackground />
      <header className="assistantConversationTopbar">
        <button type="button" className="assistantBackButton pressable" onClick={() => navigateWithTransition(assistantChatsPath(), "back")}>← Чаты</button>
        <button type="button" className="assistantTopbarButton pressable" onClick={() => navigate("/")}>Закрыть</button>
      </header>
      <main className="assistantConversationPageMain">{conversation}</main>
    </div>
  );
}

function workshopStageLabel({
  isThinking,
  currentRun,
  generation,
  pollState,
}: {
  isThinking: boolean;
  currentRun: AssistantRun | null;
  generation: Generation | null;
  pollState: PollState;
}): string {
  if (generation?.status === "done") return "Результат готов";
  if (generation?.status === "error") return "Нужен повтор";
  if (generation) return pollState === "retrying" ? "Восстанавливаем связь" : generation.status === "queued" ? "В очереди" : phaseLabel(generation.phase);
  if (isThinking) return "Помощник думает…";
  if (currentRun && isAssistantGenerationOffer(currentRun.result)) return "Готово к запуску";
  return "Чат";
}

function MessageThread({
  message,
  run,
  streaming,
}: {
  message: AssistantMessage;
  run: AssistantRun | undefined;
  streaming: boolean;
}) {
  return (
    <>
      <MessageBubble role="user" body={visibleMessageContent(message.content)} />
      {streaming || run?.status === "queued" || run?.status === "running" ? <ThinkingBubble /> : run ? <RunReply run={run} /> : null}
    </>
  );
}

function visibleMessageContent(content: string): string {
  return content.replace(/^\[[^\n]+\]\n/, "");
}

function RunReply({ run }: { run: AssistantRun }) {
  const result = run.result;
  if (isAssistantClarification(result)) {
    return (
      <MessageBubble role="assistant" body={result.question} state="clarification" kicker="Нужно уточнение">
        {result.reason ? <span className="assistantReplyDetail">{result.reason}</span> : null}
      </MessageBubble>
    );
  }
  if (isAssistantAnswer(result)) {
    const state = answerState(result.text, result.note, result.citations);
    return (
      <MessageBubble
        role="assistant"
        body={result.text}
        markdown={result.text.startsWith("Сравнение материалов\n")}
        state={state}
        kicker={state === "degraded" ? "Ответ по данным каталога" : state === "empty-news" ? "Период проверен" : undefined}
      >
        {state === "degraded" ? <span className="assistantReplyDetail">Источник недоступен. Показаны только найденные данные портала.</span> : null}
        {result.citations.length > 0 ? (
          <div className="assistantEvidenceList" aria-label="Материалы ответа">
            {result.citations.map((citation) => <EvidenceCard key={citationKey(citation)} citation={citation} />)}
          </div>
        ) : null}
      </MessageBubble>
    );
  }
  if (isAssistantGenerationOffer(result)) {
    return <MessageBubble role="assistant" body={result.note ?? `Предлагаю собрать: «${result.prompt_summary}».`} />;
  }
  if (isAssistantError(result)) {
    const state = result.code === "tool_error" ? "tool-error" : "provider-error";
    return <MessageBubble role="assistant" body={runErrorCopy(result.code, result.retryable)} state={state} kicker={state === "tool-error" ? "Ошибка источника" : "Ошибка ответа"} />;
  }
  return <MessageBubble role="assistant" body="Не удалось разобрать ответ помощника." />;
}

function answerState(text: string, note: string | null | undefined, citations: AssistantCitation[]): "answer" | "incomplete" | "empty-news" | "degraded" {
  if (note?.includes("без AI-синтеза") || text.includes("AI-провайдер недоступен")) return "degraded";
  if (isSuccessfulEmptyNews(text, citations)) return "empty-news";
  if (citations.some((citation) => isAssistantEvidenceCitation(citation) && !["printer", "comparison"].includes(citation.facts.kind) && citation.missing_fields.length > 0)) return "incomplete";
  return "answer";
}

function isSuccessfulEmptyNews(text: string, citations: AssistantCitation[]): boolean {
  return citations.length === 0 && text.toLocaleLowerCase("ru-RU").includes("ничего не опубликовано");
}

function runErrorCopy(errorCode: string | null, retryable = false): string {
  if (errorCode === "tool_error") return "Инструмент каталога недоступен. Поиск не завершён — это не означает, что данных нет.";
  if (errorCode === "provider_timeout" || errorCode === "provider_error") {
    return retryable ? "Источник недоступен. Попробуйте отправить вопрос ещё раз." : "Источник недоступен. Ответ сейчас получить нельзя.";
  }
  if (errorCode === "invalid_output") return "Получился нечитаемый ответ. Переформулируйте вопрос, пожалуйста.";
  return "Не удалось получить ответ. Можно попробовать ещё раз.";
}

function citationKey(citation: AssistantCitation): string {
  return isAssistantEvidenceCitation(citation) ? citation.evidence_id : citation.model_id;
}

function EvidenceCard({ citation }: { citation: AssistantCitation }) {
  if (!isAssistantEvidenceCitation(citation)) {
    return (
      <article className="assistantEvidenceCard assistantEvidenceCard--legacy" data-evidence-kind="legacy-model">
        <strong>{citation.title}</strong>
        {citation.snippet ? <p>{citation.snippet}</p> : null}
        {citation.source_url ? <a href={citation.source_url}>Открыть модель</a> : null}
      </article>
    );
  }

  const printer = citation.facts.kind === "printer";
  const cardUrl = citation.canonical_url;
  return (
    <article className="assistantEvidenceCard" data-evidence-kind={citation.entity_type}>
      <header>
        <span>{evidenceKindLabel(citation.entity_type)}</span>
        {cardUrl ? <a href={cardUrl}>{citation.title}</a> : <strong>{citation.title}</strong>}
      </header>
      {!printer && citation.facts.kind !== "material" && citation.snippet ? <p>{citation.snippet}</p> : null}
      {citation.facts.kind === "comparison" ? <ComparisonFacts citation={citation} /> : <EvidenceFacts citation={citation} />}
      {citation.facts.kind === "printer" ? (
        citation.facts.price_ru_rub && citation.freshness === "stale"
          ? <p className="assistantEvidencePriceNote">{evidenceFreshnessLabel(citation.freshness)}</p>
          : null
      ) : null}
      {!printer && citation.facts.kind !== "comparison" && citation.freshness ? (
        <p className="assistantEvidenceFreshness" data-freshness={citation.freshness}>{evidenceFreshnessLabel(citation.freshness)}</p>
      ) : null}
    </article>
  );
}

function ComparisonFacts({ citation }: { citation: AssistantEvidenceCitation }) {
  if (citation.facts.kind !== "comparison") return null;
  const comparison = citation.facts;
  const identityRow = comparison.rows.find((row) => row.field === "identity");
  const printTypeRow = comparison.rows.find((row) => row.field === "print_type");
  return (
    <div className="assistantComparisonScroll">
      <table className="assistantComparison" aria-label={citation.title}>
        <thead><tr><th aria-hidden="true" />{comparison.printer_ids.map((id, index) => <th key={id}>{identityRow?.cells[index]?.display_value?.trim() || id}</th>)}</tr></thead>
        <tbody>
          {comparison.rows.map((row) => (
            <tr key={row.field}>
              <th>{COMPARISON_FIELD_LABELS[row.field]}</th>
              {row.cells.map((cell, index) => <td key={`${row.field}-${comparison.printer_ids[index]}`} data-state={cell.state} aria-label={cell.display_value ?? (cell.state === "missing" ? "Значение не указано" : undefined)}>
                {row.field === "supported_materials" && cell.display_value
                  ? cell.display_value.split(/\s*[,;]\s*/).filter(Boolean).map((material, materialIndex) => (
                    <span key={`${material}-${materialIndex}`}>{materialIndex > 0 ? ", " : null}<a href={materialCatalogUrl(material, materialKindFromPrintType(printTypeRow?.cells[index]?.display_value))}>{material}</a></span>
                  ))
                  : cell.display_value ?? "—"}
              </td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceFacts({ citation }: { citation: AssistantEvidenceCitation }) {
  const facts = citation.facts;
  if (facts.kind === "printer") {
    const specs: { label: string; value: string }[] = [];
    if (facts.build_volume_mm) specs.push({ label: "Область печати", value: `${facts.build_volume_mm.x} × ${facts.build_volume_mm.y} × ${facts.build_volume_mm.z} мм` });
    if (facts.max_hotend_temperature_c != null) specs.push({ label: "Сопло до", value: `${facts.max_hotend_temperature_c} °C` });
    if (facts.max_bed_temperature_c != null) specs.push({ label: "Стол до", value: `${facts.max_bed_temperature_c} °C` });
    const nozzle = facts.nozzle_material ?? (facts.nozzle_hardened === true ? "Закалённое" : null);
    if (nozzle) specs.push({ label: "Сопло", value: nozzle });
    if (facts.enclosed != null) specs.push({ label: "Корпус", value: facts.enclosed ? "Закрытый" : "Открытый" });
    if (facts.price_ru_rub) specs.push({ label: "Цена в России", value: formatPrice(facts.price_ru_rub.amount, "RUB") });
    const materialKind = materialKindFromPrintType(facts.print_type);
    return (
      <>
        {specs.length > 0 ? <dl className="assistantPrinterSpecs">{specs.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
        {facts.supported_materials?.length ? (
          <div className="assistantPrinterGroup"><strong>Поддерживаемые материалы</strong><ul className="assistantEvidenceFacts">
            {facts.supported_materials.map((material) => <li key={material}><a href={materialCatalogUrl(material, materialKind)}>{material}</a></li>)}
          </ul></div>
        ) : null}
        {facts.unique_features?.length ? (
          <div className="assistantPrinterGroup"><strong>Особенности</strong><ul className="assistantPrinterFeatures">
            {facts.unique_features.map((feature, index) => <li key={`${index}-${feature}`}>{feature}</li>)}
          </ul></div>
        ) : null}
      </>
    );
  }
  if (facts.kind === "material") {
    const specs: { label: string; value: ReactNode }[] = [];
    if (facts.printer_label) specs.push({ label: "Для принтера", value: facts.printer_label });
    if (facts.compatibility) specs.push({ label: "Совместимость", value: materialCompatibilityLabel(facts.compatibility) });
    if (facts.material_type) specs.push({ label: "Материал", value: <a href={materialCatalogUrl(facts.material_type, "filament")}>{facts.material_type.toLocaleUpperCase("ru-RU")}</a> });
    if (facts.diameter_mm != null) specs.push({ label: "Диаметр", value: `${new Intl.NumberFormat("ru-RU").format(facts.diameter_mm)} мм` });
    if (facts.color) specs.push({ label: "Цвет", value: facts.color });
    if (facts.price_ru_rub) specs.push({ label: "Цена", value: formatPrice(facts.price_ru_rub.amount, "RUB") });
    if (facts.abrasive === true) specs.push({ label: "Особенность", value: "Абразивный" });
    return (
      <>
        {specs.length > 0 ? <dl className="assistantPrinterSpecs">{specs.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
        {facts.compatibility_reasons?.length ? (
          <div className="assistantPrinterGroup"><strong>Условия совместимости</strong><ul className="assistantEvidenceFacts">
            {facts.compatibility_reasons.map((reason, index) => <li key={`${reason.code}-${index}`} data-severity={reason.severity}>{reason.message}</li>)}
          </ul></div>
        ) : null}
        {citation.missing_fields.length > 0 ? (
          <div className="assistantPrinterGroup"><strong>Не хватает данных</strong><ul className="assistantEvidenceFacts">
            {citation.missing_fields.map((field) => <li key={field}>{materialMissingFieldLabel(field)}</li>)}
          </ul></div>
        ) : null}
      </>
    );
  }
  return facts.kind === "news" && facts.topic ? <ul className="assistantEvidenceFacts"><li>{facts.topic}</li></ul> : null;
}

function formatPrice(amount: number, currency: "RUB" | "USD"): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function materialCompatibilityLabel(compatibility: "compatible" | "conditional" | "insufficient_data"): string {
  if (compatibility === "compatible") return "Совместим";
  if (compatibility === "conditional") return "Условно совместим";
  return "Недостаточно данных";
}

function materialMissingFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    "material.extruder_temp_max_c": "максимальная температура печати материала",
    "material.diameter_mm": "диаметр филамента",
    "material.fill_type": "тип наполнения материала",
    "confirmed_machine": "подтверждённая модель принтера",
    "machine.max_hotend_temp_c": "максимальная температура сопла принтера",
    "machine.filament_dia_mm": "поддерживаемый диаметр филамента",
    "machine.nozzle_hardened": "тип сопла принтера",
    "machine.chamber": "тип камеры принтера",
    "machine.extruder_drive": "тип экструдера принтера",
  };
  return labels[field] ?? field;
}

function materialCatalogUrl(material: string, kind: "filament" | "resin"): string {
  const params = /^[A-Za-z][A-Za-z0-9-]{1,19}$/.test(material)
    ? new URLSearchParams({ type: material.toLowerCase(), kind })
    : new URLSearchParams({ q: material, kind });
  return `/materials?${params}`;
}

function materialKindFromPrintType(printType: string | null | undefined): "filament" | "resin" {
  return /\b(sla|msla|dlp|lcd|resin)\b/i.test(printType ?? "") ? "resin" : "filament";
}

function evidenceKindLabel(kind: AssistantEvidenceCitation["entity_type"]): string {
  if (kind === "comparison") return "Сравнение";
  if (kind === "material") return "Филамент";
  if (kind === "news") return "Новость";
  if (kind === "printer") return "Принтер";
  return "Данные";
}

function MessageBubble({
  role,
  body,
  children,
  state,
  kicker,
  markdown = false,
}: {
  role: "user" | "assistant";
  body: string;
  children?: ReactNode;
  state?: string;
  kicker?: string;
  markdown?: boolean;
}) {
  return (
    <article className="assistantMessage" data-role={role} data-state={state} data-markdown={markdown || undefined}>
      <span className="assistantMessageAuthor">{role === "user" ? "Вы" : "3mf"}</span>
      {kicker ? <strong className="assistantReplyKicker">{kicker}</strong> : null}
      {markdown ? <MarkdownBody source={body} /> : <p>{body}</p>}
      {children}
    </article>
  );
}

function ThinkingBubble() {
  return (
    <article className="assistantMessage" data-role="assistant" data-streaming="true">
      <span className="assistantMessageAuthor">3mf</span>
      <p className="assistantThinking" aria-live="polite">
        <span className="assistantStreamCursor" aria-hidden="true" />
        думает…
      </p>
    </article>
  );
}

function WaitingExperience({
  generation,
  pollState,
}: {
  generation: Generation;
  pollState: PollState;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(generation.created_at).getTime()) / 1000));
  const isQueued = generation.status === "queued";
  const isDelayed = (isQueued && elapsedSeconds >= 180) || (generation.status === "running" && elapsedSeconds >= 480);
  const activeStep = waitStepIndex(generation);
  const title =
    pollState === "retrying"
      ? "Связь прервалась — задача не потеряна"
      : isDelayed
        ? "Нужно немного больше времени"
        : isQueued
          ? "Ваш запрос в очереди"
          : phaseTitle(generation.phase);
  const detail =
    pollState === "retrying"
      ? "Продолжаем проверять в фоне. Можно закрыть мастерскую и вернуться из раздела «Чаты»."
      : isDelayed
        ? "Мощности заняты более сложными моделями. Место в очереди сохранено, повторно запускать запрос не нужно."
        : isQueued
          ? queueCopy(generation)
          : "Промежуточные этапы будут появляться здесь, а пояснения ассистента — приходить в чат.";

  return (
    <div className="assistantWaitExperience" data-state={pollState === "retrying" ? "retrying" : isQueued ? "queued" : "running"}>
      <div className="assistantWaitOrb" aria-hidden="true">
        <span className="assistantWaitOrbit assistantWaitOrbit--outer" />
        <span className="assistantWaitOrbit assistantWaitOrbit--inner" />
        <span className="assistantWaitCore"><WorkshopCubeGlyph size={58} /></span>
      </div>
      <div className="assistantWaitCopy">
        <span className="assistantKicker">
          {generation.queue_position && generation.queue_position > 0
            ? `Позиция ${generation.queue_position}`
            : isQueued
              ? "Очередь генерации"
              : "3D-пайплайн"}
        </span>
        <h1>{title}</h1>
        <p>{detail}</p>
        {generation.eta_seconds || isQueued ? (
          <strong className="assistantWaitEta">
            {generation.eta_seconds
              ? `Примерно через ${formatEta(generation.eta_seconds)}`
              : isDelayed
                ? "Обновим оценку, когда освободится генератор"
                : "Обычно первая версия занимает 2–4 минуты"}
          </strong>
        ) : null}
      </div>
      <ol className="assistantWaitSteps" aria-label="Этапы генерации">
        {["Очередь", "Черновая форма", "Геометрия", "Экспорт"].map((label, index) => (
          <li key={label} data-active={index === activeStep || undefined} data-done={index < activeStep || undefined}>
            <span>{index < activeStep ? "✓" : String(index + 1).padStart(2, "0")}</span>
            {label}
          </li>
        ))}
      </ol>
      <div
        className="assistantWaitProgress"
        role="progressbar"
        aria-label="Прогресс генерации"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={typeof generation.progress === "number" ? Math.round(generation.progress) : undefined}
        data-indeterminate={typeof generation.progress !== "number" || undefined}
      >
        <span style={typeof generation.progress === "number" ? { width: `${Math.max(0, Math.min(100, generation.progress))}%` } : undefined} />
      </div>
      <span className="assistantWaitBackgroundHint">Можно уйти со страницы — задача продолжится в фоне</span>
    </div>
  );
}

function queueCopy(generation: Generation): string {
  if (generation.queue_position && generation.queue_position > 1) {
    return `Перед вами ${generation.queue_position - 1}. Как только освободится генератор, работа начнётся автоматически.`;
  }
  if (generation.queue_position === 1) {
    return "Вы следующие. Подготавливаем модель и свободный генератор.";
  }
  return "Мощности ограничены, поэтому запускаем задачи по очереди. Место уже сохранено.";
}

function formatEta(seconds: number): string {
  if (seconds < 60) return "минуту";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")}`;
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function waitStepIndex(generation: Generation): number {
  if (generation.status === "queued") return 0;
  if (generation.status === "done") return 4;
  if (generation.phase === "export" || generation.phase === "validation") return 3;
  if (generation.phase === "geometry") return 2;
  return 1;
}

function phaseTitle(phase: GenerationPhase | null | undefined): string {
  if (phase === "loading") return "Подготавливаем генератор";
  if (phase === "geometry") return "Строим геометрию";
  if (phase === "validation") return "Проверяем сетку";
  if (phase === "export") return "Собираем 3D-файл";
  return "Создаём первую форму";
}

function phaseLabel(phase: GenerationPhase | null | undefined): string {
  if (phase === "loading") return "Подготавливаем";
  if (phase === "geometry") return "Строим геометрию";
  if (phase === "validation") return "Проверяем";
  if (phase === "export") return "Экспортируем";
  return "Создаём модель";
}

function WorkshopCubeGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4l8-4.6Zm0 0V12m0 9.2V12m0 0L4 7.4m8 4.6 8-4.6" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
    </svg>
  );
}
