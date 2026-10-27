import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch, type InteractionContext } from "./telemetry";

export type ConnectionType = "object_storage" | "database" | "vector_database" | "model_service";

export interface ProjectConnection {
  id: string;
  project_id: string;
  name: string;
  connection_type: ConnectionType;
  endpoint: string;
  credential_configured: boolean;
  allowed_environment_ids: string[];
  status: string;
  last_check: { kind: string; passed: boolean; errors: string[]; checked_at: string; side_effects: boolean } | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectionInput {
  name: string;
  connection_type: ConnectionType;
  endpoint: string;
  credential_ref?: string;
  allowed_environment_ids: string[];
}

export interface RuntimeRelease {
  id: string;
  digest: string;
  name: string;
  image: string;
  sdk_abi: string;
  cpu_arch: "amd64" | "arm64";
  gpu_required: boolean;
  capabilities: string[];
  status: "registered" | "disabled";
  health_message: string | null;
  created_at: string;
}

export interface RuntimeInput {
  digest: string;
  name: string;
  image: string;
  sdk_abi: string;
  cpu_arch: "amd64" | "arm64";
  gpu_required: boolean;
  capabilities: string[];
  status: "registered" | "disabled";
}

export interface WorkerPool {
  id: string;
  name: string;
  resource_kind: "cpu" | "gpu";
  max_concurrency: number;
  status: string;
  last_heartbeat_at: string | null;
  runtime: RuntimeRelease;
}

export interface ExecutionEnvironment {
  id: string;
  name: string;
  revision: number;
  stage: "development" | "test" | "production";
  network_policy: "restricted" | "internal" | "approved_egress";
  status: string;
  health_message: string | null;
  worker_pools: WorkerPool[];
  created_at: string;
  updated_at: string;
  grant?: { id: string; max_concurrency: number; priority: number; enabled: boolean };
}

export interface EnvironmentInput {
  name: string;
  stage: ExecutionEnvironment["stage"];
  network_policy: ExecutionEnvironment["network_policy"];
}

async function request<T>(path: string, csrf?: string, body?: unknown, interaction?: InteractionContext): Promise<T> {
  const response = await instrumentedFetch(apiUrl(path), {
    credentials: "include",
    ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" }, body: JSON.stringify(body) } : {}),
  }, interaction);
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const data = await response.json() as { detail?: string | { msg?: string }[] };
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((item) => item.msg ?? "参数无效").join("；");
    } catch { /* Keep the HTTP failure. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export const connectionsQueryFor = (projectId: string) => queryOptions({
  queryKey: ["project-connections", projectId],
  queryFn: () => request<ProjectConnection[]>(`/api/projects/${encodeURIComponent(projectId)}/connections`),
});

export const createConnection = (projectId: string, input: ConnectionInput, csrf: string, interaction?: InteractionContext) =>
  request<ProjectConnection>(`/api/projects/${encodeURIComponent(projectId)}/connections`, csrf, input, interaction);

export const checkConnection = (projectId: string, connectionId: string, csrf: string, interaction?: InteractionContext) =>
  request<{ connection_id: string; check_type: string; passed: boolean; errors: string[]; side_effects: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/checks`,
    csrf,
    {},
    interaction,
  );

export const runtimeReleasesQuery = queryOptions({
  queryKey: ["runtime-releases"],
  queryFn: () => request<RuntimeRelease[]>("/api/admin/runtime-releases"),
});

export const createRuntimeRelease = (input: RuntimeInput, csrf: string, interaction?: InteractionContext) =>
  request<RuntimeRelease>("/api/admin/runtime-releases", csrf, input, interaction);

export const environmentsQuery = queryOptions({
  queryKey: ["execution-environments"],
  queryFn: () => request<ExecutionEnvironment[]>("/api/admin/environments"),
});

export const projectEnvironmentsQueryFor = (projectId: string) => queryOptions({
  queryKey: ["project-environments", projectId],
  queryFn: () => request<ExecutionEnvironment[]>(`/api/projects/${encodeURIComponent(projectId)}/environments`),
});

export const createEnvironment = (input: EnvironmentInput, csrf: string, interaction?: InteractionContext) =>
  request<ExecutionEnvironment>("/api/admin/environments", csrf, input, interaction);

export const createWorkerPool = (environmentId: string, input: { name: string; runtime_release_id: string; resource_kind: "cpu" | "gpu"; max_concurrency: number }, csrf: string, interaction?: InteractionContext) =>
  request<WorkerPool>(`/api/admin/environments/${encodeURIComponent(environmentId)}/worker-pools`, csrf, input, interaction);

export const grantEnvironment = (projectId: string, input: { environment_id: string; max_concurrency: number; priority: number; enabled: boolean }, csrf: string, interaction?: InteractionContext) =>
  request<ExecutionEnvironment>(`/api/projects/${encodeURIComponent(projectId)}/environments/grants`, csrf, input, interaction);
