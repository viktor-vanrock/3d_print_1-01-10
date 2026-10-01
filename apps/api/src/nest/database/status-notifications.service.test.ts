import { EventEmitter } from "node:events";
import type { Pool, PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeLogger } from "../observability/runtime-logger.ts";
import { StatusNotificationsService } from "./status-notifications.service.ts";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createClient(query: (sql: string) => Promise<unknown>): PoolClient & {
  readonly queryMock: ReturnType<typeof vi.fn>;
  readonly releaseMock: ReturnType<typeof vi.fn>;
  readonly listenerCount: (event: string) => number;
} {
  const events = new EventEmitter();
  const queryMock = vi.fn(query);
  const releaseMock = vi.fn();
  return {
    on: events.on.bind(events),
    once: events.once.bind(events),
    off: events.off.bind(events),
    query: queryMock,
    release: releaseMock,
    queryMock,
    releaseMock,
    listenerCount: (event: string) => events.listenerCount(event),
  } as unknown as PoolClient & {
    readonly queryMock: ReturnType<typeof vi.fn>;
    readonly releaseMock: ReturnType<typeof vi.fn>;
    readonly listenerCount: (event: string) => number;
  };
}

function createService(client: PoolClient): StatusNotificationsService {
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  const logger = { warn: vi.fn() } as unknown as RuntimeLogger;
  return new StatusNotificationsService(pool, logger);
}

const queryResult = {} as QueryResult;

describe("StatusNotificationsService shutdown", () => {
  it("releases a candidate when shutdown begins while LISTEN setup is in flight", async () => {
    const listen = deferred<unknown>();
    const client = createClient(() => listen.promise);
    const service = createService(client);
    const iterator = service.watch("assistant_run_changed", "run-1", new AbortController().signal)[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(client.queryMock).toHaveBeenCalledTimes(1));

    service.beforeApplicationShutdown();
    expect(client.releaseMock).toHaveBeenCalledWith(true);
    listen.resolve(queryResult);

    await expect(first).resolves.toEqual({ done: true, value: undefined });
    expect(client.listenerCount("notification")).toBe(0);
  });

  it("does not wait for UNLISTEN to finish before releasing an active listener", async () => {
    const unlisten = deferred<unknown>();
    const client = createClient((sql) => (sql === "UNLISTEN *" ? unlisten.promise : Promise.resolve(queryResult)));
    const service = createService(client);
    const iterator = service.watch("assistant_run_changed", "run-1", new AbortController().signal)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: undefined });

    const shutdownResult = service.beforeApplicationShutdown();

    expect(shutdownResult).toBeUndefined();
    expect(client.releaseMock).toHaveBeenCalledWith(true);
    unlisten.resolve(queryResult);
    await iterator.return?.();
  });

  it("ends a watcher that is waiting when shutdown begins", async () => {
    const client = createClient(() => Promise.resolve(queryResult));
    const service = createService(client);
    const iterator = service.watch("assistant_run_changed", "run-1", new AbortController().signal)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: undefined });
    const waiting = iterator.next();

    service.beforeApplicationShutdown();

    await expect(waiting).resolves.toEqual({ done: true, value: undefined });
  });
});
