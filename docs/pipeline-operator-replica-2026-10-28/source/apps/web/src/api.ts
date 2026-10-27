import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch, type InteractionContext } from "./telemetry";
import type {
  DashboardData,
  EventCreateInput,
  FlywheelEvent,
  Participant,
  Requirement,
  RequirementCreateInput,
  RequirementTransitionInput,
} from "./types";

async function responseError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { detail?: string | Array<{ msg: string; loc?: (string | number)[] }> };
    const detail = Array.isArray(body.detail) ? body.detail.map((item) => `${item.loc?.slice(1).join(".") ?? "字段"}: ${item.msg}`).join("；") : body.detail;
    return new ApiError(detail ?? fallback, response.status);
  } catch {
    return new ApiError(fallback, response.status);
  }
}

async function requirementRequest<T>(path: string, init?: RequestInit, interaction?: InteractionContext): Promise<T> {
  const response = await instrumentedFetch(apiUrl(path), { ...init, credentials: "include" }, interaction);
  if (!response.ok) throw await responseError(response, `请求失败：HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function loadDashboard(): Promise<{ data: DashboardData; isFallback: boolean }> {
  const response = await fetch(apiUrl("/api/flywheel"), { credentials: "include" });
  if (!response.ok) throw await responseError(response, `概览读取失败：HTTP ${response.status}`);
  return { data: await response.json() as DashboardData, isFallback: false };
}

export function loadRequirements() {
  return requirementRequest<Requirement[]>("/api/requirements");
}

export function loadEvents() {
  return requirementRequest<FlywheelEvent[]>("/api/events");
}

export function exportEvents(interaction?: InteractionContext) {
  return requirementRequest<FlywheelEvent[]>("/api/events/export", undefined, interaction);
}

export function loadRequirement(id: string) {
  return requirementRequest<Requirement>(`/api/requirements/${id}`);
}

export function loadParticipants() {
  return requirementRequest<Participant[]>("/api/requirements/participants");
}

export function createRequirement(payload: RequirementCreateInput, csrfToken: string, interaction?: InteractionContext) {
  return requirementRequest<Requirement>("/api/requirements", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(payload),
  }, interaction);
}

export function transitionRequirement(id: string, payload: RequirementTransitionInput, csrfToken: string, interaction?: InteractionContext) {
  return requirementRequest<Requirement>(`/api/requirements/${id}/transitions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(payload),
  }, interaction);
}

export function editRequirement(id: string, payload: RequirementCreateInput, csrfToken: string, interaction?: InteractionContext) {
  return requirementRequest<Requirement>(`/api/requirements/${id}/edit`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify(payload),
  }, interaction);
}

export function commentRequirement(id: string, comment: string, expected_revision: number, csrfToken: string, interaction?: InteractionContext) {
  return requirementRequest<Requirement>(`/api/requirements/${id}/comments`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ comment, expected_revision }),
  }, interaction);
}

export async function createFlywheelEvent(payload: EventCreateInput, csrfToken: string, interaction?: InteractionContext): Promise<FlywheelEvent> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  const response = await instrumentedFetch(`${baseUrl}/api/events`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(payload),
  }, interaction);
  if (!response.ok) {
    throw new Error(`事件写入失败：HTTP ${response.status}`);
  }
  return response.json() as Promise<FlywheelEvent>;
}

export const dashboardQueryOptions = queryOptions({
  queryKey: ["flywheel-dashboard"],
  queryFn: loadDashboard,
  staleTime: 30_000,
  refetchInterval: 60_000,
});

export const eventsQueryOptions = queryOptions({
  queryKey: ["flywheel-events"],
  queryFn: loadEvents,
  staleTime: 30_000,
  refetchInterval: 60_000,
});

export const requirementsQueryOptions = queryOptions({
  queryKey: ["requirements"], queryFn: loadRequirements, staleTime: 15_000, refetchInterval: 30_000,
});

export const requirementQueryOptions = (id: string) => queryOptions({
  queryKey: ["requirements", id], queryFn: () => loadRequirement(id), staleTime: 10_000, refetchInterval: 30_000,
});

export const participantsQueryOptions = queryOptions({
  queryKey: ["requirement-participants"], queryFn: loadParticipants, staleTime: 60_000,
});
