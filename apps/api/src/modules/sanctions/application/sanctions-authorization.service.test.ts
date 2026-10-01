import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { Permissions, type PermissionsService } from "../../permissions/public/index.ts";
import { SanctionsAuthorizationService } from "./sanctions-authorization.service.ts";

const actorId = UserId("00000000-0000-4000-8000-000000000001");
const targetId = UserId("00000000-0000-4000-8000-000000000002");

function permissions(input: { readonly active?: boolean; readonly allowed?: readonly Permissions[] } = {}): PermissionsService {
  const allowed = new Set(input.allowed ?? []);
  return {
    isActiveUser: vi.fn().mockResolvedValue(input.active ?? true),
    hasPermission: vi.fn((_userId, permission: Permissions) => Promise.resolve(allowed.has(permission))),
  } as unknown as PermissionsService;
}

describe("SanctionsAuthorizationService", () => {
  it("checks the exact permission for sanction mutations", async () => {
    const policy = new SanctionsAuthorizationService(permissions({ allowed: [Permissions.MODERATION_MANAGE_SANCTIONS] }));

    await expect(policy.canManageSanctions(actorId)).resolves.toBe(true);
    await expect(policy.canResolveAppeal(actorId)).resolves.toBe(false);
  });

  it("checks the exact permission for appeal resolution", async () => {
    const policy = new SanctionsAuthorizationService(permissions({ allowed: [Permissions.MODERATION_RESOLVE_APPEAL] }));

    await expect(policy.canManageSanctions(actorId)).resolves.toBe(false);
    await expect(policy.canResolveAppeal(actorId)).resolves.toBe(true);
  });

  it("allows an active user to read their own sanctions without a platform permission", async () => {
    const policy = new SanctionsAuthorizationService(permissions());

    await expect(policy.canViewUserSanctions(actorId, actorId)).resolves.toBe(true);
  });

  it("rejects reading another user's sanctions without view permission", async () => {
    const policy = new SanctionsAuthorizationService(permissions());

    await expect(policy.canViewUserSanctions(actorId, targetId)).resolves.toBe(false);
  });

  it("allows reading another user's sanctions with view permission", async () => {
    const policy = new SanctionsAuthorizationService(permissions({ allowed: [Permissions.MODERATION_VIEW_REPORTS] }));

    await expect(policy.canViewUserSanctions(actorId, targetId)).resolves.toBe(true);
  });

  it("rejects self-read for an inactive user", async () => {
    const policy = new SanctionsAuthorizationService(permissions({ active: false }));

    await expect(policy.canViewUserSanctions(actorId, actorId)).resolves.toBe(false);
  });
});
