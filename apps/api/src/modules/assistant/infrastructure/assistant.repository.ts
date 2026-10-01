import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import {
  ASSISTANT_MAX_ACTIVE_RUNS_PER_USER,
  assistantGlobalQueuedRunsLimit,
  assistantMessageQuotaDaily,
  assistantMessageQuotaHourly,
  assistantRunEtaSecondsPerJob,
  assistantRunStaleTimeoutMinutes,
  deriveErrorCode,
  deriveResultKind,
  sanitizeRunResult,
  type AssistantMessageRow,
  type AssistantRunEventRow,
  type AssistantRunRow,
  type AssistantThreadRow,
  type RunQueueInfo,
} from "../domain/assistant.ts";
import type { AssistantCompletedTurns, AssistantLeaseClaim } from "../domain/assistant-internal.ts";
import type { AssistantIncidentPort, AssistantQueryExecutor } from "../public/index.ts";

const THREAD_COLUMNS = "id, owner_id, title, kind, device_id, severity, incident_status, read_at, created_at, updated_at";
const MESSAGE_COLUMNS = "id, thread_id, role, content, client_request_id, run_id, created_at";
const RUN_COLUMNS = "id, thread_id, triggering_message_id, user_id, message, status, result_type, result, error_code, confirmed_generation_id, created_at, updated_at";
const RUN_COLUMNS_QUALIFIED =
  "r.id, r.thread_id, r.triggering_message_id, r.user_id, r.message, r.status, r.result_type, r.result, r.error_code, r.confirmed_generation_id, r.created_at, r.updated_at";
const EVENT_COLUMNS = "id, run_id, seq, event_type, payload, created_at";
const THREAD_CREATE_LOCK_NAMESPACE = 0x4d46_1995;
const MESSAGE_QUOTA_LOCK_NAMESPACE = 0x4d46_1997;
const GLOBAL_QUEUE_LOCK_NAMESPACE = 0x4d46_1999;
const RUN_EVENTS_LOCK_NAMESPACE = 0x4d46_1996;
const GENERATION_CONFIRM_LOCK_NAMESPACE = 0x4d46_1998;

export type MessageCreateResult =
  | { readonly kind: "created" | "replayed"; readonly message: AssistantMessageRow; readonly run: AssistantRunRow | null }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "thread_missing" }
  | { readonly kind: "hourly_limit" | "daily_limit" | "active_run_limit" | "global_queue_limit"; readonly limit: number };

export type ThreadCreateResult = { readonly kind: "created"; readonly thread: AssistantThreadRow } | { readonly kind: "daily_limit"; readonly limit: number };

function assistantThreadCreateQuotaDaily(): number {
  const value = Number(process.env.ASSISTANT_THREAD_CREATE_QUOTA_DAILY);
  return Number.isSafeInteger(value) && value > 0 ? value : 20;
}

export interface AssistantRunIdentity {
  readonly runId: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly userId: string;
  readonly message: string;
}

export interface GenerationOffer {
  readonly branch: unknown;
  readonly prompt: unknown;
  readonly params: unknown;
}

export type GenerationConfirmResult =
  | { readonly kind: "missing" }
  | { readonly kind: "already"; readonly generationId: string }
  | { readonly kind: "not_ready"; readonly status: string }
  | { readonly kind: "not_offer" }
  | { readonly kind: "offer"; readonly row: AssistantRunRow; readonly offer: GenerationOffer; readonly finish: (generationId: string) => Promise<void> };

@Injectable()
export class AssistantRepository implements AssistantIncidentPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async activeRunIdentity(runId: string, claim: AssistantLeaseClaim): Promise<AssistantRunIdentity | null> {
    const result = await this.pool.query<AssistantRunIdentity>(
      `select r.id as "runId", t.id as "threadId", m.id as "messageId", t.owner_id as "userId", m.content as message
       from assistant_runs r
       join assistant_threads t on t.id = r.thread_id and t.owner_id = r.user_id
       join assistant_messages m on m.id = r.triggering_message_id and m.thread_id = t.id
       where r.id = $1 and r.status = 'running' and r.lease_expires_at > clock_timestamp()
         and r.leased_by = $2 and r.lease_generation = $3
         and t.kind = 'chat' and t.deleted_at is null and m.role = 'user' and m.content = r.message
         and (m.run_id is null or m.run_id = r.id)`,
      [runId, claim.ownerId, claim.generation],
    );
    return result.rows[0] ?? null;
  }

  async completedTurns(identity: AssistantRunIdentity, limit: number): Promise<AssistantCompletedTurns> {
    const rows = (
      await this.pool.query<{
        readonly user_content: string;
        readonly result_type: "answer" | "clarification" | "generation_offer";
        readonly result: Record<string, unknown>;
        readonly total: string;
      }>(
        `select m.content as user_content, r.result_type, r.result, count(*) over()::text as total
         from assistant_runs r
         join assistant_messages m on m.id = r.triggering_message_id and m.thread_id = r.thread_id
         join assistant_messages current_message on current_message.id = $2 and current_message.thread_id = $1
         where r.thread_id = $1 and r.user_id = $3 and r.id <> $4
           and r.status = 'done' and r.result_type in ('answer','clarification','generation_offer')
           and m.role = 'user' and m.content = r.message
           and (m.created_at, m.id) < (current_message.created_at, current_message.id)
         order by m.created_at desc, m.id desc
         limit $5`,
        [identity.threadId, identity.messageId, identity.userId, identity.runId, limit],
      )
    ).rows;
    return {
      turns: rows.map(({ user_content, result_type, result }) => ({ user_content, result_type, result })),
      total: Number(rows[0]?.total ?? 0),
    };
  }

  async createThread(ownerId: UserId, title: string | null): Promise<ThreadCreateResult> {
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock($1, hashtext($2))", [THREAD_CREATE_LOCK_NAMESPACE, ownerId]);
      const dailyLimit = assistantThreadCreateQuotaDaily();
      const createdToday = (
        await client.query<{ count: string }>(
          `select count(*)::text as count
           from (select 1 from assistant_threads
                 where owner_id = $1 and kind = 'chat' and created_at > now() - interval '1 day'
                   and created_at > coalesce((select reset_at from assistant_quota_resets where user_id = $1), '-infinity'::timestamptz)
                 limit $2) recent_threads`,
          [ownerId, dailyLimit],
        )
      ).rows[0]?.count;
      if (Number(createdToday ?? 0) >= dailyLimit) return { kind: "daily_limit", limit: dailyLimit };
      const row = (await client.query<AssistantThreadRow>(`insert into assistant_threads (owner_id, title) values ($1, $2) returning ${THREAD_COLUMNS}`, [ownerId, title])).rows[0];
      if (row === undefined) throw new Error("assistant thread insert returned no row");
      return { kind: "created", thread: row };
    });
  }

  async listThreads(ownerId: UserId, cursor: string | null, limit: number): Promise<readonly AssistantThreadRow[]> {
    const values: unknown[] = [ownerId];
    const cursorSql = cursor === null ? "" : ` and created_at < $${values.push(cursor)}::timestamptz`;
    return (
      await this.pool.query<AssistantThreadRow>(
        `select ${THREAD_COLUMNS} from assistant_threads where owner_id = $1 and deleted_at is null${cursorSql} order by created_at desc limit ${limit + 1}`,
        values,
      )
    ).rows;
  }

  async ownedThread(threadId: string, ownerId: UserId): Promise<AssistantThreadRow | null> {
    return (
      await this.pool.query<AssistantThreadRow>(`select ${THREAD_COLUMNS} from assistant_threads where id = $1 and owner_id = $2 and deleted_at is null`, [threadId, ownerId])
    ).rows[0] ?? null;
  }

  async softDeleteThread(threadId: string, ownerId: UserId): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query<{ readonly id: string }>(
        `update assistant_threads
         set deleted_at = coalesce(deleted_at, now()), updated_at = case when deleted_at is null then now() else updated_at end
         where id = $1 and owner_id = $2 and kind = 'chat'
         returning id`,
        [threadId, ownerId],
      );
      if (result.rows[0] === undefined) return false;
      const cancelledRuns = (
        await client.query<{ readonly id: string }>(
          `update assistant_runs
           set status = 'error', result_type = 'error',
               result = jsonb_build_object('kind', 'error', 'code', 'provider_error', 'retryable', false),
               error_code = 'provider_error', error = 'assistant thread deleted',
               leased_by = null, lease_expires_at = null, lease_generation = lease_generation + 1,
               updated_at = now()
           where thread_id = $1 and status in ('queued', 'running')
           returning id`,
          [threadId],
        )
      ).rows;
      await client.query("select pg_notify('assistant_thread_changed', $1)", [threadId]);
      if (cancelledRuns.length > 0)
        await client.query(`select pg_notify('assistant_run_changed', id::text) from unnest($1::uuid[]) as cancelled(id)`, [cancelledRuns.map(({ id }) => id)]);
      return true;
    });
  }

  async markRead(threadId: string): Promise<AssistantThreadRow> {
    const row = (await this.pool.query<AssistantThreadRow>(`update assistant_threads set read_at = coalesce(read_at, now()) where id = $1 returning ${THREAD_COLUMNS}`, [threadId]))
      .rows[0];
    if (row === undefined) throw new Error("assistant thread read update returned no row");
    return row;
  }

  async transitionIncidentThread(executor: AssistantQueryExecutor, input: { readonly threadId: string; readonly status: "acknowledged" | "resolved" }): Promise<void> {
    await executor.query(`update assistant_threads set incident_status=$2,updated_at=now() where id=$1`, [input.threadId, input.status]);
  }

  async listMessages(threadId: string, cursor: string | null, limit: number): Promise<readonly AssistantMessageRow[]> {
    const values: unknown[] = [threadId];
    const cursorSql = cursor === null ? "" : ` and created_at < $${values.push(cursor)}::timestamptz`;
    return (
      await this.pool.query<AssistantMessageRow>(
        `select ${MESSAGE_COLUMNS} from assistant_messages where thread_id = $1${cursorSql} order by created_at desc, id desc limit ${limit + 1}`,
        values,
      )
    ).rows;
  }

  async listRunsForMessages(threadId: string, messageIds: readonly string[]): Promise<readonly AssistantRunRow[]> {
    const boundedMessageIds = messageIds.slice(0, 100);
    if (boundedMessageIds.length === 0) return [];
    return (
      await this.pool.query<AssistantRunRow>(
        `select ${RUN_COLUMNS}
         from assistant_runs
         where thread_id = $1 and triggering_message_id = any($2::uuid[])
         order by created_at asc, id asc
         limit $3`,
        [threadId, boundedMessageIds, boundedMessageIds.length],
      )
    ).rows;
  }

  async existingMessage(threadId: string, content: string, clientRequestId: string): Promise<MessageCreateResult | null> {
    const existing = (
      await this.pool.query<AssistantMessageRow>(
        `select m.id, m.thread_id, m.role, m.content, m.client_request_id, m.run_id, m.created_at
         from assistant_messages m join assistant_threads t on t.id = m.thread_id
         where m.thread_id = $1 and m.client_request_id = $2 and t.deleted_at is null`,
        [threadId, clientRequestId],
      )
    ).rows[0];
    if (existing === undefined) return null;
    if (existing.content !== content) return { kind: "idempotency_conflict" };
    const run = (await this.pool.query<AssistantRunRow>(`select ${RUN_COLUMNS} from assistant_runs where triggering_message_id = $1`, [existing.id])).rows[0] ?? null;
    return { kind: "replayed", message: existing, run };
  }

  async createMessage(thread: AssistantThreadRow, content: string, clientRequestId: string): Promise<MessageCreateResult> {
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock($1, hashtext($2))", [MESSAGE_QUOTA_LOCK_NAMESPACE, thread.owner_id]);
      const activeThread = await client.query(
        `select id from assistant_threads where id = $1 and owner_id = $2 and deleted_at is null for update`,
        [thread.id, thread.owner_id],
      );
      if (activeThread.rows[0] === undefined) return { kind: "thread_missing" };
      const existing = (
        await client.query<AssistantMessageRow>(`select ${MESSAGE_COLUMNS} from assistant_messages where thread_id = $1 and client_request_id = $2`, [thread.id, clientRequestId])
      ).rows[0];
      if (existing !== undefined) {
        if (existing.content !== content) return { kind: "idempotency_conflict" };
        const run = (await client.query<AssistantRunRow>(`select ${RUN_COLUMNS} from assistant_runs where triggering_message_id = $1`, [existing.id])).rows[0] ?? null;
        return { kind: "replayed", message: existing, run };
      }
      const usage = (
        await client.query<{ hourly: string; daily: string }>(
          `select count(*) filter (where m.created_at > now() - interval '1 hour') as hourly, count(*) as daily
           from assistant_messages m join assistant_threads t on t.id = m.thread_id
           where t.owner_id = $1 and m.role = 'user' and m.created_at > now() - interval '1 day'
             and m.created_at > coalesce((select reset_at from assistant_quota_resets where user_id = $1), '-infinity'::timestamptz)`,
          [thread.owner_id],
        )
      ).rows[0];
      const hourlyLimit = assistantMessageQuotaHourly();
      const dailyLimit = assistantMessageQuotaDaily();
      if (Number(usage?.hourly ?? 0) >= hourlyLimit) return { kind: "hourly_limit", limit: hourlyLimit };
      if (Number(usage?.daily ?? 0) >= dailyLimit) return { kind: "daily_limit", limit: dailyLimit };
      const staleCutoff = new Date(Date.now() - assistantRunStaleTimeoutMinutes() * 60_000);
      await client.query(
        `update assistant_runs set status = 'error', result_type = 'error', error_code = 'timeout', updated_at = now()
         where user_id = $1 and status in ('queued', 'running') and updated_at < $2`,
        [thread.owner_id, staleCutoff],
      );
      const activeRunLimit = ASSISTANT_MAX_ACTIVE_RUNS_PER_USER;
      const activeRuns = (
        await client.query<{ count: string }>(
          `select count(*)::text as count
           from (select 1 from assistant_runs where user_id = $1 and status in ('queued', 'running') limit $2) active_runs`,
          [thread.owner_id, activeRunLimit],
        )
      ).rows[0]?.count;
      if (Number(activeRuns ?? 0) >= activeRunLimit) return { kind: "active_run_limit", limit: activeRunLimit };

      await client.query("select pg_advisory_xact_lock($1, 0)", [GLOBAL_QUEUE_LOCK_NAMESPACE]);
      const globalQueueLimit = assistantGlobalQueuedRunsLimit();
      await client.query(
        `with stale as (
           select id from assistant_runs
           where status = 'queued' and updated_at < $1
           order by updated_at, id limit $2 for update skip locked
         )
         update assistant_runs r set status = 'error', result_type = 'error', error_code = 'timeout', updated_at = now()
         from stale where r.id = stale.id`,
        [staleCutoff, globalQueueLimit],
      );
      const queuedRuns = (
        await client.query<{ count: string }>(`select count(*)::text as count from (select 1 from assistant_runs where status = 'queued' limit $1) queued_runs`, [globalQueueLimit])
      ).rows[0]?.count;
      if (Number(queuedRuns ?? 0) >= globalQueueLimit) return { kind: "global_queue_limit", limit: globalQueueLimit };
      const message = (
        await client.query<AssistantMessageRow>(
          `insert into assistant_messages (thread_id, role, content, client_request_id) values ($1, 'user', $2, $3) returning ${MESSAGE_COLUMNS}`,
          [thread.id, content, clientRequestId],
        )
      ).rows[0];
      if (message === undefined) throw new Error("assistant message insert returned no row");
      const run = (
        await client.query<AssistantRunRow>(`insert into assistant_runs (thread_id, triggering_message_id, user_id, message) values ($1, $2, $3, $4) returning ${RUN_COLUMNS}`, [
          thread.id,
          message.id,
          thread.owner_id,
          content,
        ])
      ).rows[0];
      if (run === undefined) throw new Error("assistant run insert returned no row");
      await client.query("update assistant_threads set updated_at = now() where id = $1", [thread.id]);
      return { kind: "created", message, run };
    });
  }

  async runInThread(runId: string, threadId: string): Promise<AssistantRunRow | null> {
    return (await this.pool.query<AssistantRunRow>(`select ${RUN_COLUMNS} from assistant_runs where id = $1 and thread_id = $2`, [runId, threadId])).rows[0] ?? null;
  }

  async ownedRun(runId: string, ownerId: UserId): Promise<AssistantRunRow | null> {
    return (
      (
        await this.pool.query<AssistantRunRow>(
          `select ${RUN_COLUMNS_QUALIFIED}
           from assistant_runs r join assistant_threads t on t.id = r.thread_id
           where r.id = $1 and t.owner_id = $2 and t.deleted_at is null`,
          [runId, ownerId],
        )
      ).rows[0] ?? null
    );
  }

  async resolveStale(row: AssistantRunRow): Promise<AssistantRunRow> {
    if (row.status !== "queued" && row.status !== "running") return row;
    const cutoff = new Date(Date.now() - assistantRunStaleTimeoutMinutes() * 60_000);
    if (row.updated_at > cutoff) return row;
    return (
      (
        await this.pool.query<AssistantRunRow>(
          `update assistant_runs set status = 'error', result_type = 'error', error_code = 'timeout', updated_at = now() where id = $1 and status in ('queued', 'running') and updated_at < $2 returning ${RUN_COLUMNS}`,
          [row.id, cutoff],
        )
      ).rows[0] ?? row
    );
  }

  async queueInfo(row: AssistantRunRow): Promise<RunQueueInfo | null> {
    if (row.status !== "queued") return null;
    const ahead =
      (await this.pool.query<{ ahead: string }>("select count(*) as ahead from assistant_runs where status = 'queued' and created_at < $1", [row.created_at])).rows[0]?.ahead ??
      "0";
    const position = Number(ahead) + 1;
    return { position, eta_seconds: position * assistantRunEtaSecondsPerJob() };
  }

  async freshRun(runId: string): Promise<AssistantRunRow | null> {
    return (
      await this.pool.query<AssistantRunRow>(
        `select ${RUN_COLUMNS_QUALIFIED}
         from assistant_runs r join assistant_threads t on t.id = r.thread_id
         where r.id = $1 and t.deleted_at is null`,
        [runId],
      )
    ).rows[0] ?? null;
  }

  async ensureRunEvents(run: AssistantRunRow): Promise<readonly AssistantRunEventRow[]> {
    if (run.status !== "done" && run.status !== "error") return this.loadRunEvents(run.id);
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock($1, hashtext($2))", [RUN_EVENTS_LOCK_NAMESPACE, run.id]);
      const existing = (await client.query<AssistantRunEventRow>(`select ${EVENT_COLUMNS} from assistant_run_events where run_id = $1 order by seq asc`, [run.id])).rows;
      if (existing.some((event) => event.event_type === "assistant.completed" || event.event_type === "assistant.error")) return existing;
      let nextSeq = (existing.at(-1)?.seq ?? 0) + 1;
      const rows = [...existing];
      if (run.status === "done") {
        const delta = (
          await client.query<AssistantRunEventRow>(
            `insert into assistant_run_events (run_id, seq, event_type, payload) values ($1, $2, 'assistant.delta', $3) returning ${EVENT_COLUMNS}`,
            [run.id, nextSeq, JSON.stringify(sanitizeRunResult(run.result, deriveResultKind(run), run.id))],
          )
        ).rows[0];
        if (delta === undefined) throw new Error("assistant delta insert returned no row");
        rows.push(delta);
        nextSeq += 1;
        const completed = (
          await client.query<AssistantRunEventRow>(
            `insert into assistant_run_events (run_id, seq, event_type, payload) values ($1, $2, 'assistant.completed', $3) returning ${EVENT_COLUMNS}`,
            [run.id, nextSeq, JSON.stringify({ status: "done" })],
          )
        ).rows[0];
        if (completed === undefined) throw new Error("assistant completed insert returned no row");
        rows.push(completed);
      } else {
        const error = (
          await client.query<AssistantRunEventRow>(
            `insert into assistant_run_events (run_id, seq, event_type, payload) values ($1, $2, 'assistant.error', $3) returning ${EVENT_COLUMNS}`,
            [run.id, nextSeq, JSON.stringify({ error_code: deriveErrorCode(run) })],
          )
        ).rows[0];
        if (error === undefined) throw new Error("assistant error event insert returned no row");
        rows.push(error);
      }
      return rows;
    });
  }

  async beginGenerationConfirm(threadId: string, runId: string): Promise<{ readonly result: GenerationConfirmResult; readonly release: (commit: boolean) => Promise<void> }> {
    const client = await this.pool.connect();
    let finished = false;
    const release = async (commit: boolean) => {
      if (finished) return;
      finished = true;
      try {
        await client.query(commit ? "commit" : "rollback");
      } finally {
        client.release();
      }
    };
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock($1, hashtext($2))", [GENERATION_CONFIRM_LOCK_NAMESPACE, runId]);
      const thread = await client.query(
        `select id from assistant_threads
         where id = $1 and deleted_at is null
         for update`,
        [threadId],
      );
      if (thread.rows[0] === undefined) return { result: { kind: "missing" }, release };
      const row = (
        await client.query<AssistantRunRow>(
          `select ${RUN_COLUMNS}
           from assistant_runs
           where id = $1 and thread_id = $2
           for update`,
          [runId, threadId],
        )
      ).rows[0];
      if (row === undefined) return { result: { kind: "missing" }, release };
      if (row.confirmed_generation_id !== null) return { result: { kind: "already", generationId: row.confirmed_generation_id }, release };
      if (row.status !== "done") return { result: { kind: "not_ready", status: row.status }, release };
      if (deriveResultKind(row) !== "generation_offer") return { result: { kind: "not_offer" }, release };
      const offer = row.result as { readonly branch?: unknown; readonly prompt_summary?: unknown; readonly prompt?: unknown; readonly params?: unknown };
      return {
        result: {
          kind: "offer",
          row,
          offer: { branch: offer.branch, prompt: typeof offer.prompt_summary === "string" ? offer.prompt_summary : offer.prompt, params: offer.params },
          finish: async (generationId: string) => {
            await client.query("update assistant_runs set confirmed_generation_id = $2, updated_at = now() where id = $1", [row.id, generationId]);
          },
        },
        release,
      };
    } catch (error) {
      await release(false).catch(() => undefined);
      throw error;
    }
  }

  private async loadRunEvents(runId: string): Promise<readonly AssistantRunEventRow[]> {
    return (await this.pool.query<AssistantRunEventRow>(`select ${EVENT_COLUMNS} from assistant_run_events where run_id = $1 order by seq asc`, [runId])).rows;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
