import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Internal } from "../../permissions/public/index.ts";
import { AssistantToolsService } from "../application/assistant-tools.service.ts";
import { AssistantToolCallDto } from "./assistant-internal.dto.ts";
import { AssistantServiceGuard } from "./assistant-service.guard.ts";

@Controller("internal/assistant/v1")
@Internal()
@ApiExcludeController()
@UseGuards(AssistantServiceGuard)
export class AssistantInternalController {
  constructor(@Inject(AssistantToolsService) private readonly tools: AssistantToolsService) {}

  @Get("runs/:runId/context")
  context(
    @Param("runId") runId: string,
    @Headers("x-correlation-id") correlationId: string,
    @Headers("x-assistant-lease-owner") leaseOwner: string,
    @Headers("x-assistant-lease-generation") leaseGeneration: string,
  ) {
    return this.tools.context(runId, { ownerId: leaseOwner, generation: leaseGeneration }, correlationId);
  }

  @Post("runs/:runId/tools/:toolName")
  @HttpCode(200)
  execute(
    @Param("runId") runId: string,
    @Param("toolName") toolName: string,
    @Body() body: AssistantToolCallDto,
    @Headers("x-correlation-id") correlationId: string,
    @Headers("x-assistant-lease-owner") leaseOwner: string,
    @Headers("x-assistant-lease-generation") leaseGeneration: string,
  ) {
    return this.tools.execute(runId, { ownerId: leaseOwner, generation: leaseGeneration }, toolName, body?.args, correlationId);
  }
}
