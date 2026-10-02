import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { AUTH_STEP_UP_PORT, type AuthStepUpPort } from "../../auth/public/index.ts";
import {
  type PermissionChangeContext,
  type PermissionChangePayload,
  type PermissionChangeResult,
  type PreparedPermissionChange,
  type AdminUserAccessState,
  Permissions,
  PermissionsService,
} from "../../permissions/public/index.ts";

interface BaseInput {
  readonly actorId: UserId;
  readonly targetId: UserId;
  readonly sessionFingerprint: string;
  readonly sessionVersion: number;
  readonly action: PermissionChangePayload["action"];
  readonly reason: string;
}

export interface PreviewPermissionChangeInput extends BaseInput {
  readonly permission?: Permissions;
  readonly grantId?: string;
  readonly expiresAt?: string | null;
  readonly desiredRole?: "user" | "admin";
  readonly directPermissions?: readonly Permissions[];
}

export interface ExecutePermissionChangeInput extends BaseInput {
  readonly confirmationId: string;
  readonly currentPassword?: string;
  readonly password?: string;
  readonly permission?: Permissions;
  readonly grantId?: string;
  readonly expiresAt?: string | null;
  readonly desiredRole?: "user" | "admin";
  readonly directPermissions?: readonly Permissions[];
}

export interface AdminPermissionChangePort {
  preparePermissionChange(input: PermissionChangeContext): Promise<PreparedPermissionChange>;
  executePermissionChange(input: PermissionChangeContext & { readonly confirmationId: string }): Promise<PermissionChangeResult>;
  readUserAccessState(actorId: UserId, targetId: UserId): Promise<AdminUserAccessState>;
}

function requiredPermission(action: PermissionChangePayload["action"]): Permissions {
  switch (action) {
    case "configure_access": return Permissions.USER_VIEW_PERMISSIONS;
    case "assign_admin": return Permissions.USER_ASSIGN_ADMIN;
    case "remove_admin_assignment": return Permissions.USER_REMOVE_ADMIN_ASSIGNMENT;
    case "revoke_all_admin_access": return Permissions.USER_REVOKE_ALL_ADMIN_ACCESS;
    case "grant_permission": return Permissions.USER_GRANT_PERMISSION;
    case "revoke_permission": return Permissions.USER_REVOKE_PERMISSION;
  }
}

function payload(input: BaseInput & { readonly permission?: Permissions; readonly grantId?: string; readonly expiresAt?: string | null; readonly desiredRole?: "user" | "admin"; readonly directPermissions?: readonly Permissions[] }): PermissionChangePayload {
  const reason = input.reason.trim();
  if (reason === "") throw new BadRequestException("Необходимо указать причину изменения доступа");
  if (input.action === "grant_permission") {
    if (input.permission === undefined) throw new BadRequestException("Необходимо указать разрешение");
    return { action: input.action, reason, permission: input.permission, expires_at: input.expiresAt ?? null };
  }
  if (input.action === "configure_access") {
    if (input.directPermissions === undefined) throw new BadRequestException("Необходимо указать роль и разрешения");
    return { action: input.action, reason, direct_permissions: [...new Set(input.directPermissions)].sort() };
  }
  if (input.action === "revoke_permission") {
    if (input.grantId === undefined) throw new BadRequestException("Необходимо указать grant");
    return { action: input.action, reason, grant_id: input.grantId };
  }
  return { action: input.action, reason };
}

@Injectable()
export class AdminAccessService {
  constructor(
    @Inject(PermissionsService) private readonly permissions: AdminPermissionChangePort,
    @Inject(AUTH_STEP_UP_PORT) private readonly stepUp: AuthStepUpPort,
  ) {}

  async preview(input: PreviewPermissionChangeInput): Promise<PreparedPermissionChange> {
    return this.permissions.preparePermissionChange({
      actorId: input.actorId,
      targetId: input.targetId,
      sessionFingerprint: input.sessionFingerprint,
      sessionVersion: input.sessionVersion,
      requiredPermission: requiredPermission(input.action),
      payload: payload(input),
    });
  }

  state(actorId: UserId, targetId: UserId): Promise<AdminUserAccessState> {
    return this.permissions.readUserAccessState(actorId, targetId);
  }

  async execute(input: ExecutePermissionChangeInput): Promise<PermissionChangeResult> {
    const password = input.currentPassword ?? input.password;
    if (password === undefined || !(await this.stepUp.verifyPassword(input.actorId, password))) throw new ForbiddenException("Подтверждение не прошло");
    return this.permissions.executePermissionChange({
      actorId: input.actorId,
      targetId: input.targetId,
      sessionFingerprint: input.sessionFingerprint,
      sessionVersion: input.sessionVersion,
      requiredPermission: requiredPermission(input.action),
      payload: payload(input),
      confirmationId: input.confirmationId,
    });
  }
}
