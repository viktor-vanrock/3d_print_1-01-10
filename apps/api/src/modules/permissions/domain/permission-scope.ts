export type PermissionScope =
  | Readonly<{ kind: "global" }>
  | Readonly<{ kind: "community"; communityId: string }>
  | Readonly<{ kind: "vendor"; vendorId: string }>
  | Readonly<{ kind: "catalog"; catalog: "materials" | "printers" }>
  | Readonly<{ kind: "user"; userId: string }>;

export const GLOBAL_PERMISSION_SCOPE: PermissionScope = Object.freeze({ kind: "global" });

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function parsePermissionScope(value: unknown): PermissionScope | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;

  switch (value.kind) {
    case "global":
      return hasExactKeys(value, ["kind"]) ? GLOBAL_PERMISSION_SCOPE : null;
    case "community":
      return hasExactKeys(value, ["kind", "communityId"]) && isNonBlankString(value.communityId)
        ? Object.freeze({ kind: "community", communityId: value.communityId })
        : null;
    case "vendor":
      return hasExactKeys(value, ["kind", "vendorId"]) && isNonBlankString(value.vendorId)
        ? Object.freeze({ kind: "vendor", vendorId: value.vendorId })
        : null;
    case "catalog":
      return hasExactKeys(value, ["kind", "catalog"]) && (value.catalog === "materials" || value.catalog === "printers")
        ? Object.freeze({ kind: "catalog", catalog: value.catalog })
        : null;
    case "user":
      return hasExactKeys(value, ["kind", "userId"]) && isNonBlankString(value.userId)
        ? Object.freeze({ kind: "user", userId: value.userId })
        : null;
    default:
      return null;
  }
}

export function permissionScopeCovers(grantScope: PermissionScope, requestedScope?: PermissionScope): boolean {
  if (grantScope.kind === "global") return true;
  if (requestedScope === undefined) return false;

  switch (grantScope.kind) {
    case "community":
      return requestedScope.kind === "community" && requestedScope.communityId === grantScope.communityId;
    case "vendor":
      return requestedScope.kind === "vendor" && requestedScope.vendorId === grantScope.vendorId;
    case "catalog":
      return requestedScope.kind === "catalog" && requestedScope.catalog === grantScope.catalog;
    case "user":
      return requestedScope.kind === "user" && requestedScope.userId === grantScope.userId;
  }
}
