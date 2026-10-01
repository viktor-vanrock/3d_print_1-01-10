// Клиент реального assistant.v1 API (MF-1997/MF-1999, packages/contracts/http/assistant.ts) —
// заменяет localassistant.ts (localStorage-фикстуру, MF-1996 fixture-first). Тот же паттерн
// fetch/credentials, что generate/generations.ts и auth/session.ts.

import type { Generation } from "../generate/generations.ts";
import { apiFetch, API_URL } from "@shared/api";
import type { components } from "src/api/generated/openapi";

function makeClientRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `cr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type AssistantRequestError = "RATE_LIMITED" | "REQUEST_FAILED" | "NETWORK";

export const ASSISTANT_RATE_LIMIT_MESSAGE = "Сейчас нельзя отправить ещё один запрос. Дождитесь предыдущего ответа или попробуйте позже.";

export type CreateThreadResult =
  | { thread: components["schemas"]["AssistantThreadDto"] }
  | { error: AssistantRequestError };

export async function createThread(title?: string): Promise<CreateThreadResult> {
  try {
    const response = await apiFetch(`/assistant/threads`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(title ? { title } : {}),
    });
    if (!response.ok) return { error: response.status === 429 ? "RATE_LIMITED" : "REQUEST_FAILED" };
    const body = (await response.json()) as components["schemas"]["AssistantThreadResponseDto"];
    return { thread: body.thread };
  } catch {
    return { error: "NETWORK" };
  }
}

export async function getThread(id: string): Promise<components["schemas"]["AssistantThreadDto"] | null> {
  try {
    const response = await apiFetch(`/assistant/threads/${encodeURIComponent(id)}`, {
      credentials: "include",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as components["schemas"]["AssistantThreadResponseDto"];
    return body.thread;
  } catch {
    return null;
  }
}

export async function listThreads(): Promise<components["schemas"]["AssistantThreadDto"][] | null> {
  try {
    const response = await apiFetch(`/assistant/threads`, { credentials: "include" });
    if (!response.ok) return null;
    const body = (await response.json()) as components["schemas"]["AssistantThreadsResponseDto"];
    return [...body.items];
  } catch {
    return null;
  }
}

export async function deleteThread(id: string): Promise<boolean> {
  try {
    const response = await apiFetch(`/assistant/threads/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listMessages(threadId: string): Promise<components["schemas"]["AssistantMessagesResponseDto"] | null> {
  try {
    const response = await apiFetch(
      `/assistant/threads/${encodeURIComponent(threadId)}/messages?limit=100`,
      { credentials: "include" },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as components["schemas"]["AssistantMessagesResponseDto"];
    return { items: [...body.items], runs: body.runs ? [...body.runs] : [], next_cursor: body.next_cursor };
  } catch {
    return null;
  }
}

export type SendMessageResult =
  | { message: components["schemas"]["AssistantMessageDto"]; run: components["schemas"]["AssistantRunDto"] | null }
  | { error: AssistantRequestError };

export async function sendMessage(threadId: string, content: string): Promise<SendMessageResult> {
  let response: Response;
  try {
    response = await apiFetch(`/assistant/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, client_request_id: makeClientRequestId() }),
    });
  } catch {
    return { error: "NETWORK" };
  }
  if (!response.ok) {
    return { error: response.status === 429 ? "RATE_LIMITED" : "REQUEST_FAILED" };
  }
  const body = (await response.json()) as components["schemas"]["AssistantMessageCreatedResponseDto"];
  return { message: body.message, run: body.run };
}

export async function getRun(threadId: string, runId: string): Promise<components["schemas"]["AssistantRunDto"] | null> {
  try {
    const response = await apiFetch(
      `/assistant/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`,
      { credentials: "include" },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as components["schemas"]["AssistantRunResponseDto"];
    return body.run;
  } catch {
    return null;
  }
}

export type AssistantEventConnectionState = "connecting" | "connected" | "retrying";

export function subscribeAssistantRunEvents(
  runId: string,
  handlers: {
    onSnapshot: (run: components["schemas"]["AssistantRunDto"]) => void;
    onTerminal: () => void;
    onConnectionState?: (state: AssistantEventConnectionState) => void;
  },
): () => void {
  handlers.onConnectionState?.("connecting");
  const source = new EventSource(`${API_URL}/assistant/runs/${encodeURIComponent(runId)}/events`, {
    withCredentials: true,
  });
  let terminalReceived = false;

  source.onopen = () => handlers.onConnectionState?.("connected");
  source.onerror = () => {
    if (!terminalReceived) handlers.onConnectionState?.("retrying");
  };
  const onRun = (event: Event) => {
    const payload = parseEventData<{ run?: components["schemas"]["AssistantRunDto"] }>(event);
    if (!payload?.run) return;
    handlers.onSnapshot(payload.run);
    if (payload.run.status === "done" || payload.run.status === "error") {
      terminalReceived = true;
      source.close();
    }
  };
  source.addEventListener("assistant.snapshot", onRun);
  source.addEventListener("assistant.updated", onRun);
  const onTerminal = () => {
    if (terminalReceived) return;
    terminalReceived = true;
    source.close();
    handlers.onTerminal();
  };
  source.addEventListener("assistant.completed", onTerminal);
  source.addEventListener("assistant.error", onTerminal);

  return () => source.close();
}

function parseEventData<T>(event: Event): T | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") return null;
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

export type ConfirmGenerationResult = { generation: Generation } | { error: string };

export async function confirmGeneration(threadId: string, runId: string): Promise<ConfirmGenerationResult> {
  let response: Response;
  try {
    response = await apiFetch(`/assistant/threads/${encodeURIComponent(threadId)}/generations`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId }),
    });
  } catch {
    return { error: "NETWORK" };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { error: body?.error ?? "NETWORK" };
  }
  const body = (await response.json()) as { generation: Generation };
  return { generation: body.generation };
}

// Хендофф run_id между экраном, который создал тред+первое сообщение (home.search.tsx,
// auth/guestresume.tsx), и AssistantWorkshopScreen, который монтируется заново уже после
// навигации и не может получить run из ответа fetch напрямую (нет server state/props для этого).
// sessionStorage переживает навигацию в той же вкладке, но не более — намеренно: это подсказка
// "только что созданный run" до первого API-read. История и активный run восстанавливаются из API.
const PENDING_RUN_PREFIX = "portal.assistant.pending-run.";

export function stashPendingRun(threadId: string, runId: string): void {
  try {
    window.sessionStorage.setItem(PENDING_RUN_PREFIX + threadId, runId);
  } catch {
    // Safari private mode/quota — просто не покажем мгновенный ответ на первый вопрос,
    // следующий API-read всё равно подхватит run при первой перезагрузке экрана.
  }
}

export function takePendingRun(threadId: string): string | null {
  try {
    const key = PENDING_RUN_PREFIX + threadId;
    const value = window.sessionStorage.getItem(key);
    if (value) window.sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}
