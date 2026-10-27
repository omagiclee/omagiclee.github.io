import { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
import App from "./App";
import { userDirectoryQueryOptions } from "./admin-api";
import { eventsQueryOptions, requirementQueryOptions, requirementsQueryOptions } from "./api";
import { meQueryOptions } from "./auth-api";
import DashboardPage from "./pages/DashboardPage";
import { RequirementError, RequirementLoading } from "./components/RequirementRouteState";
import { GlobalRouteError } from "./components/GlobalRouteError";
import { GlobalRouteNotFound } from "./components/GlobalRouteNotFound";

interface RouterContext {
  queryClient: QueryClient;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const rootRoute = createRootRouteWithContext<RouterContext>()({
  loader: ({ context }) => context.queryClient.ensureQueryData(meQueryOptions),
  component: App,
  errorComponent: GlobalRouteError,
  notFoundComponent: GlobalRouteNotFound,
});

function insightsSearch(search: Record<string, unknown>) {
  const result: Record<string, string | number> = {};
  const days = Number(search.days);
  if ([7, 30, 90].includes(days)) result.days = days;
  const offset = Number(search.offset);
  if (Number.isSafeInteger(offset) && offset >= 0) result.offset = offset;
  for (const key of ["project_id", "user_id", "actor_user_id", "page_id", "element_id", "kind", "action", "status", "session_id", "group_by", "period"]) {
    if (typeof search[key] === "string" && search[key].length <= (key === "pagingHistory" ? 4096 : key === "cursor" ? 512 : 160)) result[key] = search[key];
  }
  return result;
}

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: insightsSearch,
  component: DashboardPage,
});

const operationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/operations",
  validateSearch: insightsSearch,
  component: lazyRouteComponent(() => import("./pages/DataOperationsPage")),
});

const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics",
  validateSearch: insightsSearch,
  component: lazyRouteComponent(() => import("./pages/UsageAnalyticsPage")),
});

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/audit",
  validateSearch: insightsSearch,
  component: lazyRouteComponent(() => import("./pages/AuditPage")),
});

const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events",
  loader: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    return me?.permissions.includes("events:read")
      ? context.queryClient.ensureQueryData(eventsQueryOptions)
      : null;
  },
  component: lazyRouteComponent(() => import("./pages/EventsPage")),
});

const requirementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/requirements",
  errorComponent: RequirementError,
  pendingComponent: RequirementLoading,
  loader: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    return me?.permissions.includes("requirements:read")
      ? context.queryClient.ensureQueryData(requirementsQueryOptions)
      : null;
  },
  component: lazyRouteComponent(() => import("./pages/RequirementsPage")),
});

const requirementDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/requirements/$requirementId",
  errorComponent: RequirementError,
  pendingComponent: RequirementLoading,
  loader: async ({ context, params }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    return me?.permissions.includes("requirements:read")
      ? context.queryClient.ensureQueryData(requirementQueryOptions(params.requirementId))
      : null;
  },
  component: lazyRouteComponent(() => import("./pages/RequirementDetailPage")),
});

const usersAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/users",
  loader: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    return me?.permissions.includes("users:read")
      ? context.queryClient.ensureQueryData(userDirectoryQueryOptions)
      : null;
  },
  component: lazyRouteComponent(() => import("./pages/UsersAdminPage")),
});

const pipelinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pipelines",
  validateSearch: (search: Record<string, unknown>): { pipelineId?: string; runId?: string; project_id?: string; view?: "builder" | "runs" | "versions" | "new"; template?: "video" | "text"; version?: number; q?: string; status?: string; page?: number; operator_id?: string; operator_version?: string } => ({
    ...(typeof search.operator_id === "string" && search.operator_id.length <= 160 ? { operator_id: search.operator_id } : {}),
    ...(["string", "number"].includes(typeof search.operator_version) && String(search.operator_version).length <= 80 ? { operator_version: String(search.operator_version) } : {}),
    ...(typeof search.pipelineId === "string" && search.pipelineId.length <= 80 ? { pipelineId: search.pipelineId } : {}),
    ...(typeof search.runId === "string" && search.runId.length <= 80 ? { runId: search.runId } : {}),
    ...(typeof search.project_id === "string" && search.project_id !== "*" && search.project_id.length <= 80 ? { project_id: search.project_id } : {}),
    ...(["builder", "runs", "versions", "new"].includes(String(search.view)) ? { view: search.view as "builder" | "runs" | "versions" | "new" } : {}),
    ...(["video", "text"].includes(String(search.template)) ? { template: search.template as "video" | "text" } : {}),
    ...(Number.isSafeInteger(Number(search.version)) && Number(search.version) > 0 ? { version: Number(search.version) } : {}),
    ...(Number.isSafeInteger(Number(search.page)) && Number(search.page) > 0 ? { page: Number(search.page) } : {}),
    ...(typeof search.q === "string" && search.q.length <= 200 ? { q: search.q } : {}),
    ...(typeof search.status === "string" && ["none", "pending", "queued", "running", "succeeded", "failed", "cancelled", "cancelling", "interrupted"].includes(search.status) ? { status: search.status } : {}),
  }),
  component: lazyRouteComponent(() => import("./pages/PipelinesPage")),
});

const projectPipelinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/pipelines",
  validateSearch: (search: Record<string, unknown>) => search,
  component: lazyRouteComponent(() => import("./pages/PipelinesPage"), "ProjectPipelinesRoute"),
});

const operatorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/operators",
  validateSearch: (search: Record<string, unknown>): { project_id?: string; view?: "development"; releaseId?: string; pluginId?: string; q?: string; offset?: number } => ({
    ...(typeof search.project_id === "string" && search.project_id !== "*" && search.project_id.length <= 80 ? { project_id: search.project_id } : {}),
    ...(search.view === "development" ? { view: "development" as const } : {}),
    ...(typeof search.releaseId === "string" && search.releaseId.length <= 100 ? { releaseId: search.releaseId } : {}),
    ...(typeof search.pluginId === "string" && search.pluginId.length <= 200 ? { pluginId: search.pluginId } : {}),
    ...(typeof search.q === "string" && search.q.length <= 200 ? { q: search.q } : {}),
    ...(Number.isSafeInteger(Number(search.offset)) && Number(search.offset) >= 0 ? { offset: Number(search.offset) } : {}),
  }),
  component: lazyRouteComponent(() => import("./pages/OperatorsPage")),
});

const projectOperatorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/operators",
  validateSearch: (search: Record<string, unknown>) => search,
  component: lazyRouteComponent(() => import("./pages/OperatorsPage"), "ProjectOperatorsRoute"),
});

const projectRunsSearch = (search: Record<string, unknown>): { pipelineId?: string; status?: "pending" | "queued" | "running" | "succeeded" | "failed" | "interrupted" | "cancelling" | "cancelled"; page?: number } => ({
  ...(typeof search.pipelineId === "string" && search.pipelineId.length <= 80 ? { pipelineId: search.pipelineId } : {}),
  ...(typeof search.status === "string" && ["pending", "queued", "running", "succeeded", "failed", "interrupted", "cancelling", "cancelled"].includes(search.status)
    ? { status: search.status as "pending" | "queued" | "running" | "succeeded" | "failed" | "interrupted" | "cancelling" | "cancelled" }
    : {}),
  ...(Number.isSafeInteger(Number(search.page)) && Number(search.page) > 0 ? { page: Number(search.page) } : {}),
});

const projectRunsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/runs",
  validateSearch: projectRunsSearch,
  component: lazyRouteComponent(() => import("./pages/RunsPage"), "ProjectRunsPage"),
});

const projectRunDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/runs/$runId",
  validateSearch: projectRunsSearch,
  component: lazyRouteComponent(() => import("./pages/RunsPage"), "ProjectRunDetailPage"),
});

const projectConnectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/settings/connections",
  component: lazyRouteComponent(() => import("./pages/ConnectionsPage")),
});

function platformSearch(search: Record<string, unknown>): { tab?: string; version?: string; sample?: string; workspace?: string; selection?: string; modelId?:string;create?:string } {
  return Object.fromEntries(["tab", "version", "sample", "workspace", "selection", "q", "cursor", "pagingHistory", "modality", "status", "benchmarkId", "modelId", "create"].flatMap((key) =>
    typeof search[key] === "string" && search[key].length <= (key === "pagingHistory" ? 4096 : key === "cursor" ? 512 : 160) ? [[key, search[key]]] : []));
}

const trainingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/training",
  validateSearch: (search:Record<string,unknown>) => Object.fromEntries(["job","datasetId"].flatMap(key=>typeof search[key]==="string"&&search[key].length<=80?[[key,search[key]]]:[])),
  component: lazyRouteComponent(() => import("./pages/TrainingPage")),
});

const datasetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/datasets",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "DatasetsPage"),
});

const autoGtRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/auto-gt",
  validateSearch: (search: Record<string, unknown>): { job_id?: string } => ({ ...(typeof search.job_id === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(search.job_id) ? { job_id: search.job_id } : {}) }),
  component: lazyRouteComponent(() => import("./pages/AutoGtPage")),
});

const datasetDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/datasets/$datasetId",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "DatasetDetailPage"),
});

function mediaExploreSearch(search: Record<string, unknown>): { project_id?: string; evaluation_id?: string; search_id?: string } {
  const evaluation = search.evaluation_id ?? search.evaluation;
  const session = search.search_id ?? search.search;
  return {
    ...(typeof search.project_id === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(search.project_id) ? { project_id: search.project_id } : {}),
    ...(typeof evaluation === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(evaluation) ? { evaluation_id: evaluation } : {}),
    ...(typeof session === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(session) ? { search_id: session } : {}),
  };
}

const projectExploreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/explore",
  validateSearch: mediaExploreSearch,
  component: lazyRouteComponent(() => import("./pages/MediaPage"), "ProjectExplorePage"),
});

const annotationTasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/annotation/tasks",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "AnnotationTasksPage"),
});

const annotationSpecsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/annotation/specs",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "AnnotationSpecsPage"),
});

const evaluationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/evaluations",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "EvaluationExperimentsPage"),
});

const benchmarksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/benchmarks",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "EvaluationBenchmarksPage"),
});

const feedbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/feedback",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "FeedbackPage"),
});

const annotationTaskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/annotation/tasks/$taskId",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "AnnotationTaskDetailPage"),
});

const annotationSpecDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/annotation/specs/$specId",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "AnnotationSpecDetailPage"),
});

const evaluationDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/evaluations/$experimentId",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "EvaluationExperimentDetailPage"),
});

const benchmarkDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/benchmarks/$benchmarkId",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "EvaluationBenchmarkDetailPage"),
});

const feedbackDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/feedback/$feedbackId",
  validateSearch: platformSearch,
  component: lazyRouteComponent(() => import("./pages/PlatformMockPages"), "FeedbackDetailPage"),
});

const environmentsAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/environments",
  component: lazyRouteComponent(() => import("./pages/EnvironmentsAdminPage")),
});

const mediaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/media",
  validateSearch: mediaExploreSearch,
  component: lazyRouteComponent(() => import("./pages/MediaPage")),
});

const accessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/access",
  validateSearch: (search: Record<string, unknown>): { permission?: string; project_id?: string } => ({
    ...(typeof search.permission === "string" && search.permission.length < 160 ? { permission: search.permission } : {}),
    ...(typeof search.project_id === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(search.project_id) ? { project_id: search.project_id } : {}),
  }),
  component: lazyRouteComponent(() => import("./pages/AccessPage")),
});

const accessAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/access",
  component: lazyRouteComponent(() => import("./pages/AccessAdminPage")),
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications",
  component: lazyRouteComponent(() => import("./pages/NotificationsPage")),
});

const routeTree = rootRoute.addChildren([dashboardRoute, operationsRoute, analyticsRoute, auditRoute, eventsRoute, requirementsRoute, requirementDetailRoute, pipelinesRoute, projectPipelinesRoute, operatorsRoute, projectOperatorsRoute, projectRunsRoute, projectRunDetailRoute, projectConnectionsRoute, trainingRoute, datasetsRoute, datasetDetailRoute, autoGtRoute, projectExploreRoute, annotationTasksRoute, annotationTaskDetailRoute, annotationSpecsRoute, annotationSpecDetailRoute, evaluationsRoute, evaluationDetailRoute, benchmarksRoute, benchmarkDetailRoute, feedbackRoute, feedbackDetailRoute, mediaRoute, usersAdminRoute, accessRoute, accessAdminRoute, environmentsAdminRoute, notificationsRoute]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
