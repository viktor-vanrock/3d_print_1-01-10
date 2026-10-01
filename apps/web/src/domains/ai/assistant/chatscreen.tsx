import { useEffect, useRef, useState, type WheelEvent } from "react";
import type { components } from "src/api/generated/openapi";
import type { SessionUser } from "@shared/types";
import { useOverlay } from "@platform/overlay";
import { HomeHeader, type Section } from "@platform/nav";
import { AuroraBackground } from "@shared/ui";
import { generatePath, navigateWithTransition } from "../../../router.ts";
import { ASSISTANT_RATE_LIMIT_MESSAGE, createThread, deleteThread, listThreads, sendMessage, stashPendingRun } from "./assistantapi.ts";
import { createModelFromDescription } from "./directgeneration.ts";
import { assistantModeUnavailableMessage, formatThreadUpdatedAt, type AssistantMode } from "./types.ts";
import { AssistantWorkshopScreen } from "./workshop.tsx";
import "./assistant.css";

function scrollCompactThreads(event: WheelEvent<HTMLDivElement>) {
  const list = event.currentTarget;
  if (list.scrollWidth <= list.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  list.scrollLeft += event.deltaY;
}

export function AssistantChatsScreen({
  user,
  section,
  onSectionChange,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  const overlay = useOverlay();
  const [threads, setThreads] = useState<components["schemas"]["AssistantThreadDto"][] | null>(null);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<AssistantMode>("giga");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearch, setThreadSearch] = useState("");
  const threadSearchInputRef = useRef<HTMLInputElement>(null);
  const threadSearchButtonRef = useRef<HTMLButtonElement>(null);
  const searchTerm = threadSearch.trim().toLocaleLowerCase("ru-RU");
  const visibleThreads = threads?.filter((thread) =>
    (thread.title ?? "Без названия").toLocaleLowerCase("ru-RU").includes(searchTerm)
  );

  useEffect(() => {
    let cancelled = false;
    void listThreads().then((items) => {
      if (!cancelled) setThreads(items ?? []);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (threadSearchOpen) threadSearchInputRef.current?.focus();
  }, [threadSearchOpen]);

  useEffect(() => {
    if (!threadSearchOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (threadSearchInputRef.current?.contains(event.target) || threadSearchButtonRef.current?.contains(event.target)) return;
      setThreadSearchOpen(false);
      setThreadSearch("");
    };
    document.addEventListener("click", closeOutside);
    return () => document.removeEventListener("click", closeOutside);
  }, [threadSearchOpen]);

  function closeThreadSearch() {
    setThreadSearchOpen(false);
    setThreadSearch("");
    threadSearchButtonRef.current?.focus();
  }

  async function handleDeleteThread(thread: components["schemas"]["AssistantThreadDto"]) {
    if (deletingThreadId || thread.kind !== "chat") return;
    setDeletingThreadId(thread.id);
    try {
      const confirmed = await overlay.confirm({
        title: "Удалить чат?",
        message: `«${thread.title ?? "Без названия"}» исчезнет из вашей истории.`,
        confirmLabel: "Удалить",
        cancelLabel: "Отмена",
        destructive: true,
      });
      if (!confirmed) return;

      if (!await deleteThread(thread.id)) {
        overlay.toast({ severity: "warn", title: "Не удалось удалить чат", message: "Попробуйте ещё раз." });
        return;
      }
      setThreads((current) => current?.filter((item) => item.id !== thread.id) ?? current);
      setActiveThreadId((current) => current === thread.id ? null : current);
    } finally {
      setDeletingThreadId(null);
    }
  }

  async function submit() {
    const value = query.trim();
    if (!value || sending) return;
    if (assistantModeUnavailableMessage(mode)) return;
    if (mode === "make") {
      setSending(true);
      const result = await createModelFromDescription(value);
      setSending(false);
      if ("error" in result) {
        overlay.toast({ severity: "warn", title: "Не удалось начать генерацию", message: result.error });
        return;
      }
      setQuery("");
      navigateWithTransition(generatePath(result.generationId), "fwd");
      return;
    }
    setSending(true);
    const created = await createThread(value.slice(0, 72));
    if ("error" in created) {
      setSending(false);
      overlay.toast(created.error === "RATE_LIMITED"
        ? { severity: "warn", title: "Лимит запросов к ГигаЧату", message: ASSISTANT_RATE_LIMIT_MESSAGE }
        : { severity: "warn", title: "Не удалось начать чат", message: "Попробуйте ещё раз." });
      return;
    }
    const thread = created.thread;
    const result = await sendMessage(thread.id, value);
    if ("error" in result) {
      setSending(false);
      overlay.toast(result.error === "RATE_LIMITED"
        ? { severity: "warn", title: "Лимит запросов к ГигаЧату", message: ASSISTANT_RATE_LIMIT_MESSAGE }
        : { severity: "warn", title: "Запрос не отправился", message: "Чат сохранён. Попробуйте ещё раз из истории." });
      return;
    }
    if (!result.run) { setSending(false); return; }
    stashPendingRun(thread.id, result.run.id);
    setThreads((current) => current ? [thread, ...current.filter((item) => item.id !== thread.id)] : [thread]);
    setQuery("");
    setSending(false);
    setActiveThreadId(thread.id);
  }

  return (
    <div className="home assistantChatsPage">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} />
      </div>
      <main className="homeWorkspaceBody assistantGigaBody">
        <aside className="assistantGigaRail" aria-label="история чатов">
          <div className="assistantGigaRailActions">
            <button type="button" className="assistantCommandNew pressable" onClick={() => { setQuery(""); setActiveThreadId(null); setThreadSearch(""); setThreadSearchOpen(false); }}><span>＋</span> Новый чат</button>
            <button
              ref={threadSearchButtonRef}
              type="button"
              className="assistantGigaSearch pressable"
              aria-label={threadSearchOpen ? "Закрыть поиск по чатам" : "Поиск по чатам"}
              aria-expanded={threadSearchOpen}
              aria-controls={threadSearchOpen ? "assistant-thread-search" : undefined}
              title={threadSearchOpen ? "Закрыть поиск" : "Поиск по чатам"}
              onClick={() => threadSearchOpen ? closeThreadSearch() : setThreadSearchOpen(true)}
            >{threadSearchOpen ? "×" : "⌕"}</button>
          </div>
          {threadSearchOpen ? (
            <input
              ref={threadSearchInputRef}
              id="assistant-thread-search"
              className="assistantGigaSearchInput"
              type="search"
              aria-label="Поиск по названиям чатов"
              placeholder="Найти чат"
              value={threadSearch}
              onChange={(event) => setThreadSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") closeThreadSearch(); }}
            />
          ) : null}
          <span className="assistantKicker">Недавние</span>
          <div className="assistantGigaThreads" onWheel={scrollCompactThreads}>
            {visibleThreads === undefined ? <span className="assistantGigaLoading">Загружаем историю…</span> : visibleThreads.length === 0 ? (
              <span className="assistantGigaLoading" role="status">{searchTerm ? "Чаты не найдены" : "Пока нет чатов"}</span>
            ) : visibleThreads.map((thread) => (
              <div key={thread.id} className="assistantGigaThreadRow">
                <button
                  type="button"
                  className="assistantCommandThread pressable"
                  aria-current={activeThreadId === thread.id ? "page" : undefined}
                  onClick={() => setActiveThreadId(thread.id)}
                >
                  <span><strong>{thread.title ?? "Без названия"}</strong><small>{formatThreadUpdatedAt(thread.updated_at)}</small></span>
                </button>
                {thread.kind === "chat" ? <button
                  type="button"
                  className="assistantGigaThreadDelete pressable"
                  aria-label={`Удалить чат «${thread.title ?? "Без названия"}»`}
                  title="Удалить чат"
                  disabled={deletingThreadId !== null}
                  onClick={() => { void handleDeleteThread(thread); }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button> : null}
              </div>
            ))}
          </div>
        </aside>

        {activeThreadId ? (
          <section className="assistantGigaConversation">
            <AssistantWorkshopScreen user={user} threadId={activeThreadId} embedded />
          </section>
        ) : <section className="assistantGigaWelcome" data-active={query.trim() ? "true" : "false"}>
          <h1 className="srOnly">ГигаЧат</h1>
          <form className="assistantCommandComposer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <textarea
              aria-label={mode === "make" ? "Описание 3D-модели" : "Сообщение ГигаЧату"}
              placeholder={mode === "make" ? "Опишите будущую 3D-модель" : "Найдите, спросите или поручите сделать"}
              rows={3}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
              }}
            />
            <div className="assistantCommandComposerBar">
              <div className="assistantGigaComposerTools">
                <button type="button" className="assistantGigaAttach pressable" aria-label="Прикрепить файл" title="Прикрепить файл">＋</button>
                <div className="assistantCommandModes" role="tablist" aria-label="Режим">
                  <button type="button" role="tab" aria-selected={mode === "giga"} onClick={() => setMode("giga")}>ГигаЧат</button>
                  <button type="button" role="tab" aria-selected={mode === "research"} onClick={() => setMode("research")}>Исследование</button>
                  <button type="button" role="tab" aria-selected={mode === "make"} onClick={() => setMode("make")}>Сделать</button>
                </div>
              </div>
              <button type="submit" className="assistantCommandSend pressable" disabled={!query.trim() || sending || mode === "research"}>{mode === "research" ? "Недоступно" : sending ? "В очередь…" : mode === "make" ? "Создать 3D" : "Отправить"} <span>↑</span></button>
            </div>
          </form>
          {mode === "make" ? <p className="assistantModeNotice" role="status">Опишите модель — генерация начнётся сразу после отправки.</p> : null}
          {assistantModeUnavailableMessage(mode) ? <p className="assistantModeNotice" role="status">{assistantModeUnavailableMessage(mode)}</p> : null}
          <div className="assistantCommandSuggestions">
            {(mode === "make"
              ? ["Ваза с узким горлышком", "Подставка для телефона", "Настольная лампа"]
              : ["Найти проект на вечер", "Помочь с принтером", "Сделать 3D-модель", "Проверить ферму"]).map((text) => (
              <button key={text} type="button" className="pressable" onClick={() => setQuery(text)}>{text}</button>
            ))}
          </div>
        </section>}
      </main>
    </div>
  );
}
