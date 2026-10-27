import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch, type InteractionContext } from "./telemetry";

export interface RoleBindingView {
  id: string;
  role_key: string;
  role_name: string;
  scope_type: "global" | "project";
  scope_id: string;
  inherited: boolean;
  source_name: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  is_active: boolean;
  is_impersonatable: boolean;
  created_at: string;
  groups: string[];
  effective_roles: string[];
  effective_permissions: string[];
  bindings: RoleBindingView[];
}

export interface RoleOption {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

export interface ProjectOption {
  id: string;
  name: string;
}

export interface UserDirectory {
  users: AdminUser[];
  roles: RoleOption[];
  projects: ProjectOption[];
}

export interface RoleBindingInput {
  role_key: string;
  scope_type: "global" | "project";
  scope_id: string;
}

async function adminRequest<T>(path: string, init?: RequestInit, interaction?: InteractionContext): Promise<T> {
  const response = await instrumentedFetch(apiUrl(path), { ...init, credentials: "include" }, interaction);
  if (!response.ok) {
    let message = `请求失败：HTTP ${response.status}`;
    try {
      const body = await response.json() as { detail?: string };
      message = body.detail ?? message;
    } catch {
      // Keep the status-based fallback when the response is not JSON.
    }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export function loadUserDirectory() {
  return adminRequest<UserDirectory>("/api/admin/users");
}

export function updateUserRoleBindings(userId: string, bindings: RoleBindingInput[], csrfToken: string, interaction?: InteractionContext) {
  return adminRequest<AdminUser>(`/api/admin/users/${userId}/role-bindings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ bindings }),
  }, interaction);
}

export const userDirectoryQueryOptions = queryOptions({
  queryKey: ["admin", "users"],
  queryFn: loadUserDirectory,
  staleTime: 15_000,
});
