import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch } from "./telemetry";

export type AutoGtReview = "pending" | "accepted" | "rejected";
export type ReferenceKind = "degraded_from_reference" | "approximate_2d" | "rendered_physical" | "generated_pseudo" | "editor_reference";
export interface ImageQuality { width?: number; height?: number; pixels?: number; format?: string; mean_luminance?: number; clipped_dark_fraction?: number; clipped_bright_fraction?: number; warnings?: string[]; checks?: Record<string, boolean | number | string> }
export type SourceOriginKind = "unknown" | "captured_photo" | "generated_pseudo" | "rendered_physical" | "editor_reference";
export interface AutoGtSource { id: string; title: string; uri: string; object_uri: string; sha256: string; width: number; height: number; format: string; role: "image" | "mask"; review_status: AutoGtReview; revision: number; content_url: string; quality: ImageQuality; provenance?: { origin_kind: SourceOriginKind; source_note: string; claim: string } }
export interface AutoGtRecipe { id: string; name: string; available: boolean; reference_kind: ReferenceKind | "declared"; blocked_reason?: string | null }
export interface AutoGtPair { current_review?: import("./auto-gt-workbench-api").AutoGtReviewRecord | null; review_history_status?: "recorded" | "legacy_without_reason" | "unreviewed"; id: string; input_url: string; target_url: string; input_sha256: string; target_sha256: string; reference_kind: ReferenceKind; source_group: string; quality: { input?: ImageQuality; target?: ImageQuality; same_dimensions?: boolean; warnings?: string[] }; provenance: Record<string, unknown>; review_status: AutoGtReview; revision: number }
export interface AutoGtJob { revision_lineage?: import("./auto-gt-workbench-api").AutoGtRevisionLineage; id: string; name: string; recipe: string; status: "queued" | "running" | "succeeded" | "failed" | "blocked"; error?: string | null; blocked_reason?: string | null; revision: number; pair_count: number; pairs: AutoGtPair[]; recipe_snapshot: Record<string, unknown>; seed: number; progress?: { completed: number; total: number }; created_at?: string }
export interface ImportedAutoGtPair { input_uri: string; target_uri: string; input_sha256: string; target_sha256: string; reference_kind: ReferenceKind; recipe: string; model?: string; seed?: number; source_group: string; provenance?: Record<string, unknown> }
export interface AutoGtJobInput { name: string; recipe: string; source_ids: string[]; mask_ids?: Record<string, string>; seed: number; variants: number; params?: Record<string, unknown>; idempotency_key: string; imported_pairs?: ImportedAutoGtPair[] }

function scoped(projectId: string, path: string) { return `/api/auto-gt${path}${path.includes("?") ? "&" : "?"}project_id=${encodeURIComponent(projectId)}`; }
async function failure(response: Response): Promise<never> {
  let message = `请求失败（${response.status}）`;
  try { const body = await response.json() as { detail?: unknown }; if (typeof body.detail === "string") message = body.detail; else if (Array.isArray(body.detail)) message = body.detail.map((item: { msg?: string }) => item.msg ?? "参数无效").join("；"); } catch { /* Retain upstream status. */ }
  throw new ApiError(message, response.status);
}
async function request<T>(projectId: string, path: string, csrf?: string, body?: unknown): Promise<T> {
  const response = await instrumentedFetch(apiUrl(scoped(projectId, path)), { credentials: "include", ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) return failure(response);
  return response.json() as Promise<T>;
}
export const loadAutoGtRecipes = (projectId: string) => request<{ items: AutoGtRecipe[] }>(projectId, "/recipes");
export const loadAutoGtSources = (projectId: string) => request<{ items: AutoGtSource[] }>(projectId, "/sources");
export const loadAutoGtJobs = (projectId: string) => request<{ items: AutoGtJob[] }>(projectId, "/jobs");
export const loadAutoGtJob = (projectId: string, id: string) => request<AutoGtJob>(projectId, `/jobs/${encodeURIComponent(id)}`);
export const createAutoGtJob = (projectId: string, body: AutoGtJobInput, csrf: string) => request<AutoGtJob>(projectId, "/jobs", csrf, body);
export const reviewAutoGtSource = (projectId: string, source: AutoGtSource, decision: "accepted" | "rejected", csrf: string) => request<AutoGtSource>(projectId, `/sources/${encodeURIComponent(source.id)}/review`, csrf, { decision, expected_revision: source.revision });
export const reviewAutoGtPair = (projectId: string, pair: AutoGtPair, decision: "accepted" | "rejected", csrf: string) => request<AutoGtPair>(projectId, `/pairs/${encodeURIComponent(pair.id)}/review`, csrf, { decision, expected_revision: pair.revision });
export const retryAutoGtJob = (projectId: string, job: AutoGtJob, csrf: string) => request<AutoGtJob>(projectId, `/jobs/${encodeURIComponent(job.id)}/retry`, csrf, { expected_revision: job.revision });
export const publishAutoGtDataset = (projectId: string, job: AutoGtJob, name: string, pairIds: string[], key: string, csrf: string) => request<{ dataset_id: string; link: string }>(projectId, `/jobs/${encodeURIComponent(job.id)}/dataset`, csrf, { name, pair_ids: pairIds, idempotency_key: key });
export async function uploadAutoGtSource(projectId: string, file: File, role: "image" | "mask", csrf: string, originKind: SourceOriginKind = "unknown", sourceNote = "") {
  if (!file.size) throw new Error("图像文件为空，请重新选择。");
  if (file.size > 20 * 1024 * 1024) throw new Error("图像文件不能超过 20 MiB。");
  if (file.type && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图像。");
  const response = await instrumentedFetch(apiUrl(scoped(projectId, `/sources?filename=${encodeURIComponent(file.name)}&role=${role}&origin_kind=${originKind}&source_note=${encodeURIComponent(sourceNote)}`)), { method: "POST", credentials: "include", headers: { "Content-Type": "application/octet-stream", "X-CSRF-Token": csrf }, body: file });
  if (!response.ok) return failure(response);
  return response.json() as Promise<AutoGtSource>;
}
export function autoGtImageUrl(path: string): string | undefined { return path.startsWith("/api/auto-gt/") && /\/(?:sources|pairs)\/[^/?]+\/content(?:\?|$)/.test(path) ? apiUrl(path) : undefined; }
export async function downloadAutoGtArchive(projectId: string, job: AutoGtJob) {
  const response = await instrumentedFetch(apiUrl(scoped(projectId, `/jobs/${encodeURIComponent(job.id)}/archive?approved_only=true`)), { credentials: "include" });
  if (!response.ok) return failure(response);
  const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${job.name.replace(/[\\/:*?"<>|]/g, "_")}.zip`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
