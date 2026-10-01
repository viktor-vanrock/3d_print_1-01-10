import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PoolClient } from "pg";
import { PermissionGrantAlreadyActiveError, type PermissionGrant, type PermissionScope } from "../domain/permission-grant.ts";
import { GLOBAL_PERMISSION_SCOPE, parsePermissionScope, permissionScopeCovers } from "../domain/permission-scope.ts";
import {
  PERMISSION_DEFINITIONS,
  SESSION_CAPABILITIES,
  SESSION_CAPABILITY_PERMISSIONS,
  BOOTSTRAP_ADMIN_PERMISSIONS,
  SUPERADMIN_BINDING_DATA_EVIDENCE_PERMISSIONS,
  SUPERADMIN_BINDING_ROOT_EVIDENCE_PERMISSIONS,
  type SessionCapability,
  Permissions,
} from "../domain/permissions.catalog.ts";
import type {
  PermissionChangeContext,
  PermissionChangeResult,
  PreparedPermissionChange,
  AdminUserAccessState,
} from "../domain/admin-assignment.ts";

export const PERMISSION_GRANTS_REPOSITORY = Symbol("PERMISSION_GRANTS_REPOSITORY");
export const PERMISSION_CONFIRMATION_PORT = Symbol("PERMISSION_CONFIRMATION_PORT");

// Репозиторий отвечает за атомарную запись grant и его audit-события. Проверка
// применимости scope остаётся в сервисе — это единственная точка решения доступа.
export interface PermissionGrantsRepository {
  isUserActive(userId: UserId): Promise<boolean>;
  findActiveGrants(input: { readonly userId: UserId; readonly permission: Permissions; readonly now: Date }): Promise<readonly PermissionGrant[]>;
  findActivePermissions(input: {
    readonly userId: UserId;
    readonly permissions: readonly Permissions[];
    readonly now: Date;
  }): Promise<readonly Permissions[]>;
  findAllActiveGrants(input: { readonly userId: UserId; readonly now: Date }): Promise<readonly PermissionGrant[]>;
  findById(grantId: string): Promise<PermissionGrant | null>;
  isSuperadminUser(userId: UserId): Promise<boolean>;
  projectAdministrativeRoles(userIds: readonly UserId[]): Promise<ReadonlyMap<UserId, "admin" | "superadmin">>;
  hasAnyPermissionGrantsInTransaction(client: PoolClient): Promise<boolean>;
  recordAdminMeViewed(input: { readonly actorId: UserId; readonly permissionCount: number }): Promise<void>;
  recordAdminPermissionCatalogViewed(input: { readonly actorId: UserId; readonly permissionCount: number }): Promise<void>;
  ensureBootstrapPermissions(input: { readonly userId: UserId; readonly permissions: readonly Permissions[]; readonly reason: string }): Promise<{ readonly created: number; readonly skipped: number }>;
  ensureBootstrapPermissionsInTransaction(client: PoolClient, input: { readonly userId: UserId; readonly permissions: readonly Permissions[]; readonly reason: string }): Promise<{ readonly created: number; readonly skipped: number }>;
  hasCompleteBootstrapEvidenceInTransaction(client: PoolClient, input: { readonly userId: UserId; readonly permissions: readonly Permissions[]; readonly reason: string }): Promise<boolean>;
  recordSuperadminBootstrapEventsInTransaction(client: PoolClient, input: { readonly userId: UserId; readonly events: readonly string[] }): Promise<void>;
  preparePermissionChange(input: PermissionChangeContext): Promise<PreparedPermissionChange>;
  executePermissionChange(input: PermissionChangeContext & { readonly confirmationId: string }): Promise<PermissionChangeResult>;
  readUserAccessState(input: { readonly actorId: UserId; readonly targetId: UserId }): Promise<AdminUserAccessState>;
  createWithAudit(input: {
    readonly userId: UserId;
    readonly permission: Permissions;
    readonly scope: PermissionScope;
    readonly grantedBy: UserId;
    readonly reason: string;
    readonly expiresAt: Date | null;
  }): Promise<PermissionGrant>;
  revokeWithAudit(input: {
    readonly grantId: string;
    readonly revokedBy: UserId;
    readonly reason: string;
  }): Promise<boolean>;
}

export interface GrantPermissionInput {
  readonly actorId: UserId;
  readonly userId: UserId;
  readonly permission: Permissions;
  readonly scope?: PermissionScope;
  readonly reason: string;
  readonly expiresAt?: Date | null;
}

export interface RevokePermissionInput {
  readonly actorId: UserId;
  readonly grantId: string;
  readonly reason: string;
}

@Injectable()
export class PermissionsService {
  constructor(@Inject(PERMISSION_GRANTS_REPOSITORY) private readonly grants: PermissionGrantsRepository) {}

  async isActiveUser(userId: UserId): Promise<boolean> {
    try {
      return await this.grants.isUserActive(userId);
    } catch {
      return false;
    }
  }

  // Fail-closed: отсутствующий/неактивный пользователь, истёкший или отозванный
  // grant, а также несовпадающий scope всегда возвращают false.
  async hasPermission(userId: UserId, permission: Permissions, scope?: PermissionScope): Promise<boolean> {
    try {
      const definition = PERMISSION_DEFINITIONS[permission];
      if (scope !== undefined && !definition.allowedScopeKinds.includes(scope.kind)) return false;
      if (!(await this.isActiveUser(userId))) return false;
      const now = new Date();
      const grants = await this.grants.findActiveGrants({ userId, permission, now });
      return grants.some((grant) => {
        if (grant.revokedAt !== null) return false;
        if (grant.expiresAt !== null && grant.expiresAt <= now) return false;
        if (!definition.allowedScopeKinds.includes(grant.scope.kind)) return false;
        return permissionScopeCovers(grant.scope, scope);
      });
    } catch {
      return false;
    }
  }

  async sessionCapabilities(userId: UserId): Promise<readonly SessionCapability[]> {
    try {
      if (!(await this.isActiveUser(userId))) return [];
      const requested = [...SESSION_CAPABILITIES.map((capability) => SESSION_CAPABILITY_PERMISSIONS[capability]), Permissions.FEED_NEWS_EDITOR];
      const active = new Set(await this.grants.findActivePermissions({ userId, permissions: requested, now: new Date() }));
      return SESSION_CAPABILITIES.filter((capability) =>
        active.has(SESSION_CAPABILITY_PERMISSIONS[capability]) &&
        (capability !== "data.news.manage" || active.has(Permissions.FEED_NEWS_EDITOR)),
      );
    } catch {
      return [];
    }
  }

  ensureBootstrapAdminPermissions(userId: UserId): Promise<{ readonly created: number; readonly skipped: number }> {
    return this.grants.ensureBootstrapPermissions({
      userId,
      permissions: BOOTSTRAP_ADMIN_PERMISSIONS,
      reason: "automatic bootstrap root access",
    });
  }

  administrativeRoles(userIds: readonly UserId[]): Promise<ReadonlyMap<UserId, "admin" | "superadmin">> {
    return this.grants.projectAdministrativeRoles(userIds);
  }

  ensureBootstrapAdminPermissionsInTransaction(client: PoolClient, userId: UserId): Promise<{ readonly created: number; readonly skipped: number }> {
    return this.grants.ensureBootstrapPermissionsInTransaction(client, {
      userId,
      permissions: BOOTSTRAP_ADMIN_PERMISSIONS,
      reason: "automatic bootstrap root access",
    });
  }

  hasCompleteBootstrapEvidenceInTransaction(client: PoolClient, userId: UserId): Promise<boolean> {
    return Promise.all([
      this.grants.hasCompleteBootstrapEvidenceInTransaction(client, {
        userId,
        permissions: SUPERADMIN_BINDING_ROOT_EVIDENCE_PERMISSIONS,
        reason: "automatic bootstrap root access",
      }),
      this.grants.hasCompleteBootstrapEvidenceInTransaction(client, {
        userId,
        permissions: SUPERADMIN_BINDING_DATA_EVIDENCE_PERMISSIONS,
        reason: "automatic bootstrap data workspace access",
      }),
    ]).then(([root, data]) => root && data);
  }

  hasAnyPermissionGrantsInTransaction(client: PoolClient): Promise<boolean> {
    return this.grants.hasAnyPermissionGrantsInTransaction(client);
  }

  recordSuperadminBootstrapEventsInTransaction(client: PoolClient, userId: UserId, events: readonly string[]): Promise<void> {
    return this.grants.recordSuperadminBootstrapEventsInTransaction(client, { userId, events });
  }

  preparePermissionChange(input: PermissionChangeContext): Promise<PreparedPermissionChange> {
    return this.grants.preparePermissionChange(input);
  }

  executePermissionChange(input: PermissionChangeContext & { readonly confirmationId: string }): Promise<PermissionChangeResult> {
    return this.grants.executePermissionChange(input);
  }

  readUserAccessState(actorId: UserId, targetId: UserId): Promise<AdminUserAccessState> {
    return this.grants.readUserAccessState({ actorId, targetId });
  }

  async listEffectiveGrants(userId: UserId): Promise<readonly PermissionGrant[]> {
    if (!(await this.isActiveUser(userId))) throw new ForbiddenException();
    return this.grants.findAllActiveGrants({ userId, now: new Date() });
  }

  recordAdminMeViewed(actorId: UserId, permissionCount: number): Promise<void> {
    return this.grants.recordAdminMeViewed({ actorId, permissionCount });
  }

  recordAdminPermissionCatalogViewed(actorId: UserId, permissionCount: number): Promise<void> {
    return this.grants.recordAdminPermissionCatalogViewed({ actorId, permissionCount });
  }

  private async assertDelegationTargetAllowed(actorId: UserId, permission: Permissions, scope: PermissionScope): Promise<void> {
    const definition = PERMISSION_DEFINITIONS[permission];
    if (!definition.delegable) throw new ForbiddenException();
    if (definition.confirmation !== "none") throw new ForbiddenException("Операция требует серверного подтверждения");
    if (!(await this.hasPermission(actorId, permission, scope))) throw new ForbiddenException();
  }

  async grant(input: GrantPermissionInput): Promise<PermissionGrant> {
    if (input.permission === Permissions.FEED_NEWS_EDITOR) throw new ForbiddenException("Разрешение управляется системой");
    if (await this.grants.isSuperadminUser(input.userId)) throw new ForbiddenException("Права Superadmin управляются только startup provisioning");
    if (input.actorId === input.userId) throw new ForbiddenException("Нельзя выдать разрешение самому себе");
    const reason = input.reason.trim();
    if (reason === "") throw new BadRequestException("Необходимо указать причину выдачи разрешения");
    const expiresAt = input.expiresAt ?? null;
    if (expiresAt !== null && expiresAt <= new Date()) throw new BadRequestException("Срок действия разрешения должен быть в будущем");
    const scope = parsePermissionScope(input.scope ?? GLOBAL_PERMISSION_SCOPE);
    if (scope === null) throw new BadRequestException("Некорректная область действия разрешения");
    if (!PERMISSION_DEFINITIONS[input.permission].allowedScopeKinds.includes(scope.kind)) {
      throw new BadRequestException("Область действия недоступна для этого разрешения");
    }
    if (!(await this.hasPermission(input.actorId, Permissions.USER_GRANT_PERMISSION))) throw new ForbiddenException();
    await this.assertDelegationTargetAllowed(input.actorId, input.permission, scope);
    try {
      return await this.grants.createWithAudit({
        userId: input.userId,
        permission: input.permission,
        scope,
        grantedBy: input.actorId,
        reason,
        expiresAt,
      });
    } catch (error) {
      if (error instanceof PermissionGrantAlreadyActiveError) throw new ConflictException("Разрешение уже активно");
      throw error;
    }
  }

  async revoke(input: RevokePermissionInput): Promise<boolean> {
    const reason = input.reason.trim();
    if (reason === "") throw new BadRequestException("Необходимо указать причину отзыва разрешения");
    if (!(await this.hasPermission(input.actorId, Permissions.USER_REVOKE_PERMISSION))) throw new ForbiddenException();
    const grant = await this.grants.findById(input.grantId);
    if (grant === null || grant.revokedAt !== null) return false;
    if (await this.grants.isSuperadminUser(grant.userId)) throw new ForbiddenException("Права Superadmin управляются только startup provisioning");
    await this.assertDelegationTargetAllowed(input.actorId, grant.permission, grant.scope);
    return this.grants.revokeWithAudit({ grantId: input.grantId, revokedBy: input.actorId, reason });
  }
}
