import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, BOOTSTRAP_ADMIN_PERMISSIONS, PERMISSION_DEFINITIONS, Permissions, SUPERADMIN_BINDING_DATA_EVIDENCE_PERMISSIONS, SUPERADMIN_BINDING_ROOT_EVIDENCE_PERMISSIONS } from "./permissions.catalog.ts";

describe("PERMISSION_DEFINITIONS", () => {
  it("содержит ровно одно определение для каждого permission и не содержит неизвестных ключей", () => {
    const definitionKeys = Object.keys(PERMISSION_DEFINITIONS);

    expect(definitionKeys).toHaveLength(ALL_PERMISSIONS.length);
    expect(new Set(definitionKeys)).toEqual(new Set(ALL_PERMISSIONS));
    expect(Object.values(PERMISSION_DEFINITIONS).map((definition) => definition.key)).toEqual(ALL_PERMISSIONS);
  });

  it("объявляет хотя бы один допустимый scope kind для каждого permission", () => {
    for (const definition of Object.values(PERMISSION_DEFINITIONS)) {
      expect(definition.allowedScopeKinds.length, definition.key).toBeGreaterThan(0);
      expect(typeof definition.adminAssignable, definition.key).toBe("boolean");
    }
  });

  it("exposes only the current Administration and Data permissions in the access editor", () => {
    const visible = Object.values(PERMISSION_DEFINITIONS).filter((definition) => definition.adminAssignable).map((definition) => definition.key);
    expect(visible).toEqual([
      Permissions.ADMIN_PORTAL_ACCESS, Permissions.ADMIN_VIEW_PERMISSION_CATALOG, Permissions.USER_VIEW_ANY,
      Permissions.USER_VIEW_PERMISSIONS, Permissions.USER_VIEW_SESSIONS, Permissions.USER_MANAGE_SESSIONS,
      Permissions.USER_SUSPEND, Permissions.USER_BLOCK, Permissions.USER_RESTORE, Permissions.USER_DELETE,
      Permissions.USER_EXPORT, Permissions.AUDIT_VIEW_LOG, Permissions.AUDIT_EXPORT,
      Permissions.CATALOG_PUBLISH_ANY, Permissions.CATALOG_UNPUBLISH_ANY, Permissions.CATALOG_EDIT_ANY,
      Permissions.CATALOG_REVIEW_PRINTER_REPORTS, Permissions.FEED_MANAGE_NEWS, Permissions.RESEARCH_MANAGE_PRINTERS,
    ]);
    expect(PERMISSION_DEFINITIONS[Permissions.RESEARCH_ACCESS].adminAssignable).toBe(false);
    expect(PERMISSION_DEFINITIONS[Permissions.SUPPORT_VIEW_TICKETS].adminAssignable).toBe(false);
  });

  it("позволяет назначать операционные права управления аккаунтом с обязательным step-up", () => {
    const accountOperationPermissions = [
      Permissions.USER_MANAGE_SESSIONS,
      Permissions.USER_SUSPEND,
      Permissions.USER_BLOCK,
      Permissions.USER_RESTORE,
      Permissions.USER_DELETE,
    ];

    for (const permission of accountOperationPermissions) {
      expect(PERMISSION_DEFINITIONS[permission]).toMatchObject({
        adminAssignable: true,
        delegable: true,
        risk: "critical",
        confirmation: "step_up",
      });
    }
  });

  it("разрешает ограниченный экспорт метаданных без password step-up", () => {
    expect(PERMISSION_DEFINITIONS[Permissions.USER_EXPORT]).toMatchObject({
      adminAssignable: true,
      delegable: true,
      risk: "medium",
      confirmation: "confirm",
    });
  });

  it("требует дополнительное подтверждение для high и critical permissions", () => {
    for (const definition of Object.values(PERMISSION_DEFINITIONS)) {
      if (definition.risk === "high" || definition.risk === "critical") {
        expect(definition.confirmation, definition.key).not.toBe("none");
      }
      if (definition.risk === "critical") {
        expect(definition.confirmation, definition.key).toBe("step_up");
      }
    }
  });

  it("защищает каталог, определения и списки scope kinds от runtime-изменений", () => {
    expect(Object.isFrozen(PERMISSION_DEFINITIONS)).toBe(true);

    for (const definition of Object.values(PERMISSION_DEFINITIONS)) {
      expect(Object.isFrozen(definition), definition.key).toBe(true);
      expect(Object.isFrozen(definition.allowedScopeKinds), definition.key).toBe(true);
    }
  });

  it("выдаёт bootstrap root полный каталог permissions", () => {
    expect(BOOTSTRAP_ADMIN_PERMISSIONS).toEqual(ALL_PERMISSIONS);
  });

  it("сохраняет immutable evidence baseline Step 3A4 отдельно от поздних permissions", () => {
    expect(Object.isFrozen(SUPERADMIN_BINDING_ROOT_EVIDENCE_PERMISSIONS)).toBe(true);
    expect(Object.isFrozen(SUPERADMIN_BINDING_DATA_EVIDENCE_PERMISSIONS)).toBe(true);
    expect(SUPERADMIN_BINDING_ROOT_EVIDENCE_PERMISSIONS).toHaveLength(26);
    expect(SUPERADMIN_BINDING_DATA_EVIDENCE_PERMISSIONS).toEqual([
      Permissions.CATALOG_EDIT_ANY, Permissions.RESEARCH_MANAGE_PRINTERS, Permissions.FEED_MANAGE_NEWS,
    ]);
    const baseline = [...SUPERADMIN_BINDING_ROOT_EVIDENCE_PERMISSIONS, ...SUPERADMIN_BINDING_DATA_EVIDENCE_PERMISSIONS];
    expect(baseline).not.toContain(Permissions.ADMIN_PORTAL_ACCESS);
    expect(baseline).not.toContain(Permissions.ADMIN_VIEW_PERMISSION_CATALOG);
    expect(Permissions).not.toHaveProperty("USER_LOOKUP_IDENTITY");
    expect(new Set(baseline).size).toBe(baseline.length);
  });

  it("не позволяет делегировать права управления permissions", () => {
    expect(PERMISSION_DEFINITIONS[Permissions.USER_GRANT_PERMISSION].delegable).toBe(false);
    expect(PERMISSION_DEFINITIONS[Permissions.USER_REVOKE_PERMISSION].delegable).toBe(false);
  });

  it("оставляет News editor eligibility системным permission вне immutable Admin preset", () => {
    expect(PERMISSION_DEFINITIONS[Permissions.FEED_NEWS_EDITOR]).toMatchObject({ delegable: false, confirmation: "step_up" });
    expect(BOOTSTRAP_ADMIN_PERMISSIONS).toContain(Permissions.FEED_NEWS_EDITOR);
  });

  it("описывает admin shell access как delegable global permission", () => {
    const definition = PERMISSION_DEFINITIONS[Permissions.ADMIN_PORTAL_ACCESS];

    expect(definition).toMatchObject({
      key: Permissions.ADMIN_PORTAL_ACCESS,
      category: "admin",
      delegable: true,
      allowedScopeKinds: ["global"],
      confirmation: "none",
    });
    expect(BOOTSTRAP_ADMIN_PERMISSIONS).toContain(Permissions.ADMIN_PORTAL_ACCESS);
    expect(ALL_PERMISSIONS).not.toContain("admin.access");
  });

  it("описывает чтение permission catalog отдельным delegable global permission", () => {
    const definition = PERMISSION_DEFINITIONS[Permissions.ADMIN_VIEW_PERMISSION_CATALOG];

    expect(definition).toMatchObject({
      key: Permissions.ADMIN_VIEW_PERMISSION_CATALOG,
      category: "admin",
      risk: "low",
      delegable: true,
      allowedScopeKinds: ["global"],
      confirmation: "none",
    });
    expect(BOOTSTRAP_ADMIN_PERMISSIONS).toContain(Permissions.ADMIN_VIEW_PERMISSION_CATALOG);
  });

  it("разделяет basic card и чувствительные read projections", () => {
    const sensitiveReads = [
      Permissions.USER_VIEW_PERMISSIONS,
      Permissions.MODERATION_VIEW_SANCTIONS,
    ];
    for (const permission of sensitiveReads) {
      expect(PERMISSION_DEFINITIONS[permission]).toMatchObject({ risk: "medium", delegable: true, confirmation: "none" });
      expect(permission).not.toBe(Permissions.USER_VIEW_ANY);
    }
  });
});
