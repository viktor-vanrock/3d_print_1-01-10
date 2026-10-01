import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { SYSTEM_USER_ID, UserId } from "../../_kernel/brandedIds.ts";
import type { PermissionGrantsRepository } from "../application/permissions.service.ts";
import { PermissionGrantAlreadyActiveError, type PermissionGrant, type PermissionScope } from "../domain/permission-grant.ts";
import { GLOBAL_PERMISSION_SCOPE, parsePermissionScope } from "../domain/permission-scope.ts";
import { ALL_PERMISSIONS, PERMISSION_DEFINITIONS, Permissions } from "../domain/permissions.catalog.ts";
import {
  ADMINISTRATIVE_PERMISSIONS,
  CURRENT_ADMIN_PRESET,
  canonicalPermissionChangePayload,
  type PermissionChangeContext,
  type PermissionChangeResult,
  type PreparedPermissionChange,
  type AdminUserAccessState,
  type PermissionAccessGrant,
  type PermissionChangeEffects,
} from "../domain/admin-assignment.ts";
import type { AdministrativeConfirmationAction, AdministrativeConfirmationEffects, PermissionConfirmationPort } from "../public/index.ts";

const BOOTSTRAP_PERMISSION_LOCK_NAMESPACE = "permissions.bootstrap";
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const PERMISSION_KEYS = new Set<string>(ALL_PERMISSIONS);

function isPermission(value: string): value is Permissions {
  return PERMISSION_KEYS.has(value);
}

function payloadPermission(input: PermissionChangeContext): Permissions {
  const value = input.payload.permission;
  if (typeof value !== "string" || !isPermission(value)) throw new BadRequestException("Некорректное разрешение");
  return value;
}

function payloadGrantId(input: PermissionChangeContext): string {
  const value = input.payload.grant_id;
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new BadRequestException("Некорректный grant");
  return value;
}

function accessConfiguration(input: PermissionChangeContext): { readonly role: "user" | "admin"; readonly hasAdminPreset: boolean; readonly directPermissions: readonly Permissions[] } {
  const role = "user";
  const values = input.payload.direct_permissions;
  if (!Array.isArray(values)) throw new BadRequestException("Некорректная конфигурация доступа");
  const permissions: Permissions[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !isPermission(value)) throw new BadRequestException("Некорректное разрешение");
    if (permissions.includes(value)) throw new BadRequestException("Разрешения не должны повторяться");
    permissions.push(value);
  }
  const hasAdminPreset=false;
  if (permissions.includes(Permissions.FEED_NEWS_EDITOR)) throw new ForbiddenException("Разрешение управляется системой");
  if (hasAdminPreset && permissions.some((permission) => CURRENT_ADMIN_PRESET.permissions.includes(permission))) {
    throw new BadRequestException("Разрешение роли нельзя дублировать индивидуально");
  }
  return { role, hasAdminPreset, directPermissions: permissions.sort() };
}

function requiredPermissionForAction(action: PermissionChangeContext["payload"]["action"]): Permissions {
  switch (action) {
    case "configure_access": return Permissions.USER_VIEW_PERMISSIONS;
    case "assign_admin": return Permissions.USER_ASSIGN_ADMIN;
    case "remove_admin_assignment": return Permissions.USER_REMOVE_ADMIN_ASSIGNMENT;
    case "revoke_all_admin_access": return Permissions.USER_REVOKE_ALL_ADMIN_ACCESS;
    case "grant_permission": return Permissions.USER_GRANT_PERMISSION;
    case "revoke_permission": return Permissions.USER_REVOKE_PERMISSION;
  }
}

function permissionScopeLockKey(scope: PermissionScope): string {
  switch (scope.kind) {
    case "global":
      return "global";
    case "community":
      return `community:${scope.communityId}`;
    case "vendor":
      return `vendor:${scope.vendorId}`;
    case "catalog":
      return `catalog:${scope.catalog}`;
    case "user":
      return `user:${scope.userId}`;
  }
}

function permissionGrantLockKey(userId: UserId, permission: Permissions, scope: PermissionScope): string {
  return `permissions.grant:${userId}:${permission}:${permissionScopeLockKey(scope)}`;
}

interface PermissionGrantRow {
  id: string;
  user_id: string;
  permission: Permissions;
  scope: unknown;
  granted_by: string;
  reason: string;
  granted_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

function permissionGrant(row: PermissionGrantRow): PermissionGrant {
  const scope = parsePermissionScope(row.scope);
  if (scope === null) throw new Error("Invalid permission grant scope");
  return {
    id: row.id,
    userId: UserId(row.user_id),
    permission: row.permission,
    scope,
    grantedBy: UserId(row.granted_by),
    reason: row.reason,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by === null ? null : UserId(row.revoked_by),
    revokeReason: row.revoke_reason,
  };
}

@Injectable()
export class PermissionGrantsPgRepository implements PermissionGrantsRepository, PermissionConfirmationPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async projectAdministrativeRoles(userIds: readonly UserId[]): Promise<ReadonlyMap<UserId, "admin" | "superadmin">> {
    if (userIds.length === 0) return new Map();
    const result = await this.pool.query<{ user_id: string; role: "admin" | "superadmin" }>(
      `select requested.user_id,
              case when marker.user_id is not null then 'superadmin' else 'admin' end role
         from unnest($1::uuid[]) requested(user_id)
         left join superadmin_identity_read_v1 marker
           on marker.user_id=requested.user_id
        where marker.user_id is not null
           or (
             select count(distinct g.permission) from permission_grants g
             where g.user_id=requested.user_id and g.permission=any($2::text[])
               and g.scope='{"kind":"global"}'::jsonb and g.revoked_at is null
               and (g.expires_at is null or g.expires_at>now())
           )=cardinality($2::text[])`,
      [userIds, CURRENT_ADMIN_PRESET.permissions],
    );
    return new Map(result.rows.map((row) => [UserId(row.user_id), row.role]));
  }

  private administrativePayloadHash(payload: Readonly<Record<string, string | null>>): string {
    return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
  }

  private async assertAdministrativeContext(tx: PoolClient, input: { readonly actorId: UserId; readonly sessionVersion: number; readonly requiredPermission: Permissions }): Promise<void> {
    const actor = await tx.query(
      `select 1 from authorization_identity_read_v1 u join permission_grants g on g.user_id=u.user_id
        where u.user_id=$1 and u.status='active' and u.session_version=$2
          and g.permission=$3 and g.scope='{"kind":"global"}'::jsonb
          and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()) for update of u`,
      [input.actorId, input.sessionVersion, input.requiredPermission],
    );
    if (actor.rowCount === 0) throw new ForbiddenException();
  }

  async prepareAdministrativeConfirmation(input: {
    readonly actorId: UserId; readonly targetId: UserId; readonly sessionFingerprint: string; readonly sessionVersion: number;
    readonly action: AdministrativeConfirmationAction; readonly requiredPermission: Permissions;
    readonly payload: Readonly<Record<string, string | null>>;
    readonly snapshot: (tx: PoolClient) => Promise<{ readonly stateHash: string; readonly effects: AdministrativeConfirmationEffects }>;
  }): Promise<{ readonly id: string; readonly expiresAt: Date; readonly effects: AdministrativeConfirmationEffects }> {
    const client = await this.pool.connect();
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS);
    try {
      await client.query("begin");
      await this.assertAdministrativeContext(client, input);
      if (input.targetId === SYSTEM_USER_ID || (await client.query(`select 1 from superadmin_identity_read_v1 where user_id=$1`, [input.targetId])).rowCount === 1) {
        throw new ForbiddenException("Защищённый аккаунт нельзя изменять");
      }
      const snapshot = await input.snapshot(client);
      await client.query(
        `insert into permission_change_confirmations
          (id,actor_user_id,target_user_id,session_fingerprint,session_version,action,payload,payload_hash,state_hash,effects,expires_at)
         values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11)`,
        [id, input.actorId, input.targetId, input.sessionFingerprint, input.sessionVersion, input.action,
          JSON.stringify(input.payload), this.administrativePayloadHash(input.payload), snapshot.stateHash, JSON.stringify(snapshot.effects), expiresAt],
      );
      await client.query("commit");
      return { id, expiresAt, effects: snapshot.effects };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async executeAdministrativeConfirmation(input: {
    readonly confirmationId: string; readonly actorId: UserId; readonly targetId: UserId; readonly sessionFingerprint: string;
    readonly sessionVersion: number; readonly action: AdministrativeConfirmationAction; readonly requiredPermission: Permissions;
    readonly payload: Readonly<Record<string, string | null>>; readonly currentStateHash: (tx: PoolClient) => Promise<string>;
    readonly mutate: (tx: PoolClient) => Promise<void>;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<{ actor_user_id: string; target_user_id: string; session_fingerprint: string; session_version: number; action: string; payload_hash: string; state_hash: string | null; expires_at: Date; consumed_at: Date | null }>(
        `select actor_user_id,target_user_id,session_fingerprint,session_version,action,payload_hash,state_hash,expires_at,consumed_at
           from permission_change_confirmations where id=$1 for update`, [input.confirmationId],
      );
      const intent = result.rows[0];
      if (intent === undefined || intent.consumed_at !== null || intent.expires_at <= new Date()
        || intent.actor_user_id !== input.actorId || intent.target_user_id !== input.targetId
        || intent.session_fingerprint !== input.sessionFingerprint || intent.session_version !== input.sessionVersion
        || intent.action !== input.action || intent.payload_hash !== this.administrativePayloadHash(input.payload) || intent.state_hash === null) {
        throw new ConflictException("Подтверждение недействительно или уже использовано");
      }
      await this.assertAdministrativeContext(client, input);
      if (await input.currentStateHash(client) !== intent.state_hash) throw new ConflictException("Preview устарел");
      await input.mutate(client);
      const consumed = await client.query(`update permission_change_confirmations set consumed_at=now() where id=$1 and consumed_at is null`, [input.confirmationId]);
      if (consumed.rowCount !== 1) throw new ConflictException("Подтверждение уже использовано");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async isUserActive(userId: UserId): Promise<boolean> {
    const result = await this.pool.query(`select 1 from identity_read_v1 where user_id = $1`, [userId]);
    return result.rowCount === 1;
  }

  async findActiveGrants(input: { readonly userId: UserId; readonly permission: Permissions; readonly now: Date }): Promise<readonly PermissionGrant[]> {
    const result = await this.pool.query<PermissionGrantRow>(
      `select id,user_id,permission,scope,granted_by,reason,granted_at,expires_at,revoked_at,revoked_by,revoke_reason
       from permission_grants
       where user_id=$1 and permission=$2 and revoked_at is null and (expires_at is null or expires_at>$3)`,
      [input.userId, input.permission, input.now],
    );
    return result.rows.map(permissionGrant);
  }

  async findActivePermissions(input: { readonly userId: UserId; readonly permissions: readonly Permissions[]; readonly now: Date }): Promise<readonly Permissions[]> {
    const result = await this.pool.query<{ permission: Permissions }>(
      `select distinct permission
       from permission_grants
       where user_id=$1 and permission=any($2::text[]) and scope='{"kind":"global"}'::jsonb
         and revoked_at is null and (expires_at is null or expires_at>$3)`,
      [input.userId, input.permissions, input.now],
    );
    return result.rows.map((row) => row.permission);
  }

  async findAllActiveGrants(input: { readonly userId: UserId; readonly now: Date }): Promise<readonly PermissionGrant[]> {
    const result = await this.pool.query<PermissionGrantRow>(
      `select id,user_id,permission,scope,granted_by,reason,granted_at,expires_at,revoked_at,revoked_by,revoke_reason
       from permission_grants
       where user_id=$1 and revoked_at is null and (expires_at is null or expires_at>$2)
       order by permission,scope::text,expires_at nulls last,id`,
      [input.userId, input.now],
    );
    return result.rows.map(permissionGrant);
  }

  async findById(grantId: string): Promise<PermissionGrant | null> {
    const result = await this.pool.query<PermissionGrantRow>(
      `select id,user_id,permission,scope,granted_by,reason,granted_at,expires_at,revoked_at,revoked_by,revoke_reason
       from permission_grants
       where id=$1`,
      [grantId],
    );
    const row = result.rows[0];
    return row === undefined ? null : permissionGrant(row);
  }

  async isSuperadminUser(userId: UserId): Promise<boolean> {
    return (await this.pool.query(`select 1 from superadmin_identity_read_v1 where user_id=$1`, [userId])).rowCount !== 0;
  }

  async hasAnyPermissionGrantsInTransaction(client: PoolClient): Promise<boolean> {
    return (await client.query(`select 1 from permission_grants limit 1`)).rowCount !== 0;
  }

  async recordAdminMeViewed(input: { readonly actorId: UserId; readonly permissionCount: number }): Promise<void> {
    await this.pool.query(
      `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
       values($1,$2,'admin.me.viewed','user',$2,$3,now())`,
      [randomUUID(), input.actorId, JSON.stringify({ permission_count: input.permissionCount })],
    );
  }

  async recordAdminPermissionCatalogViewed(input: { readonly actorId: UserId; readonly permissionCount: number }): Promise<void> {
    await this.pool.query(
      `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
       values($1,$2,'admin.permissions_catalog.viewed','permission_catalog',$2,$3,now())`,
      [randomUUID(), input.actorId, JSON.stringify({ permission_count: input.permissionCount })],
    );
  }

  async ensureBootstrapPermissions(input: {
    readonly userId: UserId;
    readonly permissions: readonly Permissions[];
    readonly reason: string;
  }): Promise<{ readonly created: number; readonly skipped: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await this.ensureBootstrapPermissionsInTransaction(client, input);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureBootstrapPermissionsInTransaction(
    client: PoolClient,
    input: { readonly userId: UserId; readonly permissions: readonly Permissions[]; readonly reason: string },
  ): Promise<{ readonly created: number; readonly skipped: number }> {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [`${BOOTSTRAP_PERMISSION_LOCK_NAMESPACE}:${input.userId}`]);
    const existingUser = await client.query(`select 1 from identity_read_all_v1 where user_id=$1 and status <> 'deleted'`, [input.userId]);
    if ((existingUser.rowCount ?? 0) === 0) throw new Error("Bootstrap permissions require a non-deleted user");
    let created = 0;
    let skipped = 0;
    for (const permission of input.permissions) {
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [permissionGrantLockKey(input.userId, permission, GLOBAL_PERMISSION_SCOPE)]);
      const existing = await client.query(
        `select 1 from permission_grants where user_id=$1 and permission=$2 and scope='{"kind":"global"}'::jsonb
           and revoked_at is null and (expires_at is null or expires_at>now())`,
        [input.userId, permission],
      );
      if ((existing.rowCount ?? 0) > 0) {
        skipped += 1;
        continue;
      }
      const grant = await client.query<{ id: string }>(
        `insert into permission_grants(user_id,permission,scope,granted_by,reason,expires_at)
         values($1,$2,'{"kind":"global"}'::jsonb,$1,$3,null) returning id`,
        [input.userId, permission, input.reason],
      );
      const grantId = grant.rows[0]?.id;
      if (grantId === undefined) throw new Error("Не удалось создать bootstrap grant");
      await client.query(
        `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
         values($1,$2,'permission.granted','permission_grant',$3,$4,now())`,
        [randomUUID(), input.userId, grantId, JSON.stringify({ permission, source: "startup" })],
      );
      created += 1;
    }
    return { created, skipped };
  }

  async hasCompleteBootstrapEvidenceInTransaction(
    client: PoolClient,
    input: { readonly userId: UserId; readonly permissions: readonly Permissions[]; readonly reason: string },
  ): Promise<boolean> {
    const rows = await client.query<{ permission: Permissions }>(
      `select distinct permission from permission_grants
        where user_id=$1 and granted_by=$1 and reason=$2 and scope='{"kind":"global"}'::jsonb
          and revoked_at is null and (expires_at is null or expires_at>now())`,
      [input.userId, input.reason],
    );
    const actual = new Set(rows.rows.map((row) => row.permission));
    return input.permissions.every((permission) => actual.has(permission));
  }

  async recordSuperadminBootstrapEventsInTransaction(
    client: PoolClient,
    input: { readonly userId: UserId; readonly events: readonly string[] },
  ): Promise<void> {
    for (const event of input.events) {
      await client.query(
        `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
         values($1,$2,$3,'user',$2,$4,now())`,
        [randomUUID(), input.userId, event, JSON.stringify({ user_id: input.userId, initiated_by: "startup" })],
      );
    }
  }

  private async hasGlobalPermission(client: PoolClient, userId: UserId, permission: Permissions): Promise<boolean> {
    return (await client.query(
      `select 1 from permission_grants where user_id=$1 and permission=$2
       and scope='{"kind":"global"}'::jsonb and revoked_at is null and (expires_at is null or expires_at>now())`,
      [userId, permission],
    )).rowCount !== 0;
  }

  private async assertPermissionChangeContext(client: PoolClient, input: PermissionChangeContext): Promise<void> {
    if (input.actorId === input.targetId) throw new ForbiddenException("Нельзя изменять собственные административные права");
    if (!/^[0-9a-f]{64}$/.test(input.sessionFingerprint)) throw new ForbiddenException();
    if (requiredPermissionForAction(input.payload.action) !== input.requiredPermission) throw new ForbiddenException();

    const actor = await client.query<{ status: string; session_version: number }>(
      `select status,session_version from authorization_identity_read_v1 where user_id=$1`, [input.actorId],
    );
    const actorState = actor.rows[0];
    if (actorState === undefined || actorState.status !== "active" || actorState.session_version !== input.sessionVersion) {
      throw new ForbiddenException("Сессия или состояние инициатора изменились");
    }
    const target = await client.query<{ status: string }>(
      `select status from authorization_identity_read_v1 where user_id=$1`, [input.targetId],
    );
    if (target.rows[0]?.status !== "active") throw new ForbiddenException("Целевой аккаунт недоступен");
    if ((await client.query(`select 1 from superadmin_identity_read_v1 where user_id=$1`, [input.targetId])).rowCount !== 0) {
      throw new ForbiddenException("Права Superadmin управляются только startup provisioning");
    }
    if (!(await this.hasGlobalPermission(client, input.actorId, input.requiredPermission))) throw new ForbiddenException();

    let affected: readonly Permissions[] = [];
    if (input.payload.action === "configure_access") {
      const configuration = accessConfiguration(input);
      const state = await this.loadAccessStateInTransaction(client, input.targetId);
      const current = state.grants.filter((grant) => PERMISSION_DEFINITIONS[grant.permission].adminAssignable);
      const desired = new Set(configuration.directPermissions);
      if (configuration.directPermissions.some((permission) => !PERMISSION_DEFINITIONS[permission].adminAssignable)) throw new ForbiddenException("Разрешение недоступно в редакторе доступа");
      if (configuration.directPermissions.some((permission) => !current.some((grant) => grant.permission === permission)) && !(await this.hasGlobalPermission(client, input.actorId, Permissions.USER_GRANT_PERMISSION))) throw new ForbiddenException();
      if (current.some((grant) => !desired.has(grant.permission)) && !(await this.hasGlobalPermission(client, input.actorId, Permissions.USER_REVOKE_PERMISSION))) throw new ForbiddenException();
      affected = [...new Set([...configuration.directPermissions, ...current.map((grant) => grant.permission)])];
    }
    if (input.payload.action === "assign_admin") affected = CURRENT_ADMIN_PRESET.permissions;
    if (input.payload.action === "grant_permission") {
      const permission = payloadPermission(input);
      if (permission === Permissions.FEED_NEWS_EDITOR) throw new ForbiddenException("Разрешение управляется системой");
      if (!PERMISSION_DEFINITIONS[permission].delegable) throw new ForbiddenException("Разрешение нельзя делегировать");
      if (permission === Permissions.FEED_MANAGE_NEWS) {
        affected = [permission, Permissions.FEED_NEWS_EDITOR];
      } else {
        affected = [permission];
      }
    }
    if (input.payload.action === "revoke_permission") {
      const grant = await client.query<{ permission: Permissions; user_id: string }>(
        `select permission,user_id from permission_grants where id=$1 and revoked_at is null and (expires_at is null or expires_at>now())`,
        [payloadGrantId(input)],
      );
      const row = grant.rows[0];
      if (row === undefined || row.user_id !== input.targetId) throw new ConflictException("Grant больше не активен");
      if (row.permission === Permissions.FEED_NEWS_EDITOR) throw new ForbiddenException("Разрешение управляется системой");
      affected = row.permission === Permissions.FEED_MANAGE_NEWS
        ? [row.permission, Permissions.FEED_NEWS_EDITOR]
        : [row.permission];
    }
    if (input.payload.action === "remove_admin_assignment") {
      const assignment = await client.query<{ preset_snapshot: unknown }>(
        `select preset_snapshot from admin_permission_assignments where user_id=$1 and preset_key=$2 and removed_at is null`,
        [input.targetId, CURRENT_ADMIN_PRESET.key],
      );
      const snapshot = assignment.rows[0]?.preset_snapshot;
      if (!Array.isArray(snapshot)) throw new ConflictException("Активное назначение Admin не найдено");
      affected = snapshot.filter((value): value is Permissions => typeof value === "string" && isPermission(value));
    }
    if (input.payload.action === "revoke_all_admin_access") {
      const grants = await client.query<{ permission: Permissions }>(
        `select distinct permission from permission_grants where user_id=$1 and permission=any($2::text[])
         and revoked_at is null and (expires_at is null or expires_at>now())`,
        [input.targetId, ADMINISTRATIVE_PERMISSIONS],
      );
      affected = grants.rows.map((row) => row.permission);
    }
    for (const permission of affected) {
      if (!(await this.hasGlobalPermission(client, input.actorId, permission))) throw new ForbiddenException("Превышен delegation ceiling");
    }
  }

  private async loadAccessStateInTransaction(client: PoolClient, targetId: UserId): Promise<AdminUserAccessState> {
    const assignmentResult = await client.query<{
      id: string;
      preset_key: string;
      preset_version: number;
      preset_snapshot: unknown;
      assigned_at: Date;
    }>(
      `select id,preset_key,preset_version,preset_snapshot,assigned_at
       from admin_permission_assignments
       where user_id=$1 and removed_at is null
       order by assigned_at desc,id limit 1`,
      [targetId],
    );
    const grantResult = await client.query<PermissionGrantRow & { assignment_id: string | null; coverage_kind: string | null }>(
      `select permission_grant.id,permission_grant.user_id,permission_grant.permission,permission_grant.scope,permission_grant.granted_by,permission_grant.reason,
              permission_grant.granted_at,permission_grant.expires_at,permission_grant.revoked_at,permission_grant.revoked_by,permission_grant.revoke_reason,
              assignment.id assignment_id,item.coverage_kind
       from permission_grants permission_grant
       left join admin_permission_assignment_items item on item.grant_id=permission_grant.id and item.coverage_kind='assignment_grant'
       left join admin_permission_assignments assignment on assignment.id=item.assignment_id and assignment.removed_at is null
       where permission_grant.user_id=$1 and permission_grant.revoked_at is null and (permission_grant.expires_at is null or permission_grant.expires_at>now())
       order by permission_grant.permission,permission_grant.scope::text,permission_grant.id`,
      [targetId],
    );
    const grants: PermissionAccessGrant[] = grantResult.rows.map((row) => {
      const grant = permissionGrant(row);
      return {
        id: grant.id,
        permission: grant.permission,
        scope: grant.scope,
        expiresAt: grant.expiresAt,
        provenance: row.assignment_id === null ? "direct" : "admin_assignment",
        assignmentId: row.assignment_id,
      };
    });
    const assignmentRow = assignmentResult.rows[0];
    if (assignmentRow === undefined) return { assignment: null, grants };
    const snapshot = Array.isArray(assignmentRow.preset_snapshot)
      ? assignmentRow.preset_snapshot.filter((value): value is Permissions => typeof value === "string" && isPermission(value))
      : [];
    const effective = new Set(grants.map((grant) => grant.permission));
    const direct = new Set(grants.filter((grant) => grant.provenance === "direct").map((grant) => grant.permission));
    return {
      assignment: {
        id: assignmentRow.id,
        presetKey: assignmentRow.preset_key,
        presetVersion: assignmentRow.preset_version,
        presetSnapshot: snapshot,
        assignedAt: assignmentRow.assigned_at,
        missingSnapshotPermissions: snapshot.filter((permission) => !effective.has(permission)),
        additionalDirectPermissions: [...direct].filter((permission) => !snapshot.includes(permission)).sort(),
        currentPresetAdded: CURRENT_ADMIN_PRESET.permissions.filter((permission) => !snapshot.includes(permission)),
        currentPresetRemoved: snapshot.filter((permission) => !CURRENT_ADMIN_PRESET.permissions.includes(permission)),
      },
      grants,
    };
  }

  private accessStateHash(state: AdminUserAccessState): string {
    const hashState = {
      assignment: state.assignment === null ? null : {
        id: state.assignment.id,
        preset_key: state.assignment.presetKey,
        preset_version: state.assignment.presetVersion,
        preset_snapshot: state.assignment.presetSnapshot,
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
    return createHash("sha256").update(JSON.stringify(hashState)).digest("hex");
  }

  private permissionChangeEffects(input: PermissionChangeContext, state: AdminUserAccessState): PermissionChangeEffects {
    const effect = (grant: PermissionAccessGrant) => ({
      grantId: grant.id,
      permission: grant.permission,
      provenance: grant.provenance,
    });
    if (input.payload.action === "configure_access") {
      const configuration = accessConfiguration(input);
      const desired = new Set(configuration.directPermissions);
      const active = new Set(state.grants.map((grant) => grant.permission));
      const retained = state.grants.filter((grant) => desired.has(grant.permission) || !PERMISSION_DEFINITIONS[grant.permission].adminAssignable).map(effect);
      const revoked = state.grants.filter((grant) => PERMISSION_DEFINITIONS[grant.permission].adminAssignable && !desired.has(grant.permission)).map(effect);
      const added: Array<PermissionChangeEffects["added"][number]> = configuration.directPermissions.filter((permission) => !active.has(permission)).map((permission) => ({ grantId: null, permission, provenance: "direct" }));
      if (desired.has(Permissions.FEED_MANAGE_NEWS) && !active.has(Permissions.FEED_NEWS_EDITOR)) added.push({ grantId: null, permission: Permissions.FEED_NEWS_EDITOR, provenance: "direct" });
      if (!desired.has(Permissions.FEED_MANAGE_NEWS)) {
        revoked.push(...state.grants.filter((grant) => grant.permission === Permissions.FEED_NEWS_EDITOR).map(effect));
      }
      return { added, revoked, retained: retained.filter((item) => desired.has(Permissions.FEED_MANAGE_NEWS) || item.permission !== Permissions.FEED_NEWS_EDITOR) };
    }
    if (input.payload.action === "assign_admin") {
      if (state.assignment !== null) throw new ConflictException("Активное назначение Admin уже существует");
      const active = new Set(state.grants.map((grant) => grant.permission));
      const added: Array<PermissionChangeEffects["added"][number]> = CURRENT_ADMIN_PRESET.permissions
          .filter((permission) => !active.has(permission))
          .map((permission) => ({ grantId: null, permission, provenance: "admin_assignment" as const }));
      if (active.has(Permissions.FEED_MANAGE_NEWS) && !active.has(Permissions.FEED_NEWS_EDITOR)) {
        added.push({ grantId: null, permission: Permissions.FEED_NEWS_EDITOR, provenance: "direct" });
      }
      return {
        added,
        revoked: [],
        retained: state.grants.map(effect),
      };
    }
    if (input.payload.action === "remove_admin_assignment") {
      if (state.assignment === null) throw new ConflictException("Активное назначение Admin не найдено");
      return {
        added: [],
        revoked: state.grants.filter((grant) => grant.provenance === "admin_assignment").map(effect),
        retained: state.grants.filter((grant) => grant.provenance === "direct").map(effect),
      };
    }
    if (input.payload.action === "revoke_all_admin_access") {
      return {
        added: [],
        revoked: state.grants.filter((grant) => ADMINISTRATIVE_PERMISSIONS.includes(grant.permission)).map(effect),
        retained: state.grants.filter((grant) => !ADMINISTRATIVE_PERMISSIONS.includes(grant.permission)).map(effect),
      };
    }
    if (input.payload.action === "grant_permission") {
      const permission = payloadPermission(input);
      if (state.grants.some((grant) => grant.permission === permission && grant.scope.kind === "global")) {
        throw new ConflictException("Разрешение уже активно");
      }
      const companion = state.grants.find((grant) => grant.permission === Permissions.FEED_NEWS_EDITOR);
      const added: PermissionChangeEffects["added"] = permission === Permissions.FEED_MANAGE_NEWS && companion === undefined
        ? [{ grantId: null, permission, provenance: "direct" }, { grantId: null, permission: Permissions.FEED_NEWS_EDITOR, provenance: "direct" }]
        : [{ grantId: null, permission, provenance: "direct" }];
      return {
        added,
        revoked: [],
        retained: state.grants.map(effect),
      };
    }
    const grantId = payloadGrantId(input);
    const selected = state.grants.find((grant) => grant.id === grantId);
    if (selected === undefined) throw new ConflictException("Grant больше не активен");
    const lastNewsGrant = selected.permission === Permissions.FEED_MANAGE_NEWS
      && !state.grants.some((grant) => grant.id !== grantId && grant.permission === Permissions.FEED_MANAGE_NEWS);
    const revoked = lastNewsGrant
      ? state.grants.filter((grant) => grant.id === grantId || grant.permission === Permissions.FEED_NEWS_EDITOR)
      : [selected];
    return {
      added: [],
      revoked: revoked.map(effect),
      retained: state.grants.filter((grant) => !revoked.some((item) => item.id === grant.id)).map(effect),
    };
  }

  async readUserAccessState(input: { readonly actorId: UserId; readonly targetId: UserId }): Promise<AdminUserAccessState> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const target = await client.query(`select 1 from authorization_identity_read_v1 where user_id=$1`, [input.targetId]);
      if (target.rowCount === 0) throw new ForbiddenException("Целевой аккаунт недоступен");
      const state = await this.loadAccessStateInTransaction(client, input.targetId);
      await client.query(
        `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
         values($1,$2,'admin.user_access.viewed','user',$3,$4,now())`,
        [randomUUID(), input.actorId, input.targetId, JSON.stringify({ grant_count: state.grants.length, has_assignment: state.assignment !== null })],
      );
      await client.query("commit");
      return state;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async preparePermissionChange(input: PermissionChangeContext): Promise<PreparedPermissionChange> {
    const client = await this.pool.connect();
    const canonical = canonicalPermissionChangePayload(input.payload);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS);
    try {
      await client.query("begin");
      await this.assertPermissionChangeContext(client, input);
      const state = await this.loadAccessStateInTransaction(client, input.targetId);
      const effects = this.permissionChangeEffects(input, state);
      const stateHash = this.accessStateHash(state);
      await client.query(
        `insert into permission_change_confirmations
          (id,actor_user_id,target_user_id,session_fingerprint,session_version,action,payload,payload_hash,state_hash,effects,expires_at)
         values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11)`,
        [id, input.actorId, input.targetId, input.sessionFingerprint, input.sessionVersion, input.payload.action, canonical.json, canonical.hash, stateHash, JSON.stringify(effects), expiresAt],
      );
      await client.query(
        `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
         values($1,$2,'admin.permission_change.previewed','user',$3,$4,now())`,
        [randomUUID(), input.actorId, input.targetId, JSON.stringify({ confirmation_id: id, action: input.payload.action, expires_at: expiresAt.toISOString(), added_count: effects.added.length, revoked_count: effects.revoked.length, retained_count: effects.retained.length })],
      );
      await client.query("commit");
      return { id, expiresAt, effects };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async auditGrant(client: PoolClient, input: { readonly actorId: UserId; readonly action: "permission.granted" | "permission.revoked"; readonly grantId: string; readonly userId: UserId; readonly permission: Permissions; readonly reason: string }): Promise<void> {
    await client.query(
      `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
       values($1,$2,$3,'permission_grant',$4,$5,now())`,
      [randomUUID(), input.actorId, input.action, input.grantId, JSON.stringify({ permission: input.permission })],
    );
  }

  private async ensureNewsEditorCompanion(
    client: PoolClient,
    input: { readonly assignmentId?: string; readonly actorId: UserId; readonly targetId: UserId; readonly reason: string },
  ): Promise<string | null> {
    const existing = await client.query<{ id: string }>(
      `select id from permission_grants where user_id=$1 and permission=$2 and scope='{"kind":"global"}'::jsonb
       and revoked_at is null and (expires_at is null or expires_at>now()) order by granted_at,id limit 1 for update`,
      [input.targetId, Permissions.FEED_NEWS_EDITOR],
    );
    const existingId = existing.rows[0]?.id;
    if (existingId !== undefined) {
      return null;
    }
    const grant = await client.query<{ id: string }>(
      `insert into permission_grants(user_id,permission,scope,granted_by,reason)
       values($1,$2,'{"kind":"global"}'::jsonb,$3,$4) returning id`,
      [input.targetId, Permissions.FEED_NEWS_EDITOR, input.actorId, `System-managed News editor companion: ${input.reason}`],
    );
    const grantId = grant.rows[0]?.id;
    if (grantId === undefined) throw new Error("Не удалось материализовать News editor companion");
    await this.auditGrant(client, { actorId: input.actorId, action: "permission.granted", grantId, userId: input.targetId, permission: Permissions.FEED_NEWS_EDITOR, reason: input.reason });
    return grantId;
  }

  private async revokeGrantInTransaction(client: PoolClient, input: { readonly grantId: string; readonly actorId: UserId; readonly reason: string }): Promise<{ readonly id: string; readonly permission: Permissions } | null> {
    const result = await client.query<{ id: string; permission: Permissions; user_id: string }>(
      `update permission_grants set revoked_at=now(),revoked_by=$2,revoke_reason=$3
       where id=$1 and revoked_at is null and (expires_at is null or expires_at>now()) returning id,permission,user_id`,
      [input.grantId, input.actorId, input.reason],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    await this.auditGrant(client, { actorId: input.actorId, action: "permission.revoked", grantId: row.id, userId: UserId(row.user_id), permission: row.permission, reason: input.reason });
    return row;
  }

  async executePermissionChange(input: PermissionChangeContext & { readonly confirmationId: string }): Promise<PermissionChangeResult> {
    const client = await this.pool.connect();
    const canonical = canonicalPermissionChangePayload(input.payload);
    const createdGrantIds: string[] = [];
    const revokedGrantIds: string[] = [];
    try {
      await client.query("begin");
      const confirmation = await client.query<{
        actor_user_id: string; target_user_id: string; session_fingerprint: string; session_version: number;
        action: string; payload_hash: string; state_hash: string | null; expires_at: Date; consumed_at: Date | null;
      }>(`select actor_user_id,target_user_id,session_fingerprint,session_version,action,payload_hash,state_hash,expires_at,consumed_at
          from permission_change_confirmations where id=$1 for update`, [input.confirmationId]);
      const intent = confirmation.rows[0];
      if (intent === undefined || intent.consumed_at !== null || intent.expires_at <= new Date()
        || intent.actor_user_id !== input.actorId || intent.target_user_id !== input.targetId
        || intent.session_fingerprint !== input.sessionFingerprint || intent.session_version !== input.sessionVersion
        || intent.action !== input.payload.action || intent.payload_hash !== canonical.hash || intent.state_hash === null) {
        throw new ConflictException("Подтверждение недействительно или уже использовано");
      }
      await this.assertPermissionChangeContext(client, input);
      const currentState = await this.loadAccessStateInTransaction(client, input.targetId);
      if (this.accessStateHash(currentState) !== intent.state_hash) throw new ConflictException("Preview устарел: состояние доступа изменилось");
      const reason = input.payload.reason;

      if (input.payload.action === "configure_access") {
        const configuration = accessConfiguration(input);
        const desired = new Set(configuration.directPermissions);
        for (const grant of currentState.grants.filter((item) => PERMISSION_DEFINITIONS[item.permission].adminAssignable && !desired.has(item.permission))) {
          const revoked = await this.revokeGrantInTransaction(client,{grantId:grant.id,actorId:input.actorId,reason});
          if(revoked!==null) revokedGrantIds.push(revoked.id);
        }
        const current = new Set(currentState.grants.map((item) => item.permission));
        for (const permission of configuration.directPermissions.filter((item) => !current.has(item))) {
          const grant = await client.query<{id:string}>(`insert into permission_grants(user_id,permission,scope,granted_by,reason) values($1,$2,'{"kind":"global"}'::jsonb,$3,$4) returning id`,[input.targetId,permission,input.actorId,reason]);
          const grantId=grant.rows[0]?.id;
          if(grantId===undefined) throw new Error("Не удалось создать grant");
          createdGrantIds.push(grantId);
          await this.auditGrant(client,{actorId:input.actorId,action:"permission.granted",grantId,userId:input.targetId,permission,reason});
        }
        await client.query(`update admin_permission_assignments set removed_at=now(),removed_by=$2,remove_reason=$3 where user_id=$1 and removed_at is null`,[input.targetId,input.actorId,reason]);
        if (desired.has(Permissions.FEED_MANAGE_NEWS)) {
          const companionId=await this.ensureNewsEditorCompanion(client,{actorId:input.actorId,targetId:input.targetId,reason});
          if(companionId!==null) createdGrantIds.push(companionId);
        } else {
          for(const grant of currentState.grants.filter((item)=>item.permission===Permissions.FEED_NEWS_EDITOR)){
            const revoked=await this.revokeGrantInTransaction(client,{grantId:grant.id,actorId:input.actorId,reason});
            if(revoked!==null) revokedGrantIds.push(revoked.id);
          }
        }
      }

      if (input.payload.action === "assign_admin") {
        const assignment = await client.query<{ id: string }>(
          `insert into admin_permission_assignments(user_id,preset_key,preset_version,preset_snapshot,assigned_by,reason)
           values($1,$2,$3,$4::jsonb,$5,$6) returning id`,
          [input.targetId, CURRENT_ADMIN_PRESET.key, CURRENT_ADMIN_PRESET.version, JSON.stringify(CURRENT_ADMIN_PRESET.permissions), input.actorId, reason],
        );
        const assignmentId = assignment.rows[0]?.id;
        if (assignmentId === undefined) throw new Error("Не удалось создать Admin assignment");
        for (const permission of CURRENT_ADMIN_PRESET.permissions) {
          const existing = await client.query<{ id: string }>(
            `select id from permission_grants where user_id=$1 and permission=$2 and scope='{"kind":"global"}'::jsonb
             and revoked_at is null and (expires_at is null or expires_at>now()) order by granted_at,id limit 1`,
            [input.targetId, permission],
          );
          let grantId = existing.rows[0]?.id;
          let coverage = "direct_existing";
          if (grantId === undefined) {
            const grant = await client.query<{ id: string }>(
              `insert into permission_grants(user_id,permission,scope,granted_by,reason)
               values($1,$2,'{"kind":"global"}'::jsonb,$3,$4) returning id`,
              [input.targetId, permission, input.actorId, `Admin preset ${CURRENT_ADMIN_PRESET.key}@${CURRENT_ADMIN_PRESET.version}: ${reason}`],
            );
            grantId = grant.rows[0]?.id;
            if (grantId === undefined) throw new Error("Не удалось материализовать Admin grant");
            coverage = "assignment_grant";
            createdGrantIds.push(grantId);
            await this.auditGrant(client, { actorId: input.actorId, action: "permission.granted", grantId, userId: input.targetId, permission, reason });
          }
          await client.query(
            `insert into admin_permission_assignment_items(assignment_id,permission,coverage_kind,grant_id) values($1,$2,$3,$4)`,
            [assignmentId, permission, coverage, grantId],
          );
        }
        if (currentState.grants.some((item) => item.permission === Permissions.FEED_MANAGE_NEWS)) {
          const companionId = await this.ensureNewsEditorCompanion(client, { assignmentId, actorId: input.actorId, targetId: input.targetId, reason });
          if (companionId !== null) createdGrantIds.push(companionId);
        }
      }

      if (input.payload.action === "remove_admin_assignment") {
        const assignment = await client.query<{ id: string }>(
          `select id from admin_permission_assignments where user_id=$1 and preset_key=$2 and removed_at is null for update`,
          [input.targetId, CURRENT_ADMIN_PRESET.key],
        );
        const assignmentId = assignment.rows[0]?.id;
        if (assignmentId === undefined) throw new ConflictException("Активное назначение Admin не найдено");
        const owned = await client.query<{ grant_id: string }>(
          `select grant_id from admin_permission_assignment_items where assignment_id=$1 and coverage_kind='assignment_grant'`, [assignmentId],
        );
        for (const item of owned.rows) {
          const revoked = await this.revokeGrantInTransaction(client, { grantId: item.grant_id, actorId: input.actorId, reason });
          if (revoked !== null) revokedGrantIds.push(revoked.id);
        }
        await client.query(
          `update admin_permission_assignments set removed_at=now(),removed_by=$2,remove_reason=$3 where id=$1`,
          [assignmentId, input.actorId, reason],
        );
      }

      if (input.payload.action === "revoke_all_admin_access") {
        const active = await client.query<{ id: string }>(
          `select id from permission_grants where user_id=$1 and permission=any($2::text[])
           and revoked_at is null and (expires_at is null or expires_at>now()) for update`,
          [input.targetId, ADMINISTRATIVE_PERMISSIONS],
        );
        for (const grant of active.rows) {
          const revoked = await this.revokeGrantInTransaction(client, { grantId: grant.id, actorId: input.actorId, reason });
          if (revoked !== null) revokedGrantIds.push(revoked.id);
        }
        await client.query(
          `update admin_permission_assignments set removed_at=now(),removed_by=$2,remove_reason=$3
           where user_id=$1 and removed_at is null`, [input.targetId, input.actorId, reason],
        );
      }

      if (input.payload.action === "grant_permission") {
        const permission = payloadPermission(input);
        const expiresAtValue = input.payload.expires_at;
        const expiresAt = typeof expiresAtValue === "string" ? new Date(expiresAtValue) : null;
        if (expiresAt !== null && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) throw new BadRequestException("Некорректный срок действия");
        const grant = await client.query<{ id: string }>(
          `insert into permission_grants(user_id,permission,scope,granted_by,reason,expires_at)
           values($1,$2,'{"kind":"global"}'::jsonb,$3,$4,$5) returning id`,
          [input.targetId, permission, input.actorId, reason, expiresAt],
        );
        const grantId = grant.rows[0]?.id;
        if (grantId === undefined) throw new Error("Не удалось создать grant");
        createdGrantIds.push(grantId);
        await this.auditGrant(client, { actorId: input.actorId, action: "permission.granted", grantId, userId: input.targetId, permission, reason });
        if (permission === Permissions.FEED_MANAGE_NEWS) {
          const companionId = await this.ensureNewsEditorCompanion(client, { actorId: input.actorId, targetId: input.targetId, reason });
          if (companionId !== null) createdGrantIds.push(companionId);
        }
      }

      if (input.payload.action === "revoke_permission") {
        const revoked = await this.revokeGrantInTransaction(client, { grantId: payloadGrantId(input), actorId: input.actorId, reason });
        if (revoked === null) throw new ConflictException("Grant больше не активен");
        revokedGrantIds.push(revoked.id);
        if (revoked.permission === Permissions.FEED_MANAGE_NEWS && !(await this.hasGlobalPermission(client, input.targetId, Permissions.FEED_MANAGE_NEWS))) {
          const companions = await client.query<{ id: string }>(
            `select id from permission_grants where user_id=$1 and permission=$2 and revoked_at is null for update`,
            [input.targetId, Permissions.FEED_NEWS_EDITOR],
          );
          for (const companion of companions.rows) {
            const retired = await this.revokeGrantInTransaction(client, { grantId: companion.id, actorId: input.actorId, reason });
            if (retired !== null) revokedGrantIds.push(retired.id);
          }
        }
      }

      const remaining = await client.query<{ permission: Permissions }>(
        `select distinct permission from permission_grants where user_id=$1 and permission=any($2::text[])
         and revoked_at is null and (expires_at is null or expires_at>now())
         and not exists (
           select 1 from admin_permission_assignment_items item
           join admin_permission_assignments assignment on assignment.id=item.assignment_id
           where item.grant_id=permission_grants.id and item.coverage_kind='assignment_grant'
             and assignment.removed_at is null
         ) order by permission`,
        [input.targetId, ADMINISTRATIVE_PERMISSIONS],
      );
      await client.query(`update permission_change_confirmations set consumed_at=now() where id=$1 and consumed_at is null`, [input.confirmationId]);
      await client.query(
        `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
         values($1,$2,'admin.permission_change.executed','user',$3,$4,now())`,
        [randomUUID(), input.actorId, input.targetId, JSON.stringify({ confirmation_id: input.confirmationId, action: input.payload.action, created_grant_ids: createdGrantIds, revoked_grant_ids: revokedGrantIds, remaining_direct_permissions: remaining.rows.map((row) => row.permission) })],
      );
      await client.query("commit");
      return { action: input.payload.action, createdGrantIds, revokedGrantIds, remainingDirectPermissions: remaining.rows.map((row) => row.permission) };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createWithAudit(input: {
    readonly userId: UserId;
    readonly permission: Permissions;
    readonly scope: PermissionScope;
    readonly grantedBy: UserId;
    readonly reason: string;
    readonly expiresAt: Date | null;
  }): Promise<PermissionGrant> {
    if (input.permission === Permissions.FEED_NEWS_EDITOR) throw new ForbiddenException("Разрешение управляется системой");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [
        permissionGrantLockKey(input.userId, input.permission, input.scope),
      ]);
      const existing = await client.query(
        `select 1 from permission_grants
         where user_id=$1 and permission=$2 and scope=$3::jsonb
           and revoked_at is null and (expires_at is null or expires_at>now())`,
        [input.userId, input.permission, JSON.stringify(input.scope)],
      );
      if ((existing.rowCount ?? 0) > 0) throw new PermissionGrantAlreadyActiveError();
      const created = await client.query<PermissionGrantRow>(
        `insert into permission_grants(user_id,permission,scope,granted_by,reason,expires_at)
         values($1,$2,$3,$4,$5,$6)
         returning id,user_id,permission,scope,granted_by,reason,granted_at,expires_at,revoked_at,revoked_by,revoke_reason`,
        [input.userId, input.permission, JSON.stringify(input.scope), input.grantedBy, input.reason, input.expiresAt],
      );
      const row = created.rows[0];
      if (row === undefined) throw new Error("Не удалось создать grant разрешения");
      await client.query(
        `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
         values($1,$2,$3,$4,$5,$6,now())`,
        [
          randomUUID(),
          input.grantedBy,
          "permission.granted",
          "permission_grant",
          row.id,
          JSON.stringify({ permission: input.permission }),
        ],
      );
      await client.query("commit");
      return permissionGrant(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeWithAudit(input: { readonly grantId: string; readonly revokedBy: UserId; readonly reason: string }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const updated = await client.query<{ id: string; user_id: string; permission: Permissions }>(
        `update permission_grants set revoked_at=now(),revoked_by=$2,revoke_reason=$3
         where id=$1 and revoked_at is null returning id,user_id,permission`,
        [input.grantId, input.revokedBy, input.reason],
      );
      const row = updated.rows[0];
      if (row === undefined) {
        await client.query("rollback");
        return false;
      }
      await client.query(
        `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
         values($1,$2,$3,$4,$5,$6,now())`,
        [
          randomUUID(),
          input.revokedBy,
          "permission.revoked",
          "permission_grant",
          row.id,
          JSON.stringify({ permission: row.permission }),
        ],
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
