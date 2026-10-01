import type { components } from "../../api/generated/openapi.ts";
import { apiFetch } from "@shared/api";

export type AdminMe = components["schemas"]["AdminMeResponseDto"];
export type AdminPermission = AdminMe["permissions"][number]["key"];
export type AdminUser = components["schemas"]["AdminUserCardDto"];
export type AdminUserPage = components["schemas"]["AdminUsersPageDto"];
export type AdminUserSummary = AdminUserPage["items"][number];
export type AdminUserAccess = components["schemas"]["AdminUserAccessStateDto"];
export type AdminUserSanctions = components["schemas"]["AdminLatestSanctionsResponseDto"];
export type AdminPermissionCatalog = components["schemas"]["AdminPermissionCatalogResponseDto"];
export type PermissionChangePreview = components["schemas"]["AdminPermissionChangePreviewResponseDto"];
export type PermissionChangeResult = components["schemas"]["AdminPermissionChangeResultDto"];
export type PermissionChangeAction = "assign_admin" | "remove_admin_assignment" | "revoke_all_admin_access" | "grant_permission" | "revoke_permission";
export type ConfigurableRole = "user" | "admin";
export type AdminBrowserSessions = components["schemas"]["AdminBrowserSessionsResponseDto"];
export type AdminOperationPreview = components["schemas"]["AdminOperationPreviewResponseDto"];
export type AdminOperationAction = "suspend_account" | "block_account" | "restore_account" | "delete_account" | "export_account" | "revoke_session";
export type AdminAuditPage = components["schemas"]["AdminAuditPageDto"];
export type AdminAuditExportCreated = components["schemas"]["AdminAuditExportCreatedDto"];

export class AdminApiError extends Error {
  constructor(readonly status: number) {
    super(`admin request failed (${status})`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, { credentials: "include", ...init });
  if (!response.ok) throw new AdminApiError(response.status);
  return response.json();
}

function mutationPath(userId: string, action: PermissionChangeAction, phase: "preview" | "execute"): string {
  const base = `/v1/admin/users/${encodeURIComponent(userId)}`;
  switch (action) {
    case "assign_admin": return `${base}/admin-assignment/${phase}`;
    case "remove_admin_assignment": return `${base}/admin-assignment/remove/${phase}`;
    case "revoke_all_admin_access": return `${base}/admin-access/revoke-all/${phase}`;
    case "grant_permission": return `${base}/permissions/grant/${phase}`;
    case "revoke_permission": return `${base}/permissions/revoke/${phase}`;
  }
}

function post<T>(path: string, body: Readonly<Record<string, unknown>>): Promise<T> {
  return request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function getAdminMe(): Promise<AdminMe> {
  return request("/v1/admin/me");
}

export function browseAdminUsers(): Promise<AdminUserPage> {
  return request("/v1/admin/users?limit=50");
}

export function searchAdminUsers(query: string): Promise<AdminUserPage> {
  return post("/v1/admin/users/search", { query, limit: 50 });
}

export function getAdminUser(userId: string): Promise<AdminUser> {
  return request(`/v1/admin/users/${encodeURIComponent(userId)}`);
}

export function getAdminUserAccess(userId: string): Promise<AdminUserAccess> {
  return request(`/v1/admin/users/${encodeURIComponent(userId)}/access`);
}

export function getAdminUserSanctions(userId: string): Promise<AdminUserSanctions> {
  return request(`/v1/admin/users/${encodeURIComponent(userId)}/sanctions`);
}
export function getAdminUserSessions(userId: string): Promise<AdminBrowserSessions> { return request(`/v1/admin/users/${encodeURIComponent(userId)}/sessions`); }

const ADMIN_OPERATION_REASONS: Readonly<Record<AdminOperationAction, string>> = {
  suspend_account: "Приостановка аккаунта через интерфейс администрирования",
  block_account: "Блокировка аккаунта через интерфейс администрирования",
  restore_account: "Восстановление аккаунта через интерфейс администрирования",
  delete_account: "Закрытие аккаунта через интерфейс администрирования",
  export_account: "Экспорт метаданных через интерфейс администрирования",
  revoke_session: "Завершение сессии через интерфейс администрирования",
};

function operationPath(userId: string, action: AdminOperationAction, phase: "preview" | "execute", resourceId?: string): string {
  const base = `/v1/admin/users/${encodeURIComponent(userId)}`;
  if (action === "suspend_account") return `${base}/account/suspend/${phase}`;
  if (action === "block_account") return `${base}/account/block/${phase}`;
  if (action === "restore_account") return `${base}/account/restore/${phase}`;
  if (action === "delete_account") return `${base}/account/close/${phase}`;
  if (action === "export_account") return `${base}/export/${phase}`;
  if (resourceId === undefined) throw new Error("resource id is required");
  if (action === "revoke_session") return `${base}/sessions/${encodeURIComponent(resourceId)}/revoke/${phase}`;
  return `${base}/sessions/${encodeURIComponent(resourceId)}/revoke/${phase}`;
}
export function previewAdminOperation(userId: string, action: AdminOperationAction, resourceId?: string): Promise<AdminOperationPreview> {
  return post(operationPath(userId, action, "preview", resourceId), { reason: ADMIN_OPERATION_REASONS[action] });
}
export function executeAdminOperation(userId: string, action: AdminOperationAction, body: { readonly confirmation_id: string; readonly password?: string }, resourceId?: string): Promise<Readonly<Record<string, unknown>>> {
  return post(operationPath(userId, action, "execute", resourceId), { ...body, reason: ADMIN_OPERATION_REASONS[action] });
}

export function getAdminPermissionCatalog(): Promise<AdminPermissionCatalog> {
  return request("/v1/admin/permissions/catalog");
}

export function getAdminAuditEvents(input: { readonly cursor?: string; readonly targetId?: string } = {}): Promise<AdminAuditPage> {
  const query = new URLSearchParams({ limit: "50" });
  if (input.cursor !== undefined) query.set("cursor", input.cursor);
  if (input.targetId !== undefined) query.set("target_id", input.targetId);
  return request(`/v1/admin/audit/events?${query.toString()}`);
}

export function createAdminAuditExport(input: { readonly from?: string; readonly to?: string; readonly cursor?: string }): Promise<AdminAuditExportCreated> {
  return post("/v1/admin/audit/exports", input);
}

export async function downloadAdminAuditExport(id: string): Promise<void> {
  const response = await apiFetch(`/v1/admin/audit/exports/${encodeURIComponent(id)}/download`, { credentials: "include" });
  if (!response.ok) throw new AdminApiError(response.status);
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `admin-audit-${id}.json`; link.click(); URL.revokeObjectURL(url);
}

export function previewPermissionChange(
  userId: string,
  action: PermissionChangeAction,
  body: Readonly<Record<string, unknown>>,
): Promise<PermissionChangePreview> {
  return post(mutationPath(userId, action, "preview"), body);
}

export function executePermissionChange(
  userId: string,
  action: PermissionChangeAction,
  body: Readonly<Record<string, unknown>>,
): Promise<PermissionChangeResult> {
  return post(mutationPath(userId, action, "execute"), body);
}

export function previewAccessConfiguration(userId:string,input:{readonly permissions:readonly AdminPermission[];readonly reason:string}):Promise<PermissionChangePreview>{
  return post(`/v1/admin/users/${encodeURIComponent(userId)}/access/configure/preview`,input);
}
export function executeAccessConfiguration(userId:string,input:{readonly permissions:readonly AdminPermission[];readonly reason:string;readonly confirmation_id:string}):Promise<PermissionChangeResult>{
  return post(`/v1/admin/users/${encodeURIComponent(userId)}/access/configure/execute`,input);
}
