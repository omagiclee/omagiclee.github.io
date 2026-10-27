import { autoGtDatasetProvenance, autoGtFailureProvenance } from "./auto-gt-display";
interface ReflowQuery { query?: string; mode?: string; reference_shot_id?: string; tags_all?: string[]; tags_any?: string[] }
export interface ReflowProvenance {
  schema: "media.failure-reflow.v1"; issue?: string; evaluation_id?: string | null; search_id?: string | null;
  candidate_snapshot_id?: string; review_source?: string | null; query?: ReflowQuery;
  schemes?: { search_id: string; label?: string }[];
}
function object(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trimStart().startsWith("{")) return null;
  try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; } catch { return null; }
}
export function reflowProvenance(source: unknown): ReflowProvenance | null {
  const parsed = object(source);
  if (parsed?.schema !== "media.failure-reflow.v1") return null;
  const text = (key: string) => typeof parsed[key] === "string" ? parsed[key] as string : undefined;
  const schemes = Array.isArray(parsed.schemes) ? parsed.schemes.filter((item) => item && typeof item === "object" && typeof item.search_id === "string").map((item) => ({ search_id: item.search_id as string, label: typeof item.label === "string" ? item.label : undefined })) : undefined;
  return { schema: "media.failure-reflow.v1", issue: text("issue"), evaluation_id: text("evaluation_id"), search_id: text("search_id"), candidate_snapshot_id: text("candidate_snapshot_id"), review_source: text("review_source"), query: parsed.query && typeof parsed.query === "object" ? parsed.query as ReflowQuery : undefined, schemes };
}
export function datasetSourceLabel(source: unknown): string { if (typeof source !== "string") return ""; return reflowProvenance(source) ? "检索失败回流" : autoGtDatasetProvenance(source) ? "AutoGT 配对候选" : autoGtFailureProvenance(source) ? "AutoGT 失败回流" : typeof object(source)?.original_source === "string" ? object(source)!.original_source as string : source; }
export function reflowQueryLabel(query?: ReflowQuery): string {
  if (!query) return "未记录查询";
  if (typeof query.query === "string" && query.query.trim()) return query.query;
  if (query.reference_shot_id) return "以参考镜头检索";
  if (query.mode === "image" || query.mode === "composed") return "参考图片检索";
  const tags = [...(Array.isArray(query.tags_all) ? query.tags_all : []), ...(Array.isArray(query.tags_any) ? query.tags_any : [])].filter((tag) => typeof tag === "string");
  return tags.length ? `标签筛选：${tags.join("、")}` : "条件筛选";
}
export function sampleInputLabel(input: unknown): string {
  if (typeof input !== "string") return "";
  const parsed = object(input);
  if (parsed?.schema !== "media.failure-candidate.v1") return input;
  const issue = typeof parsed.issue === "string" ? parsed.issue : "待人工确认的检索问题";
  return `问题：${issue}；检索条件：${reflowQueryLabel(parsed.query as ReflowQuery | undefined)}`;
}
export function reflowExploreUrl(projectId: string, kind: "evaluation_id" | "search_id", id: string): string {
  return `/projects/${encodeURIComponent(projectId)}/explore?${kind}=${encodeURIComponent(id)}`;
}
