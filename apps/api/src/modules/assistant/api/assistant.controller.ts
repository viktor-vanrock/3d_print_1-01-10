import { Body, Controller, Delete, Get, Headers, HttpCode, HttpException, HttpStatus, Inject, Param, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { streamSseEvents } from "../../../nest/http/stream-sse.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { User } from "../../permissions/public/index.ts";
import { ASSISTANT_PORT, type AssistantPort } from "../public/index.ts";
import { AssistantListQueryDto, AssistantLooseBodyDto } from "./assistant.dto.ts";
import { ApiAssistantOperation } from "./openapi.ts";

function user(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

function errorCode(error: unknown): string {
  const rawCode = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof rawCode === "string" && /^[A-Z0-9_]{1,32}$/i.test(rawCode) ? rawCode : "unknown";
}

function streamLimit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

@Controller()
@User()
export class AssistantController {
  private lastStreamErrorLogAt = 0;
  private readonly streamsByUser = new Map<string, number>();
  private readonly streamsByIp = new Map<string, number>();
  private activeStreams = 0;

  constructor(
    @Inject(ASSISTANT_PORT) private readonly assistant: AssistantPort,
    @Inject(RuntimeLogger) private readonly logger: RuntimeLogger,
  ) {}

  private logStreamError(kind: "thread" | "run", error: unknown): void {
    const now = Date.now();
    if (now - this.lastStreamErrorLogAt < 30_000) return;
    this.lastStreamErrorLogAt = now;
    this.logger.warn({ event: "assistant.sse_stream_failed", error_code: errorCode(error), reason: kind }, "Assistant SSE stream failed; client may reconnect");
  }

  private acquireStream(userId: UserIdType, ip: string): () => void {
    const userCount = this.streamsByUser.get(userId) ?? 0;
    const ipCount = this.streamsByIp.get(ip) ?? 0;
    if (
      userCount >= streamLimit("ASSISTANT_SSE_USER_CONCURRENT_LIMIT", 4) ||
      ipCount >= streamLimit("ASSISTANT_SSE_IP_CONCURRENT_LIMIT", 40) ||
      this.activeStreams >= streamLimit("ASSISTANT_SSE_INSTANCE_CONCURRENT_LIMIT", 500)
    ) throw new HttpException("Too many assistant event streams", HttpStatus.TOO_MANY_REQUESTS);
    this.streamsByUser.set(userId, userCount + 1);
    this.streamsByIp.set(ip, ipCount + 1);
    this.activeStreams += 1;
    return () => {
      const remainingUser = (this.streamsByUser.get(userId) ?? 1) - 1;
      const remainingIp = (this.streamsByIp.get(ip) ?? 1) - 1;
      if (remainingUser === 0) this.streamsByUser.delete(userId);
      else this.streamsByUser.set(userId, remainingUser);
      if (remainingIp === 0) this.streamsByIp.delete(ip);
      else this.streamsByIp.set(ip, remainingIp);
      this.activeStreams -= 1;
    };
  }

  @Post("assistant/threads")
  @ApiAssistantOperation("Create assistant thread", { status: 201, body: true, response: "thread" })
  createThread(@Req() request: RequestWithSession, @Body() body: AssistantLooseBodyDto | undefined) {
    return this.assistant.createThread(user(request), body?.title, request);
  }

  @Get("assistant/threads")
  @ApiAssistantOperation("List own assistant threads", { response: "threads" })
  listThreads(@Req() request: RequestWithSession, @Query() query: AssistantListQueryDto) {
    return this.assistant.listThreads(user(request), { ...query });
  }

  @Get("assistant/threads/:id")
  @ApiAssistantOperation("Read own assistant thread")
  thread(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.assistant.threadDetail(user(request), id);
  }

  @Delete("assistant/threads/:id")
  @HttpCode(204)
  @ApiAssistantOperation("Delete own assistant thread", { status: 204, response: "empty" })
  async deleteThread(@Req() request: RequestWithSession, @Param("id") id: string): Promise<void> {
    await this.assistant.deleteThread(user(request), id);
  }

  @Post("assistant/threads/:id/read")
  @HttpCode(200)
  @ApiAssistantOperation("Mark assistant thread read")
  read(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.assistant.markThreadRead(user(request), id);
  }

  @Get("assistant/threads/:id/events")
  @ApiAssistantOperation("Stream assistant thread events", { sse: "thread" })
  async threadEvents(@Req() request: RequestWithSession, @Res() response: Response, @Param("id") id: string, @Headers("last-event-id") lastEventId: unknown) {
    const userId = user(request);
    await this.assistant.assertStreamOpen(userId, request);
    const release = this.acquireStream(userId, request.ip ?? request.socket.remoteAddress ?? "unknown");
    const abort = new AbortController();
    response.on("close", () => abort.abort());
    try {
      const source = await this.assistant.openThreadEvents(userId, id, lastEventId, abort.signal);
      await streamSseEvents(response, source.frames, (error) => this.logStreamError("thread", error));
    } finally {
      abort.abort();
      release();
    }
  }

  @Get("assistant/threads/:id/messages")
  @ApiAssistantOperation("List assistant thread messages", { response: "messages" })
  messages(@Req() request: RequestWithSession, @Param("id") id: string, @Query() query: AssistantListQueryDto) {
    return this.assistant.listMessages(user(request), id, { ...query });
  }

  @Post("assistant/threads/:id/messages")
  @ApiAssistantOperation("Create assistant message and queue run", { status: 201, body: true, response: "message", replay: true })
  async createMessage(
    @Req() request: RequestWithSession,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
    @Body() body: AssistantLooseBodyDto | undefined,
  ) {
    const result = await this.assistant.createMessage(user(request), id, { ...(body ?? {}) }, request);
    if (result.status === 201 && result.body.run !== null) {
      this.logger.info(
        { event: "assistant.run.queued.v1", request_id: result.body.run.id, outcome: result.body.run.status },
        "assistant run queued",
      );
    }
    response.status(result.status);
    return result.body;
  }

  @Get("assistant/threads/:id/runs/:runId")
  @ApiAssistantOperation("Read assistant run state", { response: "run" })
  run(@Req() request: RequestWithSession, @Param("id") id: string, @Param("runId") runId: string) {
    return this.assistant.runDetail(user(request), id, runId);
  }

  @Get("assistant/runs/:id/events")
  @ApiAssistantOperation("Stream assistant run events", { sse: "run" })
  async runEvents(@Req() request: RequestWithSession, @Res() response: Response, @Param("id") id: string, @Headers("last-event-id") lastEventId: unknown) {
    const userId = user(request);
    await this.assistant.assertStreamOpen(userId, request);
    const release = this.acquireStream(userId, request.ip ?? request.socket.remoteAddress ?? "unknown");
    const abort = new AbortController();
    response.on("close", () => abort.abort());
    try {
      const source = await this.assistant.openRunEvents(userId, id, lastEventId, abort.signal);
      await streamSseEvents(response, source.frames, (error) => this.logStreamError("run", error));
    } finally {
      abort.abort();
      release();
    }
  }

  @Post("assistant/threads/:id/generations")
  @ApiAssistantOperation("Confirm generation offer", { status: 201, body: true, response: "generation", replay: true })
  async generation(@Req() request: RequestWithSession, @Res({ passthrough: true }) response: Response, @Param("id") id: string, @Body() body: AssistantLooseBodyDto | undefined) {
    const result = await this.assistant.confirmGeneration(user(request), id, body?.run_id);
    response.status(result.status);
    return result.body;
  }

  @Post("assistant/prompt-variants")
  @HttpCode(200)
  @ApiAssistantOperation("Generate prompt variants", { body: true, response: "prompt-variants" })
  promptVariants(@Req() request: RequestWithSession, @Body() body: AssistantLooseBodyDto | undefined) {
    return this.assistant.promptVariants(user(request), { ...(body ?? {}) }, request);
  }
}
