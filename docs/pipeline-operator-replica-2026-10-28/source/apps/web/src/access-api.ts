import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ApiError, apiUrl, meQueryOptions } from "./auth-api";

export interface PermissionDefinition {
  key: string;
  name: string;
  kind: "menu" | "page" | "button";
  parent_key: string | null;
  route: string | null;
  requestable: boolean;
}
export interface PermissionCatalog {
  permissions: PermissionDefinition[];
  projects: { id: string; name: string }[];
}
export interface AccessScope { scope_type: "global" | "project"; scope_id: string }
export interface AccessUser {
  id: string; username: string; display_name: string; is_active: boolean;
  group_ids: string[]; effective_permissions: string[];
}
export interface AccessGroup { id: string; key: string; name: string; member_ids: string[] }
export interface AccessPolicy extends AccessScope {
  id: string; subject_type: "user" | "group"; subject_id: string;
  permission_key: string; effect: "allow" | "deny";
}
export interface AccessDirectory { users: AccessUser[]; groups: AccessGroup[]; policies: AccessPolicy[] }
export type PolicyInput = Omit<AccessPolicy, "id" | "effect"> & { effect: "allow" | "deny" | "inherit" };
export interface PermissionRequest {
  id: string; requester_id: string; requester_name: string;
  permission_key: string; permission_name: string; project_id: string;
  reason: string; requested_permissions: string[];
  status: "pending" | "approved" | "rejected";
  reviewer_id: string | null; reviewer_name: string | null; review_comment: string | null;
  created_at: string; reviewed_at: string | null;
}
export interface InAppNotification {
  id: string; kind: string; title: string; body: string; request_id: string | null;
  read_at: string | null; created_at: string;
}
export interface NotificationFeed { items: InAppNotification[]; unread_count: number }

async function accessRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), { ...init, credentials: "include" });
  if (!response.ok) {
    let message = `请求失败：HTTP ${response.status}`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((item: { msg?: string }) => item.msg ?? "输入格式有误").join("；");
    } catch { /* Use the HTTP error when no readable response is available. */ }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
function write<T>(path: string, method: string, input: unknown, csrfToken: string) {
  return accessRequest<T>(path, {
    method, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(input),
  });
}
export const catalogQueryOptions = queryOptions({
  queryKey: ["access", "catalog"], queryFn: () => accessRequest<PermissionCatalog>("/api/access/catalog"), staleTime: 60_000,
});
export const ownRequestsQueryOptions = queryOptions({
  queryKey: ["access", "requests", "mine"], queryFn: () => accessRequest<PermissionRequest[]>("/api/access/requests"),
  refetchInterval: 30_000, refetchOnWindowFocus: "always",
});
export const adminRequestsQueryOptions = queryOptions({
  queryKey: ["access", "requests", "admin"], queryFn: () => accessRequest<PermissionRequest[]>("/api/admin/access/requests"),
  refetchInterval: 30_000, refetchOnWindowFocus: "always",
});
export const notificationsQueryOptions = queryOptions({
  queryKey: ["access", "notifications"], queryFn: () => accessRequest<NotificationFeed>("/api/notifications"),
  refetchInterval: 30_000, refetchOnWindowFocus: "always",
});
export const accessDirectoryQueryOptions = (scope: AccessScope) => queryOptions({
  queryKey: ["access", "directory", scope.scope_type, scope.scope_id],
  queryFn: () => accessRequest<AccessDirectory>(`/api/admin/access?${new URLSearchParams({ ...scope })}`),
  staleTime: 15_000,
});
export const saveAccessPolicy = (input: PolicyInput, token: string) => write<unknown>("/api/admin/access/policies", "PUT", input, token);
export const createAccessGroup = (input: { key: string; name: string }, token: string) => write<AccessGroup>("/api/admin/access/groups", "POST", input, token);
export const saveGroupMembers = (id: string, userIds: string[], token: string) => write<AccessGroup>(`/api/admin/access/groups/${encodeURIComponent(id)}/members`, "PUT", { user_ids: userIds }, token);
export const createPermissionRequest = (input: { permission_key: string; project_id: string; reason: string }, token: string) => write<PermissionRequest>("/api/access/requests", "POST", input, token);
export const decidePermissionRequest = (id: string, decision: "approved" | "rejected", comment: string, token: string) => write<PermissionRequest>(`/api/admin/access/requests/${encodeURIComponent(id)}/decision`, "POST", { decision, comment }, token);
export const markNotificationRead = (id: string, token: string) => write<unknown>(`/api/notifications/${encodeURIComponent(id)}/read`, "POST", {}, token);

export async function refreshAccess(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["access"] }),
    client.invalidateQueries({ queryKey: meQueryOptions.queryKey }),
    client.invalidateQueries({ queryKey: ["accessible-projects"] }),
    client.invalidateQueries({ queryKey: ["admin", "users"] }),
  ]);
}

export function permissionRows(permissions: PermissionDefinition[]) {
  const rows: { permission: PermissionDefinition; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (permission: PermissionDefinition, depth: number) => {
    if (seen.has(permission.key)) return;
    seen.add(permission.key);
    rows.push({ permission, depth });
    permissions.filter((item) => item.parent_key === permission.key).forEach((child) => visit(child, depth + 1));
  };
  permissions.filter((item) => !item.parent_key || !permissions.some((parent) => parent.key === item.parent_key)).forEach((root) => visit(root, 0));
  permissions.forEach((item) => visit(item, 0));
  return rows;
}
export function missingDependencies(permission: PermissionDefinition, permissions: PermissionDefinition[], effective: string[]) {
  const parents: PermissionDefinition[] = [];
  const seen = new Set([permission.key]);
  let key = permission.parent_key;
  while (key && !seen.has(key)) {
    seen.add(key);
    const parent = permissions.find((item) => item.key === key);
    if (!parent) break;
    if (!effective.includes(parent.key)) parents.unshift(parent);
    key = parent.parent_key;
  }
  return parents;
}
