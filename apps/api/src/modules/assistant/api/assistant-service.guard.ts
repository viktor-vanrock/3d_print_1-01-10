import { createHash, timingSafeEqual } from "node:crypto";
import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";

const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

@Injectable()
export class AssistantServiceGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const correlationId = request.header("x-correlation-id");
    if (correlationId === undefined || !CORRELATION_ID.test(correlationId)) throw new BadRequestException();
    http.getResponse<Response>().setHeader("x-correlation-id", correlationId);

    // Internal workers call the API directly; public proxy paths must fail closed.
    if (["forwarded", "x-forwarded-for", "x-forwarded-host"].some((header) => request.headers[header] !== undefined)) throw new ForbiddenException();

    const expected = this.config.get<string>("ASSISTANT_SERVICE_TOKEN") ?? "";
    const actual = request.header("x-assistant-service-token") ?? "";
    // Fixed-size digests preserve the relay-internal constant-time comparison pattern.
    const equal = timingSafeEqual(createHash("sha256").update(actual, "utf8").digest(), createHash("sha256").update(expected, "utf8").digest());
    if (expected.length < 32 || expected.length > 512 || actual.length < 32 || actual.length > 512 || !equal) throw new UnauthorizedException();
    return true;
  }
}
