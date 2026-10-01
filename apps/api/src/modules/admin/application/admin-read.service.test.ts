import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { PermissionGrant } from "../../permissions/domain/permission-grant.ts";
import { ALL_PERMISSIONS, PERMISSION_DEFINITIONS, Permissions } from "../../permissions/domain/permissions.catalog.ts";
import type { PermissionsService } from "../../permissions/public/index.ts";
import type { ProfileAdminDirectoryPort } from "../../profile/public/index.ts";
import type { SanctionsReadPort } from "../../sanctions/public/index.ts";
import type { AdminAuditRepository } from "../infrastructure/admin-audit.repository.ts";
import { AdminReadService } from "./admin-read.service.ts";

const userId = UserId("00000000-0000-4000-8000-000000000001");
const effectiveGrant: PermissionGrant = {
  id: "00000000-0000-4000-8000-000000000002",
  userId,
  permission: Permissions.ADMIN_PORTAL_ACCESS,
  scope: { kind: "global" },
  grantedBy: UserId("00000000-0000-4000-8000-000000000003"),
  reason: "secret operational reason",
  grantedAt: new Date("2026-01-01T00:00:00.000Z"),
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  revokeReason: null,
};

function permissions(input: { auditError?: Error; catalogAuditError?: Error } = {}) {
  return {
    listEffectiveGrants: vi.fn().mockResolvedValue([effectiveGrant]),
    recordAdminMeViewed: input.auditError === undefined ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(input.auditError),
    recordAdminPermissionCatalogViewed:
      input.catalogAuditError === undefined ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(input.catalogAuditError),
    administrativeRoles: vi.fn().mockResolvedValue(new Map([[userId, "superadmin"]])),
  };
}

function service(
  access = permissions(),
  input: {
    readonly auditError?: Error;
    readonly rows?: readonly Record<string, unknown>[];
  } = {},
) {
  const profile = {
    listAdminDirectoryUsers: vi.fn().mockResolvedValue(input.rows ?? []),
    findAdminDirectoryUser: vi.fn().mockResolvedValue(null),
  };
  const audit = { record: input.auditError === undefined ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(input.auditError) };
  const sanctions = { listLatestForAdmin: vi.fn().mockResolvedValue({ items: [], hasEarlier: false }) };
  return {
    instance: new AdminReadService(
      access as unknown as PermissionsService,
      profile as unknown as ProfileAdminDirectoryPort,
      sanctions as unknown as SanctionsReadPort,
      audit as unknown as AdminAuditRepository,
    ),
    profile,
    sanctions,
    audit,
  };
}

describe("AdminReadService", () => {
  it("возвращает безопасную проекцию effective permissions и записывает audit", async () => {
    const access = permissions();
    const instance = service(access).instance;

    await expect(instance.me(userId)).resolves.toEqual({
      user_id: userId,
      permissions: [{ key: Permissions.ADMIN_PORTAL_ACCESS, scope: { kind: "global" }, expires_at: null }],
    });
    expect(access.recordAdminMeViewed).toHaveBeenCalledWith(userId, 1);
  });

  it("returns independently masked sensitive sections and audits only safe metadata", async () => {
    const targetId = UserId("00000000-0000-4000-8000-000000000010");
    const state = service();
    state.profile.findAdminDirectoryUser.mockResolvedValue({ id: targetId });
    await expect(state.instance.sanctionHistory(userId, targetId)).resolves.toEqual({ items: [], has_earlier: false, limit: 50 });
    const audit = JSON.stringify(state.audit.record.mock.calls);
    expect(audit).not.toMatch(/password_hash|identifier_hash|reason_note|evidence_url|s3_key/i);
  });

  it("не завершает чтение успешно, если audit недоступен", async () => {
    const auditError = new Error("audit unavailable");
    const instance = service(permissions({ auditError })).instance;

    await expect(instance.me(userId)).rejects.toBe(auditError);
  });

  it("возвращает стабильную безопасную проекцию permission catalog и записывает audit", async () => {
    const access = permissions();
    const instance = service(access).instance;

    const result = await instance.permissionCatalog(userId);

    expect(result.items).toHaveLength(ALL_PERMISSIONS.length);
    expect(result.items[0]).toEqual({
      key: Permissions.ADMIN_PORTAL_ACCESS,
      category: PERMISSION_DEFINITIONS[Permissions.ADMIN_PORTAL_ACCESS].category,
      description: PERMISSION_DEFINITIONS[Permissions.ADMIN_PORTAL_ACCESS].description,
      risk: PERMISSION_DEFINITIONS[Permissions.ADMIN_PORTAL_ACCESS].risk,
      delegable: PERMISSION_DEFINITIONS[Permissions.ADMIN_PORTAL_ACCESS].delegable,
      admin_assignable: PERMISSION_DEFINITIONS[Permissions.ADMIN_PORTAL_ACCESS].adminAssignable,
      allowed_scope_kinds: PERMISSION_DEFINITIONS[Permissions.ADMIN_PORTAL_ACCESS].allowedScopeKinds,
      confirmation: PERMISSION_DEFINITIONS[Permissions.ADMIN_PORTAL_ACCESS].confirmation,
    });
    expect(result.items.map((item) => item.key)).toEqual(ALL_PERMISSIONS);
    expect(access.recordAdminPermissionCatalogViewed).toHaveBeenCalledWith(userId, ALL_PERMISSIONS.length);
  });

  it("не завершает чтение permission catalog успешно, если audit недоступен", async () => {
    const auditError = new Error("catalog audit unavailable");
    const instance = service(permissions({ catalogAuditError: auditError })).instance;

    await expect(instance.permissionCatalog(userId)).rejects.toBe(auditError);
  });

  it("returns a server-masked bounded directory page and audits without the search text", async () => {
    const row = {
      id: userId,
      username: "public-name",
      displayName: "Public Name",
      status: "active" as const,
      administrativeState: "active" as const,
      createdAt: new Date("2026-09-24T12:00:00.000Z"),
      updatedAt: new Date("2026-09-24T12:30:00.000Z"),
    };
    const state = service(permissions(), { rows: [row] });

    await expect(state.instance.searchUsers(userId, { query: "  Public Name  ", limit: 1 })).resolves.toEqual({
      items: [{ id: userId, username: "public-name", display_name: "Public Name", status: "active", role: "superadmin", account_state: "active", created_at: "2026-09-24T12:00:00.000Z", pii_masked: true }],
      next_cursor: null,
    });
    expect(state.profile.listAdminDirectoryUsers).toHaveBeenCalledWith(expect.objectContaining({ query: "public name", limit: 2 }));
    const auditInput = state.audit.record.mock.calls[0]?.[0];
    expect(JSON.stringify(auditInput)).not.toContain("Public Name");
    expect(auditInput).toMatchObject({ action: "admin.users.searched", details: { query_kind: "text", pii_masked: true } });
  });

  it("fails the read when directory audit is unavailable", async () => {
    const failure = new Error("audit unavailable");
    const state = service(permissions(), { auditError: failure });
    await expect(state.instance.users(userId, {})).rejects.toBe(failure);
  });

});
