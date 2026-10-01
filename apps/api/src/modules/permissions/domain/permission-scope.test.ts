import { describe, expect, it } from "vitest";
import { parsePermissionScope, permissionScopeCovers } from "./permission-scope.ts";

describe("PermissionScope", () => {
  it.each([
    { kind: "global" },
    { kind: "community", communityId: "community-1" },
    { kind: "vendor", vendorId: "vendor-1" },
    { kind: "catalog", catalog: "materials" },
    { kind: "catalog", catalog: "printers" },
    { kind: "user", userId: "user-1" },
  ])("принимает точную форму $kind", (scope) => {
    expect(parsePermissionScope(scope)).toEqual(scope);
  });

  it.each([
    {},
    null,
    [],
    { kind: "unknown" },
    { kind: "global", extra: true },
    { kind: "community" },
    { kind: "community", communityId: "" },
    { kind: "community", communityId: "community-1", extra: true },
    { kind: "vendor", vendorId: 42 },
    { kind: "catalog", catalog: "models" },
    { kind: "user", userId: " " },
  ])("отклоняет некорректный scope %#", (scope) => {
    expect(parsePermissionScope(scope)).toBeNull();
  });

  it("разрешает global grant для global и ресурсного запроса", () => {
    expect(permissionScopeCovers({ kind: "global" })).toBe(true);
    expect(permissionScopeCovers({ kind: "global" }, { kind: "community", communityId: "community-1" })).toBe(true);
  });

  it("разрешает ресурсный grant только для того же kind и identifier", () => {
    const grant = { kind: "community", communityId: "community-1" } as const;

    expect(permissionScopeCovers(grant, { kind: "community", communityId: "community-1" })).toBe(true);
    expect(permissionScopeCovers(grant, { kind: "community", communityId: "community-2" })).toBe(false);
    expect(permissionScopeCovers(grant, { kind: "user", userId: "community-1" })).toBe(false);
    expect(permissionScopeCovers(grant)).toBe(false);
  });
});
