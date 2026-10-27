import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch } from "./telemetry";

export interface PipelineDeployment {
  id: string; name: string; revision: number; pipeline_id: string; pipeline_version: number;
  trigger_kind: "manual" | "interval" | "data"; interval_seconds: number | null;
  timezone: string; next_trigger_at: string | null; paused: boolean; use_cache: boolean;
  last_error: string | null; webhook_enabled: boolean;
  execution_snapshot: { profile: string; resource_kind?: string; worker_pool_id?: string };
}
export interface DeploymentInput {
  name: string; pipeline_id: string; pipeline_version: number; trigger_kind: PipelineDeployment["trigger_kind"];
  timezone: string; interval_seconds?: number; first_trigger_at?: string;
  environment_id?: string; worker_pool_id?: string; input_configs?: Record<string, Record<string, unknown>>;
}
async function request<T>(path: string, projectId: string, csrf?: string, body?: unknown): Promise<T> {
  const response = await instrumentedFetch(apiUrl(`/api/pipeline-deployments${path}${path.includes("?") ? "&" : "?"}project_id=${encodeURIComponent(projectId)}`), {
    credentials: "include", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try { const result = await response.json() as { detail?: unknown }; if (typeof result.detail === "string") message = result.detail; else if (Array.isArray(result.detail)) message = result.detail.map((item: { msg: string }) => item.msg).join("；"); } catch { /* Keep HTTP failure. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
export const deploymentsQueryFor = (projectId: string, pipelineId: string) => queryOptions({
  queryKey: ["pipeline-deployments", projectId, pipelineId],
  queryFn: () => request<PipelineDeployment[]>(`?pipeline_id=${encodeURIComponent(pipelineId)}`, projectId),
});
export const createDeployment = (projectId: string, csrf: string, input: DeploymentInput) => request<PipelineDeployment>("", projectId, csrf, input);
export const pauseDeployment = (projectId: string, csrf: string, id: string, paused: boolean) => request<PipelineDeployment>(`/${id}/state`, projectId, csrf, { paused });
export const triggerDeployment = (projectId: string, csrf: string, id: string, eventKey: string) => request<{ run_id: string }>(`/${id}/trigger`, projectId, csrf, { event_key: eventKey });
