import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Pool, type PoolClient } from "pg";
import { SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { requiresSession } from "../../../nest/auth/access-matrix.ts";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { ApiExceptionFilter } from "../../../nest/errors/api-exception.filter.ts";
import { CorrelationInterceptor } from "../../../nest/observability/correlation.interceptor.ts";
import { RequestContext } from "../../../nest/observability/request-context.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import { PROFILE_AUTH_PORT } from "../../profile/public/index.ts";
import { CATALOG_EXTERNAL_PORT, CATALOG_READ_PORT, PRINTER_MACHINE_LINKS_PORT } from "../../catalog/public/index.ts";
import { FEED_ASSISTANT_NEWS_PORT } from "../../feed/public/index.ts";
import { ASSISTANT_OWNED_PRINTER_PORT } from "../../printers/public/index.ts";
import { ProfileRepository } from "../../profile/infrastructure/profile.repository.ts";
import { SANCTIONS_READ_PORT } from "../../sanctions/public/index.ts";
import { SanctionsRepository } from "../../sanctions/infrastructure/sanctions.repository.ts";
import { AssistantModule } from "../assistant.module.ts";
import { AssistantService } from "../application/assistant.service.ts";
import { AssistantToolsService } from "../application/assistant-tools.service.ts";
import { AssistantRepository, type AssistantRunIdentity } from "../infrastructure/assistant.repository.ts";

const SERVICE_TOKEN = "assistant-test-service-token-32-characters";
const JWT_SECRET = "assistant-internal-session-test-secret";
const LEASE_OWNER = "assistant-worker-test-01";
const LEASE_HEADERS = { "x-assistant-lease-owner": LEASE_OWNER, "x-assistant-lease-generation": "1" };
const CORRELATION = "assistant-test-correlation-01";
let transactionPool: Pool;
const testCatalog = {
  searchAssistantPrinters: async () => ({ kind: "not_found" as const }),
  getAssistantPrinter: async (input: { readonly reference: string }) => ({ kind: "resolved" as const, evidence: { entity_id: input.reference } }),
};
const testNews = { listAssistantNews: async () => ({ period: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z", defaulted: false, bounded: false, date_basis: "portal_published_at" as const }, evidence: [] }), isAssistantNewsVisible: async () => false };

@Global()
@Module({
  providers: [
    { provide: PROFILE_AUTH_PORT, useFactory: () => new ProfileRepository(transactionPool) },
    { provide: SANCTIONS_READ_PORT, useFactory: () => new SanctionsRepository(transactionPool) },
    {
      provide: CATALOG_EXTERNAL_PORT,
      useValue: testCatalog,
    },
    { provide: FEED_ASSISTANT_NEWS_PORT, useValue: testNews },
    { provide: CATALOG_READ_PORT, useValue: {} },
    { provide: PRINTER_MACHINE_LINKS_PORT, useValue: {} },
    { provide: ASSISTANT_OWNED_PRINTER_PORT, useValue: {} },
  ],
  exports: [PROFILE_AUTH_PORT, SANCTIONS_READ_PORT, CATALOG_EXTERNAL_PORT, FEED_ASSISTANT_NEWS_PORT, CATALOG_READ_PORT, PRINTER_MACHINE_LINKS_PORT, ASSISTANT_OWNED_PRINTER_PORT],
})
class TestAuthorizationModule {}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), TestAuthorizationModule, AssistantModule],
  providers: [
    RequestContext,
    RuntimeLogger,
    SessionVerifier,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
})
class TestAppModule {}

describe("assistant internal access matrix", () => {
  it("delegates exactly the versioned prefix to service auth in public and closed modes", () => {
    for (const closedDev of [true, false]) {
      expect(requiresSession({ method: "GET", url: "/internal/assistant/v1/runs/id/context", closedDev })).toBe(false);
      expect(requiresSession({ method: "POST", url: "/internal/assistant/v1/runs/id/tools/search_printers", closedDev })).toBe(false);
      expect(requiresSession({ method: "GET", url: "/internal/assistant/v2/runs/id/context", closedDev })).toBe(true);
      expect(requiresSession({ method: "GET", url: "/internal/assistant/v1-other/context", closedDev })).toBe(true);
    }
  });
});

describe("assistant internal required authorization adapters", () => {
  it.each([PROFILE_AUTH_PORT, SANCTIONS_READ_PORT])("fails composition without %s", async (missing) => {
    const other = missing === PROFILE_AUTH_PORT ? SANCTIONS_READ_PORT : PROFILE_AUTH_PORT;
    await expect(
      Test.createTestingModule({
        providers: [
          AssistantToolsService,
          { provide: AssistantRepository, useValue: {} },
          { provide: other, useValue: {} },
          { provide: CATALOG_EXTERNAL_PORT, useValue: {} },
          { provide: CATALOG_READ_PORT, useValue: {} },
          { provide: PRINTER_MACHINE_LINKS_PORT, useValue: {} },
          { provide: ASSISTANT_OWNED_PRINTER_PORT, useValue: {} },
          { provide: FEED_ASSISTANT_NEWS_PORT, useValue: {} },
        ],
      }).compile(),
    ).rejects.toThrow("Nest can't resolve dependencies");
  });
});

// Real repository joins, HTTP guards and public auth ports; all fixtures roll back.
describe.skipIf(!process.env.DATABASE_URL)("assistant internal HTTP boundary", () => {
  let pool: Pool;
  let tx: PoolClient;
  let app: NestExpressApplication;
  let baseUrl: string;
  let userId: string;
  let foreignUserId: string;
  let threadId: string;
  let foreignThreadId: string;
  let messageId: string;
  let runId: string;
  let tools: AssistantToolsService;
  const errors = vi.spyOn(RuntimeLogger.prototype, "error").mockImplementation(() => undefined);
  const logs = vi.spyOn(RuntimeLogger.prototype, "info").mockImplementation(() => undefined);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tx = await pool.connect();
    const database = (await tx.query<{ name: string }>("select current_database() as name")).rows[0]!.name;
    if (!/^(sandbox_|sbx_|portal_test)/.test(database)) throw new Error("Assistant internal tests require an isolated test database");
    await tx.query("begin");
    transactionPool = { query: tx.query.bind(tx), end: async () => undefined } as unknown as Pool;
    userId = (await tx.query<{ id: string }>("insert into users(username) values($1) returning id", [`assistant-internal-${randomUUID()}`])).rows[0]!.id;
    foreignUserId = (await tx.query<{ id: string }>("insert into users(username) values($1) returning id", [`assistant-foreign-${randomUUID()}`])).rows[0]!.id;
    threadId = (await tx.query<{ id: string }>("insert into assistant_threads(owner_id) values($1) returning id", [userId])).rows[0]!.id;
    foreignThreadId = (await tx.query<{ id: string }>("insert into assistant_threads(owner_id) values($1) returning id", [foreignUserId])).rows[0]!.id;
    messageId = (
      await tx.query<{ id: string }>("insert into assistant_messages(thread_id,role,content,client_request_id) values($1,'user','Current question','internal-test') returning id", [
        threadId,
      ])
    ).rows[0]!.id;
    runId = (
      await tx.query<{ id: string }>(
        "insert into assistant_runs(thread_id,triggering_message_id,user_id,message,status,lease_expires_at,leased_by,lease_generation) values($1,$2,$3,'Current question','running',now()+interval '1 hour',$4,1) returning id",
        [threadId, messageId, userId, LEASE_OWNER],
      )
    ).rows[0]!.id;
    await tx.query("savepoint fixture");
    const module = await Test.createTestingModule({ imports: [TestAppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(transactionPool)
      .overrideProvider(AssistantService)
      .useValue({})
      .compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    tools = app.get(AssistantToolsService);
  });

  beforeEach(async () => {
    await tx.query("rollback to savepoint fixture");
    app.get(ConfigService).set("ASSISTANT_SERVICE_TOKEN", SERVICE_TOKEN);
    Object.defineProperty(tools, "handlers", { value: Object.freeze({}), configurable: true });
    app.get(ConfigService).set("JWT_SECRET", JWT_SECRET);
    logs.mockClear();
    errors.mockClear();
  });

  afterAll(async () => {
    await app?.close();
    if (tx) {
      await tx.query("rollback");
      tx.release();
    }
    await pool?.end();
    logs.mockRestore();
    errors.mockRestore();
  });

  function context(id = runId, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/internal/assistant/v1/runs/${id}/context`, {
      headers: { ...LEASE_HEADERS, "x-correlation-id": CORRELATION, "x-assistant-service-token": SERVICE_TOKEN, ...headers },
    });
  }
  function execute(name: string, body: unknown = { args: {} }, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/internal/assistant/v1/runs/${runId}/tools/${name}`, {
      method: "POST",
      headers: { ...LEASE_HEADERS, "content-type": "application/json", "x-correlation-id": CORRELATION, "x-assistant-service-token": SERVICE_TOKEN, ...headers },
      body: JSON.stringify(body),
    });
  }
  function installReadFixture(scopes = ["catalog:read"]) {
    const read = vi.fn(async (_identity: AssistantRunIdentity, _args: unknown, _correlation: string) => ({ resolution: "not_found" as const, evidence: [] }));
    Object.defineProperty(tools, "handlers", {
      configurable: true,
      value: Object.freeze({
        search_printers: {
          scopes,
          validate: (args: Record<string, unknown>) => Object.keys(args).length === 1 && typeof args.query === "string" && args.query.length > 0 && args.query.length <= 200,
          execute: read,
        },
      }),
    });
    return read;
  }

  it("returns server-derived identity, live scopes and only implemented tools with correlation", async () => {
    const response = await context();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe(CORRELATION);
    expect(await response.json()).toEqual({
      run_id: runId,
      thread_id: threadId,
      message: { id: messageId, content: "Current question" },
      mode: "global",
      scopes: ["catalog:read", "feed:read", "profile:printers:read", "generation:propose"],
      tools: [],
      context: [],
      context_truncated: false,
      context_omitted_turns: 0,
      correlation_id: CORRELATION,
    });
  });

  it("returns prior completed same-thread turns in provider order without requiring a tool call", async () => {
    const citation = {
      evidence_id: "printer:visible-printer",
      entity_type: "printer",
      entity_id: "visible-printer",
      title: "Visible printer",
      snippet: "Visible printer description",
      canonical_url: "/printers/visible-printer",
      facts: { kind: "printer", brand: "Visible", model: "Printer" },
      source_refs: [],
      source_published_at: null,
      observed_at: null,
      updated_at: null,
      price_updated_at: null,
      quality: "reported",
      missing_fields: [],
    };
    const insertTurn = async (content: string, status: "done" | "error" | "queued", resultType: "answer" | "clarification" | "error" | null, result: object, minutes: number) => {
      const priorMessageId = (
        await tx.query<{ id: string }>(
          "insert into assistant_messages(thread_id,role,content,client_request_id,created_at) values($1,'user',$2,$3,now()-interval '1 minute'*$4) returning id",
          [threadId, content, randomUUID(), minutes],
        )
      ).rows[0]!.id;
      await tx.query(
        "insert into assistant_runs(thread_id,triggering_message_id,user_id,message,status,result_type,result,created_at) values($1,$2,$3,$4,$5,$6,$7,now()-interval '1 minute'*$8)",
        [threadId, priorMessageId, userId, content, status, resultType, result, minutes],
      );
    };
    await insertTurn("first user", "done", "answer", { kind: "answer", text: "first answer", citations: [citation] }, 4);
    await insertTurn("failed user", "error", "error", { kind: "error", code: "provider_error" }, 3);
    await insertTurn("second user", "done", "clarification", { kind: "clarification", question: "second answer" }, 2);
    await insertTurn("queued user", "queued", null, {}, 1);
    const foreignMessage = (
      await tx.query<{ id: string }>("insert into assistant_messages(thread_id,role,content,client_request_id) values($1,'user','foreign user',$2) returning id", [
        foreignThreadId,
        randomUUID(),
      ])
    ).rows[0]!.id;
    await tx.query(
      "insert into assistant_runs(thread_id,triggering_message_id,user_id,message,status,result_type,result) values($1,$2,$3,'foreign user','done','clarification',$4)",
      [foreignThreadId, foreignMessage, foreignUserId, { kind: "clarification", question: "foreign answer" }],
    );

    const response = await context();
    expect(response.status).toBe(200);
    expect((await response.json()) as object).toMatchObject({
      message: { id: messageId, content: "Current question" },
      context: [
        { role: "user", content: "first user" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second user" },
        { role: "assistant", content: "second answer" },
      ],
      context_truncated: false,
      context_omitted_turns: 0,
      tools: [],
    });
  });

  it("rejects missing, short, wrong and oversized service tokens, including cookie/Bearer callers", async () => {
    const sessionVersion = (await tx.query<{ session_version: number }>("select session_version from users where id=$1", [userId])).rows[0]!.session_version;
    const session = await new SignJWT({ username: "assistant-internal", sv: sessionVersion })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(JWT_SECRET));
    const publicSession = await fetch(`${baseUrl}/internal/assistant/v1/runs/${runId}/context`, {
      headers: { "x-correlation-id": CORRELATION, cookie: `portal_session=${session}` },
    });
    expect(publicSession.status).toBe(401);
    for (const token of ["", "short", "x".repeat(40), "x".repeat(513)]) {
      const response = await context(runId, { "x-assistant-service-token": token, cookie: "portal_session=public-session", authorization: `Bearer ${SERVICE_TOKEN}` });
      expect(response.status).toBe(401);
      const body = await response.text();
      expect(body).not.toContain(SERVICE_TOKEN);
      expect(response.headers.get("x-correlation-id")).toBe(CORRELATION);
    }
    for (const configured of ["", "short", "x".repeat(513)]) {
      app.get(ConfigService).set("ASSISTANT_SERVICE_TOKEN", configured);
      expect((await context()).status).toBe(401);
    }
    expect(JSON.stringify(errors.mock.calls)).not.toContain(SERVICE_TOKEN);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(session);
  });

  it("rejects proxy forwarding headers before service auth or route access", async () => {
    const read = installReadFixture();
    const contextCall = vi.spyOn(tools, "context");
    const executeCall = vi.spyOn(tools, "execute");
    try {
      for (const header of ["Forwarded", "X-Forwarded-For", "X-Forwarded-Host"]) {
        for (const value of ["", "public.portal.example"]) {
          for (const token of [SERVICE_TOKEN, "invalid-token"]) {
            const headers = { [header]: value, "x-assistant-service-token": token };
            expect((await context(runId, headers)).status).toBe(403);
            expect((await execute("search_printers", { args: { query: "printer" } }, headers)).status).toBe(403);
          }
        }
      }
      expect(contextCall).not.toHaveBeenCalled();
      expect(executeCall).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    } finally {
      contextCall.mockRestore();
      executeCall.mockRestore();
    }
  });

  it("requires safe owner and positive bigint generation headers on both routes", async () => {
    const read = installReadFixture();
    for (const headers of [
      { "x-assistant-lease-owner": "" },
      { "x-assistant-lease-owner": "bad owner" },
      { "x-assistant-lease-owner": "x".repeat(129) },
      ...["", "0", "-1", "1.5", "01", "1e1", "9223372036854775808"].map((generation) => ({ "x-assistant-lease-generation": generation })),
    ]) {
      expect((await context(runId, headers)).status).toBe(400);
      expect((await execute("search_printers", { args: { query: "printer" } }, headers)).status).toBe(400);
    }
    for (const route of ["context", "tools/search_printers"]) {
      const response = await fetch(`${baseUrl}/internal/assistant/v1/runs/${runId}/${route}`, {
        method: route === "context" ? "GET" : "POST",
        headers: { "x-correlation-id": CORRELATION, "x-assistant-service-token": SERVICE_TOKEN, "content-type": "application/json" },
        ...(route === "context" ? {} : { body: JSON.stringify({ args: { query: "printer" } }) }),
      });
      expect(response.status).toBe(400);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("fences the previous claim after reclaim on context and tool calls", async () => {
    const read = installReadFixture();
    expect((await context()).status).toBe(200);
    await tx.query("update assistant_runs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [runId]);
    const reclaimed = await tx.query(
      "update assistant_runs set leased_by=$2,lease_generation=lease_generation+1,lease_expires_at=clock_timestamp()+interval '1 hour' where id=$1 and lease_expires_at < clock_timestamp() returning id",
      [runId, "assistant-worker-test-02"],
    );
    expect(reclaimed.rowCount).toBe(1);
    for (const headers of [LEASE_HEADERS, { ...LEASE_HEADERS, "x-assistant-lease-owner": "assistant-worker-test-02" }, { ...LEASE_HEADERS, "x-assistant-lease-generation": "2" }]) {
      expect((await context(runId, headers)).status).toBe(404);
      expect((await execute("search_printers", { args: { query: "printer" } }, headers)).status).toBe(404);
    }
    expect(read).not.toHaveBeenCalled();
    const currentClaim = { "x-assistant-lease-owner": "assistant-worker-test-02", "x-assistant-lease-generation": "2" };
    expect((await context(runId, currentClaim)).status).toBe(200);
    expect((await execute("search_printers", { args: { query: "printer" } }, currentClaim)).status).toBe(200);
    expect(read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(LEASE_OWNER);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(currentClaim["x-assistant-lease-owner"]);
  });

  it("rejects malformed correlation without echoing it", async () => {
    const response = await context(runId, { "x-correlation-id": "bad" });
    expect(response.status).toBe(400);
    expect(response.headers.get("x-correlation-id")).toBeNull();
  });

  it("rejects missing, queued, completed and expired runs", async () => {
    expect((await context(randomUUID())).status).toBe(404);
    expect((await context("invalid-run")).status).toBe(404);
    for (const status of ["queued", "done", "error"]) {
      await tx.query("update assistant_runs set status=$2 where id=$1", [runId, status]);
      expect((await context()).status).toBe(404);
    }
    await tx.query("update assistant_runs set status='running',lease_expires_at=now()-interval '1 second' where id=$1", [runId]);
    expect((await context()).status).toBe(404);
  });

  it("rejects foreign ownership and mismatched triggering thread, content and role", async () => {
    await tx.query("update assistant_runs set user_id=$2 where id=$1", [runId, foreignUserId]);
    expect((await context()).status).toBe(404);
    await tx.query("update assistant_runs set user_id=$2,thread_id=$3 where id=$1", [runId, foreignUserId, foreignThreadId]);
    expect((await context()).status).toBe(404);
    await tx.query("update assistant_runs set user_id=$2,thread_id=$3,message='mismatch' where id=$1", [runId, userId, threadId]);
    expect((await context()).status).toBe(404);
    await tx.query("update assistant_runs set message='Current question' where id=$1", [runId]);
    await tx.query("update assistant_messages set role='assistant',client_request_id=null where id=$1", [messageId]);
    expect((await context()).status).toBe(404);
  });

  it("rechecks revoked account between context and execution before domain access", async () => {
    const read = installReadFixture();
    expect((await context()).status).toBe(200);
    await tx.query("update users set status='restricted' where id=$1", [userId]);
    expect((await execute("search_printers", { args: { query: "printer" } })).status).toBe(403);
    expect((await context()).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });

  it("checks live sanctions even when account status is still active", async () => {
    const read = installReadFixture();
    expect((await context()).status).toBe(200);
    await tx.query(
      "insert into sanctions(user_id,type,state,reason_code,starts_at,created_by,idempotency_key,idempotency_payload_hash) values($1,'ban','active','other',now(),$2,$3,$4)",
      [userId, foreignUserId, randomUUID(), Buffer.alloc(32)],
    );
    expect((await execute("search_printers", { args: { query: "printer" } })).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects invented, prototype, unimplemented and mutating tools without leaking arbitrary input in logs", async () => {
    for (const name of ["invented_tool", "constructor", "__proto__", "search_printers", "generation_offer", "delete_printer", "research_request"]) {
      const response = await execute(name);
      expect(response.status).toBe(404);
      expect(response.headers.get("x-correlation-id")).toBe(CORRELATION);
    }
    const recorded = JSON.stringify(logs.mock.calls);
    expect(recorded).toContain("assistant.tool.completed");
    expect(recorded).not.toContain("invented_tool");
    expect(recorded).not.toContain(SERVICE_TOKEN);
    expect(recorded).not.toContain("Current question");
  });

  it("rejects caller identity/scopes, malformed envelopes and schema-invalid arguments", async () => {
    const read = installReadFixture();
    for (const body of [
      {},
      { args: [] },
      { args: null },
      { args: {}, user_id: foreignUserId },
      { args: {}, scopes: ["admin"] },
      { args: { query: 1 } },
      { args: { query: "printer", user_id: foreignUserId } },
    ]) {
      expect((await execute("search_printers", body)).status).toBe(422);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("propagates only run identity and correlation to a schema-validated read handler", async () => {
    const read = installReadFixture();
    const response = await execute("search_printers", { args: { query: "printer" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ run_id: runId, tool: "search_printers", result: { resolution: "not_found", evidence: [] }, correlation_id: CORRELATION });
    expect(read).toHaveBeenCalledWith({ runId, threadId, messageId, userId, message: "Current question" }, { query: "printer" }, CORRELATION);
  });

  it("omits out-of-scope handlers from context and rejects calls before reads", async () => {
    const read = installReadFixture(["admin:write"]);
    const response = await context();
    expect(((await response.json()) as { tools: string[] }).tools).toEqual([]);
    expect((await execute("search_printers", { args: { query: "printer" } })).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });
});
