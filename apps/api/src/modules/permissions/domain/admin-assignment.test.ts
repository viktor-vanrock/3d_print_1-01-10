import { describe, expect, it } from "vitest";
import { ADMIN_PRESET_V1, ADMIN_PRESET_V2, CURRENT_ADMIN_PRESET, RETIRED_ADMIN_V1_HEALTH_PERMISSION, canonicalPermissionChangePayload, isAdministrativePermission } from "./admin-assignment.ts";
import { Permissions } from "./permissions.catalog.ts";

describe("Admin preset and permission-change payload", () => {
  it("freezes the approved v1 snapshot without identity lookup or mutation powers", () => {
    expect(ADMIN_PRESET_V1).toEqual({
      key: "admin.default",
      version: 1,
      permissions: [
        Permissions.ADMIN_PORTAL_ACCESS,
        Permissions.ADMIN_VIEW_PERMISSION_CATALOG,
        Permissions.USER_VIEW_ANY,
        RETIRED_ADMIN_V1_HEALTH_PERMISSION,
      ],
    });
    expect(ADMIN_PRESET_V1.permissions).not.toContain(Permissions.USER_VIEW_PERMISSIONS);
    expect(ADMIN_PRESET_V1.permissions).not.toContain(Permissions.MODERATION_VIEW_SANCTIONS);
    expect(ADMIN_PRESET_V1.permissions).not.toContain(Permissions.FEED_NEWS_EDITOR);
  });

  it("keeps v1 immutable and uses the reduced v2 preset for new assignments", () => {
    expect(ADMIN_PRESET_V1.permissions).toContain(RETIRED_ADMIN_V1_HEALTH_PERMISSION);
    expect(ADMIN_PRESET_V2).toEqual({
      key: "admin.default",
      version: 2,
      permissions: [Permissions.ADMIN_PORTAL_ACCESS, Permissions.ADMIN_VIEW_PERMISSION_CATALOG, Permissions.USER_VIEW_ANY],
    });
    expect(ADMIN_PRESET_V2.permissions).not.toContain(RETIRED_ADMIN_V1_HEALTH_PERMISSION);
    expect(CURRENT_ADMIN_PRESET).toBe(ADMIN_PRESET_V2);
  });

  it("canonicalizes equivalent payloads and detects changes", () => {
    const first = canonicalPermissionChangePayload({ action: "assign_admin", reason: "approved" });
    const same = canonicalPermissionChangePayload({ reason: "approved", action: "assign_admin" });
    const changed = canonicalPermissionChangePayload({ action: "assign_admin", reason: "different" });
    expect(first.json).toBe(same.json);
    expect(first.hash).toBe(same.hash);
    expect(first.hash).not.toBe(changed.hash);
  });

  it("binds configured role and permission selection to the confirmation hash",()=>{
    const user=canonicalPermissionChangePayload({action:"configure_access",reason:"approved",desired_role:"user",direct_permissions:[]});
    const admin=canonicalPermissionChangePayload({action:"configure_access",reason:"approved",desired_role:"admin",direct_permissions:[Permissions.CATALOG_EDIT_ANY]});
    expect(user.hash).not.toBe(admin.hash);
  });

  it("classifies only platform administration permissions for revoke-all", () => {
    expect(isAdministrativePermission(Permissions.ADMIN_PORTAL_ACCESS)).toBe(true);
    expect(isAdministrativePermission(Permissions.USER_VIEW_ANY)).toBe(true);
    expect(isAdministrativePermission(Permissions.CATALOG_EDIT_ANY)).toBe(true);
    expect(isAdministrativePermission(Permissions.USER_VIEW_PERMISSIONS)).toBe(true);
    expect(isAdministrativePermission(Permissions.MODERATION_VIEW_SANCTIONS)).toBe(true);
    expect(isAdministrativePermission(Permissions.RESEARCH_ACCESS)).toBe(false);
    expect(isAdministrativePermission(Permissions.RESEARCH_MANAGE_PRINTERS)).toBe(false);
  });
});
