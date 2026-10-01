// Единый закрытый каталог платформенных разрешений. Строковые литералы прав вне
// этого файла запрещены: это исключает опечатки и неявные новые привилегии.
import type { PermissionDefinition, PermissionScopeKind } from "./permission-definition.ts";

export enum Permissions {
  ADMIN_PORTAL_ACCESS = "admin.portal.access",
  ADMIN_VIEW_PERMISSION_CATALOG = "admin.view_permission_catalog",

  USER_VIEW_ANY = "user.view_any",
  USER_VIEW_PERMISSIONS = "user.view_permissions",
  USER_VIEW_SESSIONS = "user.view_sessions",
  USER_MANAGE_SESSIONS = "user.manage_sessions",
  USER_SUSPEND = "user.suspend",
  USER_BLOCK = "user.block",
  USER_RESTORE = "user.restore",
  USER_DELETE = "user.delete",
  USER_EXPORT = "user.export",
  USER_EDIT_ANY = "user.edit_any",
  USER_DEACTIVATE = "user.deactivate",
  USER_GRANT_PERMISSION = "user.grant_permission",
  USER_REVOKE_PERMISSION = "user.revoke_permission",
  USER_ASSIGN_ADMIN = "user.assign_admin",
  USER_REMOVE_ADMIN_ASSIGNMENT = "user.remove_admin_assignment",
  USER_REVOKE_ALL_ADMIN_ACCESS = "user.revoke_all_admin_access",

  MODERATION_DELETE_CONTENT = "moderation.delete_content",
  MODERATION_BAN_USER = "moderation.ban_user",
  MODERATION_VIEW_REPORTS = "moderation.view_reports",
  MODERATION_RESOLVE_REPORT = "moderation.resolve_report",
  MODERATION_MANAGE_SANCTIONS = "moderation.manage_sanctions",
  MODERATION_VIEW_SANCTIONS = "moderation.view_sanctions",
  MODERATION_RESOLVE_APPEAL = "moderation.resolve_appeal",
  MODERATION_MANAGE_COMMUNITY_MEMBERS = "moderation.manage_community_members",

  BILLING_MANAGE_PAYOUTS = "billing.manage_payouts",

  AUDIT_VIEW_LOG = "audit.view_log",
  AUDIT_EXPORT = "audit.export",

  CATALOG_PUBLISH_ANY = "catalog.publish_any",
  CATALOG_UNPUBLISH_ANY = "catalog.unpublish_any",
  CATALOG_EDIT_ANY = "catalog.edit_any",
  CATALOG_FEATURE = "catalog.feature",
  CATALOG_REVIEW_CANDIDATES = "catalog.review_candidates",
  CATALOG_REVIEW_VENDOR_CLAIMS = "catalog.review_vendor_claims",
  CATALOG_REVIEW_PRINTER_REPORTS = "catalog.review_printer_reports",

  FEED_MANAGE_NEWS = "feed.manage_news",
  FEED_NEWS_EDITOR = "feed.news_editor",

  RESEARCH_ACCESS = "research.access",
  RESEARCH_MANAGE = "research.manage",
  RESEARCH_MANAGE_PRINTERS = "research.manage_printers",

  SUPPORT_VIEW_TICKETS = "support.view_tickets",
  SUPPORT_MANAGE_DEVICES = "support.manage_devices",
  SUPPORT_VIEW_DEVICE_INCIDENTS = "support.view_device_incidents",
  SUPPORT_RESOLVE_DEVICE_INCIDENTS = "support.resolve_device_incidents",
}

export const ALL_PERMISSIONS = Object.freeze(Object.values(Permissions));

// Immutable evidence contract from the catalog that existed when stable
// Superadmin identity binding was introduced (Step 3A4). Later permissions are
// repaired only after this provenance baseline and the configured identity are
// verified inside the same startup transaction.
export const SUPERADMIN_BINDING_ROOT_EVIDENCE_PERMISSIONS = Object.freeze([
  Permissions.USER_VIEW_ANY, Permissions.USER_EDIT_ANY, Permissions.USER_DEACTIVATE,
  Permissions.USER_GRANT_PERMISSION, Permissions.USER_REVOKE_PERMISSION,
  Permissions.MODERATION_DELETE_CONTENT, Permissions.MODERATION_BAN_USER,
  Permissions.MODERATION_VIEW_REPORTS, Permissions.MODERATION_RESOLVE_REPORT,
  Permissions.MODERATION_MANAGE_SANCTIONS, Permissions.MODERATION_RESOLVE_APPEAL,
  Permissions.MODERATION_MANAGE_COMMUNITY_MEMBERS,
  Permissions.BILLING_MANAGE_PAYOUTS, Permissions.AUDIT_VIEW_LOG,
  Permissions.CATALOG_PUBLISH_ANY, Permissions.CATALOG_UNPUBLISH_ANY,
  Permissions.CATALOG_FEATURE, Permissions.CATALOG_REVIEW_CANDIDATES,
  Permissions.CATALOG_REVIEW_VENDOR_CLAIMS, Permissions.CATALOG_REVIEW_PRINTER_REPORTS,
  Permissions.RESEARCH_ACCESS, Permissions.RESEARCH_MANAGE, Permissions.SUPPORT_VIEW_TICKETS,
  Permissions.SUPPORT_MANAGE_DEVICES, Permissions.SUPPORT_VIEW_DEVICE_INCIDENTS,
  Permissions.SUPPORT_RESOLVE_DEVICE_INCIDENTS,
] as const);

export const SUPERADMIN_BINDING_DATA_EVIDENCE_PERMISSIONS = Object.freeze([
  Permissions.CATALOG_EDIT_ANY,
  Permissions.RESEARCH_MANAGE_PRINTERS,
  Permissions.FEED_MANAGE_NEWS,
] as const);

const GLOBAL_SCOPE_KINDS = Object.freeze(["global"] satisfies readonly PermissionScopeKind[]);

type PermissionDefinitionInput = Omit<PermissionDefinition, "adminAssignable"> & { readonly adminAssignable?: boolean };

function definePermission(definition: PermissionDefinitionInput): PermissionDefinition {
  return Object.freeze({ ...definition, adminAssignable: definition.adminAssignable ?? false });
}

export const PERMISSION_DEFINITIONS: Readonly<Record<Permissions, PermissionDefinition>> = Object.freeze({
  [Permissions.ADMIN_PORTAL_ACCESS]: definePermission({
    key: Permissions.ADMIN_PORTAL_ACCESS,
    category: "admin",
    description: "Access the administrative workspace",
    risk: "low",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),
  [Permissions.ADMIN_VIEW_PERMISSION_CATALOG]: definePermission({
    key: Permissions.ADMIN_VIEW_PERMISSION_CATALOG,
    category: "admin",
    description: "View the platform permission catalog",
    risk: "low",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),

  [Permissions.USER_VIEW_ANY]: definePermission({
    key: Permissions.USER_VIEW_ANY,
    category: "users",
    description: "View user accounts",
    risk: "medium",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),
  [Permissions.USER_VIEW_PERMISSIONS]: definePermission({
    key: Permissions.USER_VIEW_PERMISSIONS,
    category: "users",
    description: "View effective permissions and assignment provenance for users",
    risk: "medium",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),
  [Permissions.USER_VIEW_SESSIONS]: definePermission({ key: Permissions.USER_VIEW_SESSIONS, category: "users", description: "View bounded browser session metadata", risk: "medium", delegable: true, adminAssignable: true, allowedScopeKinds: GLOBAL_SCOPE_KINDS, confirmation: "none" }),
  [Permissions.USER_MANAGE_SESSIONS]: definePermission({ key: Permissions.USER_MANAGE_SESSIONS, category: "users", description: "Revoke individual browser sessions", risk: "critical", delegable: true, adminAssignable: true, allowedScopeKinds: GLOBAL_SCOPE_KINDS, confirmation: "step_up" }),
  [Permissions.USER_SUSPEND]: definePermission({ key: Permissions.USER_SUSPEND, category: "users", description: "Suspend an account and revoke credentials", risk: "critical", delegable: true, adminAssignable: true, allowedScopeKinds: GLOBAL_SCOPE_KINDS, confirmation: "step_up" }),
  [Permissions.USER_BLOCK]: definePermission({ key: Permissions.USER_BLOCK, category: "users", description: "Block an account and revoke credentials", risk: "critical", delegable: true, adminAssignable: true, allowedScopeKinds: GLOBAL_SCOPE_KINDS, confirmation: "step_up" }),
  [Permissions.USER_RESTORE]: definePermission({ key: Permissions.USER_RESTORE, category: "users", description: "Restore administrative account state", risk: "critical", delegable: true, adminAssignable: true, allowedScopeKinds: GLOBAL_SCOPE_KINDS, confirmation: "step_up" }),
  [Permissions.USER_DELETE]: definePermission({ key: Permissions.USER_DELETE, category: "users", description: "Permanently close an account", risk: "critical", delegable: true, adminAssignable: true, allowedScopeKinds: GLOBAL_SCOPE_KINDS, confirmation: "step_up" }),
  [Permissions.USER_EXPORT]: definePermission({ key: Permissions.USER_EXPORT, category: "users", description: "Export a bounded administrative account metadata snapshot", risk: "medium", delegable: true, adminAssignable: true, allowedScopeKinds: GLOBAL_SCOPE_KINDS, confirmation: "confirm" }),
  [Permissions.USER_EDIT_ANY]: definePermission({
    key: Permissions.USER_EDIT_ANY,
    category: "users",
    description: "Edit user accounts",
    risk: "high",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.USER_DEACTIVATE]: definePermission({
    key: Permissions.USER_DEACTIVATE,
    category: "users",
    description: "Deactivate user accounts",
    risk: "critical",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "step_up",
  }),
  [Permissions.USER_GRANT_PERMISSION]: definePermission({
    key: Permissions.USER_GRANT_PERMISSION,
    category: "users",
    description: "Grant permissions to users",
    risk: "critical",
    delegable: false,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "step_up",
  }),
  [Permissions.USER_REVOKE_PERMISSION]: definePermission({
    key: Permissions.USER_REVOKE_PERMISSION,
    category: "users",
    description: "Revoke assigned user permissions",
    risk: "critical",
    delegable: false,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "step_up",
  }),
  [Permissions.USER_ASSIGN_ADMIN]: definePermission({
    key: Permissions.USER_ASSIGN_ADMIN,
    category: "users",
    description: "Assign the versioned Admin permission preset",
    risk: "critical",
    delegable: false,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "step_up",
  }),
  [Permissions.USER_REMOVE_ADMIN_ASSIGNMENT]: definePermission({
    key: Permissions.USER_REMOVE_ADMIN_ASSIGNMENT,
    category: "users",
    description: "Remove grants owned by an Admin preset assignment",
    risk: "critical",
    delegable: false,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "step_up",
  }),
  [Permissions.USER_REVOKE_ALL_ADMIN_ACCESS]: definePermission({
    key: Permissions.USER_REVOKE_ALL_ADMIN_ACCESS,
    category: "users",
    description: "Revoke all active administrative permission grants",
    risk: "critical",
    delegable: false,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "step_up",
  }),

  [Permissions.MODERATION_DELETE_CONTENT]: definePermission({
    key: Permissions.MODERATION_DELETE_CONTENT,
    category: "moderation",
    description: "Delete moderated content",
    risk: "high",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.MODERATION_BAN_USER]: definePermission({
    key: Permissions.MODERATION_BAN_USER,
    category: "moderation",
    description: "Ban users",
    risk: "critical",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "step_up",
  }),
  [Permissions.MODERATION_VIEW_REPORTS]: definePermission({
    key: Permissions.MODERATION_VIEW_REPORTS,
    category: "moderation",
    description: "View moderation reports",
    risk: "medium",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),
  [Permissions.MODERATION_RESOLVE_REPORT]: definePermission({
    key: Permissions.MODERATION_RESOLVE_REPORT,
    category: "moderation",
    description: "Resolve moderation reports",
    risk: "high",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.MODERATION_MANAGE_SANCTIONS]: definePermission({
    key: Permissions.MODERATION_MANAGE_SANCTIONS,
    category: "moderation",
    description: "Create and cancel sanctions",
    risk: "high",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.MODERATION_VIEW_SANCTIONS]: definePermission({
    key: Permissions.MODERATION_VIEW_SANCTIONS,
    category: "moderation",
    description: "View bounded masked sanction history for users",
    risk: "medium",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),
  [Permissions.MODERATION_RESOLVE_APPEAL]: definePermission({
    key: Permissions.MODERATION_RESOLVE_APPEAL,
    category: "moderation",
    description: "Resolve sanction appeals",
    risk: "high",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.MODERATION_MANAGE_COMMUNITY_MEMBERS]: definePermission({
    key: Permissions.MODERATION_MANAGE_COMMUNITY_MEMBERS,
    category: "moderation",
    description: "Manage community members",
    risk: "high",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),

  [Permissions.BILLING_MANAGE_PAYOUTS]: definePermission({
    key: Permissions.BILLING_MANAGE_PAYOUTS,
    category: "billing",
    description: "Manage billing payouts",
    risk: "critical",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "step_up",
  }),

  [Permissions.AUDIT_VIEW_LOG]: definePermission({
    key: Permissions.AUDIT_VIEW_LOG,
    category: "audit",
    description: "View audit log",
    risk: "high",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.AUDIT_EXPORT]: definePermission({
    key: Permissions.AUDIT_EXPORT,
    category: "audit",
    description: "Export a bounded masked audit-log segment",
    risk: "high",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),

  [Permissions.CATALOG_PUBLISH_ANY]: definePermission({
    key: Permissions.CATALOG_PUBLISH_ANY,
    category: "catalog",
    description: "Publish catalog entries",
    risk: "high",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.CATALOG_UNPUBLISH_ANY]: definePermission({
    key: Permissions.CATALOG_UNPUBLISH_ANY,
    category: "catalog",
    description: "Unpublish catalog entries",
    risk: "high",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.CATALOG_EDIT_ANY]: definePermission({
    key: Permissions.CATALOG_EDIT_ANY,
    category: "catalog",
    description: "Edit catalog entries",
    risk: "medium",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),
  [Permissions.CATALOG_FEATURE]: definePermission({
    key: Permissions.CATALOG_FEATURE,
    category: "catalog",
    description: "Feature catalog entries",
    risk: "medium",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),
  [Permissions.CATALOG_REVIEW_CANDIDATES]: definePermission({
    key: Permissions.CATALOG_REVIEW_CANDIDATES,
    category: "catalog",
    description: "Review catalog candidates",
    risk: "medium",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),
  [Permissions.CATALOG_REVIEW_VENDOR_CLAIMS]: definePermission({
    key: Permissions.CATALOG_REVIEW_VENDOR_CLAIMS,
    category: "catalog",
    description: "Review vendor ownership claims",
    risk: "high",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.CATALOG_REVIEW_PRINTER_REPORTS]: definePermission({
    key: Permissions.CATALOG_REVIEW_PRINTER_REPORTS,
    category: "catalog",
    description: "Review printer reports",
    risk: "medium",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),

  [Permissions.FEED_MANAGE_NEWS]: definePermission({
    key: Permissions.FEED_MANAGE_NEWS,
    category: "feed",
    description: "Manage news feed entries",
    risk: "high",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.FEED_NEWS_EDITOR]: definePermission({
    key: Permissions.FEED_NEWS_EDITOR,
    category: "feed",
    description: "System-managed eligibility for the News editorial workspace",
    risk: "critical",
    delegable: false,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "step_up",
  }),

  [Permissions.RESEARCH_ACCESS]: definePermission({
    key: Permissions.RESEARCH_ACCESS,
    category: "research",
    description: "Access research workspace",
    risk: "low",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),
  [Permissions.RESEARCH_MANAGE]: definePermission({
    key: Permissions.RESEARCH_MANAGE,
    category: "research",
    description: "Manage research workspace",
    risk: "high",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.RESEARCH_MANAGE_PRINTERS]: definePermission({
    key: Permissions.RESEARCH_MANAGE_PRINTERS,
    category: "research",
    description: "Manage research printer data",
    risk: "medium",
    delegable: true,
    adminAssignable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),

  [Permissions.SUPPORT_VIEW_TICKETS]: definePermission({
    key: Permissions.SUPPORT_VIEW_TICKETS,
    category: "support",
    description: "View support tickets",
    risk: "medium",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),
  [Permissions.SUPPORT_MANAGE_DEVICES]: definePermission({
    key: Permissions.SUPPORT_MANAGE_DEVICES,
    category: "support",
    description: "Manage user devices",
    risk: "high",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
  [Permissions.SUPPORT_VIEW_DEVICE_INCIDENTS]: definePermission({
    key: Permissions.SUPPORT_VIEW_DEVICE_INCIDENTS,
    category: "support",
    description: "View device incidents",
    risk: "medium",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "none",
  }),
  [Permissions.SUPPORT_RESOLVE_DEVICE_INCIDENTS]: definePermission({
    key: Permissions.SUPPORT_RESOLVE_DEVICE_INCIDENTS,
    category: "support",
    description: "Resolve device incidents",
    risk: "high",
    delegable: true,
    allowedScopeKinds: GLOBAL_SCOPE_KINDS,
    confirmation: "confirm",
  }),
});

export const DATA_CAPABILITIES = [
  "data.materials.manage",
  "data.materials.publish",
  "data.materials.unpublish",
  "data.printers.manage",
  "data.news.manage",
] as const;

export type DataCapability = (typeof DATA_CAPABILITIES)[number];

export const DATA_CAPABILITY_PERMISSIONS: Readonly<Record<DataCapability, Permissions>> = {
  "data.materials.manage": Permissions.CATALOG_EDIT_ANY,
  "data.materials.publish": Permissions.CATALOG_PUBLISH_ANY,
  "data.materials.unpublish": Permissions.CATALOG_UNPUBLISH_ANY,
  "data.printers.manage": Permissions.RESEARCH_MANAGE_PRINTERS,
  "data.news.manage": Permissions.FEED_MANAGE_NEWS,
};

export const SESSION_CAPABILITIES = [...DATA_CAPABILITIES, "admin.portal.access"] as const;
export type SessionCapability = (typeof SESSION_CAPABILITIES)[number];

export const SESSION_CAPABILITY_PERMISSIONS: Readonly<Record<SessionCapability, Permissions>> = {
  ...DATA_CAPABILITY_PERMISSIONS,
  "admin.portal.access": Permissions.ADMIN_PORTAL_ACCESS,
};

export const BOOTSTRAP_ADMIN_PERMISSIONS = ALL_PERMISSIONS;
