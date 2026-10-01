import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { Permissions } from "../../permissions/public/index.ts";
import { AdminAccessService } from "./admin-access.service.ts";

const actorId = UserId("00000000-0000-4000-8000-000000000001");
const targetId = UserId("00000000-0000-4000-8000-000000000002");

function fixture(passwordValid = true) {
  const permissions = {
    preparePermissionChange: vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000003",
      expiresAt: new Date("2030-01-01"),
      effects: { added: [], revoked: [], retained: [] },
    }),
    executePermissionChange: vi.fn().mockResolvedValue({ action: "assign_admin", createdGrantIds: [], revokedGrantIds: [], remainingDirectPermissions: [] }),
    readUserAccessState: vi.fn().mockResolvedValue({ assignment: null, grants: [] }),
  };
  const stepUp = { verifyPassword: vi.fn().mockResolvedValue(passwordValid) };
  return { service: new AdminAccessService(permissions, stepUp), permissions, stepUp };
}

describe("AdminAccessService", () => {
  it("configures access without password verification", async () => {
    const { service, permissions, stepUp } = fixture();
    await service.execute({ actorId, targetId, sessionFingerprint: "d".repeat(64), sessionVersion: 3, action: "configure_access", reason: "approved", confirmationId: "intent", desiredRole: "admin", directPermissions: [] });
    expect(stepUp.verifyPassword).not.toHaveBeenCalled();
    expect(permissions.executePermissionChange).toHaveBeenCalled();
  });
  it("creates a server-calculated preview before asking for the password", async () => {
    const allowed = fixture(false);
    await allowed.service.preview({
      actorId, targetId, sessionFingerprint: "a".repeat(64), sessionVersion: 4,
      action: "assign_admin", reason: "approved",
    });
    expect(allowed.stepUp.verifyPassword).not.toHaveBeenCalled();
    expect(allowed.permissions.preparePermissionChange).toHaveBeenCalledWith(expect.objectContaining({
      actorId, targetId, sessionVersion: 4, requiredPermission: Permissions.USER_ASSIGN_ADMIN,
    }));
  });

  it("requires password step-up for execute and binds it to the same action payload and session", async () => {
    const { service, permissions } = fixture();
    await service.execute({
      actorId, targetId, sessionFingerprint: "b".repeat(64), sessionVersion: 7,
      confirmationId: "00000000-0000-4000-8000-000000000003", action: "grant_permission",
      reason: "limited access", password: "correct", permission: Permissions.CATALOG_EDIT_ANY, expiresAt: null,
    });
    expect(permissions.executePermissionChange).toHaveBeenCalledWith(expect.objectContaining({
      actorId, targetId, sessionVersion: 7, requiredPermission: Permissions.USER_GRANT_PERMISSION,
      payload: expect.objectContaining({ action: "grant_permission", permission: Permissions.CATALOG_EDIT_ANY }),
    }));
  });

  it("does not execute when password step-up fails", async () => {
    const denied = fixture(false);
    await expect(denied.service.execute({
      actorId, targetId, sessionFingerprint: "c".repeat(64), sessionVersion: 1,
      confirmationId: "00000000-0000-4000-8000-000000000003", action: "assign_admin",
      reason: "approved", password: "wrong",
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(denied.permissions.executePermissionChange).not.toHaveBeenCalled();
  });

  it("binds one sorted role and direct-permission configuration to the preview", async()=>{
    const {service,permissions}=fixture();
    await service.preview({actorId,targetId,sessionFingerprint:"d".repeat(64),sessionVersion:3,action:"configure_access",reason:"Новая зона ответственности",directPermissions:[Permissions.CATALOG_EDIT_ANY,Permissions.AUDIT_VIEW_LOG,Permissions.CATALOG_EDIT_ANY]});
    expect(permissions.preparePermissionChange).toHaveBeenCalledWith(expect.objectContaining({requiredPermission:Permissions.USER_VIEW_PERMISSIONS,payload:{action:"configure_access",reason:"Новая зона ответственности",direct_permissions:[Permissions.AUDIT_VIEW_LOG,Permissions.CATALOG_EDIT_ANY]}}));
  });
});
