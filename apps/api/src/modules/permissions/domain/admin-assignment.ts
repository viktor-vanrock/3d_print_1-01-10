import { createHash } from "node:crypto";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PermissionScope } from "./permission-scope.ts";
import { Permissions } from "./permissions.catalog.ts";

export const RETIRED_ADMIN_V1_HEALTH_PERMISSION = ["analytics", "view_health"].join(".");

export const ADMIN_PRESET_V1 = Object.freeze({
  key: "admin.default",
  version: 1,
  permissions: Object.freeze([
    Permissions.ADMIN_PORTAL_ACCESS,
    Permissions.ADMIN_VIEW_PERMISSION_CATALOG,
    Permissions.USER_VIEW_ANY,
    RETIRED_ADMIN_V1_HEALTH_PERMISSION,
  ]),
});

export const ADMIN_PRESET_V2 = Object.freeze({
  key: "admin.default",
  version: 2,
  permissions: Object.freeze([
    Permissions.ADMIN_PORTAL_ACCESS,
    Permissions.ADMIN_VIEW_PERMISSION_CATALOG,
    Permissions.USER_VIEW_ANY,
  ]),
});

export const CURRENT_ADMIN_PRESET = ADMIN_PRESET_V2;

const PERMISSION_ACCESS_CLASS: Readonly<Record<Permissions, "administrative" | "ordinary">> = Object.freeze({
  [Permissions.ADMIN_PORTAL_ACCESS]: "administrative",
  [Permissions.ADMIN_VIEW_PERMISSION_CATALOG]: "administrative",
  [Permissions.USER_VIEW_ANY]: "administrative",
  [Permissions.USER_VIEW_PERMISSIONS]: "administrative",
  [Permissions.USER_VIEW_SESSIONS]: "administrative",
  [Permissions.USER_MANAGE_SESSIONS]: "administrative",
  [Permissions.USER_SUSPEND]: "administrative",
  [Permissions.USER_BLOCK]: "administrative",
  [Permissions.USER_RESTORE]: "administrative",
  [Permissions.USER_DELETE]: "administrative",
  [Permissions.USER_EXPORT]: "administrative",
  [Permissions.USER_EDIT_ANY]: "administrative",
  [Permissions.USER_DEACTIVATE]: "administrative",
  [Permissions.USER_GRANT_PERMISSION]: "administrative",
  [Permissions.USER_REVOKE_PERMISSION]: "administrative",
  [Permissions.USER_ASSIGN_ADMIN]: "administrative",
  [Permissions.USER_REMOVE_ADMIN_ASSIGNMENT]: "administrative",
  [Permissions.USER_REVOKE_ALL_ADMIN_ACCESS]: "administrative",
  [Permissions.MODERATION_DELETE_CONTENT]: "administrative",
  [Permissions.MODERATION_BAN_USER]: "administrative",
  [Permissions.MODERATION_VIEW_REPORTS]: "administrative",
  [Permissions.MODERATION_RESOLVE_REPORT]: "administrative",
  [Permissions.MODERATION_MANAGE_SANCTIONS]: "administrative",
  [Permissions.MODERATION_VIEW_SANCTIONS]: "administrative",
  [Permissions.MODERATION_RESOLVE_APPEAL]: "administrative",
  [Permissions.MODERATION_MANAGE_COMMUNITY_MEMBERS]: "administrative",
  [Permissions.BILLING_MANAGE_PAYOUTS]: "administrative",
  [Permissions.AUDIT_VIEW_LOG]: "administrative",
  [Permissions.AUDIT_EXPORT]: "administrative",
  [Permissions.CATALOG_PUBLISH_ANY]: "administrative",
  [Permissions.CATALOG_UNPUBLISH_ANY]: "administrative",
  [Permissions.CATALOG_EDIT_ANY]: "administrative",
  [Permissions.CATALOG_FEATURE]: "administrative",
  [Permissions.CATALOG_REVIEW_CANDIDATES]: "administrative",
  [Permissions.CATALOG_REVIEW_VENDOR_CLAIMS]: "administrative",
  [Permissions.CATALOG_REVIEW_PRINTER_REPORTS]: "administrative",
  [Permissions.FEED_MANAGE_NEWS]: "administrative",
  [Permissions.FEED_NEWS_EDITOR]: "administrative",
  [Permissions.RESEARCH_ACCESS]: "ordinary",
  [Permissions.RESEARCH_MANAGE]: "administrative",
  [Permissions.RESEARCH_MANAGE_PRINTERS]: "ordinary",
  [Permissions.SUPPORT_VIEW_TICKETS]: "administrative",
  [Permissions.SUPPORT_MANAGE_DEVICES]: "administrative",
  [Permissions.SUPPORT_VIEW_DEVICE_INCIDENTS]: "administrative",
  [Permissions.SUPPORT_RESOLVE_DEVICE_INCIDENTS]: "administrative",
});

export const ADMINISTRATIVE_PERMISSIONS = Object.freeze(
  Object.values(Permissions).filter((permission) => PERMISSION_ACCESS_CLASS[permission] === "administrative"),
);
const ADMINISTRATIVE_PERMISSION_SET: ReadonlySet<Permissions> = new Set(ADMINISTRATIVE_PERMISSIONS);

export type PermissionChangeAction =
  | "configure_access"
  | "assign_admin"
  | "remove_admin_assignment"
  | "revoke_all_admin_access"
  | "grant_permission"
  | "revoke_permission";

export type PermissionChangePayload = Readonly<Record<string, string | number | boolean | null | readonly string[]>> & {
  readonly action: PermissionChangeAction;
  readonly reason: string;
};

export interface PermissionChangeContext {
  readonly actorId: UserId;
  readonly targetId: UserId;
  readonly sessionFingerprint: string;
  readonly sessionVersion: number;
  readonly requiredPermission: Permissions;
  readonly payload: PermissionChangePayload;
}

export interface PreparedPermissionChange {
  readonly id: string;
  readonly expiresAt: Date;
  readonly effects: PermissionChangeEffects;
}

export type PermissionGrantProvenance = "admin_assignment" | "direct";

export interface PermissionAccessGrant {
  readonly id: string;
  readonly permission: Permissions;
  readonly scope: PermissionScope;
  readonly expiresAt: Date | null;
  readonly provenance: PermissionGrantProvenance;
  readonly assignmentId: string | null;
}

export interface AdminAssignmentAccessState {
  readonly id: string;
  readonly presetKey: string;
  readonly presetVersion: number;
  readonly presetSnapshot: readonly Permissions[];
  readonly assignedAt: Date;
  readonly missingSnapshotPermissions: readonly Permissions[];
  readonly additionalDirectPermissions: readonly Permissions[];
  readonly currentPresetAdded: readonly Permissions[];
  readonly currentPresetRemoved: readonly Permissions[];
}

export interface AdminUserAccessState {
  readonly assignment: AdminAssignmentAccessState | null;
  readonly grants: readonly PermissionAccessGrant[];
}

export interface PermissionChangeEffect {
  readonly grantId: string | null;
  readonly permission: Permissions;
  readonly provenance: PermissionGrantProvenance;
}

export interface PermissionChangeEffects {
  readonly added: readonly PermissionChangeEffect[];
  readonly revoked: readonly PermissionChangeEffect[];
  readonly retained: readonly PermissionChangeEffect[];
}

export interface PermissionChangeResult {
  readonly action: PermissionChangeAction;
  readonly createdGrantIds: readonly string[];
  readonly revokedGrantIds: readonly string[];
  readonly remainingDirectPermissions: readonly Permissions[];
}

function sortedObject(input: PermissionChangePayload): Record<string, string | number | boolean | null | readonly string[]> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

export function canonicalPermissionChangePayload(payload: PermissionChangePayload): { readonly json: string; readonly hash: string } {
  const json = JSON.stringify(sortedObject(payload));
  return { json, hash: createHash("sha256").update(json).digest("hex") };
}

export function isAdministrativePermission(permission: Permissions): boolean {
  return ADMINISTRATIVE_PERMISSION_SET.has(permission);
}
