import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";

export interface InsightFilters {
  days?: number;
  project_id?: string;
  user_id?: string;
  actor_user_id?: string;
  page_id?: string;
  element_id?: string;
  kind?: string;
  action?: string;
  status?: string;
  session_id?: string;
  offset?: number;
  group_by?: "page" | "menu" | "button" | "user";
  period?: "window" | "current";
}
export interface InsightWindow { start: string; end: string; days: number }
export interface InsightProjects { projects: Array<{ id: string; name: string }>; default_project_id: string; can_view_all: boolean }
export interface UsageSummary { active_users: number; page_views: number; clicks: number; business_actions: number }
export interface Overview {
  project_id: string;
  generated_at: string;
  window: InsightWindow;
  media: null | { videos: number; shots: number; indexed_shots: number; keyframes: number; new_videos: number; new_shots: number; index_rate: number | null };
  production: null | { total: number; succeeded: number; failed: number; running: number; cancelled?: number; success_rate: number | null; avg_duration_ms: number | null };
  requirements: null | { total: number; open: number; pending_review: number; pending_acceptance: number; in_progress: number; overdue: number; completed: number };
  usage: null | (Partial<UsageSummary> & { available: boolean });
  trend: Array<{ date: string; videos: number; shots: number; runs: number; succeeded: number; active_users: number; page_views: number }>;
  attention: Array<{ id: string; kind: string; title: string; status: string; created_at: string; href: string }>;
  top_features: Array<{ id: string; label: string; page_id: string; clicks: number; users: number }>;
}
export interface UsageRow {
  id: string; label: string; page_id: string | null; views: number; clicks: number; users: number;
  exposures: number; exposed_users: number; click_rate: number | null; avg_duration_ms: number | null; last_seen_at: string | null;
  business_actions?: number; succeeded?: number; failed?: number; running?: number;
}
export interface UsageReport { generated_at: string; window: InsightWindow; summary: UsageSummary; rows: UsageRow[]; collection_started_at: string | null }
export interface InsightEvent {
  id: string; kind: string; action: string | null; label: string | null; page_id: string | null; element_id: string | null;
  actor_user_id: string; actor_name: string; effective_user_id: string; user_name: string; session_id: string | null;
  created_at: string; status: string | null; object_id: string | null; interaction_id: string | null;
  details: Record<string, unknown> | null; href: string | null;
}
export interface EventReport { items: InsightEvent[]; total: number; offset: number; limit: number }
export interface RecordReport { items: Array<{ id: string; kind: string; title: string; status: string | null; created_at: string; href: string | null }>; total: number; offset: number; limit: number }
export interface InsightPeople { people: Array<{ id: string; name: string; username: string }> }

export function insightSearch(filters: InsightFilters, extra: Record<string, string | number | undefined | null> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(`/api/insights/${path}`), { credentials: "include", signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: unknown };
    throw new ApiError(typeof body.detail === "string" ? body.detail : `读取统计失败（HTTP ${response.status}）`, response.status);
  }
  return response.json() as Promise<T>;
}

export const insightProjectsOptions = queryOptions({ queryKey: ["insights", "projects"], queryFn: ({ signal }) => request<InsightProjects>("projects", signal), staleTime: 60_000 });
export const overviewOptions = (filters: InsightFilters) => queryOptions({ queryKey: ["insights", "overview", filters], queryFn: ({ signal }) => request<Overview>(`overview?${insightSearch(filters)}`, signal), staleTime: 30_000 });
export const operationsOptions = (filters: InsightFilters) => queryOptions({ queryKey: ["insights", "operations", filters], queryFn: ({ signal }) => request<Overview>(`operations?${insightSearch(filters)}`, signal), staleTime: 30_000 });
export const usageOptions = (filters: InsightFilters) => queryOptions({ queryKey: ["insights", "usage", filters], queryFn: ({ signal }) => request<UsageReport>(`usage?${insightSearch(filters)}`, signal), staleTime: 15_000 });
export const insightEventsOptions = (filters: InsightFilters) => queryOptions({ queryKey: ["insights", "events", filters], queryFn: ({ signal }) => request<EventReport>(`events?${insightSearch(filters, { limit: 30 })}`, signal), staleTime: 10_000 });
export const insightRecordsOptions = (filters: InsightFilters) => queryOptions({ queryKey: ["insights", "records", filters], queryFn: ({ signal }) => request<RecordReport>(`records?${insightSearch(filters, { limit: 20 })}`, signal), staleTime: 15_000 });
export const insightPeopleOptions = (filters: InsightFilters) => queryOptions({ queryKey: ["insights", "people", filters.project_id, filters.days], queryFn: ({ signal }) => request<InsightPeople>(`people?${insightSearch({ project_id: filters.project_id, days: filters.days })}`, signal), staleTime: 30_000 });
