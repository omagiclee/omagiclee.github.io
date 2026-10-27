import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch, type InteractionContext } from "./telemetry";
import type { Pipeline, PipelineRun } from "./pipelines-api";

export type PersonStatus = "detected" | "not_detected" | "unknown";
export type SearchMode = "filter" | "text" | "image" | "composed";
export type EmbeddingSpace = "hybrid" | "image" | "video";
export type RetrievalProfile = "auto" | "baseline" | "multimodal";
export type Relevance = "positive" | "negative" | "clear";
export type ScoreType = "catalog" | "rrf" | "cosine" | "reranker" | "semantic_penalty";

export interface MediaStatus {
  models: { id: string; name: string; available: boolean; issues?: string[]; detail?: string }[];
  issues: string[];
  counts: { videos: number; shots: number; keyframes: number; indexed_shots: number; indexed_videos?: number };
  latest_published_at?: string | null;
  executor: { kind: string; concurrency: number; active_run_id: string | null; available?: boolean; issue?: string };
  retrieval?: { multimodal: { available: boolean; embedding_ready: boolean; reranker_ready: boolean; issues: string[]; model_names?: Record<string, string>; index_ready?: boolean; total_ready_shots?: number; indexed_shots?: number; index_progress?: { completed?: number; total?: number; status?: string } }; baseline: { available: boolean } };
}
export interface MediaVideo {
  id: string; title: string; source_url: string; duration_ms: number;
  shot_count: number; created_at: string;
}
export interface MediaShot {
  id: string; video_id: string; video_title: string; title?: string;
  start_ms: number; end_ms: number; duration_ms: number;
  person_status: PersonStatus; index_state: string;
  keyframe_url: string | null; video_url: string | null; mask_url: string | null;
  score: number | null; matched_frame_id: string | null; frame_count: number;
  matched_timestamp_ms?: number | null; segmentation_model?: string | null;
  index_run_id?: string | null; index_pipeline_id?: string | null; index_pipeline_version?: number | null;
  tags?: string[];
  retrieval_route?: string;
  evidence?: { unit: string; coverage: string; frame_ids?: string[]; reference_kind?: string; retrieval_score?: number; reranker_score?: number; exclude_score?: number; sample_timestamps_ms?: number[]; routes?: Record<string, { cosine: number; rank: number }>; fusion_score?: number };
}
export interface MediaSearchInput {
  mode: SearchMode; query?: string; image_base64?: string;
  person_status?: PersonStatus; video_id?: string; limit: number;
  embedding_space?: EmbeddingSpace;
  duration_min_ms?: number; duration_max_ms?: number;
  tags_all?: string[]; tags_any?: string[]; tags_none?: string[];
  exclude_query?: string; reference_shot_id?: string; reference_frame_id?: string;
  retrieval_profile?: RetrievalProfile; rerank?: boolean;
}
export interface MediaSearchResult {
  items: MediaShot[]; total: number; mode: SearchMode; score_type?: ScoreType; search_id?: string; eligible_shots?: number;
  retrieval?: { profile: string; route: string; models?: { embedding?: string | null; reranker?: string | null }; reranked: boolean; candidate_count: number; coverage?: string; limitations: string[]; index_revision?: string; recall_routes?: string[]; fusion?: string | null };
}
export interface MediaFacets { tags: { tag: string; count: number }[]; person_status: { value: PersonStatus; count: number }[]; videos: { id: string; title: string; count: number }[]; tag_semantics: string }
export interface SavedMediaSearch { id: string; name: string; search_id: string; created_at: string; result_count: number; query: MediaSearchInput }
export interface MediaSample { size: number; group_by: "video" | "person"; per_group?: number; deduplicate: boolean }
export interface MediaSamplingReport extends Partial<MediaSample> { selected_count?: number; candidate_count?: number; shortfall?: number; group_counts?: Record<string, number>; excluded_duplicates?: unknown[]; vector_unavailable_shot_ids?: string[]; deduplication?: { note?: string } }
export interface MediaCollection { id: string; name: string; search_id: string; created_at: string; item_count: number; manifest_sha256: string; sampling?: MediaSamplingReport | null }
export interface MediaCollectionDetail extends MediaCollection { manifest: { items: MediaShot[]; [key: string]: unknown } }
export interface DemoPipeline extends Pipeline { pipeline_id: string; urls?: string[] }

function scoped(path: string, projectId: string) {
  return `${path}${path.includes("?") ? "&" : "?"}project_id=${encodeURIComponent(projectId)}`;
}

async function request<T>(path: string, options: { csrf?: string; body?: unknown; signal?: AbortSignal; interaction?: InteractionContext } = {}): Promise<T> {
  const response = await instrumentedFetch(apiUrl(path), {
    credentials: "include", signal: options.signal,
    ...(options.body !== undefined ? {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": options.csrf ?? "" },
      body: JSON.stringify(options.body),
    } : {}),
  }, options.interaction);
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const data = await response.json() as { detail?: unknown };
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((item: { msg?: string; loc?: unknown[] }) => `${item.loc?.slice(1).join(".") ?? ""} ${item.msg ?? "参数无效"}`).join("；");
      else if (data.detail && typeof data.detail === "object") {
        const detail = data.detail as { message?: string; errors?: string[]; issues?: string[] };
        message = detail.errors?.join("；") ?? detail.issues?.join("；") ?? detail.message ?? message;
      }
    } catch { /* Keep the HTTP status when an upstream service returns plain text. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export const loadMediaStatus = (projectId: string) => request<MediaStatus>(scoped("/api/media/status", projectId));
export const loadMediaVideos = (projectId: string) => request<MediaVideo[]>(scoped("/api/media/videos", projectId));
export const searchMedia = (projectId: string, input: MediaSearchInput, csrf: string, signal?: AbortSignal, interaction?: InteractionContext) => request<MediaSearchResult>(scoped("/api/media/search", projectId), { csrf, body: input, signal, interaction });
export const createDemoPipeline = (projectId: string, csrf: string, urls?: string[], interaction?: InteractionContext) => request<DemoPipeline>(scoped("/api/media/demo-pipeline", projectId), { csrf, body: urls ? { urls } : {}, interaction });
export const runMediaPipeline = (projectId: string, pipelineId: string, version: number, csrf: string, interaction?: InteractionContext) => request<PipelineRun>(scoped(`/api/media/pipelines/${encodeURIComponent(pipelineId)}/runs`, projectId), { csrf, body: { version, use_cache: true }, interaction });
export const loadMediaRun = (projectId: string, runId: string) => request<PipelineRun>(scoped(`/api/pipeline-runs/${encodeURIComponent(runId)}`, projectId));
export const importMediaVideo = (projectId: string, input: { object_uri: string; title: string; idempotency_key: string }, csrf: string) => request<PipelineRun>(scoped("/api/media/imports", projectId), { csrf, body: input });
export const cancelMediaRun = (projectId: string, runId: string, csrf: string, interaction?: InteractionContext) => request<PipelineRun>(scoped(`/api/media/runs/${encodeURIComponent(runId)}/cancel`, projectId), { csrf, body: {}, interaction });
export const retryMediaSubmission = (projectId: string, runId: string, csrf: string, interaction?: InteractionContext) => request<PipelineRun>(scoped(`/api/media/runs/${encodeURIComponent(runId)}/retry-submission`, projectId), { csrf, body: { use_cache: true }, interaction });
export const reconcileMediaSubmission = (projectId: string, runId: string, csrf: string, interaction?: InteractionContext) => request<PipelineRun>(scoped(`/api/media/runs/${encodeURIComponent(runId)}/reconcile`, projectId), { csrf, body: {}, interaction });
export const loadMediaFacets = (projectId: string) => request<MediaFacets>(scoped("/api/media/facets", projectId));
export const loadSavedMediaSearches = (projectId: string) => request<{ items: SavedMediaSearch[] }>(scoped("/api/media/saved-searches", projectId));
export const saveMediaSearch = (projectId: string, input: { name: string; search_id: string }, csrf: string) => request<SavedMediaSearch>(scoped("/api/media/saved-searches", projectId), { csrf, body: input });
export const loadMediaSearchSession = (projectId: string, searchId: string) => request<{ id: string; query: MediaSearchInput; result: MediaSearchResult; feedback: Record<string, "positive" | "negative"> }>(scoped(`/api/media/search-sessions/${encodeURIComponent(searchId)}`, projectId));
export const sendMediaFeedback = (projectId: string, input: { search_id: string; shot_id: string; relevance: Relevance }, csrf: string) => request<{ search_id: string; shot_id: string; relevance: Relevance }>(scoped("/api/media/feedback", projectId), { csrf, body: input });
export const loadMediaCollections = (projectId: string) => request<{ items: MediaCollection[] }>(scoped("/api/media/collections", projectId));
export const createMediaCollection = (projectId: string, input: { name: string; search_id: string; shot_ids?: string[]; sample?: MediaSample }, csrf: string) => request<MediaCollectionDetail>(scoped("/api/media/collections", projectId), { csrf, body: input });
export const loadMediaCollection = (projectId: string, id: string) => request<MediaCollectionDetail>(scoped(`/api/media/collections/${encodeURIComponent(id)}`, projectId));
export const updateMediaShotTags = (projectId: string, shotId: string, tags: string[], csrf: string) => request<{ shot_id: string; tags: string[] }>(scoped(`/api/media/shots/${encodeURIComponent(shotId)}/tags`, projectId), { csrf, body: { tags } });
export async function exportMediaCollection(projectId: string, collection: MediaCollection) {
  const manifest = await request<Record<string, unknown>>(scoped(`/api/media/collections/${encodeURIComponent(collection.id)}/export`, projectId));
  const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${collection.name.replace(/[\\/:*?"<>|]/g, "_")}.json`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadMediaArchive(projectId: string, collection: MediaCollection, csrf: string) {
  const response = await instrumentedFetch(apiUrl(scoped(`/api/media/collections/${encodeURIComponent(collection.id)}/archive`, projectId)), {
    method: "POST", credentials: "include", headers: { "X-CSRF-Token": csrf },
  });
  if (!response.ok) {
    let message = `视频文件包导出失败（${response.status}）`;
    try { const body = await response.json() as { detail?: unknown }; if (typeof body.detail === "string") message = body.detail; } catch { /* Preserve status for upstream errors. */ }
    throw new ApiError(message, response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${collection.name.replace(/[\\/:*?"<>|]/g, "_")}.zip`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const MAX_QUERY_IMAGE_BYTES = 6 * 1024 * 1024;
export function queryImagePreviewUrl(data: string): string | undefined {
  if (/^data:image\/(?:jpeg|png|webp);base64,/.test(data)) return data;
  const type = data.startsWith("/9j/") ? "jpeg" : data.startsWith("iVBORw0KGgo") ? "png" : data.startsWith("UklGR") ? "webp" : null;
  return type ? `data:image/${type};base64,${data}` : undefined;
}
export async function readQueryImage(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请选择 JPEG、PNG 或 WebP 图片。");
  if (file.size === 0) throw new Error("图片为空，请重新选择。");
  if (file.size > MAX_QUERY_IMAGE_BYTES) throw new Error("图片不能超过 6 MB，请压缩后重试。");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("无法读取图片。"));
    reader.onerror = () => reject(new Error("无法读取图片，请重新选择。"));
    reader.readAsDataURL(file);
  });
}

export function mediaFileUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  // Media assets are served through the authenticated API, never arbitrary stored URLs.
  if (!path.startsWith("/api/media/files/")) return undefined;
  return apiUrl(path);
}
