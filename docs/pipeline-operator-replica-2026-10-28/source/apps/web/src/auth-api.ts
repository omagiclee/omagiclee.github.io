import { queryOptions } from "@tanstack/react-query";
import { behavior, instrumentedFetch, type InteractionContext } from "./telemetry";

export interface UserView {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
}

export interface ScopeView {
  type: "global" | "project" | "resource";
  id: string;
}

export interface ImpersonationView {
  active: boolean;
  started_at: string | null;
  expires_at: string | null;
  reason: string | null;
}

export interface MeResponse {
  actor: UserView;
  user: UserView;
  scope: ScopeView;
  roles: string[];
  groups: string[];
  permissions: string[];
  can_impersonate: boolean;
  csrf_token: string;
  auth_mode: "dev" | "oidc";
  impersonation: ImpersonationView;
}

export interface ImpersonationTarget extends UserView {
  roles: string[];
  groups: string[];
}

export interface StartImpersonationInput {
  target_user_id: string;
  reason: string;
  duration_minutes: number;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiUrl(path: string) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  return `${baseUrl}${path}`;
}

async function readError(response: Response) {
  try {
    const body = await response.json() as { detail?: string };
    return body.detail ?? `请求失败：HTTP ${response.status}`;
  } catch {
    return `请求失败：HTTP ${response.status}`;
  }
}

async function requestJson<T>(path: string, init?: RequestInit, interaction?: InteractionContext): Promise<T> {
  const response = await instrumentedFetch(apiUrl(path), { ...init, credentials: "include" }, interaction);
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return response.json() as Promise<T>;
}

export async function loadMe(projectId?: string): Promise<MeResponse | null> {
  try {
    return await requestJson<MeResponse>(`/api/me${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function loadImpersonationTargets() {
  return requestJson<ImpersonationTarget[]>("/api/admin/impersonation/targets");
}

export function startImpersonation(input: StartImpersonationInput, csrfToken: string, interaction?: InteractionContext) {
  return behavior.changeIdentity(() => requestJson<MeResponse>("/api/admin/impersonation/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(input),
  }, interaction));
}

export function stopImpersonation(csrfToken: string, interaction?: InteractionContext) {
  return behavior.changeIdentity(() => requestJson<MeResponse>("/api/admin/impersonation/stop", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
  }, interaction));
}

export async function logout(csrfToken: string, interaction?: InteractionContext) {
  return behavior.changeIdentity(() => requestJson<{ redirect_url: string }>("/auth/logout", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
  }, interaction));
}

export const meQueryOptions = queryOptions({
  queryKey: ["authenticated-user"],
  queryFn: () => loadMe(),
  staleTime: 30_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
});

export const projectMeQueryOptions = (projectId: string) => queryOptions({
  queryKey: ["authenticated-user", "project", projectId],
  queryFn: () => loadMe(projectId),
  staleTime: 30_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
});

export interface AccessibleProject { id: string; name: string; permissions: string[] }
export const accessibleProjectsQueryOptions = queryOptions({
  queryKey: ["accessible-projects"],
  queryFn: () => requestJson<{ projects: AccessibleProject[]; default_project_id: string | null }>("/api/projects"),
  staleTime: 30_000,
});
