import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pipeline, PipelineGraph, PipelineRun } from "../pipelines-api";
import { server } from "../test/server";
import OperatorsPage from "./OperatorsPage";
import PipelinesPage from "./PipelinesPage";

const access = vi.hoisted(() => ({ scope: "workspace-project", denied: [] as string[] }));
vi.mock("../auth-context", () => { const auth = () => ({ me: { user: { id: "workspace-test-user" }, scope: { type: "project", id: access.scope }, csrf_token: "workspace-csrf" }, can: (permission: string) => !access.denied.includes(permission) }); return { useAuth: auth, useProjectAuth: auth }; });
vi.mock("../components/PipelineCanvas", async () => ({
  connectionError: (await vi.importActual<typeof import("../components/PipelineCanvas")>("../components/PipelineCanvas")).connectionError,
  layoutPipeline: (graph: PipelineGraph) => ({ nodes: graph.nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } })) }),
  PipelineCanvas: () => <div aria-label="canvas fixture" />,
}));

const operator = { id: "media.source", name: "视频接入", version: "1", plugin_id: "media.video", description: "界面测试算子", kind: "source", input_type: null, output_type: "video_assets", config_schema: { properties: {} }, default_config: {}, deterministic: true, side_effects: false, implementation_digest: "fixture" };
const pipeline = (id = "flow-a", version = 2): Pipeline => ({ id, name: id === "flow-a" ? "森林视频流程" : "城市视频流程", description: "独立项目 API 界面测试", version, graph: { nodes: [{ id: "source", operator: operator.id, version: "1", config: { marker: `version-${version}` }, inputs: {} }] }, created_at: "2026-09-10T01:00:00Z", updated_at: "2026-09-10T01:02:00Z", versions: [{ version: 2, name: "新定义", created_at: "2026-09-10T01:02:00Z" }, { version: 1, name: "原始定义", created_at: "2026-09-10T01:00:00Z" }] });
const runFixture = (id = "run-a", pipelineId = "flow-a", status = "succeeded"): PipelineRun => ({ id, pipeline_id: pipelineId, pipeline_name: pipeline(pipelineId).name, pipeline_version: 2, status, created_at: "2026-09-10T01:03:00Z", finished_at: null, error: null, tasks: [], artifacts: [] });

function mount(initial = "/pipelines?project_id=workspace-project") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const pipelineRoute = createRoute({ getParentRoute: () => root, path: "/pipelines", validateSearch: (search: Record<string, unknown>) => search, component: PipelinesPage });
  const operatorsRoute = createRoute({ getParentRoute: () => root, path: "/operators", validateSearch: (search: Record<string, unknown>) => search, component: OperatorsPage });
  const router = createRouter({ routeTree: root.addChildren([pipelineRoute, operatorsRoute]), history: createMemoryHistory({ initialEntries: [initial] }) });
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router, unmount: () => { view.unmount(); client.clear(); } };
}

describe("pipeline user tasks with an isolated MSW API (no real executions)", () => {
  let runs: PipelineRun[];
  const requests: { path: string; scope: string | null; pipeline: string | null }[] = [];
  beforeEach(() => {
    access.scope = "workspace-project"; access.denied = []; runs = [runFixture(), runFixture("run-b", "flow-b")]; requests.length = 0;
    vi.spyOn(window, "scrollTo").mockImplementation(() => {}); sessionStorage.clear(); vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    const capture = (request: Request) => { const url = new URL(request.url); requests.push({ path: url.pathname, scope: url.searchParams.get("project_id"), pipeline: url.searchParams.get("pipeline_id") }); };
    server.use(
      http.get("http://api.test/api/plugin-releases", () => HttpResponse.json({ items: [], total: 0, offset: 0, limit: 20, has_more: false })),
      http.get("http://api.test/api/operators", ({ request }) => { capture(request); return HttpResponse.json([operator]); }),
      http.get("http://api.test/api/pipelines", ({ request }) => { capture(request); const url = new URL(request.url); const items = [pipeline(), pipeline("flow-b")].filter((item) => item.name.includes(url.searchParams.get("q") ?? "")); return HttpResponse.json({ items, total: items.length, offset: 0, limit: 20, has_more: false }); }),
      http.get("http://api.test/api/pipelines/:id", ({ request, params }) => { capture(request); return HttpResponse.json(pipeline(String(params.id))); }),
      http.get("http://api.test/api/pipelines/:id/versions/:version", ({ request, params }) => { capture(request); return HttpResponse.json(pipeline(String(params.id), Number(params.version))); }),
      // Return both pipelines intentionally: the detail must also defend its object scope.
      http.get("http://api.test/api/pipeline-runs", ({ request }) => { capture(request); return HttpResponse.json(runs); }),
      http.get("http://api.test/api/pipeline-runs/:id", ({ request, params }) => { capture(request); return HttpResponse.json(runs.find((run) => run.id === params.id) ?? runFixture(String(params.id))); }),
    );
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  it("keeps one page-header action plus contextual creation and no empty pagination", async () => {
    server.use(http.get("http://api.test/api/pipelines", () => HttpResponse.json({ items: [], total: 0, offset: 0, limit: 20, has_more: false })));
    const { client } = mount();
    await screen.findByRole("heading", { name: "创建第一条流水线" });
    expect(screen.getAllByRole("link", { name: "新建流水线" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "创建流水线" })).toHaveAttribute("href", "/pipelines?project_id=workspace-project&view=new");
    expect(screen.queryByRole("navigation", { name: "流水线分页" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("搜索流水线")).toBeInTheDocument();
    client.clear();
  });

  it("keeps a way back from a later page that has become empty", async () => {
    server.use(http.get("http://api.test/api/pipelines", () => HttpResponse.json({ items: [], total: 0, offset: 20, limit: 20, has_more: false })));
    const { client, router } = mount("/pipelines?project_id=workspace-project&page=2");
    await screen.findByRole("heading", { name: "当前页暂无流水线" });
    const pagination = screen.getByRole("navigation", { name: "流水线分页" });
    expect(within(pagination).getByRole("button", { name: "上一页" })).toBeEnabled();
    fireEvent.click(within(pagination).getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ page: 1 }));
    client.clear();
  });

  it("starts at a searchable list and persists the selected pipeline, tab and run in the URL", async () => {
    const { client, router } = mount();
    await screen.findByRole("link", { name: "森林视频流程" });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索流水线"), { target: { value: "森林" } });
    await waitFor(() => expect(screen.queryByRole("link", { name: "城市视频流程" })).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole("link", { name: "森林视频流程" }));
    await screen.findByRole("tab", { name: "编排" });
    fireEvent.click(screen.getByRole("tab", { name: "运行记录" }));
    const panel = await screen.findByRole("tabpanel", { name: "运行记录" });
    await within(panel).findByText("run-a");
    expect(within(panel).queryByText("run-b")).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("link"));
    await screen.findByRole("region", { name: "运行详情" });
    expect(router.state.location.search).toMatchObject({ project_id: "workspace-project", pipelineId: "flow-a", view: "runs", runId: "run-a" });
    expect(requests.some((request) => request.path === "/api/pipeline-runs" && request.pipeline === "flow-a")).toBe(true);
    expect(requests.every((request) => request.scope === "workspace-project")).toBe(true);
    await act(() => router.history.back());
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("runId"));
    client.clear();
  });

  it("reads saved historical definitions and gives them no editing or run controls", async () => {
    const { client, router } = mount("/pipelines?project_id=workspace-project&pipelineId=flow-a&view=versions&version=1");
    await screen.findByText("只读版本");
    expect(screen.getByText("森林视频流程 · v1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("参数与输入"));
    expect(screen.getAllByText(/version-1/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "保存版本" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^正式运行/ })).not.toBeInTheDocument();
    expect(requests.some((request) => request.path === "/api/pipelines/flow-a/versions/1")).toBe(true);
    const tabs = screen.getByRole("tab", { name: "版本" });
    act(() => tabs.focus()); fireEvent.keyDown(tabs, { key: "ArrowLeft" });
    await waitFor(() => expect(router.state.location.search).toMatchObject({ view: "runs" }));
    client.clear();
  });

  it("remembers the selected run when checking the graph and restores directory filters on return", async () => {
    const { router, unmount } = mount("/pipelines?project_id=workspace-project&q=森林&page=2&status=failed");
    fireEvent.click(await screen.findByRole("link", { name: "森林视频流程" }));
    fireEvent.click(await screen.findByRole("tab", { name: "运行记录" }));
    const panel = await screen.findByRole("tabpanel", { name: "运行记录" });
    fireEvent.click(await within(panel).findByRole("link", { name: /run-a/ }));
    await screen.findByRole("region", { name: "运行详情" });
    fireEvent.click(screen.getByRole("tab", { name: "编排" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ view: "builder" }));
    fireEvent.click(screen.getByRole("tab", { name: "运行记录" }));
    await screen.findByRole("region", { name: "运行详情" });
    await waitFor(() => expect(router.state.location.search).toMatchObject({ runId: "run-a", view: "runs" }));
    fireEvent.click(screen.getByRole("link", { name: "流水线列表" }));
    await screen.findByRole("textbox", { name: "搜索流水线" });
    expect(router.state.location.search).toMatchObject({ q: "森林", page: 2, status: "failed" });
    unmount();
  });

  it("opens an active run instead of submitting a second run for the same version", async () => {
    runs = [runFixture("active-a", "flow-a", "running")];
    let submissions = 0;
    server.use(http.post("http://api.test/api/pipelines/flow-a/runs", () => { submissions++; return HttpResponse.error(); }));
    const { client, router } = mount("/pipelines?pipelineId=flow-a");
    fireEvent.click(await screen.findByRole("button", { name: "查看运行" }));
    await screen.findByRole("region", { name: "运行详情" });
    expect(router.state.location.search).toMatchObject({ pipelineId: "flow-a", runId: "active-a", view: "runs" });
    expect(submissions).toBe(0); client.clear();
  });

  it("double clicking creates one idempotent submission and a refreshed deep link finds that same run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const submissions: { idempotency_key: string }[] = [];
    server.use(http.post("http://api.test/api/pipelines/flow-a/runs", async ({ request }) => {
      expect(new URL(request.url).searchParams.get("project_id")).toBe("workspace-project");
      expect(request.headers.get("x-csrf-token")).toBe("workspace-csrf");
      const body = await request.json() as { idempotency_key: string };
      submissions.push(body); await gate;
      const run = runFixture("only-new-run", "flow-a", "pending"); runs = [run, ...runs]; return HttpResponse.json(run, { status: 202 });
    }));
    const view = mount("/pipelines?pipelineId=flow-a&project_id=workspace-project");
    const button = await screen.findByRole("button", { name: /^正式运行/ });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0].idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(button).toBeDisabled(); release();
    await screen.findByRole("region", { name: "运行详情" });
    const href = view.router.state.location.href; view.unmount();
    const refreshed = mount(href);
    await screen.findByRole("region", { name: "运行详情" });
    fireEvent.click(screen.getByRole("tab", { name: "编排" }));
    await screen.findByRole("button", { name: "查看运行" });
    expect(submissions).toHaveLength(1); refreshed.unmount();
  });

  it("reuses the same submission key after an uncertain error and page reload", async () => {
    const keys: string[] = [];
    const cacheValues: boolean[] = [];
    const targets: string[]=[];
    server.use(http.get("http://api.test/api/projects/workspace-project/environments",()=>HttpResponse.json([{id:"target-env",name:"对象执行环境",revision:1,status:"configured",worker_pools:[{id:"target-pool",name:"对象CPU池",status:"configured",resource_kind:"cpu",runtime:{status:"registered",cpu_arch:"arm64"}}]}])));
    server.use(http.post("http://api.test/api/pipelines/flow-a/runs", async ({ request }) => {
      const body = await request.json() as { idempotency_key: string; use_cache: boolean;environment_id:string;worker_pool_id:string };
      keys.push(body.idempotency_key); cacheValues.push(body.use_cache);targets.push(`${body.environment_id}/${body.worker_pool_id}`);
      if (keys.length === 1) return HttpResponse.json({ detail: "提交响应暂不可确认" }, { status: 503 });
      const run = runFixture("recovered-run", "flow-a", "pending"); runs = [run]; return HttpResponse.json(run, { status: 202 });
    }));
    const first = mount("/pipelines?pipelineId=flow-a&project_id=workspace-project");
    await screen.findByRole("button", { name: /^正式运行/ });
    fireEvent.click(screen.getByRole("button",{name:"执行环境 · 本地默认"}));
    await screen.findByRole("option",{name:"对象执行环境 · r1"});
    fireEvent.change(screen.getByLabelText("运行执行环境"),{target:{value:"target-env"}});
    fireEvent.change(screen.getByLabelText("运行 Worker 资源池"),{target:{value:"target-pool"}});
    fireEvent.click(screen.getByRole("button", { name: "更多流程操作" }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "复用节点缓存" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /^正式运行/ }));
    await screen.findByText("提交响应暂不可确认");
    await waitFor(() => expect(screen.getByRole("button", { name: /^重试同次提交/ })).toBeEnabled());
    expect(screen.getByRole("button", { name: "执行环境 · 已选择" })).toBeDisabled();
    first.unmount();
    const second = mount("/pipelines?pipelineId=flow-a&project_id=workspace-project");
    fireEvent.click(await screen.findByRole("button", { name: /^重试同次提交/ }));
    await screen.findByRole("region", { name: "运行详情" });
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); expect(cacheValues).toEqual([false, false]);expect(targets).toEqual(["target-env/target-pool","target-env/target-pool"]); second.unmount();
  });

  it("waits for the version's run status and blocks submission when that read fails", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let failed = true;
    server.use(http.get("http://api.test/api/pipeline-runs", async () => { await gate; return failed ? HttpResponse.json({ detail: "运行状态暂不可用" }, { status: 503 }) : HttpResponse.json([runFixture("existing-active", "flow-a", "running")]); }));
    const { client } = mount("/pipelines?pipelineId=flow-a");
    expect(await screen.findByRole("button", { name: "读取运行状态…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^正式运行/ })).not.toBeInTheDocument();
    release();
    expect(await screen.findByRole("button", { name: "运行状态不可用" })).toBeDisabled();
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "重试读取运行状态" }));
    await screen.findByRole("button", { name: "查看运行" }); client.clear();
  });

  it("opens the video creation route without creating or running anything until explicitly requested", async () => {
    let creations = 0;
    server.use(http.post("http://api.test/api/media/demo-pipeline", async ({ request }) => { creations++; expect(await request.json()).toEqual({ urls: ["https://www.youtube.com/watch?v=fixture"] }); return HttpResponse.json({ ...pipeline(), pipeline_id: "flow-a" }); }));
    const { client, router } = mount("/pipelines?view=new&template=video&project_id=workspace-project");
    await screen.findByRole("button", { name: "创建视频处理流程" });
    expect(creations).toBe(0);
    fireEvent.change(screen.getByLabelText("示例视频链接"), { target: { value: "https://www.youtube.com/watch?v=fixture" } });
    fireEvent.click(screen.getByRole("button", { name: "创建视频处理流程" }));
    await screen.findByRole("tab", { name: "编排" });
    expect(creations).toBe(1); expect(router.state.location.search).toMatchObject({ pipelineId: "flow-a", view: "builder" }); client.clear();
  });

  it("enables an installed plugin through the independent operator library", async () => {
    let registered = false;
    server.use(http.get("http://api.test/api/operator-plugins", () => HttpResponse.json([{ id: "media.video", name: "视频插件", description: "已安装测试包", version: "1", registered, operators: [operator] }])), http.post("http://api.test/api/operator-plugins/register", async ({ request }) => { expect(await request.json()).toEqual({ plugin_id: "media.video" }); expect(new URL(request.url).searchParams.get("project_id")).toBe("workspace-project"); registered = true; return HttpResponse.json({ registered: true }); }));
    const { client } = mount("/operators?project_id=workspace-project");
    await screen.findByRole("heading", { name: "算子与插件" });
    fireEvent.click(screen.getByRole("button", { name: "启用插件" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "启用到项目" }));
    await within(dialog).findByText("项目已启用"); expect(registered).toBe(true); client.clear();
  });
  it("distinguishes failed directory loading from a first-time empty project and retries", async () => {
    let fail = true;
    server.use(http.get("http://api.test/api/pipelines", () => fail ? HttpResponse.json({ detail: "流水线目录不可用" }, { status: 503 }) : HttpResponse.json({ items: [pipeline()], total: 1, offset: 0, limit: 20, has_more: false })));
    const { client } = mount();
    await screen.findByText("流水线目录不可用");
    expect(screen.queryByRole("heading", { name: "创建第一条流水线" })).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重新读取流水线" }));
    await screen.findByRole("link", { name: "森林视频流程" });
    client.clear();
  });

  it("clears unmatched pipeline directory filters through the empty state", async () => {
    const { client, router } = mount("/pipelines?project_id=workspace-project&q=不存在&status=failed");
    await screen.findByRole("heading", { name: "没有符合条件的流水线" });
    fireEvent.click(screen.getByRole("link", { name: "查看全部流水线" }));
    await screen.findByRole("link", { name: "森林视频流程" });
    expect(router.state.location.search).not.toHaveProperty("q");
    expect(router.state.location.search).not.toHaveProperty("status");
    client.clear();
  });

  it("offers plugin activation beside the empty operator library and clears unmatched filters", async () => {
    server.use(http.get("http://api.test/api/operators", () => HttpResponse.json([])));
    const view = mount("/operators?project_id=workspace-project");
    await screen.findByRole("heading", { name: "当前项目尚未启用算子" });
    fireEvent.click(screen.getByRole("button", { name: "选择插件并启用" }));
    await screen.findByRole("dialog", { name: "启用插件到项目" });
    fireEvent.click(screen.getByRole("button", { name: "关闭插件启用窗口" }));
    fireEvent.change(screen.getByLabelText("搜索算子"), { target: { value: "不存在" } });
    await screen.findByRole("heading", { name: "没有匹配的算子" });
    fireEvent.click(screen.getByRole("button", { name: "清除算子筛选" }));
    expect(screen.getByLabelText("搜索算子")).toHaveValue("");
    await screen.findByRole("heading", { name: "当前项目尚未启用算子" });
    view.unmount();
  });

});
