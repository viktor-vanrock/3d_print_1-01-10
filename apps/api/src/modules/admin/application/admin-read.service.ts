import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { ALL_PERMISSIONS, PERMISSION_DEFINITIONS, PermissionsService } from "../../permissions/public/index.ts";
import { PROFILE_ADMIN_DIRECTORY_PORT, type AdminDirectoryUserRecord, type ProfileAdminDirectoryPort } from "../../profile/public/index.ts";
import { SANCTIONS_READ_PORT, type SanctionsReadPort } from "../../sanctions/public/index.ts";
import { AdminAuditRepository } from "../infrastructure/admin-audit.repository.ts";
import {
  AdminUserDirectoryCursorError,
  decodeAdminUserDirectoryCursor,
  encodeAdminUserDirectoryCursor,
  type AdminUserDirectoryFilter,
} from "./admin-user-directory.cursor.ts";

const DEFAULT_LIMIT = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UsersBrowseInput {
  readonly status?: "active" | "restricted" | "deleted";
  readonly limit?: number;
  readonly cursor?: string;
}

interface UsersSearchInput extends UsersBrowseInput {
  readonly query: string;
}

@Injectable()
export class AdminReadService {
  constructor(
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(PROFILE_ADMIN_DIRECTORY_PORT) private readonly profiles: ProfileAdminDirectoryPort,
    @Inject(SANCTIONS_READ_PORT) private readonly sanctions: SanctionsReadPort,
    @Inject(AdminAuditRepository) private readonly audit: AdminAuditRepository,
  ) {}

  async me(userId: UserIdType) {
    const grants = await this.permissions.listEffectiveGrants(userId);
    const result = {
      user_id: userId,
      permissions: grants.map((grant) => ({
        key: grant.permission,
        scope: grant.scope,
        expires_at: grant.expiresAt?.toISOString() ?? null,
      })),
    };
    await this.permissions.recordAdminMeViewed(userId, result.permissions.length);
    return result;
  }

  async permissionCatalog(userId: UserIdType) {
    const items = ALL_PERMISSIONS.map((key) => {
      const definition = PERMISSION_DEFINITIONS[key];
      return {
        key,
        category: definition.category,
        description: definition.description,
        risk: definition.risk,
        delegable: definition.delegable,
        admin_assignable: definition.adminAssignable,
        allowed_scope_kinds: definition.allowedScopeKinds,
        confirmation: definition.confirmation,
      };
    });
    await this.permissions.recordAdminPermissionCatalogViewed(userId, items.length);
    return { items };
  }

  users(actorId: UserIdType, query: UsersBrowseInput) {
    return this.userPage(actorId, { mode: "browse", status: query.status ?? null, query: null, limit: query.limit ?? DEFAULT_LIMIT }, query.cursor);
  }

  searchUsers(actorId: UserIdType, body: UsersSearchInput) {
    const query = body.query.trim().toLowerCase();
    return this.userPage(actorId, { mode: "search", status: body.status ?? null, query, limit: body.limit ?? DEFAULT_LIMIT }, body.cursor);
  }

  async user(actorId: UserIdType, targetId: UserIdType) {
    const record = await this.profiles.findAdminDirectoryUser(targetId);
    await this.audit.record({
      actorId,
      action: "admin.user.viewed",
      targetType: "user",
      targetId,
      details: { outcome: record === null ? "not_found" : "success", pii_masked: true },
    });
    if (record === null) throw new NotFoundException();
    const roles = await this.permissions.administrativeRoles([targetId]);
    return { ...this.summary(record, roles.get(targetId) ?? "user"), updated_at: record.updatedAt.toISOString() };
  }

  async sanctionHistory(actorId: UserIdType, targetId: UserIdType) {
    await this.requireVisibleTarget(targetId);
    const history = await this.sanctions.listLatestForAdmin(targetId, 50);
    await this.audit.record({ actorId, action: "admin.user.sanctions_viewed", targetType: "user", targetId, details: { count: history.items.length, has_earlier: history.hasEarlier, sensitive_details_masked: true } });
    return {
      items: history.items.map((item) => ({
        id: item.id, type: item.type, state: item.state, reason_code: item.reasonCode,
        starts_at: item.startsAt.toISOString(), ends_at: item.endsAt?.toISOString() ?? null,
        created_at: item.createdAt.toISOString(), updated_at: item.updatedAt.toISOString(),
        sensitive_details_masked: true as const,
      })),
      has_earlier: history.hasEarlier,
      limit: 50 as const,
    };
  }

  private async requireVisibleTarget(targetId: UserIdType): Promise<void> {
    if (await this.profiles.findAdminDirectoryUser(targetId) === null) throw new NotFoundException();
  }

  private async userPage(actorId: UserIdType, filter: AdminUserDirectoryFilter, rawCursor: string | undefined) {
    let after: { readonly createdAt: Date; readonly userId: UserIdType } | null = null;
    if (rawCursor !== undefined) {
      try {
        const decoded = decodeAdminUserDirectoryCursor(rawCursor, filter);
        after = { createdAt: new Date(decoded.createdAt), userId: UserId(decoded.userId) };
      } catch (error) {
        if (error instanceof AdminUserDirectoryCursorError) throw new BadRequestException("Некорректный cursor");
        throw error;
      }
    }
    const rows = await this.profiles.listAdminDirectoryUsers({
      status: filter.status,
      query: filter.query,
      after,
      limit: filter.limit + 1,
    });
    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    const last = page.at(-1);
    const nextCursor = hasMore && last !== undefined
      ? encodeAdminUserDirectoryCursor({ createdAt: last.createdAt.toISOString(), userId: last.id }, filter)
      : null;
    await this.audit.record({
      actorId,
      action: filter.mode === "browse" ? "admin.users.browsed" : "admin.users.searched",
      targetType: "user_directory",
      targetId: actorId,
      details: {
        status: filter.status,
        page_size: filter.limit,
        result_count: page.length,
        has_more: hasMore,
        ...(filter.mode === "search" ? { query_kind: UUID_RE.test(filter.query ?? "") ? "uuid" : "text" } : {}),
        pii_masked: true,
      },
    });
    const roles = await this.permissions.administrativeRoles(page.map((record) => record.id));
    return { items: page.map((record) => this.summary(record, roles.get(record.id) ?? "user")), next_cursor: nextCursor };
  }

  private summary(record: AdminDirectoryUserRecord, role: "user" | "admin" | "superadmin") {
    const accountState = record.status === "deleted"
      ? "closed"
      : record.administrativeState === "blocked"
        ? "blocked"
        : record.administrativeState === "suspended"
          ? "suspended"
          : record.status === "restricted" ? "restricted" : "active";
    return {
      id: record.id,
      username: record.username,
      display_name: record.displayName,
      status: record.status,
      role,
      account_state: accountState,
      created_at: record.createdAt.toISOString(),
      pii_masked: true as const,
    };
  }
}
