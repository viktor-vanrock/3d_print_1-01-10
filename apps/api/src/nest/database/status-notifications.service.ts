import { Inject, Injectable } from "@nestjs/common";
import type { BeforeApplicationShutdown, OnApplicationBootstrap } from "@nestjs/common";
import type { Notification, Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "./database.constants.ts";
import { RuntimeLogger } from "../observability/runtime-logger.ts";

export type StatusNotificationChannel =
  | "assistant_run_changed"
  | "assistant_thread_changed"
  | "assistant_queue_changed"
  | "generation_changed"
  | "generation_queue_changed"
  | "concept_changed";

const CHANNELS: readonly StatusNotificationChannel[] = [
  "assistant_run_changed",
  "assistant_thread_changed",
  "assistant_queue_changed",
  "generation_changed",
  "generation_queue_changed",
  "concept_changed",
];
const LISTEN_READY_TIMEOUT_MS = 10_000;
const CONNECTION_LOG_INTERVAL_MS = 30_000;

interface Subscriber {
  readonly channel: StatusNotificationChannel;
  readonly id: string;
  readonly globalChannel: StatusNotificationChannel | undefined;
  readonly globalEnabled: (() => boolean) | undefined;
  active: boolean;
  pending: boolean;
  wake: (() => void) | null;
}

@Injectable()
export class StatusNotificationsService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly subscribers = new Set<Subscriber>();
  private readonly readyWaiters = new Set<() => void>();
  private client: PoolClient | null = null;
  private setupClient: PoolClient | null = null;
  private connecting = false;
  private closing = false;
  private lastConnectionLogAt = 0;
  private connectionIssueObserved = false;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(RuntimeLogger) private readonly logger: RuntimeLogger,
  ) {}

  get isClosing(): boolean {
    return this.closing;
  }

  onApplicationBootstrap(): void {
    this.ensureConnecting();
  }

  beforeApplicationShutdown(): void {
    this.closing = true;
    this.wakeAll();
    this.resolveReadyWaiters();
    const client = this.client;
    this.client = null;
    const setupClient = this.setupClient;
    this.setupClient = null;
    // A dedicated LISTEN connection must not delay shutdown or return to the pool.
    client?.release(true);
    setupClient?.release(true);
  }

  async *watch(
    channel: StatusNotificationChannel,
    id: string,
    signal: AbortSignal,
    timeoutMs?: number,
    globalChannel?: StatusNotificationChannel,
    globalEnabled?: () => boolean,
  ): AsyncIterable<void> {
    const subscriber: Subscriber = { channel, id, globalChannel, globalEnabled, active: false, pending: false, wake: null };
    this.subscribers.add(subscriber);
    this.ensureConnecting();
    try {
      if (!(await this.waitUntilReady(signal))) return;
      subscriber.active = true;
      const deadline = timeoutMs === undefined ? null : Date.now() + Math.max(0, timeoutMs);
      yield;
      while (!signal.aborted && !this.closing) {
        if (subscriber.pending) {
          subscriber.pending = false;
          if (this.client === null && !(await this.waitUntilReady(signal))) return;
          // Re-read current state after reconnect: NOTIFY messages emitted while the
          // dedicated connection was down cannot be replayed by PostgreSQL.
          subscriber.pending = false;
          yield;
          continue;
        }
        const reason = await this.waitForWake(subscriber, signal, deadline);
        if (reason === "abort") return;
        if (reason === "timeout") {
          yield;
          return;
        }
        subscriber.pending = false;
        if (this.client === null && !(await this.waitUntilReady(signal))) return;
        subscriber.pending = false;
        yield;
      }
    } finally {
      this.subscribers.delete(subscriber);
      subscriber.wake?.();
    }
  }

  private ensureConnecting(): void {
    if (this.connecting || this.closing || this.client !== null) return;
    this.connecting = true;
    void this.connectLoop();
  }

  private async connectLoop(): Promise<void> {
    let retryDelayMs = 100;
    try {
      while (!this.closing && this.client === null) {
        let candidate: PoolClient | null = null;
        let connectionError: unknown;
        const onSetupError = (): void => undefined;
        try {
          const client = await this.pool.connect();
          candidate = client;
          this.setupClient = client;
          client.on("error", onSetupError);
          if (this.closing) return;
          for (const channel of CHANNELS) await client.query(`LISTEN ${channel}`);
          if (this.closing) return;
          const onNotification = (notification: Notification): void => this.onNotification(notification);
          const onDisconnect = (): void => this.onDisconnect(client, onNotification, onDisconnect);
          client.off("error", onSetupError);
          client.on("notification", onNotification);
          client.once("error", onDisconnect);
          client.once("end", onDisconnect);
          this.setupClient = null;
          this.client = client;
          candidate = null;
          this.logConnectionRestored();
          this.resolveReadyWaiters();
          this.wakeAllActive();
          return;
        } catch (error) {
          connectionError = error;
        } finally {
          candidate?.off("error", onSetupError);
          if (candidate !== null && this.setupClient === candidate) {
            this.setupClient = null;
            candidate.release(true);
          }
        }
        if (this.closing) return;
        this.logConnectionIssue(connectionError);
        await this.delay(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 5_000);
      }
    } finally {
      this.connecting = false;
      if (!this.closing && this.client === null) this.ensureConnecting();
    }
  }

  private onDisconnect(client: PoolClient, onNotification: (notification: Notification) => void, onDisconnect: () => void): void {
    if (this.client !== client) return;
    this.logConnectionIssue("listener_disconnected");
    this.client = null;
    client.off("notification", onNotification);
    client.off("error", onDisconnect);
    client.off("end", onDisconnect);
    client.release(true);
    this.wakeAllActive();
    this.ensureConnecting();
  }

  private onNotification(notification: Notification): void {
    if (!this.isChannel(notification.channel) || notification.payload === undefined) return;
    for (const subscriber of this.subscribers) {
      const directMatch = subscriber.channel === notification.channel && subscriber.id === notification.payload;
      const globalMatch =
        subscriber.globalChannel === notification.channel &&
        subscriber.id !== notification.payload &&
        (subscriber.globalEnabled === undefined || subscriber.globalEnabled());
      if (subscriber.active && (directMatch || globalMatch)) {
        this.wake(subscriber);
      }
    }
  }

  private isChannel(channel: string): channel is StatusNotificationChannel {
    return CHANNELS.some((candidate) => candidate === channel);
  }

  private wakeAllActive(): void {
    for (const subscriber of this.subscribers) if (subscriber.active) this.wake(subscriber);
  }

  private wakeAll(): void {
    for (const subscriber of this.subscribers) this.wake(subscriber);
  }

  private wake(subscriber: Subscriber): void {
    subscriber.pending = true;
    subscriber.wake?.();
  }

  private resolveReadyWaiters(): void {
    for (const resolve of this.readyWaiters) resolve();
    this.readyWaiters.clear();
  }

  private async waitUntilReady(signal: AbortSignal): Promise<boolean> {
    const deadline = Date.now() + LISTEN_READY_TIMEOUT_MS;
    while (this.client === null && !this.closing && !signal.aborted) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        this.logConnectionIssue("ready_timeout");
        throw new Error("PostgreSQL status listener unavailable");
      }
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          this.readyWaiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, remainingMs);
        this.readyWaiters.add(done);
        signal.addEventListener("abort", done, { once: true });
        if (this.client !== null || this.closing) done();
      });
    }
    return this.client !== null && !this.closing && !signal.aborted;
  }

  private logConnectionIssue(error: unknown): void {
    this.connectionIssueObserved = true;
    const now = Date.now();
    if (now - this.lastConnectionLogAt < CONNECTION_LOG_INTERVAL_MS) return;
    this.lastConnectionLogAt = now;
    const rawCode = typeof error === "object" && error !== null && "code" in error ? error.code : error;
    const code = typeof rawCode === "string" && /^[A-Z0-9_]{1,32}$/i.test(rawCode) ? rawCode : "unknown";
    this.logger.warn({ event: "status_notifications.listener_unavailable", error_code: code }, "PostgreSQL status listener unavailable; reconnecting");
  }

  private logConnectionRestored(): void {
    if (!this.connectionIssueObserved) return;
    this.connectionIssueObserved = false;
    this.logger.info({ event: "status_notifications.listener_restored", outcome: "connected" }, "PostgreSQL status listener restored");
  }

  private waitForWake(subscriber: Subscriber, signal: AbortSignal, deadline: number | null): Promise<"wake" | "timeout" | "abort"> {
    if (signal.aborted || this.closing) return Promise.resolve("abort");
    if (subscriber.pending) return Promise.resolve("wake");
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const finish = (reason: "wake" | "timeout" | "abort"): void => {
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (subscriber.wake === onWake) subscriber.wake = null;
        resolve(reason);
      };
      const onWake = (): void => finish(this.closing ? "abort" : "wake");
      const onAbort = (): void => finish("abort");
      subscriber.wake = onWake;
      signal.addEventListener("abort", onAbort, { once: true });
      if (deadline !== null) timer = setTimeout(() => finish("timeout"), Math.max(0, deadline - Date.now()));
      if (subscriber.pending) onWake();
    });
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds).unref());
  }
}
