import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { FeedPostId, UserId } from "../../_kernel/brandedIds.ts";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { AllPermissions, Permissions } from "../../permissions/public/index.ts";
import { FEED_ADMIN_PORT, type FeedAdminPort } from "../public/index.ts";
import { ApiFeedOperation } from "./openapi.ts";
import { FeedAdminCreateDto, FeedAdminEnvelopeDto, FeedAdminListDto, FeedAdminQueryDto, FeedAdminUpdateDto } from "./feed-admin.dto.ts";

function actor(request: RequestWithSession) {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller("data/news")
export class FeedAdminController {
  constructor(@Inject(FEED_ADMIN_PORT) private readonly admin: FeedAdminPort) {}

  @Get() @AllPermissions(Permissions.FEED_MANAGE_NEWS, Permissions.FEED_NEWS_EDITOR) @ApiFeedOperation("List managed news", { responseType: FeedAdminListDto })
  list(@Req() request: RequestWithSession, @Query() query: FeedAdminQueryDto) { return this.admin.list(actor(request), query); }

  @Get(":id") @AllPermissions(Permissions.FEED_MANAGE_NEWS, Permissions.FEED_NEWS_EDITOR) @ApiFeedOperation("Read managed news", { responseType: FeedAdminEnvelopeDto })
  detail(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string) { return this.admin.detail(actor(request), FeedPostId(id)); }

  @Post() @AllPermissions(Permissions.FEED_MANAGE_NEWS, Permissions.FEED_NEWS_EDITOR) @ApiFeedOperation("Create managed news draft", { status: 201, responseType: FeedAdminEnvelopeDto })
  create(@Req() request: RequestWithSession, @Body() body: FeedAdminCreateDto) { return this.admin.create(actor(request), body); }

  @Patch(":id") @AllPermissions(Permissions.FEED_MANAGE_NEWS, Permissions.FEED_NEWS_EDITOR) @ApiFeedOperation("Update managed news", { responseType: FeedAdminEnvelopeDto })
  update(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: FeedAdminUpdateDto) { return this.admin.update(actor(request), FeedPostId(id), body); }

  @Post(":id/publish") @AllPermissions(Permissions.FEED_MANAGE_NEWS, Permissions.FEED_NEWS_EDITOR) @ApiFeedOperation("Publish managed news", { responseType: FeedAdminEnvelopeDto })
  publish(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string) { return this.admin.publish(actor(request), FeedPostId(id)); }

  @Post(":id/hide") @AllPermissions(Permissions.FEED_MANAGE_NEWS, Permissions.FEED_NEWS_EDITOR) @ApiFeedOperation("Hide managed news", { responseType: FeedAdminEnvelopeDto })
  hide(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string) { return this.admin.hide(actor(request), FeedPostId(id)); }
}
