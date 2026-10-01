import type { Permissions } from "./permissions.catalog.ts";

export type PermissionRisk = "low" | "medium" | "high" | "critical";

export type PermissionConfirmation = "none" | "confirm" | "step_up";

export type PermissionScopeKind = "global" | "community" | "vendor" | "catalog" | "user";

export type PermissionCategory =
  | "admin"
  | "users"
  | "moderation"
  | "analytics"
  | "billing"
  | "audit"
  | "catalog"
  | "feed"
  | "research"
  | "support";

export interface PermissionDefinition {
  readonly key: Permissions;
  readonly category: PermissionCategory;
  readonly description: string;
  readonly risk: PermissionRisk;
  readonly delegable: boolean;
  readonly adminAssignable: boolean;
  readonly allowedScopeKinds: readonly PermissionScopeKind[];
  readonly confirmation: PermissionConfirmation;
}
