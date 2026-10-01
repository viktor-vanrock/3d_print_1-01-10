import { describe, expect, it } from "vitest";
import { AccessMode } from "../../permissions/domain/access-mode.ts";
import { Permissions } from "../../permissions/domain/permissions.catalog.ts";
import { ACCESS_MODE_KEY, REQUIRED_PERMISSIONS_KEY, REQUIRED_PERMISSION_KEY } from "../../permissions/guards/permission.guard.ts";
import { AdminController } from "./admin.controller.ts";

describe("AdminController authorization metadata", () => {
  it("protects GET /v1/admin/me with method-level admin.portal.access", () => {
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, AdminController.prototype.me)).toBe(AccessMode.PERMISSION);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, AdminController.prototype.me)).toBe(Permissions.ADMIN_PORTAL_ACCESS);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, AdminController)).toBeUndefined();
  });

  it("protects GET /v1/admin/permissions/catalog with its own method-level permission", () => {
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, AdminController.prototype.permissionCatalog)).toBe(AccessMode.PERMISSION);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, AdminController.prototype.permissionCatalog)).toBe(
      Permissions.ADMIN_VIEW_PERMISSION_CATALOG,
    );
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, AdminController)).toBeUndefined();
  });

  it("protects audit browsing with audit.view_log only", () => {
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, AdminController.prototype.auditEvents)).toBe(AccessMode.PERMISSION);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, AdminController.prototype.auditEvents)).toBe(Permissions.AUDIT_VIEW_LOG);
  });

  it.each(["users", "searchUsers", "user"] as const)("protects %s with method-level user.view_any", (method) => {
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, AdminController.prototype[method])).toBe(AccessMode.PERMISSION);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, AdminController.prototype[method])).toBe(Permissions.USER_VIEW_ANY);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, AdminController)).toBeUndefined();
  });

  it("requires view_any plus view_permissions for access state", () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AdminController.prototype.userAccess)).toEqual([Permissions.USER_VIEW_ANY, Permissions.USER_VIEW_PERMISSIONS]);
  });

  it.each([
    ["previewAssignAdmin", Permissions.USER_ASSIGN_ADMIN], ["executeAssignAdmin", Permissions.USER_ASSIGN_ADMIN],
    ["previewRemoveAdmin", Permissions.USER_REMOVE_ADMIN_ASSIGNMENT], ["executeRemoveAdmin", Permissions.USER_REMOVE_ADMIN_ASSIGNMENT],
    ["previewRevokeAll", Permissions.USER_REVOKE_ALL_ADMIN_ACCESS], ["executeRevokeAll", Permissions.USER_REVOKE_ALL_ADMIN_ACCESS],
    ["previewGrant", Permissions.USER_GRANT_PERMISSION], ["executeGrant", Permissions.USER_GRANT_PERMISSION],
    ["previewRevoke", Permissions.USER_REVOKE_PERMISSION], ["executeRevoke", Permissions.USER_REVOKE_PERMISSION],
  ] as const)("protects %s with its explicit mutation permission", (method, permission) => {
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, AdminController.prototype[method])).toBe(AccessMode.PERMISSION);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, AdminController.prototype[method])).toBe(permission);
  });

  it.each([
    ["previewSuspend", Permissions.USER_SUSPEND], ["executeSuspend", Permissions.USER_SUSPEND],
    ["previewBlock", Permissions.USER_BLOCK], ["executeBlock", Permissions.USER_BLOCK],
    ["previewRestore", Permissions.USER_RESTORE], ["executeRestore", Permissions.USER_RESTORE],
    ["previewClose", Permissions.USER_DELETE], ["executeClose", Permissions.USER_DELETE],
    ["previewExport", Permissions.USER_EXPORT], ["executeExport", Permissions.USER_EXPORT],
    ["previewSessionRevoke", Permissions.USER_MANAGE_SESSIONS], ["executeSessionRevoke", Permissions.USER_MANAGE_SESSIONS],
  ] as const)("protects Step 6 %s with explicit permission", (method, permission) => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, AdminController.prototype[method])).toBe(permission);
  });
});
