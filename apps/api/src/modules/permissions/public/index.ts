export { PermissionsService } from "../application/permissions.service.ts";
import type { Permissions } from "../domain/permissions.catalog.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PoolClient } from "pg";
export { Internal } from "../decorators/internal.decorator.ts";
export { AllPermissions } from "../decorators/all-permissions.decorator.ts";
export { Permission } from "../decorators/permission.decorator.ts";
export { Public } from "../decorators/public.decorator.ts";
export { User } from "../decorators/user.decorator.ts";
export { UserOrAgent } from "../decorators/user-or-agent.decorator.ts";
export type {
  PermissionCategory,
  PermissionConfirmation,
  PermissionDefinition,
  PermissionRisk,
  PermissionScopeKind,
} from "../domain/permission-definition.ts";
export { GLOBAL_PERMISSION_SCOPE, type PermissionScope } from "../domain/permission-scope.ts";
export {
  ADMIN_PRESET_V1,
  ADMIN_PRESET_V2,
  CURRENT_ADMIN_PRESET,
  ADMINISTRATIVE_PERMISSIONS,
  canonicalPermissionChangePayload,
  type PermissionChangeContext,
  type PermissionChangePayload,
  type PermissionChangeResult,
  type PreparedPermissionChange,
  type AdminAssignmentAccessState,
  type AdminUserAccessState,
  type PermissionAccessGrant,
  type PermissionChangeEffect,
  type PermissionChangeEffects,
} from "../domain/admin-assignment.ts";
export {
  ALL_PERMISSIONS,
  DATA_CAPABILITIES,
  SESSION_CAPABILITIES,
  PERMISSION_DEFINITIONS,
  Permissions,
  type DataCapability,
  type SessionCapability,
} from "../domain/permissions.catalog.ts";
export { PermissionsModule } from "../permissions.module.ts";

export { PERMISSION_CONFIRMATION_PORT } from "../application/permissions.service.ts";
export type AdministrativeConfirmationAction =
  | "suspend_account" | "block_account" | "restore_account" | "delete_account" | "export_account"
  | "revoke_session";
export interface AdministrativeConfirmationEffects {
  readonly action: AdministrativeConfirmationAction;
  readonly sessions_revoked: readonly string[];
  readonly keys_revoked: readonly string[];
  readonly retained: readonly string[];
}
export interface PermissionConfirmationPort {
  prepareAdministrativeConfirmation(input: {
    readonly actorId: UserId;
    readonly targetId: UserId;
    readonly sessionFingerprint: string;
    readonly sessionVersion: number;
    readonly action: AdministrativeConfirmationAction;
    readonly requiredPermission: Permissions;
    readonly payload: Readonly<Record<string, string | null>>;
    readonly snapshot: (tx: PoolClient) => Promise<{ readonly stateHash: string; readonly effects: AdministrativeConfirmationEffects }>;
  }): Promise<{ readonly id: string; readonly expiresAt: Date; readonly effects: AdministrativeConfirmationEffects }>;
  executeAdministrativeConfirmation(input: {
    readonly confirmationId: string;
    readonly actorId: UserId;
    readonly targetId: UserId;
    readonly sessionFingerprint: string;
    readonly sessionVersion: number;
    readonly action: AdministrativeConfirmationAction;
    readonly requiredPermission: Permissions;
    readonly payload: Readonly<Record<string, string | null>>;
    readonly currentStateHash: (tx: PoolClient) => Promise<string>;
    readonly mutate: (tx: PoolClient) => Promise<void>;
  }): Promise<void>;
}
