import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch } from "./telemetry";
import type { MediaSearchInput, MediaShot } from "./media-api";

export type EvaluationGrade = 0 | 1 | 2 | null;
export interface EvaluationSummary {
  id: string; name: string; status: string; revision: number; candidate_count: number; judged_count: number;
  reviewed: boolean; scheme_count: number; created_at: string;
}
export interface EvaluationMetrics {
  precision_at_k: number | null; recall_at_k: number | null; ndcg_at_k: number | null;
  judged_fraction: number | null; elapsed_ms: number | null; known_relevant: number;
  evaluated: number; unjudged_returned: string[];
}
export interface MediaEvaluation extends EvaluationSummary {
  query: Omit<MediaSearchInput, "limit"> & { limit?: number }; candidate_snapshot_id: string; candidates: (MediaShot & { grade: EvaluationGrade })[];
  schemes: { search_id: string; label: string; retrieval: Record<string, unknown>; items: string[] }[];
  k: number; review_source: "human" | "test_fixture" | null; metrics_kind?: "not_evaluated" | "human_reviewed" | "fixture_validation";
  metrics: { search_id: string; label: string; report: { k: number; queries: EvaluationMetrics[] } }[] | null;
  failures: { search_id: string; false_positive_ids: string[]; missed_relevant_ids: string[]; unjudged_ids: string[] }[];
  drift: { shot_id: string; reason: string }[];
}
export interface MediaReflowResult {
  dataset_id: string; feedback_ids: string[]; selection_id?: string | null; task_id?: string | null; url: string; created: boolean;
}

async function request<T>(projectId: string, path: string, csrf?: string, body?: unknown): Promise<T> {
  const response = await instrumentedFetch(apiUrl(`/api/media${path}${path.includes("?") ? "&" : "?"}project_id=${encodeURIComponent(projectId)}`), {
    credentials: "include", ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const data = await response.json() as { detail?: unknown };
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((item: { msg?: string }) => item.msg ?? "参数无效").join("；");
    } catch { /* Keep the transport status for non-JSON failures. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
export const loadMediaEvaluations = (projectId: string) => request<{ items: EvaluationSummary[] }>(projectId, "/evaluations");
export const loadMediaEvaluation = (projectId: string, id: string) => request<MediaEvaluation>(projectId, `/evaluations/${encodeURIComponent(id)}`);
export const createMediaEvaluation = (projectId: string, input: { name: string; search_ids: string[]; k: number }, csrf: string) => request<MediaEvaluation>(projectId, "/evaluations", csrf, input);
export const judgeMediaEvaluation = (projectId: string, id: string, shotId: string, grade: EvaluationGrade, csrf: string, revision: number) => request<MediaEvaluation>(projectId, `/evaluations/${encodeURIComponent(id)}/judgments`, csrf, { shot_id: shotId, grade: grade ?? "clear", expected_revision: revision });
export const reviewMediaEvaluation = (projectId: string, id: string, reviewed: boolean, csrf: string, revision: number) => request<MediaEvaluation>(projectId, `/evaluations/${encodeURIComponent(id)}/review`, csrf, { reviewed, review_source: "human", expected_revision: revision });
export const attachMediaEvaluationScheme = (projectId: string, id: string, searchId: string, label: string, csrf: string, revision: number) => request<MediaEvaluation>(projectId, `/evaluations/${encodeURIComponent(id)}/schemes`, csrf, { search_id: searchId, expected_revision: revision, ...(label.trim() ? { label: label.trim() } : {}) });
export const createMediaReflow = (projectId: string, input: { evaluation_id: string; idempotency_key: string; shot_ids: string[]; name: string; issue: string; action: "selection" | "annotation"; spec_id?: string; assignee_id?: string; reviewer_id?: string }, csrf: string) => request<MediaReflowResult>(projectId, "/reflows", csrf, input);

export const loadMediaReflows = (projectId: string, evaluationId: string) => request<{ items: (MediaReflowResult & { name: string; issue: string })[] }>(projectId, `/reflows?evaluation_id=${encodeURIComponent(evaluationId)}`);
