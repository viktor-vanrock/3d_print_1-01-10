import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { PermissionGrantAlreadyActiveError, type PermissionGrant } from "../domain/permission-grant.ts";
import { Permissions } from "../domain/permissions.catalog.ts";
import { PermissionsService, type PermissionGrantsRepository } from "./permissions.service.ts";

const userId = UserId("00000000-0000-4000-8000-000000000001");
const grantorId = UserId("00000000-0000-4000-8000-000000000002");

function grant(overrides: Partial<PermissionGrant> = {}): PermissionGrant {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    userId,
    permission: Permissions.CATALOG_EDIT_ANY,
    scope: { kind: "global" },
    grantedBy: grantorId,
    reason: "Проверка",
    grantedAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    ...overrides,
  };
}

function repository(input: { active?: boolean; grants?: readonly PermissionGrant[] } = {}): PermissionGrantsRepository & {
  readonly findActiveGrantsMock: ReturnType<typeof vi.fn>;
  readonly findActivePermissionsMock: ReturnType<typeof vi.fn>;
  readonly ensureBootstrapPermissionsMock: ReturnType<typeof vi.fn>;
  readonly createWithAuditMock: ReturnType<typeof vi.fn>;
  readonly findByIdMock: ReturnType<typeof vi.fn>;
  readonly revokeWithAuditMock: ReturnType<typeof vi.fn>;
  readonly findAllActiveGrantsMock: ReturnType<typeof vi.fn>;
  readonly recordAdminMeViewedMock: ReturnType<typeof vi.fn>;
  readonly recordAdminPermissionCatalogViewedMock: ReturnType<typeof vi.fn>;
  readonly isSuperadminUserMock: ReturnType<typeof vi.fn>;
  readonly projectAdministrativeRolesMock: ReturnType<typeof vi.fn>;
} {
  const grants = input.grants ?? [];
  const findActiveGrantsMock = vi.fn().mockImplementation(({ userId: requestedUserId, permission }: { readonly userId: string; readonly permission: Permissions }) =>
    Promise.resolve(grants.filter((item) => item.userId === requestedUserId && item.permission === permission)),
  );
  const findActivePermissionsMock = vi.fn().mockResolvedValue((input.grants ?? []).map((item) => item.permission));
  const ensureBootstrapPermissionsMock = vi.fn().mockResolvedValue({ created: 0, skipped: 3 });
  const createWithAuditMock = vi.fn().mockResolvedValue(undefined);
  const findByIdMock = vi.fn().mockResolvedValue(grants[0] ?? null);
  const revokeWithAuditMock = vi.fn().mockResolvedValue(true);
  const findAllActiveGrantsMock = vi.fn().mockResolvedValue(grants);
  const recordAdminMeViewedMock = vi.fn().mockResolvedValue(undefined);
  const recordAdminPermissionCatalogViewedMock = vi.fn().mockResolvedValue(undefined);
  const isSuperadminUserMock = vi.fn().mockResolvedValue(false);
  const projectAdministrativeRolesMock = vi.fn().mockResolvedValue(new Map());
  return {
    isUserActive: vi.fn().mockResolvedValue(input.active ?? true),
    findActiveGrants: findActiveGrantsMock,
    findActivePermissions: findActivePermissionsMock,
    ensureBootstrapPermissions: ensureBootstrapPermissionsMock,
    ensureBootstrapPermissionsInTransaction: vi.fn().mockResolvedValue({ created: 0, skipped: 3 }),
    hasCompleteBootstrapEvidenceInTransaction: vi.fn().mockResolvedValue(true),
    recordSuperadminBootstrapEventsInTransaction: vi.fn().mockResolvedValue(undefined),
    isSuperadminUser: isSuperadminUserMock,
    projectAdministrativeRoles: projectAdministrativeRolesMock,
    hasAnyPermissionGrantsInTransaction: vi.fn().mockResolvedValue(false),
    createWithAudit: createWithAuditMock,
    findById: findByIdMock,
    revokeWithAudit: revokeWithAuditMock,
    findAllActiveGrants: findAllActiveGrantsMock,
    recordAdminMeViewed: recordAdminMeViewedMock,
    recordAdminPermissionCatalogViewed: recordAdminPermissionCatalogViewedMock,
    preparePermissionChange: vi.fn(),
    executePermissionChange: vi.fn(),
    readUserAccessState: vi.fn(),
    findActiveGrantsMock,
    findActivePermissionsMock,
    ensureBootstrapPermissionsMock,
    createWithAuditMock,
    findByIdMock,
    revokeWithAuditMock,
    findAllActiveGrantsMock,
    recordAdminMeViewedMock,
    recordAdminPermissionCatalogViewedMock,
    isSuperadminUserMock,
    projectAdministrativeRolesMock,
  };
}

describe("PermissionsService", () => {
  it("отказывает неактивному пользователю до чтения grants", async () => {
    const grants = repository({ active: false, grants: [grant()] });
    const service = new PermissionsService(grants);

    await expect(service.hasPermission(userId, Permissions.CATALOG_EDIT_ANY)).resolves.toBe(false);
    expect(grants.findActiveGrantsMock).not.toHaveBeenCalled();
  });

  it("принимает глобальный grant для global-проверки", async () => {
    const service = new PermissionsService(repository({ grants: [grant()] }));

    await expect(service.hasPermission(userId, Permissions.CATALOG_EDIT_ANY)).resolves.toBe(true);
  });

  it("fail-closed отклоняет scope kind, не разрешённый metadata-каталогом", async () => {
    const service = new PermissionsService(repository({ grants: [grant()] }));

    await expect(
      service.hasPermission(userId, Permissions.CATALOG_EDIT_ANY, { kind: "community", communityId: "community-1" }),
    ).resolves.toBe(false);
  });

  it("отказывает для отозванного или истёкшего grant", async () => {
    const service = new PermissionsService(
      repository({
        grants: [
          grant({ revokedAt: new Date("2026-01-02T00:00:00.000Z") }),
          grant({ expiresAt: new Date("2000-01-01T00:00:00.000Z") }),
        ],
      }),
    );

    await expect(service.hasPermission(userId, Permissions.CATALOG_EDIT_ANY)).resolves.toBe(false);
  });

  it("не позволяет выдать разрешение самому себе", async () => {
    const service = new PermissionsService(repository());

    await expect(
      service.grant({ actorId: userId, userId, permission: Permissions.CATALOG_EDIT_ANY, reason: "Самовыдача" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("не изменяет grants marker-bound Superadmin через обычную делегацию", async () => {
    const grants = repository({ grants: [grant({ userId: grantorId, permission: Permissions.USER_GRANT_PERMISSION })] });
    grants.isSuperadminUserMock.mockResolvedValue(true);
    const service = new PermissionsService(grants);
    await expect(service.grant({ actorId: grantorId, userId, permission: Permissions.CATALOG_EDIT_ANY, reason: "Недопустимо" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(grants.createWithAuditMock).not.toHaveBeenCalled();
  });

  it("не выдаёт permission без user.grant_permission", async () => {
    const grants = repository({ grants: [grant({ userId: grantorId })] });
    const service = new PermissionsService(grants);

    await expect(
      service.grant({ actorId: grantorId, userId, permission: Permissions.CATALOG_EDIT_ANY, reason: "Рабочая необходимость" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(grants.createWithAuditMock).not.toHaveBeenCalled();
  });

  it("не выдаёт permission, которого нет у самого actor", async () => {
    const grants = repository({ grants: [grant({ userId: grantorId, permission: Permissions.USER_GRANT_PERMISSION })] });
    const service = new PermissionsService(grants);

    await expect(
      service.grant({ actorId: grantorId, userId, permission: Permissions.CATALOG_EDIT_ANY, reason: "Рабочая необходимость" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(grants.createWithAuditMock).not.toHaveBeenCalled();
  });

  it("не выдаёт non-delegable permission", async () => {
    const grants = repository({ grants: [grant({ userId: grantorId, permission: Permissions.USER_GRANT_PERMISSION })] });
    const service = new PermissionsService(grants);

    await expect(
      service.grant({ actorId: grantorId, userId, permission: Permissions.USER_GRANT_PERMISSION, reason: "Рабочая необходимость" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(grants.createWithAuditMock).not.toHaveBeenCalled();
  });

  it("никогда не выдаёт system-managed feed.news_editor через generic grant", async () => {
    const grants = repository({ grants: [
      grant({ userId: grantorId, permission: Permissions.USER_GRANT_PERMISSION }),
      grant({ id: "00000000-0000-4000-8000-000000000099", userId: grantorId, permission: Permissions.FEED_NEWS_EDITOR }),
    ] });
    const service = new PermissionsService(grants);
    await expect(service.grant({ actorId: grantorId, userId, permission: Permissions.FEED_NEWS_EDITOR, reason: "attempt" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(grants.createWithAuditMock).not.toHaveBeenCalled();
  });

  it("не выдаёт privileged permission без server confirmation", async () => {
    const grants = repository({
      grants: [
        grant({ userId: grantorId, permission: Permissions.USER_GRANT_PERMISSION }),
        grant({ userId: grantorId, permission: Permissions.FEED_MANAGE_NEWS }),
      ],
    });
    const service = new PermissionsService(grants);

    await expect(
      service.grant({ actorId: grantorId, userId, permission: Permissions.FEED_MANAGE_NEWS, reason: "Рабочая необходимость" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(grants.createWithAuditMock).not.toHaveBeenCalled();
  });

  it("выдаёт разрешённый permission с global scope по умолчанию", async () => {
    const grants = repository({
      grants: [
        grant({ userId: grantorId, permission: Permissions.USER_GRANT_PERMISSION }),
        grant({ userId: grantorId, permission: Permissions.CATALOG_EDIT_ANY }),
      ],
    });
    const service = new PermissionsService(grants);

    await service.grant({ actorId: grantorId, userId, permission: Permissions.CATALOG_EDIT_ANY, reason: "Рабочая необходимость" });

    expect(grants.createWithAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { kind: "global" } }),
    );
  });

  it("возвращает conflict при уже активном grant", async () => {
    const grants = repository({
      grants: [
        grant({ userId: grantorId, permission: Permissions.USER_GRANT_PERMISSION }),
        grant({ userId: grantorId, permission: Permissions.CATALOG_EDIT_ANY }),
      ],
    });
    grants.createWithAuditMock.mockRejectedValue(new PermissionGrantAlreadyActiveError());
    const service = new PermissionsService(grants);

    await expect(
      service.grant({ actorId: grantorId, userId, permission: Permissions.CATALOG_EDIT_ANY, reason: "Рабочая необходимость" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(grants.createWithAuditMock).toHaveBeenCalledOnce();
  });

  it("выводит независимые Data capabilities для material edit, publish и unpublish", async () => {
    const service = new PermissionsService(repository({ grants: [
      grant({ permission: Permissions.CATALOG_EDIT_ANY }),
      grant({ id: "00000000-0000-4000-8000-000000000004", permission: Permissions.CATALOG_PUBLISH_ANY }),
      grant({ id: "00000000-0000-4000-8000-000000000005", permission: Permissions.CATALOG_UNPUBLISH_ANY }),
    ] }));

    await expect(service.sessionCapabilities(userId)).resolves.toEqual([
      "data.materials.manage",
      "data.materials.publish",
      "data.materials.unpublish",
    ]);
  });

  it("не создаёт grant со scope kind вне metadata-каталога", async () => {
    const grants = repository();
    const service = new PermissionsService(grants);

    await expect(
      service.grant({
        actorId: grantorId,
        userId,
        permission: Permissions.CATALOG_EDIT_ANY,
        scope: { kind: "catalog", catalog: "materials" },
        reason: "Рабочая необходимость",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(grants.createWithAuditMock).not.toHaveBeenCalled();
  });

  it("проверяет user.revoke_permission до чтения целевого grant", async () => {
    const targetGrant = grant();
    const grants = repository({ grants: [targetGrant] });
    const service = new PermissionsService(grants);

    await expect(service.revoke({ actorId: grantorId, grantId: targetGrant.id, reason: "Больше не требуется" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(grants.findByIdMock).not.toHaveBeenCalled();
    expect(grants.revokeWithAuditMock).not.toHaveBeenCalled();
  });

  it("не отзывает permission вне delegation ceiling actor", async () => {
    const targetGrant = grant();
    const grants = repository({
      grants: [targetGrant, grant({ userId: grantorId, permission: Permissions.USER_REVOKE_PERMISSION })],
    });
    grants.findByIdMock.mockResolvedValue(targetGrant);
    const service = new PermissionsService(grants);

    await expect(service.revoke({ actorId: grantorId, grantId: targetGrant.id, reason: "Больше не требуется" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(grants.revokeWithAuditMock).not.toHaveBeenCalled();
  });

  it("не отзывает grant marker-bound Superadmin", async () => {
    const targetGrant = grant();
    const grants = repository({ grants: [targetGrant, grant({ userId: grantorId, permission: Permissions.USER_REVOKE_PERMISSION })] });
    grants.findByIdMock.mockResolvedValue(targetGrant);
    grants.isSuperadminUserMock.mockResolvedValue(true);
    const service = new PermissionsService(grants);
    await expect(service.revoke({ actorId: grantorId, grantId: targetGrant.id, reason: "Недопустимо" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(grants.revokeWithAuditMock).not.toHaveBeenCalled();
  });

  it("не отзывает privileged permission без server confirmation", async () => {
    const targetGrant = grant({ permission: Permissions.FEED_MANAGE_NEWS });
    const grants = repository({
      grants: [
        targetGrant,
        grant({ userId: grantorId, permission: Permissions.USER_REVOKE_PERMISSION }),
        grant({ userId: grantorId, permission: Permissions.FEED_MANAGE_NEWS }),
      ],
    });
    grants.findByIdMock.mockResolvedValue(targetGrant);
    const service = new PermissionsService(grants);

    await expect(service.revoke({ actorId: grantorId, grantId: targetGrant.id, reason: "Больше не требуется" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(grants.revokeWithAuditMock).not.toHaveBeenCalled();
  });

  it("отзывает delegable permission внутри delegation ceiling", async () => {
    const targetGrant = grant();
    const grants = repository({
      grants: [
        targetGrant,
        grant({ userId: grantorId, permission: Permissions.USER_REVOKE_PERMISSION }),
        grant({ userId: grantorId, permission: Permissions.CATALOG_EDIT_ANY }),
      ],
    });
    grants.findByIdMock.mockResolvedValue(targetGrant);
    const service = new PermissionsService(grants);

    await expect(service.revoke({ actorId: grantorId, grantId: targetGrant.id, reason: "Больше не требуется" })).resolves.toBe(true);
    expect(grants.revokeWithAuditMock).toHaveBeenCalledWith({
      grantId: targetGrant.id,
      revokedBy: grantorId,
      reason: "Больше не требуется",
    });
  });

  it("проецирует только навигационные permissions в стабильные capabilities", async () => {
    const grants = repository({ grants: [grant()] });
    const service = new PermissionsService(grants);

    await expect(service.sessionCapabilities(userId)).resolves.toEqual(["data.materials.manage"]);
  });

  it("независимо проецирует Data и Administration capabilities", async () => {
    const service = new PermissionsService(repository({ grants: [
      grant({ permission: Permissions.CATALOG_EDIT_ANY }),
      grant({ id: "00000000-0000-4000-8000-000000000004", permission: Permissions.ADMIN_PORTAL_ACCESS }),
    ] }));

    await expect(service.sessionCapabilities(userId)).resolves.toEqual([
      "data.materials.manage",
      "admin.portal.access",
    ]);
  });

  it("проецирует News capability только при двух активных permissions", async () => {
    const both = new PermissionsService(repository({ grants: [
      grant({ permission: Permissions.FEED_MANAGE_NEWS }),
      grant({ id: "00000000-0000-4000-8000-000000000099", permission: Permissions.FEED_NEWS_EDITOR }),
    ] }));
    await expect(both.sessionCapabilities(userId)).resolves.toContain("data.news.manage");

    for (const permission of [Permissions.FEED_MANAGE_NEWS, Permissions.FEED_NEWS_EDITOR]) {
      const one = new PermissionsService(repository({ grants: [grant({ permission })] }));
      await expect(one.sessionCapabilities(userId)).resolves.not.toContain("data.news.manage");
    }
  });

  it("не проецирует revoked или expired admin portal grant", async () => {
    const grants = repository({ grants: [grant({ permission: Permissions.ADMIN_PORTAL_ACCESS })] });
    grants.findActivePermissionsMock.mockResolvedValue([]);
    const service = new PermissionsService(grants);

    await expect(service.sessionCapabilities(userId)).resolves.toEqual([]);
  });

  it("не объявляет глобальную capability для ограниченного scope", async () => {
    const grants = repository({ grants: [grant({ scope: { kind: "catalog", catalog: "materials" } })] });
    grants.findActivePermissionsMock.mockResolvedValue([]);
    const service = new PermissionsService(grants);

    await expect(service.sessionCapabilities(userId)).resolves.toEqual([]);
  });

  it("возвращает пустой список capabilities при ошибке чтения grants", async () => {
    const grants = repository();
    grants.findActivePermissionsMock.mockRejectedValue(new Error("database unavailable"));
    const service = new PermissionsService(grants);

    await expect(service.sessionCapabilities(userId)).resolves.toEqual([]);
  });

  it("выдаёт bootstrap root полный каталог permissions", async () => {
    const grants = repository();
    const service = new PermissionsService(grants);
    await expect(service.ensureBootstrapAdminPermissions(userId)).resolves.toEqual({ created: 0, skipped: 3 });
    expect(grants.ensureBootstrapPermissionsMock).toHaveBeenCalledWith({
      userId,
      permissions: Object.values(Permissions),
      reason: "automatic bootstrap root access",
    });
  });

  it("возвращает effective grants активного пользователя", async () => {
    const effective = [grant({ userId })];
    const grants = repository({ grants: effective });
    const service = new PermissionsService(grants);

    await expect(service.listEffectiveGrants(userId)).resolves.toEqual(effective);
    expect(grants.findAllActiveGrantsMock).toHaveBeenCalledOnce();
  });

  it("не читает effective grants неактивного пользователя", async () => {
    const grants = repository({ active: false });
    const service = new PermissionsService(grants);

    await expect(service.listEffectiveGrants(userId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(grants.findAllActiveGrantsMock).not.toHaveBeenCalled();
  });

  it("делегирует обязательный audit чтения admin me", async () => {
    const grants = repository();
    const service = new PermissionsService(grants);

    await service.recordAdminMeViewed(userId, 2);

    expect(grants.recordAdminMeViewedMock).toHaveBeenCalledWith({ actorId: userId, permissionCount: 2 });
  });

  it("делегирует обязательный audit чтения permission catalog", async () => {
    const grants = repository();
    const service = new PermissionsService(grants);

    await service.recordAdminPermissionCatalogViewed(userId, 33);

    expect(grants.recordAdminPermissionCatalogViewedMock).toHaveBeenCalledWith({ actorId: userId, permissionCount: 33 });
  });
});
