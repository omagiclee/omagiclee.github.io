import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineRun } from "../pipelines-api";
import { server } from "../test/server";
import { ProjectRunDetailPage, ProjectRunsPage } from "./RunsPage";

vi.mock("../auth-context", () => ({
  useAuth: () => ({ me: { user: { id: "runs-user" }, csrf_token: "runs-csrf" }, can: () => true }),
  useProjectAuth: () => ({ me: { user: { id: "runs-user" }, csrf_token: "runs-csrf" }, can: () => true }),
}));

const run: PipelineRun = {
  id: "run-linked-001",
  pipeline_id: "pipeline-linked",
  pipeline_name: "真实视频处理",
  pipeline_version: 3,
  status: "failed",
  created_at: "2026-09-16T01:00:00Z",
  finished_at: "2026-09-16T01:02:30Z",
  error: "模型服务暂时不可用",
  tasks: [],
  artifacts: [],
};

describe("project run center", () => {
  const captured: { path: string; status: string | null; pipelineId: string | null }[] = [];

  beforeEach(() => {
    captured.length = 0;
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(
      http.get("http://api.test/api/projects/:projectId/runs", ({ request }) => {
        const url = new URL(request.url);
        captured.push({
          path: url.pathname,
          status: url.searchParams.get("status"),
          pipelineId: url.searchParams.get("pipeline_id"),
        });
        return HttpResponse.json({
          items: [run],
          total: 1,
          offset: 0,
          limit: 20,
          has_more: false,
        });
      }),
      http.get("http://api.test/api/projects/:projectId/runs/:runId", ({ request }) => {
        const url = new URL(request.url);
        captured.push({ path: url.pathname, status: null, pipelineId: null });
        return HttpResponse.json(run);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  function mount(initialUrl: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRootRoute({ component: Outlet });
    const runsRoute = createRoute({
      getParentRoute: () => root,
      path: "/projects/$projectId/runs",
      validateSearch: (search: Record<string, unknown>) => search,
      component: ProjectRunsPage,
    });
    const runRoute = createRoute({
      getParentRoute: () => root,
      path: "/projects/$projectId/runs/$runId",
      validateSearch: (search: Record<string, unknown>) => search,
      component: ProjectRunDetailPage,
    });
    const router = createRouter({ routeTree: root.addChildren([runsRoute, runRoute]), history: createMemoryHistory({ initialEntries: [initialUrl] }) });
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    return { client, router };
  }

  it("loads a project-scoped filtered run directory", async () => {
    mount("/projects/linked/runs?status=failed&pipelineId=pipeline-linked");
    expect(await screen.findByRole("heading", { name: "运行中心" })).toBeInTheDocument();
    expect(screen.getByText("linked 项目")).toBeInTheDocument();
    expect(await screen.findByText("真实视频处理")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选运行状态" })).toHaveTextContent("运行状态：失败");
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(captured).toEqual([{
      path: "/api/projects/linked/runs",
      status: "failed",
      pipelineId: "pipeline-linked",
    }]);
  });

  it("opens the shared run detail and preserves list filters when returning", async () => {
    const { router } = mount("/projects/linked/runs?status=failed&page=2");
    fireEvent.click(await screen.findByRole("link", { name: "打开运行 run-linked-001" }));
    expect(await screen.findByRole("heading", { name: "运行详情" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "真实视频处理 v3" })).toBeInTheDocument();
    expect(captured.at(-1)?.path).toBe("/api/projects/linked/runs/run-linked-001");
    const back = screen.getByRole("link", { name: "返回运行中心" });
    expect(back).toHaveAttribute("href", "/projects/linked/runs?status=failed&page=2");
    fireEvent.click(back);
    expect(router.state.location.pathname).toBe("/projects/linked/runs");
    expect(router.state.location.searchStr).toContain("status=failed");
    expect(router.state.location.searchStr).toContain("page=2");
  });

  it("keeps the previous-page action when the filtered result shrinks beneath the current page", async () => {
    server.use(http.get("http://api.test/api/projects/:projectId/runs", ({ request }) => {
      const later = new URL(request.url).searchParams.get("offset") === "20";
      return HttpResponse.json({ items: later ? [] : [run], total: 1, offset: later ? 20 : 0, limit: 20, has_more: false });
    }));
    const { router } = mount("/projects/linked/runs?status=failed&page=2");
    await screen.findByRole("heading", { name: "没有符合条件的运行" });
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(await screen.findByText("真实视频处理")).toBeInTheDocument();
    expect(router.state.location.searchStr).toContain("status=failed");
    expect(router.state.location.searchStr).not.toContain("page=");
    expect(screen.queryByRole("navigation", { name: "运行分页" })).not.toBeInTheDocument();
  });
});
