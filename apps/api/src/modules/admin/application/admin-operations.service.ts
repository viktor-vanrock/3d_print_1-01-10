import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { AUTH_SESSION_REGISTRY_PORT, AUTH_STEP_UP_PORT, type AuthSessionRegistryPort, type AuthStepUpPort } from "../../auth/public/index.ts";
import { PERMISSION_CONFIRMATION_PORT, PERMISSION_DEFINITIONS, Permissions, type AdministrativeConfirmationAction, type PermissionConfirmationPort } from "../../permissions/public/index.ts";
import { PROFILE_ADMIN_ACCOUNT_PORT, PROFILE_ADMIN_DIRECTORY_PORT, type ProfileAdminAccountPort, type ProfileAdminDirectoryPort } from "../../profile/public/index.ts";
import { PUBLICAPI_ADMIN_PORT, type PublicApiAdminPort } from "../../publicapi/public/index.ts";
import { AdminConfirmationRepository } from "../infrastructure/admin-confirmation.repository.ts";
import { AdminAuditRepository } from "../infrastructure/admin-audit.repository.ts";

export interface AdministrativeActor { readonly actorId: UserId; readonly sessionFingerprint: string; readonly sessionVersion: number }
export interface AdministrativePayload { readonly action: AdministrativeConfirmationAction; readonly reason: string; readonly resourceId?: string }
interface AdministrativeExportResult {
  readonly kind: "administrative_account_metadata_snapshot";
  readonly generated_at: string;
  readonly account: { readonly id: UserId; readonly username: string; readonly status: "active" | "restricted" | "deleted"; readonly administrative_state: "active" | "suspended" | "blocked"; readonly created_at: string; readonly updated_at: string };
  readonly sessions: readonly { readonly id: string; readonly created_at: string; readonly expires_at: string; readonly revoked_at: string | null }[];
  readonly api_keys: readonly { readonly id: string; readonly kind: "api_key" | "user_api_key"; readonly label: string; readonly prefix: string; readonly status: "active" | "revoked"; readonly created_at: string }[];
  readonly limits: { readonly sessions: 50; readonly api_keys: 50 };
}
export type AdministrativeOperationResult =
  | AdministrativeExportResult
  | { readonly action: AdministrativeConfirmationAction; readonly sessions_revoked?: number; readonly keys_revoked?: number };

const REQUIRED: Readonly<Record<AdministrativeConfirmationAction, Permissions>> = {
  suspend_account: Permissions.USER_SUSPEND, block_account: Permissions.USER_BLOCK,
  restore_account: Permissions.USER_RESTORE, delete_account: Permissions.USER_DELETE,
  export_account: Permissions.USER_EXPORT, revoke_session: Permissions.USER_MANAGE_SESSIONS,
};

function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function cleanReason(value: string): string { const reason = value.trim(); if (!reason) throw new ConflictException("Необходимо указать причину"); return reason; }

@Injectable()
export class AdminOperationsService {
  constructor(
    @Inject(PERMISSION_CONFIRMATION_PORT) private readonly confirmations: PermissionConfirmationPort,
    @Inject(AUTH_STEP_UP_PORT) private readonly stepUp: AuthStepUpPort,
    @Inject(PROFILE_ADMIN_ACCOUNT_PORT) private readonly profiles: ProfileAdminAccountPort,
    @Inject(PROFILE_ADMIN_DIRECTORY_PORT) private readonly directory: ProfileAdminDirectoryPort,
    @Inject(AUTH_SESSION_REGISTRY_PORT) private readonly sessions: AuthSessionRegistryPort,
    @Inject(PUBLICAPI_ADMIN_PORT) private readonly keys: PublicApiAdminPort,
    @Inject(AdminConfirmationRepository) private readonly repository: AdminConfirmationRepository,
    @Inject(AdminAuditRepository) private readonly readsAudit: AdminAuditRepository,
  ) {}

  async sessionsForUser(actorId: UserId, userId: UserId) {
    if (await this.directory.findAdminDirectoryUser(userId) === null) throw new NotFoundException();
    const items = await this.sessions.list(userId, 50);
    await this.readsAudit.record({ actorId, action: "admin.user.sessions_viewed", targetType: "user", targetId: userId, details: { count: items.length, limit: 50 } });
    return items;
  }

  private payload(input: AdministrativePayload): Readonly<Record<string, string | null>> {
    return { action: input.action, reason: cleanReason(input.reason), resource_id: input.resourceId ?? null };
  }
  private async state(tx: PoolClient, targetId: UserId) {
    const account = await this.profiles.lockState(tx, targetId);
    if (account === null) throw new NotFoundException();
    const sessions = await this.sessions.listInTransaction(tx, targetId, 50);
    const keys = await this.keys.listInTransaction(tx, targetId, 50);
    return { account, sessions, keys };
  }
  private stateHash(state: Awaited<ReturnType<AdminOperationsService["state"]>>): string {
    return digest({ account: state.account, sessions: state.sessions.map((item) => [item.id, item.expiresAt, item.revokedAt]), keys: state.keys.map((item) => [item.id, item.status, item.prefix]) });
  }
  private async assertTarget(tx: PoolClient, actorId: UserId, targetId: UserId, action: AdministrativeConfirmationAction): Promise<void> {
    if (await this.profiles.isProtectedSuperadmin(tx, targetId)) throw new ForbiddenException("Superadmin защищён startup marker");
    if (actorId === targetId && ["suspend_account", "block_account", "delete_account"].includes(action)) throw new ForbiddenException("Самоблокировка запрещена");
  }

  async preview(actor: AdministrativeActor, targetId: UserId, input: AdministrativePayload) {
    const payload = this.payload(input);
    const intent = await this.confirmations.prepareAdministrativeConfirmation({ ...actor, targetId, action: input.action,
      requiredPermission: REQUIRED[input.action], payload,
      snapshot: async (tx) => { const state = await this.state(tx, targetId); return { stateHash: this.stateHash(state), effects: this.effects(input.action, state, input.resourceId) }; },
    });
    return intent;
  }

  private effects(action: AdministrativeConfirmationAction, state: { readonly sessions: readonly { readonly id: string; readonly revokedAt: Date | null }[]; readonly keys: readonly { readonly id: string; readonly status: string }[] }, resourceId?: string) {
    return {
      action,
      sessions_revoked: action === "suspend_account" || action === "block_account" || action === "delete_account" ? state.sessions.filter((item) => item.revokedAt === null).map((item) => item.id) : action === "revoke_session" && resourceId ? [resourceId] : [],
      keys_revoked: action === "suspend_account" || action === "block_account" || action === "delete_account" ? state.keys.filter((item) => item.status === "active").map((item) => item.id) : [],
      retained: action === "restore_account" ? ["active_sanction", "revoked_credentials"] : [],
    };
  }

  async execute(actor: AdministrativeActor, targetId: UserId, input: AdministrativePayload & { readonly confirmationId: string; readonly password?: string }): Promise<AdministrativeOperationResult> {
    if (PERMISSION_DEFINITIONS[REQUIRED[input.action]].confirmation === "step_up"
      && (input.password === undefined || !(await this.stepUp.verifyPassword(actor.actorId, input.password)))) {
      throw new ForbiddenException("Подтверждение не прошло");
    }
    const payload = this.payload(input);
    let output: AdministrativeOperationResult | null = null;
    await this.confirmations.executeAdministrativeConfirmation({ ...actor, targetId, confirmationId: input.confirmationId,
      action: input.action, requiredPermission: REQUIRED[input.action], payload,
      currentStateHash: async (tx) => this.stateHash(await this.state(tx, targetId)),
      mutate: async (tx) => {
        await this.assertTarget(tx, actor.actorId, targetId, input.action);
        const reason = cleanReason(input.reason);
        let result: AdministrativeOperationResult = { action: input.action };
        if (input.action === "suspend_account" || input.action === "block_account") {
          await this.profiles.setAdministrativeState(tx, { userId: targetId, actorId: actor.actorId, state: input.action === "suspend_account" ? "suspended" : "blocked", reason });
          result = { ...result, sessions_revoked: await this.sessions.revokeAllInTransaction(tx, targetId, actor.actorId, reason), keys_revoked: await this.keys.revokeAllInTransaction(tx, targetId) };
        } else if (input.action === "restore_account") {
          const current = await this.profiles.lockState(tx, targetId);
          if (current?.status === "deleted") throw new ConflictException("Закрытый аккаунт восстановить нельзя");
          await this.profiles.setAdministrativeState(tx, { userId: targetId, actorId: actor.actorId, state: "active", reason });
        } else if (input.action === "delete_account") {
          await this.profiles.closeAccount(tx, { userId: targetId, actorId: actor.actorId, reason });
          result = { ...result, sessions_revoked: await this.sessions.revokeAllInTransaction(tx, targetId, actor.actorId, reason), keys_revoked: await this.keys.revokeAllInTransaction(tx, targetId) };
        } else if (input.action === "revoke_session") {
          if (!input.resourceId || !(await this.sessions.revokeInTransaction(tx, targetId, input.resourceId, actor.actorId, reason))) throw new ConflictException("Сессия уже недействительна");
        } else {
          const account = await this.profiles.lockState(tx, targetId);
          if (account === null) throw new NotFoundException();
          result = { kind: "administrative_account_metadata_snapshot", generated_at: new Date().toISOString(), account: { id: account.id, username: account.username, status: account.status, administrative_state: account.administrativeState, created_at: account.createdAt.toISOString(), updated_at: account.updatedAt.toISOString() }, sessions: (await this.sessions.listInTransaction(tx, targetId, 50)).map((item) => ({ id: item.id, created_at: item.createdAt.toISOString(), expires_at: item.expiresAt.toISOString(), revoked_at: item.revokedAt?.toISOString() ?? null })), api_keys: (await this.keys.listInTransaction(tx, targetId, 50)).map((item) => ({ id: item.id, kind: item.kind, label: item.label, prefix: item.prefix, status: item.status, created_at: item.createdAt.toISOString() })), limits: { sessions: 50, api_keys: 50 } };
        }
        await this.repository.audit(tx, { actorId: actor.actorId, targetId, action: `admin.${input.action}.executed`, details: { confirmation_id: input.confirmationId } });
        output = result;
      },
    });
    if (output === null) throw new Error("Административная операция не вернула результат");
    return output;
  }
}
