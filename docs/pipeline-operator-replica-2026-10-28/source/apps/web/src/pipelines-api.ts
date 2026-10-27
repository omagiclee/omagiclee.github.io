import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch, type InteractionContext } from "./telemetry";

export type JsonSchema = {
  type?: string | string[]; title?: string; description?: string; default?: unknown;
  $ref?: string; $defs?: Record<string, JsonSchema>; definitions?: Record<string, JsonSchema>;
  minimum?: number; maximum?: number; enum?: unknown[];
  properties?: Record<string, JsonSchema>; required?: string[];
  anyOf?: JsonSchema[]; oneOf?: JsonSchema[]; allOf?: JsonSchema[]; items?: JsonSchema;
};
export interface OperatorManifest {
  id: string; name: string; version: string; plugin_id: string; description: string;
  kind: string; input_type: string | null; output_type: string;
  input_ports?: Record<string, string>; retry_safe?: boolean | null; cacheable?: boolean | null;
  execution_protocol?: string; execution_scope?: string; batch_size?:number;
  config_schema: JsonSchema; default_config: Record<string, unknown>;
  deterministic: boolean; side_effects: boolean; implementation_digest: string;
}
export interface OperatorPlugin {
  id: string; name: string; version: string; description: string;
  registered: boolean; operators: OperatorManifest[];
}
export interface PipelineNode {
  id: string; operator: string; version: string;
  config: Record<string, unknown>; inputs: Record<string, string>;
  position?: { x: number; y: number };
}
export interface PipelineGraph { nodes: PipelineNode[] }
export interface Pipeline {
  id: string; name: string; description: string; version: number;
  graph: PipelineGraph; created_at: string; updated_at: string;
  versions?: { version: number; name: string; created_at: string }[];
  latest_version?: number;
  latest_run?: { id: string; status: string; cancellation_pending?: boolean } | null;
}
export interface PipelinePage<T> { items: T[]; total: number; offset: number; limit: number; has_more: boolean }
export interface PipelineInput { name: string; description: string; graph: PipelineGraph }
export interface GraphValidation { valid: boolean; errors: string[]; order: string[] }
export interface PipelineExecutionPlan {
  mode: "production" | "debug"; version: number; targets: string[]; node_ids: string[];
  graph: PipelineGraph; semantic_digest: string; plan_digest: string;
  sample: { limit: number | null; fixed: boolean; sources: { node_id: string; record_ids: string[]; record_count: number; content_hash: string }[] };
  warnings: string[]; blocked: { node_id: string; reason: string }[];
}
export interface PipelineRunOptions {
  mode?: "production" | "debug"; targets?: string[]; sample_limit?: number; plan_digest?: string; use_cache?: boolean;
  environment_id?: string; worker_pool_id?: string;
}
export interface ArtifactDatasetImport {
  dataset_id: string; created: boolean;
  source: { run_id: string; artifact_id: string; content_hash: string; mapping_version: string };
  quality_report: { passed?: boolean; issues?: { message?: string; code?: string }[]; [key: string]: unknown };
}
export interface PipelineTask {
  id: string; node_id: string; operator: string; status: string;
  input_count: number; output_count: number; duration_ms: number;
  error: string | null; artifact_id: string | null;
  progress?: { completed: number; total: number; unit: string; last_progress_at: string | null; source: string } | null;
}
export interface PipelineArtifact {
  id: string; run_id: string; node_id: string; type: string; record_count: number;
  content_hash: string; metadata: Record<string, unknown>;
  records: Record<string, unknown>[]; parent_artifact_ids: string[];
  cache_origin_id: string | null; created_at: string;
  has_more?: boolean;
  manifest?: { schema: string; sha256: string; record_count: number; shards: { uri: string; sha256: string; record_count: number; size?: number }[] } | null;
}
export interface PipelineRun {
  id: string; pipeline_id: string; pipeline_name: string; pipeline_version: number;
  status: string; created_at: string; finished_at: string | null; error: string | null;
  tasks: PipelineTask[]; artifacts: Omit<PipelineArtifact, "records">[];
  submission_status?: string | null;
  display_status?: string;
  waiting_reason?: string | null;
  can_retry_submission?: boolean;
  can_reconcile_submission?: boolean;
  cancellation_pending?: boolean;
  use_cache?: boolean | null;
  mode?: "production" | "debug";
  execution_plan?: PipelineExecutionPlan | null;
  operator_snapshot?: OperatorManifest[] | null;
}

async function request<T>(path: string, csrf?: string, body?: unknown, interaction?: InteractionContext): Promise<T> {
  const response = await instrumentedFetch(apiUrl(path), {
    credentials: "include",
    ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" }, body: JSON.stringify(body) } : {}),
  }, interaction);
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const data = await response.json() as { detail?: unknown };
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((item: { msg?: string; loc?: unknown[] }) => `${item.loc?.slice(1).join(".") ?? ""} ${item.msg ?? "参数无效"}`).join("；");
      else if (data.detail && typeof data.detail === "object") {
        const detail = data.detail as { message?: string; errors?: string[] };
        message = detail.errors?.join("；") ?? detail.message ?? message;
      }
    } catch { /* Preserve HTTP error when upstream returns a non-JSON response. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

const scoped = (path: string, projectId?: string) => projectId ? `${path}?project_id=${encodeURIComponent(projectId)}` : path;
async function requestPage<T>(path: string, offset: number, limit: number): Promise<PipelinePage<T>> {
  const response = await request<PipelinePage<T> | T[]>(path);
  // Permit a rolling upgrade from the legacy array response; new servers provide totals.
  return Array.isArray(response) ? { items: response, total: offset + response.length, offset, limit, has_more: false } : response;
}
export const pipelineDirectoryQueryFor = (projectId: string, filters: { page?: number; q?: string; status?: string } = {}) => {
  const page = Math.max(1, filters.page ?? 1), limit = 20, offset = (page - 1) * limit;
  const params = new URLSearchParams({ project_id: projectId, paginated: "true", offset: String(offset), limit: String(limit) });
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  return queryOptions({ queryKey: ["pipelines", projectId, "page", filters.q ?? "", filters.status ?? "", page], queryFn: () => requestPage<Pipeline>(`/api/pipelines?${params}`, offset, limit) });
};
export const pipelineRunHistoryQueryFor = (projectId: string, pipelineId: string, filters: { page?: number; version?: number; status?: string } = {}) => {
  const page = Math.max(1, filters.page ?? 1), limit = 20, offset = (page - 1) * limit;
  const params = new URLSearchParams({ project_id: projectId, pipeline_id: pipelineId, paginated: "true", offset: String(offset), limit: String(limit) });
  if (filters.version) params.set("pipeline_version", String(filters.version));
  if (filters.status) params.set("status", filters.status);
  return queryOptions({ queryKey: ["pipeline-runs", projectId, pipelineId, "page", filters.version ?? null, filters.status ?? "", page], queryFn: () => requestPage<PipelineRun>(`/api/pipeline-runs?${params}`, offset, limit) });
};
export const projectRunsQueryFor = (projectId: string, filters: { page?: number; status?: string; pipelineId?: string } = {}) => {
  const page = Math.max(1, filters.page ?? 1), limit = 20, offset = (page - 1) * limit;
  const params = new URLSearchParams({ paginated: "true", offset: String(offset), limit: String(limit) });
  if (filters.pipelineId) params.set("pipeline_id", filters.pipelineId);
  if (filters.status) params.set("status", filters.status);
  return queryOptions({ queryKey: ["project-runs", projectId, filters.pipelineId ?? "", filters.status ?? "", page], queryFn: () => requestPage<PipelineRun>(`/api/projects/${encodeURIComponent(projectId)}/runs?${params}`, offset, limit) });
};
export const loadProjectRun = (projectId: string, runId: string) => request<PipelineRun>(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`);
export const operatorsQueryFor = (projectId: string) => queryOptions({ queryKey: ["pipeline-operators", projectId], queryFn: () => request<OperatorManifest[]>(scoped("/api/operators", projectId)) });
export const operatorPluginsQueryFor = (projectId: string) => queryOptions({ queryKey: ["pipeline-plugins", projectId], queryFn: () => request<OperatorPlugin[]>(scoped("/api/operator-plugins", projectId)) });
export const pipelinesQueryFor = (projectId: string) => queryOptions({ queryKey: ["pipelines", projectId], queryFn: () => request<Pipeline[]>(scoped("/api/pipelines", projectId)) });
export const pipelineRunsQueryFor = (projectId: string, pipelineId?: string) => queryOptions({ queryKey: pipelineId ? ["pipeline-runs", projectId, pipelineId] : ["pipeline-runs", projectId], queryFn: () => request<PipelineRun[]>(`${scoped("/api/pipeline-runs", projectId)}${pipelineId ? `&pipeline_id=${encodeURIComponent(pipelineId)}` : ""}&limit=100`) });
export const pipelineQueryFor = (projectId: string, id: string) => queryOptions({ queryKey: ["pipeline", projectId, id], queryFn: () => request<Pipeline>(scoped(`/api/pipelines/${encodeURIComponent(id)}`, projectId)), enabled: Boolean(id) });
export const pipelineVersionQueryFor = (projectId: string, id: string, version?: number) => queryOptions({ queryKey: ["pipeline-version", projectId, id, version], queryFn: () => request<Pipeline>(scoped(`/api/pipelines/${encodeURIComponent(id)}/versions/${version}`, projectId)), enabled: Boolean(id && version), staleTime: Infinity });
export const operatorsQuery = operatorsQueryFor("demo");
export const operatorPluginsQuery = operatorPluginsQueryFor("demo");
export const pipelinesQuery = pipelinesQueryFor("demo");
export const pipelineRunsQuery = pipelineRunsQueryFor("demo");
export const artifactQuery = (id: string, projectId = "demo") => queryOptions({ queryKey: ["pipeline-artifact", projectId, id], queryFn: () => request<PipelineArtifact>(scoped(`/api/pipeline-artifacts/${encodeURIComponent(id)}`, projectId)), enabled: Boolean(id) });
export const validatePipeline = (graph: PipelineGraph, csrf: string, projectId?: string, interaction?: InteractionContext) => request<GraphValidation>(scoped("/api/pipelines/validate", projectId), csrf, { graph }, interaction);
export const savePipeline = (input: PipelineInput, csrf: string, existing?: { id: string; version: number }, projectId?: string, interaction?: InteractionContext) => existing
  ? request<Pipeline>(scoped(`/api/pipelines/${encodeURIComponent(existing.id)}/versions`, projectId), csrf, { ...input, expected_version: existing.version }, interaction)
  : request<Pipeline>(scoped("/api/pipelines", projectId), csrf, input, interaction);
export const planPipelineRun = (projectId: string, id: string, version: number, options: PipelineRunOptions, csrf: string) => request<PipelineExecutionPlan>(`/api/projects/${encodeURIComponent(projectId)}/pipelines/${encodeURIComponent(id)}/run-plan`, csrf, { version, ...options });
export const importArtifactDataset = (projectId: string, id: string, name: string, csrf: string) => request<ArtifactDatasetImport>(scoped(`/api/pipeline-artifacts/${encodeURIComponent(id)}/dataset`, projectId), csrf, { name });
export const runPipeline = (id: string, version: number, useCache: boolean, csrf: string, projectId?: string, idempotencyKey?: string, interaction?: InteractionContext, target?: PipelineRunOptions) => request<PipelineRun>(scoped(`/api/pipelines/${encodeURIComponent(id)}/runs`, projectId), csrf, { version, use_cache: useCache, ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}), ...target }, interaction);
export const registerOperatorPlugin = (pluginId: string, csrf: string, projectId?: string, interaction?: InteractionContext) => request<OperatorPlugin>(scoped("/api/operator-plugins/register", projectId), csrf, { plugin_id: pluginId }, interaction);
