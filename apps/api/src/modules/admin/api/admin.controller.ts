import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import { parseCookie } from "cookie";
import { SESSION_COOKIE_NAME, SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { CURRENT_ADMIN_PRESET, AllPermissions, Permission, Permissions } from "../../permissions/public/index.ts";
import { assertNestRateLimit } from "../../../nest/integration/rate-limit.ts";
import { AdminReadService } from "../application/admin-read.service.ts";
import { AdminAccessService } from "../application/admin-access.service.ts";
import { AdminOperationsService, type AdministrativeOperationResult } from "../application/admin-operations.service.ts";
import { AdminAuditReadService } from "../application/admin-audit-read.service.ts";
import { AdminAuditExportService } from "../application/admin-audit-export.service.ts";
import { AdminAuditExportCreateDto, AdminAuditQueryDto, AdminConfigureAccessExecuteDto, AdminConfigureAccessPreviewDto, AdminGrantPermissionExecuteDto, AdminGrantPermissionPreviewDto, AdminOperationExecuteDto, AdminOperationPreviewDto, AdminPermissionChangeExecuteDto, AdminPermissionChangePreviewDto, AdminRevokePermissionExecuteDto, AdminRevokePermissionPreviewDto, AdminUsersBrowseQueryDto, AdminUsersSearchBodyDto } from "./admin.dto.ts";
import { ADMIN_USER_SECTION_RESPONSES, ApiAdminAuditEventsOperation, ApiAdminAuditExportCreateOperation, ApiAdminAuditExportDownloadOperation, ApiAdminMeOperation, ApiAdminOperationExecute, ApiAdminOperationPreview, ApiAdminPermissionCatalogOperation, ApiAdminPermissionChangeExecuteOperation, ApiAdminPermissionChangePreviewOperation, ApiAdminResourceOperationExecute, ApiAdminResourceOperationPreview, ApiAdminSessionsOperation, ApiAdminUserAccessStateOperation, ApiAdminUserOperation, ApiAdminUserSectionOperation, ApiAdminUsersBrowseOperation, ApiAdminUsersSearchOperation } from "./openapi.ts";
import type { PermissionChangeEffects } from "../../permissions/public/index.ts";
import type { AdministrativeConfirmationAction } from "../../permissions/public/index.ts";

function permissionChangeActor(request: RequestWithSession & Request): { readonly actorId: ReturnType<typeof UserId>; readonly sessionFingerprint: string; readonly sessionVersion: number } {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  const cookieToken = request.headers.cookie === undefined ? undefined : parseCookie(request.headers.cookie)[SESSION_COOKIE_NAME];
  const token = cookieToken ?? /^Bearer (\S+)$/.exec(request.headers.authorization ?? "")?.[1];
  if (token === undefined || token === "") throw new UnauthorizedException();
  return {
    actorId: UserId(session.id),
    sessionFingerprint: createHash("sha256").update(token).digest("hex"),
    sessionVersion: session.sessionVersion,
  };
}

function permissionEffects(effects: PermissionChangeEffects) {
  const item = (effect: PermissionChangeEffects["added"][number]) => ({
    grant_id: effect.grantId,
    permission: effect.permission,
    provenance: effect.provenance,
  });
  return { added: effects.added.map(item), revoked: effects.revoked.map(item), retained: effects.retained.map(item) };
}

@Controller("v1/admin")
export class AdminController {
  constructor(
    @Inject(AdminReadService) private readonly admin: AdminReadService,
    @Inject(AdminAccessService) private readonly access: AdminAccessService,
    @Inject(AdminOperationsService) private readonly operations: AdminOperationsService,
    @Inject(AdminAuditReadService) private readonly audit: AdminAuditReadService,
    @Inject(AdminAuditExportService) private readonly auditExports: AdminAuditExportService,
  ) {}

  @Get("audit/events")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.AUDIT_VIEW_LOG)
  @ApiAdminAuditEventsOperation()
  auditEvents(@Req() request: RequestWithSession, @Query() query: AdminAuditQueryDto) {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    return this.audit.events(UserId(session.id), {
      cursor: query.cursor, limit: query.limit, action: query.action, targetType: query.target_type,
      actorId: query.actor_id, targetId: query.target_id, from: query.from, to: query.to,
    });
  }

  @Post("audit/exports")
  @Header("Cache-Control", "no-store")
  @AllPermissions(Permissions.AUDIT_VIEW_LOG, Permissions.AUDIT_EXPORT)
  @ApiAdminAuditExportCreateOperation()
  async createAuditExport(@Req() request: RequestWithSession & Request, @Body() body: AdminAuditExportCreateDto) {
    const session = request[SESSION_USER]; if (session === undefined) throw new UnauthorizedException();
    await assertNestRateLimit(request, "download", session.id);
    return this.auditExports.create(UserId(session.id), { from: body.from, to: body.to, action: body.action, targetType: body.target_type, actorId: body.actor_id, targetId: body.target_id, cursor: body.cursor });
  }

  @Get("audit/exports/:id/download")
  @Header("Cache-Control", "no-store")
  @AllPermissions(Permissions.AUDIT_VIEW_LOG, Permissions.AUDIT_EXPORT)
  @ApiAdminAuditExportDownloadOperation()
  async downloadAuditExport(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string, @Res() response: Response): Promise<void> {
    const session = request[SESSION_USER]; if (session === undefined) throw new UnauthorizedException();
    const result = await this.auditExports.download(id, UserId(session.id));
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename=admin-audit-${id}.json`);
    response.setHeader("Content-Length", String(result.byteSize));
    response.setHeader("Digest", `sha-256=${Buffer.from(result.sha256, "hex").toString("base64")}`);
    response.send(result.payload);
  }

  @Get("users/:id/sessions")
  @Header("Cache-Control", "no-store")
  @AllPermissions(Permissions.USER_VIEW_ANY, Permissions.USER_VIEW_SESSIONS)
  @ApiAdminSessionsOperation()
  async userSessions(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string) {
    const session = request[SESSION_USER]; if (session === undefined) throw new UnauthorizedException();
    return { items: (await this.operations.sessionsForUser(UserId(session.id), UserId(id))).map((item) => ({ id: item.id, created_at: item.createdAt.toISOString(), expires_at: item.expiresAt.toISOString(), last_seen_at: item.lastSeenAt.toISOString(), revoked_at: item.revokedAt?.toISOString() ?? null })) };
  }


  @Post("users/:id/account/suspend/preview") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_SUSPEND) @ApiAdminOperationPreview("Preview account suspension")
  previewSuspend(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminOperationPreviewDto) { return this.previewOperation(req, id, body, "suspend_account"); }
  @Post("users/:id/account/suspend/execute") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_SUSPEND) @ApiAdminOperationExecute("Suspend account")
  executeSuspend(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminOperationExecuteDto) { return this.executeOperation(req, id, body, "suspend_account"); }
  @Post("users/:id/account/block/preview") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_BLOCK) @ApiAdminOperationPreview("Preview account block")
  previewBlock(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminOperationPreviewDto) { return this.previewOperation(req, id, body, "block_account"); }
  @Post("users/:id/account/block/execute") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_BLOCK) @ApiAdminOperationExecute("Block account")
  executeBlock(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminOperationExecuteDto) { return this.executeOperation(req, id, body, "block_account"); }
  @Post("users/:id/account/restore/preview") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_RESTORE) @ApiAdminOperationPreview("Preview account restore")
  previewRestore(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminOperationPreviewDto) { return this.previewOperation(req, id, body, "restore_account"); }
  @Post("users/:id/account/restore/execute") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_RESTORE) @ApiAdminOperationExecute("Restore administrative state")
  executeRestore(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminOperationExecuteDto) { return this.executeOperation(req, id, body, "restore_account"); }
  @Post("users/:id/account/close/preview") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_DELETE) @ApiAdminOperationPreview("Preview irreversible account closure")
  previewClose(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminOperationPreviewDto) { return this.previewOperation(req, id, body, "delete_account"); }
  @Post("users/:id/account/close/execute") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_DELETE) @ApiAdminOperationExecute("Close account")
  executeClose(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminOperationExecuteDto) { return this.executeOperation(req, id, body, "delete_account"); }
  @Post("users/:id/export/preview") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_EXPORT) @ApiAdminOperationPreview("Preview administrative metadata export")
  previewExport(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminOperationPreviewDto) { return this.previewOperation(req, id, body, "export_account"); }
  @Post("users/:id/export/execute") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_EXPORT) @ApiAdminOperationExecute("Export bounded administrative metadata")
  executeExport(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminOperationExecuteDto) { return this.executeOperation(req, id, body, "export_account"); }
  @Post("users/:id/sessions/:resourceId/revoke/preview") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_MANAGE_SESSIONS) @ApiAdminResourceOperationPreview("Preview selective browser-session revocation")
  previewSessionRevoke(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Param("resourceId", new ParseUUIDPipe()) resourceId: string, @Body() body: AdminOperationPreviewDto) { return this.previewOperation(req, id, body, "revoke_session", resourceId); }
  @Post("users/:id/sessions/:resourceId/revoke/execute") @Header("Cache-Control", "no-store") @Permission(Permissions.USER_MANAGE_SESSIONS) @ApiAdminResourceOperationExecute("Revoke a browser session")
  executeSessionRevoke(@Req() req: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Param("resourceId", new ParseUUIDPipe()) resourceId: string, @Body() body: AdminOperationExecuteDto) { return this.executeOperation(req, id, body, "revoke_session", resourceId); }

  @Get("me")
  @Permission(Permissions.ADMIN_PORTAL_ACCESS)
  @ApiAdminMeOperation()
  me(@Req() request: RequestWithSession) {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    return this.admin.me(UserId(session.id));
  }

  @Get("permissions/catalog")
  @Permission(Permissions.ADMIN_VIEW_PERMISSION_CATALOG)
  @ApiAdminPermissionCatalogOperation()
  permissionCatalog(@Req() request: RequestWithSession) {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    return this.admin.permissionCatalog(UserId(session.id));
  }

  @Get("users")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_VIEW_ANY)
  @ApiAdminUsersBrowseOperation()
  users(@Req() request: RequestWithSession, @Query() query: AdminUsersBrowseQueryDto) {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    return this.admin.users(UserId(session.id), query);
  }

  @Post("users/search")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_VIEW_ANY)
  @ApiAdminUsersSearchOperation()
  searchUsers(@Req() request: RequestWithSession, @Body() body: AdminUsersSearchBodyDto) {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    return this.admin.searchUsers(UserId(session.id), body);
  }

  @Get("users/:id")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_VIEW_ANY)
  @ApiAdminUserOperation()
  user(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string) {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    return this.admin.user(UserId(session.id), UserId(id));
  }

  @Get("users/:id/access")
  @Header("Cache-Control", "no-store")
  @AllPermissions(Permissions.USER_VIEW_ANY, Permissions.USER_VIEW_PERMISSIONS)
  @ApiAdminUserAccessStateOperation()
  async userAccess(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string) {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    const state = await this.access.state(UserId(session.id), UserId(id));
    return {
      admin_preset: { key: CURRENT_ADMIN_PRESET.key, version: CURRENT_ADMIN_PRESET.version, permissions: CURRENT_ADMIN_PRESET.permissions },
      assignment: state.assignment === null ? null : {
        id: state.assignment.id,
        preset_key: state.assignment.presetKey,
        preset_version: state.assignment.presetVersion,
        preset_snapshot: state.assignment.presetSnapshot,
        assigned_at: state.assignment.assignedAt.toISOString(),
        missing_snapshot_permissions: state.assignment.missingSnapshotPermissions,
        additional_direct_permissions: state.assignment.additionalDirectPermissions,
        current_preset_added: state.assignment.currentPresetAdded,
        current_preset_removed: state.assignment.currentPresetRemoved,
      },
      grants: state.grants.map((grant) => ({
        id: grant.id,
        permission: grant.permission,
        scope: grant.scope,
        expires_at: grant.expiresAt?.toISOString() ?? null,
        provenance: grant.provenance,
        assignment_id: grant.assignmentId,
      })),
    };
  }

  @Get("users/:id/sanctions")
  @Header("Cache-Control", "no-store")
  @AllPermissions(Permissions.USER_VIEW_ANY, Permissions.MODERATION_VIEW_SANCTIONS)
  @ApiAdminUserSectionOperation("Read the latest 50 masked sanction records", ADMIN_USER_SECTION_RESPONSES.sanctions)
  sanctions(@Req() request: RequestWithSession, @Param("id", new ParseUUIDPipe()) id: string) {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    return this.admin.sanctionHistory(UserId(session.id), UserId(id));
  }

  @Post("users/:id/admin-assignment/preview")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_ASSIGN_ADMIN)
  @ApiAdminPermissionChangePreviewOperation("Preview assignment of Admin preset v1", AdminPermissionChangePreviewDto)
  async previewAssignAdmin(@Req() request: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminPermissionChangePreviewDto) {
    const actor = permissionChangeActor(request);
    const intent = await this.access.preview({ ...actor, targetId: UserId(id), action: "assign_admin", reason: body.reason });
    return { confirmation_id: intent.id, expires_at: intent.expiresAt.toISOString(), effects: permissionEffects(intent.effects) };
  }

  @Post("users/:id/access/configure/preview")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_VIEW_PERMISSIONS)
  @ApiAdminPermissionChangePreviewOperation("Preview atomic role and direct-permission configuration", AdminConfigureAccessPreviewDto)
  async previewConfigureAccess(@Req() request: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id:string, @Body() body:AdminConfigureAccessPreviewDto) {
    const actor=permissionChangeActor(request);
    const intent=await this.access.preview({...actor,targetId:UserId(id),action:"configure_access",reason:body.reason,directPermissions:body.permissions});
    return {confirmation_id:intent.id,expires_at:intent.expiresAt.toISOString(),effects:permissionEffects(intent.effects)};
  }

  @Post("users/:id/access/configure/execute")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_VIEW_PERMISSIONS)
  @ApiAdminPermissionChangeExecuteOperation("Execute atomic role and direct-permission configuration", AdminConfigureAccessExecuteDto)
  async executeConfigureAccess(@Req() request:RequestWithSession & Request,@Param("id",new ParseUUIDPipe()) id:string,@Body() body:AdminConfigureAccessExecuteDto) {
    const actor=permissionChangeActor(request);await assertNestRateLimit(request,"admin_permission_step_up",actor.actorId);
const result=await this.access.execute({...actor,targetId:UserId(id),action:"configure_access",reason:body.reason,confirmationId:body.confirmation_id,currentPassword:body.currentPassword,directPermissions:body.permissions});
    return {action:result.action,created_grant_ids:result.createdGrantIds,revoked_grant_ids:result.revokedGrantIds,remaining_direct_permissions:result.remainingDirectPermissions};
  }

  @Post("users/:id/admin-assignment/execute")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_ASSIGN_ADMIN)
  @ApiAdminPermissionChangeExecuteOperation("Execute assignment of Admin preset v1", AdminPermissionChangeExecuteDto)
  async executeAssignAdmin(@Req() request: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminPermissionChangeExecuteDto) {
    return this.executeAccess(request, id, body, "assign_admin");
  }

  @Post("users/:id/admin-assignment/remove/preview")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_REMOVE_ADMIN_ASSIGNMENT)
  @ApiAdminPermissionChangePreviewOperation("Preview removal of assignment-owned Admin grants", AdminPermissionChangePreviewDto)
  async previewRemoveAdmin(@Req() request: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminPermissionChangePreviewDto) {
    const actor = permissionChangeActor(request);
    const intent = await this.access.preview({ ...actor, targetId: UserId(id), action: "remove_admin_assignment", reason: body.reason });
    return { confirmation_id: intent.id, expires_at: intent.expiresAt.toISOString(), effects: permissionEffects(intent.effects) };
  }

  @Post("users/:id/admin-assignment/remove/execute")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_REMOVE_ADMIN_ASSIGNMENT)
  @ApiAdminPermissionChangeExecuteOperation("Execute removal of assignment-owned Admin grants", AdminPermissionChangeExecuteDto)
  executeRemoveAdmin(@Req() request: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminPermissionChangeExecuteDto) {
    return this.executeAccess(request, id, body, "remove_admin_assignment");
  }

  @Post("users/:id/admin-access/revoke-all/preview")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_REVOKE_ALL_ADMIN_ACCESS)
  @ApiAdminPermissionChangePreviewOperation("Preview revocation of all administrative grants", AdminPermissionChangePreviewDto)
  async previewRevokeAll(@Req() request: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminPermissionChangePreviewDto) {
    const actor = permissionChangeActor(request);
    const intent = await this.access.preview({ ...actor, targetId: UserId(id), action: "revoke_all_admin_access", reason: body.reason });
    return { confirmation_id: intent.id, expires_at: intent.expiresAt.toISOString(), effects: permissionEffects(intent.effects) };
  }

  @Post("users/:id/admin-access/revoke-all/execute")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_REVOKE_ALL_ADMIN_ACCESS)
  @ApiAdminPermissionChangeExecuteOperation("Execute revocation of all administrative grants", AdminPermissionChangeExecuteDto)
  executeRevokeAll(@Req() request: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminPermissionChangeExecuteDto) {
    return this.executeAccess(request, id, body, "revoke_all_admin_access");
  }

  @Post("users/:id/permissions/grant/preview")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_GRANT_PERMISSION)
  @ApiAdminPermissionChangePreviewOperation("Preview a direct permission grant", AdminGrantPermissionPreviewDto)
  async previewGrant(@Req() request: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminGrantPermissionPreviewDto) {
    const actor = permissionChangeActor(request);
    const intent = await this.access.preview({ ...actor, targetId: UserId(id), action: "grant_permission", reason: body.reason, permission: body.permission, expiresAt: body.expires_at });
    return { confirmation_id: intent.id, expires_at: intent.expiresAt.toISOString(), effects: permissionEffects(intent.effects) };
  }

  @Post("users/:id/permissions/grant/execute")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_GRANT_PERMISSION)
  @ApiAdminPermissionChangeExecuteOperation("Execute a direct permission grant", AdminGrantPermissionExecuteDto)
  executeGrant(@Req() request: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminGrantPermissionExecuteDto) {
    return this.executeAccess(request, id, body, "grant_permission");
  }

  @Post("users/:id/permissions/revoke/preview")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_REVOKE_PERMISSION)
  @ApiAdminPermissionChangePreviewOperation("Preview revocation of a permission grant", AdminRevokePermissionPreviewDto)
  async previewRevoke(@Req() request: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminRevokePermissionPreviewDto) {
    const actor = permissionChangeActor(request);
    const intent = await this.access.preview({ ...actor, targetId: UserId(id), action: "revoke_permission", reason: body.reason, grantId: body.grant_id });
    return { confirmation_id: intent.id, expires_at: intent.expiresAt.toISOString(), effects: permissionEffects(intent.effects) };
  }

  @Post("users/:id/permissions/revoke/execute")
  @Header("Cache-Control", "no-store")
  @Permission(Permissions.USER_REVOKE_PERMISSION)
  @ApiAdminPermissionChangeExecuteOperation("Execute revocation of a permission grant", AdminRevokePermissionExecuteDto)
  executeRevoke(@Req() request: RequestWithSession & Request, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: AdminRevokePermissionExecuteDto) {
    return this.executeAccess(request, id, body, "revoke_permission");
  }

  private async executeAccess(
    request: RequestWithSession & Request,
    targetId: string,
    body: AdminPermissionChangeExecuteDto & { readonly permission?: Permissions; readonly grant_id?: string; readonly expires_at?: string | null },
    action: "assign_admin" | "remove_admin_assignment" | "revoke_all_admin_access" | "grant_permission" | "revoke_permission",
  ) {
    const actor = permissionChangeActor(request);
    await assertNestRateLimit(request, "admin_permission_step_up", actor.actorId);
    const result = await this.access.execute({
      ...actor, targetId: UserId(targetId), action, reason: body.reason, password: body.password,
      confirmationId: body.confirmation_id, permission: body.permission, grantId: body.grant_id, expiresAt: body.expires_at,
    });
    return { action: result.action, created_grant_ids: result.createdGrantIds, revoked_grant_ids: result.revokedGrantIds, remaining_direct_permissions: result.remainingDirectPermissions };
  }

  private async previewOperation(request: RequestWithSession & Request, targetId: string, body: AdminOperationPreviewDto, action: AdministrativeConfirmationAction, resourceId?: string) {
    const intent = await this.operations.preview(permissionChangeActor(request), UserId(targetId), { action, reason: body.reason, ...(resourceId === undefined ? {} : { resourceId }) });
    return { confirmation_id: intent.id, expires_at: intent.expiresAt.toISOString(), effects: intent.effects };
  }

  private executeOperation(request: RequestWithSession & Request, targetId: string, body: AdminOperationExecuteDto, action: AdministrativeConfirmationAction, resourceId?: string): Promise<AdministrativeOperationResult> {
    return this.operations.execute(permissionChangeActor(request), UserId(targetId), { action, reason: body.reason, password: body.password, confirmationId: body.confirmation_id, ...(resourceId === undefined ? {} : { resourceId }) });
  }
}
