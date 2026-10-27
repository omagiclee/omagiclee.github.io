import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch } from "./telemetry";
import type { AutoGtJob, AutoGtPair, ImageQuality } from "./auto-gt-api";
export type RejectionReason = "exposure" | "color_cast" | "halo" | "identity_drift" | "misalignment" | "artifacts" | "other";
export interface AutoGtRoi { role: "input" | "target"; normalized_xywh: [number, number, number, number]; sha256: string; width: number; height: number }
export interface AutoGtReviewRecord { id: string; pair_id: string; pair_revision: number; decision: "accepted" | "rejected"; reason_codes: RejectionReason[]; note: string; rois: AutoGtRoi[]; created_at: string }
export interface AutoGtReviewInput { decision: "accepted" | "rejected"; expected_revision: number; reason_codes: RejectionReason[]; note: string; rois: AutoGtRoi[] }
export interface ComparisonPair extends AutoGtPair { job_id: string }
export interface AutoGtComparison {
  id: string; name: string; status: string; revision: number; error?: string | null;
  snapshot: { jobs: (Pick<AutoGtJob, "id" | "name" | "recipe"> & { recipe_snapshot?: Record<string, unknown> })[]; pairs: ComparisonPair[]; source_pool?: unknown };
  compatibility: { psnr_common_ranking_allowed: boolean; reason: string };
  metrics: { pair_id: string; job_id: string; source_group: string; input: ImageQuality & Record<string, unknown>; target: ImageQuality & Record<string, unknown>; psnr_db: number | null; psnr_infinite?: boolean; psnr_status: string; roi_metrics: Record<string, unknown>[] }[] | null;
  preferences: { id?: string; source_group: string; a_pair_id: string; b_pair_id: string; choice: "a" | "b" | "tie" | "incomparable" | "unknown"; note: string; created_at?: string }[];
}
export interface AutoGtReflow { dataset_id: string; feedback_ids: string[]; selection_id: string | null; task_id: string | null; url: string; created: boolean; name: string; issue: string }
async function request<T>(projectId: string, path: string, csrf?: string, body?: unknown): Promise<T> {
  const response = await instrumentedFetch(apiUrl(`/api/auto-gt${path}${path.includes("?") ? "&" : "?"}project_id=${encodeURIComponent(projectId)}`), { credentials: "include", ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) { let message = `请求失败（${response.status}）`; try { const data = await response.json() as { detail?: unknown }; if (typeof data.detail === "string") message = data.detail; else if (data.detail && typeof data.detail === "object" && "message" in data.detail) message = String(data.detail.message); else if (Array.isArray(data.detail)) message = data.detail.map((item: { msg?: string }) => item.msg ?? "参数无效").join("；"); } catch { /* Keep status for upstream transport errors. */ } throw new ApiError(message, response.status); }
  return response.json() as Promise<T>;
}
export const saveAutoGtReview = (projectId: string, pairId: string, input: AutoGtReviewInput, csrf: string) => request<AutoGtPair>(projectId, `/pairs/${encodeURIComponent(pairId)}/review`, csrf, input);
export const loadAutoGtReviews = (projectId: string, pairId: string) => request<{ items: AutoGtReviewRecord[] }>(projectId, `/pairs/${encodeURIComponent(pairId)}/reviews`);
export const loadAutoGtComparisons = (projectId: string) => request<{ items: AutoGtComparison[] }>(projectId, "/comparisons");
export const loadAutoGtComparison = (projectId: string, id: string) => request<AutoGtComparison>(projectId, `/comparisons/${encodeURIComponent(id)}`);
export const createAutoGtComparison = (projectId: string, input: { name: string; job_ids: string[]; idempotency_key: string; rois?: { source_group: string; normalized_xywh: [number, number, number, number] }[] }, csrf: string) => request<AutoGtComparison>(projectId, "/comparisons", csrf, input);
export const preferAutoGtComparison = (projectId: string, id: string, input: { source_group: string; a_pair_id: string; b_pair_id: string; choice: "a" | "b" | "tie" | "incomparable" | "unknown"; note: string; expected_revision: number }, csrf: string) => request<AutoGtComparison>(projectId, `/comparisons/${encodeURIComponent(id)}/preferences`, csrf, input);
export const createAutoGtReflow = (projectId: string, input: { pair_ids: string[]; rejection_review_ids: Record<string, string>; name: string; issue: string; action: "selection" | "annotation"; spec_id?: string; assignee_id?: string; reviewer_id?: string; idempotency_key: string }, csrf: string) => request<AutoGtReflow>(projectId, "/reflows", csrf, input);
export const loadAutoGtReflows = (projectId: string, jobId: string) => request<{ items: AutoGtReflow[] }>(projectId, `/reflows?job_id=${encodeURIComponent(jobId)}`);
export interface AutoGtRevisionLineage { revision_id: string; parent_job_id: string; task_id: string; dataset_id: string; parent_pair_ids: string[]; annotation_ids: string[]; review_ids: string[]; approval_digest: string; reason: string; params_before: Record<string, number>; params_after: Record<string, number>; source_pool?: unknown[] }
export interface AutoGtRevisionTask { task_id: string; name: string; dataset_id: string; eligible: boolean; blocked_reason?: string | null; approval_digest?: string | null; task_revision: number; dataset_revision: number; samples: { sample_id: string; pair_id: string; sample_revision: number; annotation_id: string | null; review_id: string | null; decision: string | null }[]; recipe?: string; params?: Record<string, number>; source_pool?: unknown[] }
export interface AutoGtRevisionContext { parent_job_id: string; eligible_tasks: AutoGtRevisionTask[]; recipe: string; params: Record<string, number>; editable_params: Record<string, { min: number; max: number; value: number | null }>; blocked_reason?: string | null }
export const loadAutoGtRevisionContext = (projectId: string, parentJobId: string) => request<AutoGtRevisionContext>(projectId, `/jobs/${encodeURIComponent(parentJobId)}/revision-context`);
export const createAutoGtRevision = (projectId: string, input: { parent_job_id: string; task_id: string; approval_digest: string; name: string; reason: string; params: Record<string, number>; idempotency_key: string }, csrf: string) => request<AutoGtJob>(projectId, "/revisions", csrf, input);
export const loadAutoGtRevisions = (projectId: string, parentJobId: string) => request<{ items: { id: string; lineage: AutoGtRevisionLineage; job: AutoGtJob }[] }>(projectId, `/revisions?parent_job_id=${encodeURIComponent(parentJobId)}`);
export interface AutoGtPublishedExportPlan { eligible: boolean; version_id: string; dataset_id: string; sample_count: number; split_counts: Record<"train" | "validation" | "test", number>; group_counts: Record<"train" | "validation" | "test", number>; asset_count: number; manifest_sha256: string; estimated_bytes: number }
export const loadAutoGtPublishedExportPlan = (projectId: string, datasetId: string, versionId: string) => request<AutoGtPublishedExportPlan>(projectId, `/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/export-plan`);
export async function downloadAutoGtPublishedArchive(projectId: string, datasetId: string, versionId: string, filename: string) {
  const response = await instrumentedFetch(apiUrl(`/api/auto-gt/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/archive?project_id=${encodeURIComponent(projectId)}`), { credentials: "include" });
  if (!response.ok) { let message = `版本导出失败（${response.status}）`; try { const body = await response.json() as { detail?: unknown }; if (typeof body.detail === "string") message = body.detail; else if (body.detail && typeof body.detail === "object" && "message" in body.detail) message = String(body.detail.message); } catch { /* Keep transport status. */ } throw new ApiError(message, response.status); }
  const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${filename.replace(/[\\/:*?"<>|]/g, "_")}.zip`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
