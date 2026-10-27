import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pipeline, PipelineGraph, PipelineRun } from "../pipelines-api";
import { server } from "../test/server";
import PipelinesPage from "./PipelinesPage";

const context = vi.hoisted(() => ({
  scope: "demo",
  search: {} as { project_id?: string; pipelineId?: string; runId?: string },
  listeners: new Set<() => void>(),
}));
vi.mock("../auth-context", async () => {
  const { useSyncExternalStore } = await import("react");
  const auth = () => {
    const scope = useSyncExternalStore((listener) => { context.listeners.add(listener); return () => context.listeners.delete(listener); }, () => context.scope);
    return { me: { user: { id: "scope-test-user" }, scope: { type: "project", id: scope }, csrf_token: "scope-csrf" }, can: () => true };
  }; return { useAuth: auth, useProjectAuth: auth };
});
vi.mock("../components/PipelineCanvas", async () => ({
  connectionError: (await vi.importActual<typeof import("../components/PipelineCanvas")>("../components/PipelineCanvas")).connectionError,
  layoutPipeline: (graph: PipelineGraph) => ({ nodes: graph.nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } })) }),
  PipelineCanvas: () => <div aria-label="scope test canvas" />,
}));

const pipelineFor = (project: string): Pipeline => ({
  id: `pipeline-${project}`, name: `${project} 视频流程`, description: "项目作用域界面测试", version: 1,
  graph: { nodes: [{ id: "source", operator: "scope-test.source", version: "1", config: {}, inputs: {} }] },
  created_at: "2026-09-10T01:00:00Z", updated_at: "2026-09-10T01:00:00Z",
});
const runFor = (project: string): PipelineRun => ({
  id: `run-${project}`, pipeline_id: `pipeline-${project}`, pipeline_name: `${project} 已完成运行`, pipeline_version: 1,
  status: "succeeded", created_at: "2026-09-10T01:00:00Z", finished_at: "2026-09-10T01:01:00Z", error: null,
  tasks: [], artifacts: [],
});

describe("pipeline project deep-link UI contracts (mocked API only)", () => {
  const requests: { method: string; path: string; project: string | null }[] = [];
  beforeEach(() => {
    context.scope = "demo";
    context.search = {};
    requests.length = 0;
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(
      http.get("http://api.test/api/pipelines/:id", ({ request }) => { const project = new URL(request.url).searchParams.get("project_id")!; requests.push({ method: "GET", path: "detail", project }); return HttpResponse.json(pipelineFor(project)); }),
      http.get("http://api.test/api/pipeline-runs/:id", ({ request }) => { const project = new URL(request.url).searchParams.get("project_id")!; requests.push({ method: "GET", path: "run-detail", project }); return HttpResponse.json(runFor(project)); }),
    );
    for (const path of ["operators", "operator-plugins", "pipelines", "pipeline-runs"]) {
      server.use(http.get(`http://api.test/api/${path}`, ({ request }) => {
        const project = new URL(request.url).searchParams.get("project_id");
        requests.push({ method: "GET", path, project });
        return HttpResponse.json(path === "pipelines" ? [pipelineFor(project!)] : path === "pipeline-runs" ? [runFor(project!)] : []);
      }));
    }
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const root = createRootRoute({ component: Outlet });
    const page = createRoute({ getParentRoute: () => root, path: "/pipelines", validateSearch: (search: Record<string, unknown>) => search, component: PipelinesPage });
    const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: [`/pipelines?${new URLSearchParams(context.search)}`] }) });
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    return { client, router };
  }
  async function openInformation() {
    fireEvent.click(await screen.findByRole("button", { name: "更多流程操作" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "流程信息" }));
    await screen.findByLabelText("流程名称");
  }

  it("opens the linked project's run and saves there without resetting when the default scope changes", async () => {
    context.search = { project_id: "linked-project", pipelineId: "pipeline-linked-project", runId: "run-linked-project" };
    let savedName = "";
    server.use(http.post("http://api.test/api/pipelines/pipeline-linked-project/versions", async ({ request }) => {
      const project = new URL(request.url).searchParams.get("project_id");
      requests.push({ method: "POST", path: "save", project });
      expect(project).toBe("linked-project");
      expect(request.headers.get("x-csrf-token")).toBe("scope-csrf");
      const body = await request.json() as { name: string; expected_version: number };
      expect(body.expected_version).toBe(1);
      savedName = body.name;
      return HttpResponse.json({ ...pipelineFor("linked-project"), name: savedName, version: 2 });
    }));
    const { client, router } = mount();
    await screen.findByRole("heading", { name: "linked-project 已完成运行 v1" });
    expect(screen.getByText("linked-project 项目")).toBeInTheDocument();
    expect(new Set(requests.map((item) => item.project))).toEqual(new Set(["linked-project"]));
    expect(requests.some((item) => item.path === "run-detail")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "编排" }));
    await openInformation();
    fireEvent.change(screen.getByLabelText("流程名称"), { target: { value: "跨项目草稿" } });
    act(() => { context.scope = "another-default"; context.listeners.forEach((listener) => listener()); });
    expect(screen.getByLabelText("流程名称")).toHaveValue("跨项目草稿");
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
    await screen.findByText("已保存 跨项目草稿 v2");
    expect(savedName).toBe("跨项目草稿");
    expect(requests.every((item) => item.project === "linked-project")).toBe(true);
    expect(router.state.location.search).toMatchObject({ project_id: "linked-project", pipelineId: "pipeline-linked-project", view: "builder" });
    client.clear();
  });

  it("falls back to the auth project and isolates editor state when an explicit project changes", async () => {
    context.scope = "default-project";
    context.search = { pipelineId: "pipeline-default-project" };
    const { client, router } = mount();
    await screen.findByRole("heading", { name: "default-project 视频流程" });
    await openInformation();
    expect(screen.getByLabelText("流程名称")).toHaveValue("default-project 视频流程");
    expect(requests.every((item) => item.project === "default-project")).toBe(true);
    fireEvent.change(screen.getByLabelText("流程名称"), { target: { value: "旧项目草稿" } });
    requests.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    act(() => { void router.navigate({ to: "/pipelines", search: { project_id: "next-project", pipelineId: "pipeline-next-project" } }); });
    fireEvent.click(await screen.findByRole("button", { name: "放弃修改并离开" }));
    await screen.findByRole("heading", { name: "next-project 视频流程" });
    await openInformation();
    expect(screen.getByLabelText("流程名称")).toHaveValue("next-project 视频流程");
    expect(screen.getByText("next-project 项目")).toBeInTheDocument();
    expect(requests.every((item) => item.project === "next-project")).toBe(true);
    expect(screen.queryByText("有未保存的修改")).not.toBeInTheDocument();
    client.clear();
  });
});
