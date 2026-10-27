import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";
import type { OperatorManifest } from "./pipelines-api";
import { instrumentedFetch, type InteractionContext } from "./telemetry";

export const MAX_PLUGIN_WHEEL_BYTES = 8 * 1024 * 1024;
export interface PluginReleaseManifest {
  id: string; name: string; description: string; version: string; sdk_version: string;
  operators: Omit<OperatorManifest, "plugin_id" | "implementation_digest">[];
}
export interface PluginTestCase {
  name: string; operator_id: string; config: Record<string, unknown>;
  input: unknown; expected?: unknown; expected_error?: { type: string; match?: string };
}
export interface PluginRelease {
  id: string; project_id: string; plugin_id: string; version: string;
  wheel_filename: string; wheel_sha256: string; manifest: PluginReleaseManifest;
  test_cases: PluginTestCase[];
  status: "candidate" | "validating" | "validated" | "validation_failed" | "published";
  validation_id: string | null; validation_status: string | null;
  runtime_digest: string | null; sdk_bundle_digest?: string | null; deployment_state: string; active: boolean;
  created_at: string; published_at: string | null;
}
export interface PluginValidation {
  id: string; release_id: string; status: "queued" | "running" | "passed" | "failed" | "blocked";
  report: Record<string, unknown> | null; error: string | null;
  wheel_sha256?: string | null; runtime_digest?: string | null; sdk_bundle_digest?: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
}
export interface PluginReleaseUpload {
  wheel_filename: string; wheel_base64: string;
  manifest: PluginReleaseManifest; test_cases: PluginTestCase[];
}
export interface PluginReleasePage {
  items: PluginRelease[]; total: number; offset: number; limit: number; has_more: boolean;
}
export interface PluginReleaseListOptions {
  q?: string; offset?: number; limit?: number; status?: PluginRelease["status"]; pluginId?: string;
}
const scoped = (path: string, projectId: string) => `${path}?project_id=${encodeURIComponent(projectId)}`;
const base = "/api/plugin-releases";
async function request<T>(path: string, options: { body?: unknown; csrf?: string; interaction?: InteractionContext } = {}): Promise<T> {
  const response = await instrumentedFetch(apiUrl(path), {
    credentials: "include",
    ...(options.body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": options.csrf ?? "" }, body: JSON.stringify(options.body) }),
  }, options.interaction);
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const { detail } = await response.json() as { detail?: unknown };
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail)) message = detail.map((item: { msg?: string; loc?: unknown[] }) => `${item.loc?.slice(1).join(".") ?? ""} ${item.msg ?? "参数无效"}`).join("；");
      else if (detail && typeof detail === "object") message = JSON.stringify(detail);
    } catch { /* Preserve a useful HTTP error for non-JSON responses. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
export const pluginReleasesKey = (projectId: string) => ["plugin-releases", projectId] as const;
export const pluginReleasesQuery = (projectId: string, options: PluginReleaseListOptions = {}) => {
  const page = { q: options.q?.trim() ?? "", offset: options.offset ?? 0, limit: options.limit ?? 20, status: options.status, pluginId: options.pluginId };
  const search = new URLSearchParams({ project_id: projectId, paginated: "true", q: page.q, offset: String(page.offset), limit: String(page.limit) });
  if (page.status) search.set("status", page.status);
  if (page.pluginId) search.set("plugin_id", page.pluginId);
  return queryOptions({ queryKey: [...pluginReleasesKey(projectId), page], queryFn: () => request<PluginReleasePage>(`${base}?${search}`) });
};
export const pluginReleaseQuery = (projectId: string, id: string) => queryOptions({ queryKey: ["plugin-release", projectId, id], queryFn: () => request<PluginRelease>(scoped(`${base}/${encodeURIComponent(id)}`, projectId)), enabled: Boolean(id) });
export const pluginValidationsQuery = (projectId: string, id: string) => queryOptions({ queryKey: ["plugin-validations", projectId, id], queryFn: () => request<PluginValidation[]>(scoped(`${base}/${encodeURIComponent(id)}/validations`, projectId)), enabled: Boolean(id) });
export const createPluginRelease = (projectId: string, input: PluginReleaseUpload, csrf: string, interaction?: InteractionContext) => request<PluginRelease>(scoped(base, projectId), { body: input, csrf, interaction });
export const validatePluginRelease = (projectId: string, id: string, csrf: string, interaction?: InteractionContext) => request<PluginValidation>(scoped(`${base}/${encodeURIComponent(id)}/validations`, projectId), { body: {}, csrf, interaction });
export const publishPluginRelease = (projectId: string, id: string, csrf: string, interaction?: InteractionContext) => request<PluginRelease>(scoped(`${base}/${encodeURIComponent(id)}/publish`, projectId), { body: {}, csrf, interaction });
export const activatePluginRelease = (projectId: string, id: string, csrf: string, interaction?: InteractionContext) => request<PluginRelease>(scoped(`${base}/${encodeURIComponent(id)}/activate`, projectId), { body: {}, csrf, interaction });
export async function downloadPluginTemplate(projectId: string, interaction?: InteractionContext) {
  const response = await instrumentedFetch(apiUrl(scoped(`${base}/template`, projectId)), { credentials: "include" }, interaction);
  if (!response.ok) throw new ApiError(`开发模板下载失败（${response.status}）`, response.status);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = "data-flywheel-plugin-template.zip"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
