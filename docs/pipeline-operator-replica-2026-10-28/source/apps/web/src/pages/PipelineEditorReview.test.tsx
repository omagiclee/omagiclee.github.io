import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorManifest, Pipeline, PipelineGraph } from "../pipelines-api";
import { server } from "../test/server";
import PipelinesPage from "./PipelinesPage";

const auth = vi.hoisted(() => ({ projects: [] as string[] }));
vi.mock("../auth-context", () => ({
  useAuth: () => ({ me: { user: { id: "review-user" }, scope: { type: "project", id: "default-project" } }, can: () => false }),
  useProjectAuth: (projectId: string) => { auth.projects.push(projectId); return { me: { user: { id: "review-user" }, scope: { type: "project", id: projectId }, csrf_token: "review-csrf" }, can: () => projectId === "review-project" }; },
}));
vi.mock("../components/PipelineCanvas", async () => ({
  ...(await vi.importActual<typeof import("../components/PipelineCanvas")>("../components/PipelineCanvas")),
  PipelineCanvas: ({ graph, onSelect }: { graph: PipelineGraph; onSelect: (id: string) => void }) => <div><output data-testid="current-graph">{JSON.stringify(graph)}</output>{graph.nodes.map((node) => <button key={node.id} onClick={() => onSelect(node.id)}>配置 {node.id}</button>)}</div>,
}));

const source: OperatorManifest = { id: "test.source", version: "1", name: "测试接入", plugin_id: "test", description: "测试参数契约", kind: "source", input_type: null, output_type: "video_assets", config_schema: { type: "object", properties: {} }, default_config: {}, deterministic: true, side_effects: false, implementation_digest: "fixture" };
function definition(version: number): Pipeline {
  return { id: "review-flow", version, name: `流程 v${version}`, description: "Review regression", graph: { nodes: [{ id: "source", operator: source.id, version: source.version, config: { marker: version }, inputs: {} }] }, created_at: "2026-09-15T01:00:00Z", updated_at: "2026-09-15T01:00:00Z" };
}
const graphValue = () => JSON.parse(screen.getByTestId("current-graph").textContent!) as PipelineGraph;
const clients: QueryClient[] = [];
function mount(cached?: Pipeline, initialPath = "/pipelines?project_id=review-project&pipelineId=review-flow&view=builder") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  if (cached) client.setQueryData(["pipeline", "review-project", "review-flow"], cached);
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({ getParentRoute: () => root, path: "/pipelines", validateSearch: (search: Record<string, unknown>) => search, component: PipelinesPage });
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [initialPath] }) });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return client;
}

describe("pipeline editor review regressions (isolated MSW API)", () => {
  let latest: Pipeline;
  let catalog: OperatorManifest[];
  let saved: Record<string, unknown>[];
  beforeEach(() => {
    latest = definition(1); catalog = [source]; saved = []; auth.projects.length = 0;
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test"); sessionStorage.clear(); vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    server.use(
      http.get("http://api.test/api/pipelines/review-flow", () => HttpResponse.json(latest)),
      http.get("http://api.test/api/pipelines", () => HttpResponse.json([latest])),
      http.get("http://api.test/api/operators", () => HttpResponse.json(catalog)),
      http.get("http://api.test/api/pipeline-runs", () => HttpResponse.json([])),
      http.post("http://api.test/api/pipelines/review-flow/versions", async ({ request }) => {
        const body = await request.json() as Record<string, unknown>; saved.push(body);
        latest = { ...latest, ...body, version: Number(body.expected_version) + 1 } as Pipeline;
        return HttpResponse.json(latest, { status: 201 });
      }),
    );
  });
  afterEach(() => { cleanup(); for (const client of clients.splice(0)) client.clear(); vi.unstubAllEnvs(); });

  it("refreshes a cached clean graph and submits the exact version shown on the button", async () => {
    latest = definition(2);
    let submitted: Record<string, unknown> | undefined;
    server.use(http.post("http://api.test/api/pipelines/review-flow/runs", async ({ request }) => { submitted = await request.json() as Record<string, unknown>; return HttpResponse.json({ detail: "test stops before any execution" }, { status: 503 }); }));
    mount(definition(1));
    const start = await screen.findByRole("button", { name: "正式运行 · v2" });
    expect(graphValue().nodes[0].config.marker).toBe(2);
    await waitFor(() => expect(start).toBeEnabled()); fireEvent.click(start);
    await waitFor(() => expect(submitted?.version).toBe(2));
    expect(auth.projects.every((project) => project === "review-project")).toBe(true);
  });

  it("preserves dirty content on a version conflict and explicitly rebases the next save", async () => {
    const client = mount();
    fireEvent.click(await screen.findByRole("button", { name: "添加算子 测试接入 v1" }));
    expect(graphValue().nodes).toHaveLength(2);
    latest = definition(2);
    await act(() => client.invalidateQueries({ queryKey: ["pipeline", "review-project", "review-flow"] }));
    await screen.findByText(/正在编辑 v1，已有最新版 v2/);
    expect(graphValue().nodes[0].config.marker).toBe(1);
    expect(screen.getByRole("button", { name: "保存版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保留草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].expected_version).toBe(2);
    expect((saved[0].graph as PipelineGraph).nodes).toHaveLength(2);
  });

  it("can replace a dirty draft with the latest version and clear its undo history", async () => {
    const client = mount();
    fireEvent.click(await screen.findByRole("button", { name: "添加算子 测试接入 v1" }));
    latest = definition(2);
    await act(() => client.invalidateQueries({ queryKey: ["pipeline", "review-project", "review-flow"] }));
    fireEvent.click(await screen.findByRole("button", { name: "加载最新版" }));
    expect(graphValue().nodes).toHaveLength(1);
    expect(graphValue().nodes[0].config.marker).toBe(2);
    expect(screen.getByRole("button", { name: "撤销流程修改" })).toBeDisabled();
  });

  it("fetches the latest baseline after a save conflict without losing the draft", async () => {
    server.use(http.post("http://api.test/api/pipelines/review-flow/versions", () => {
      latest = definition(2); return HttpResponse.json({ detail: "Pipeline 已更新" }, { status: 409 });
    }));
    mount(); fireEvent.click(await screen.findByRole("button", { name: "添加算子 测试接入 v1" }));
    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
    await screen.findByText(/正在编辑 v1，已有最新版 v2/);
    expect(graphValue().nodes).toHaveLength(2);
    expect(screen.getByRole("button", { name: "保留草稿" })).toBeEnabled();
  });

  it("edits referenced integer and enum parameters with their correct JSON types", async () => {
    catalog = [{ ...source, config_schema: { type: "object", $defs: {
      count: { type: "integer", minimum: 1, title: "数量" }, mode: { type: "string", enum: ["fast", "accurate"], title: "运行模式" },
    }, properties: { count: { $ref: "#/$defs/count" }, mode: { $ref: "#/$defs/mode" } }, required: ["count"] }, default_config: { count: 3, mode: "fast" } }];
    latest.graph.nodes[0].config = { count: 3, mode: "fast" };
    mount(); fireEvent.click(await screen.findByRole("button", { name: "配置 source" }));
    fireEvent.change(await screen.findByRole("spinbutton", { name: "数量" }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("combobox", { name: "运行模式" }), { target: { value: "accurate" } });
    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0].graph as PipelineGraph).nodes[0].config).toEqual({ count: 5, mode: "accurate" });
  });

  it("provides full JSON editing for nested or combined schemas", async () => {
    catalog = [{ ...source, config_schema: { oneOf: [{ properties: { nested: { type: "object" } } }, { properties: { other: { type: "string" } } }] } }];
    mount(); fireEvent.click(await screen.findByRole("button", { name: "配置 source" }));
    fireEvent.click(await screen.findByRole("button", { name: "使用 JSON 编辑" }));
    fireEvent.change(screen.getByLabelText("完整配置JSON"), { target: { value: "[]" } });
    expect(screen.getByText("完整配置必须是 JSON 对象。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存版本" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("完整配置JSON"), { target: { value: '{"nested":{"threshold":0.4,"enabled":true}}' } });
    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0].graph as PipelineGraph).nodes[0].config).toEqual({ nested: { threshold: .4, enabled: true } });
  });

  it("disables incompatible and cyclic upstream choices and rejects bypassed DOM changes", async () => {
    const cut = { ...source, id: "test.cut", kind: "transform", input_type: "video_assets", output_type: "shot_assets" };
    const label = { ...source, id: "test.label", kind: "transform", input_type: "shot_assets", output_type: "shot_assets" };
    catalog = [source, cut, label];
    latest.graph.nodes.push(
      { id: "cut", operator: cut.id, version: "1", config: {}, inputs: { data: "source" } },
      { id: "label", operator: label.id, version: "1", config: {}, inputs: { data: "cut" } },
      { id: "downstream", operator: label.id, version: "1", config: {}, inputs: { data: "label" } },
    );
    mount(); fireEvent.click(await screen.findByRole("button", { name: "配置 label" }));
    const upstream = await screen.findByRole("combobox", { name: "上游节点" });
    expect(screen.getByRole("option", { name: /source · 类型不匹配/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /downstream · 这条连接会形成循环/ })).toBeDisabled();
    fireEvent.change(upstream, { target: { value: "source" } });
    expect(graphValue().nodes.find((node) => node.id === "label")!.inputs.data).toBe("cut");
    await screen.findByRole("alert");
  });

  it("edits each named port independently, enforces its type, and saves complete inputs", async () => {
    const shots = { ...source, id: "test.shots", name: "镜头源", output_type: "shot_assets" };
    const merge = { ...source, id: "test.merge", name: "多输入合并", kind: "transform", input_type: null,
      input_ports: { video: "video_assets", shots: "shot_assets" }, output_type: "shot_assets",
      deterministic: false, retry_safe: true, cacheable: false };
    catalog = [source, shots, merge];
    latest.graph.nodes.push({ ...latest.graph.nodes[0], id: "other_video" },
      { id: "shots", operator: shots.id, version: "1", config: {}, inputs: {} },
      { id: "merge", operator: merge.id, version: "1", config: {}, inputs: { video: "source", shots: "shots" } });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "配置 merge" }));
    const video = await screen.findByRole("combobox", { name: "上游节点 · video" });
    const shotPort = screen.getByRole("combobox", { name: "上游节点 · shots" });
    expect(video).toHaveValue("source"); expect(shotPort).toHaveValue("shots");
    expect(video.querySelector('option[value="shots"]')).toBeDisabled();
    expect(shotPort.querySelector('option[value="source"]')).toBeDisabled();
    fireEvent.change(video, { target: { value: "other_video" } });
    expect(graphValue().nodes.at(-1)?.inputs).toEqual({ video: "other_video", shots: "shots" });
    fireEvent.change(shotPort, { target: { value: "source" } });
    expect(graphValue().nodes.at(-1)?.inputs).toEqual({ video: "other_video", shots: "shots" });
    expect(await screen.findByRole("alert")).toHaveTextContent("类型不匹配");
    fireEvent.change(video, { target: { value: "" } });
    expect(graphValue().nodes.at(-1)?.inputs).toEqual({ shots: "shots" });
    fireEvent.change(video, { target: { value: "source" } });
    expect(screen.getByText("每次重新计算 · 失败后可自动重试")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0].graph as PipelineGraph).nodes.at(-1)?.inputs).toEqual({ video: "source", shots: "shots" });
  });

  it("autoconnects only a compatible named port and respects explicit cache/retry flags", async () => {
    const merge = { ...source, id: "test.merge", name: "多输入合并", kind: "transform", input_type: null,
      input_ports: { shots: "shot_assets", video: "video_assets" }, output_type: "shot_assets",
      deterministic: true, retry_safe: false, cacheable: true };
    catalog = [source, merge];
    mount(); fireEvent.click(await screen.findByRole("button", { name: "配置 source" }));
    fireEvent.click(screen.getByRole("button", { name: "算子" }));
    fireEvent.click(screen.getByRole("button", { name: "添加算子 多输入合并 v1" }));
    expect(graphValue().nodes.at(-1)?.inputs).toEqual({ video: "source" });
    expect(screen.getByRole("combobox", { name: "上游节点 · shots" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "上游节点 · video" })).toHaveValue("source");
    expect(screen.getByText("支持结果缓存 · 失败后需确认再重试")).toBeVisible();
    expect(screen.getByText(/请继续连接其他输入端口/)).toBeVisible();
  });

  it("keeps invalid JSON visible when switching to the form and offers an explicit recovery", async () => {
    catalog = [{ ...source, config_schema: { type: "object", properties: { count: { type: "integer", title: "数量" } } } }];
    latest.graph.nodes[0].config = { count: 3 };
    mount(); fireEvent.click(await screen.findByRole("button", { name: "配置 source" }));
    fireEvent.click(screen.getByRole("button", { name: "使用 JSON 编辑" }));
    fireEvent.change(screen.getByLabelText("完整配置JSON"), { target: { value: "{" } });
    expect(screen.getByLabelText("完整配置JSON")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("完整配置JSON")).toHaveAccessibleDescription("请输入合法的 JSON，保存前需修正。");
    fireEvent.click(screen.getByRole("button", { name: "使用参数表单" }));
    expect(screen.getByText(/JSON 尚未有效/)).toBeVisible();
    expect(screen.getByLabelText("完整配置JSON")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "丢弃无效文本并返回表单" }));
    expect(screen.getByRole("spinbutton", { name: "数量" })).toHaveValue(3);
    expect(screen.getByRole("button", { name: "保存版本" })).toBeDisabled();
    expect(screen.getByText("已保存 · v1")).toBeVisible();
    expect(screen.queryByText("有未保存的修改")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "数量" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0].graph as PipelineGraph).nodes[0].config.count).toBe(4);
  });

  it("keeps genuine edits dirty when discarding a later invalid JSON attempt", async () => {
    catalog = [{ ...source, config_schema: { type: "object", properties: { count: { type: "integer", title: "数量" } } } }];
    latest.graph.nodes[0].config = { count: 3 };
    mount(); fireEvent.click(await screen.findByRole("button", { name: "配置 source" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "数量" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "使用 JSON 编辑" }));
    fireEvent.change(screen.getByLabelText("完整配置JSON"), { target: { value: "{" } });
    expect(screen.getByLabelText("完整配置JSON")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("完整配置JSON")).toHaveAccessibleDescription("请输入合法的 JSON，保存前需修正。");
    fireEvent.click(screen.getByRole("button", { name: "使用参数表单" }));
    fireEvent.click(screen.getByRole("button", { name: "丢弃无效文本并返回表单" }));
    expect(screen.getByRole("spinbutton", { name: "数量" })).toHaveValue(4);
    expect(screen.getByText("有未保存的修改")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0].graph as PipelineGraph).nodes[0].config.count).toBe(4);
  });

  it("preserves another node's uncommitted JSON when discarding the selected node's invalid text", async () => {
    latest.graph.nodes.push({ ...latest.graph.nodes[0], id: "source_2" });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "配置 source" }));
    fireEvent.click(screen.getByRole("button", { name: "使用 JSON 编辑" }));
    fireEvent.change(screen.getByLabelText("完整配置JSON"), { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "配置 source_2" }));
    fireEvent.change(screen.getByLabelText("完整配置JSON"), { target: { value: "[" } });
    fireEvent.click(screen.getByRole("button", { name: "使用参数表单" }));
    fireEvent.click(screen.getByRole("button", { name: "丢弃无效文本并返回表单" }));
    expect(screen.getByText("有未保存的修改")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "修正 source · 完整 JSON" }));
    expect(screen.getByLabelText("完整配置JSON")).toHaveValue("{");
  });

  it("gives node parameters priority over the palette in a compact workspace", async () => {
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 976, height: 700, x: 0, y: 0, top: 0, left: 0, right: 976, bottom: 700, toJSON: () => ({}) });
    try {
      mount();
      const palette = await screen.findByRole("complementary", { name: "算子选择器" });
      expect(palette).toBeVisible();
      expect(screen.getByRole("button", { name: "算子" })).toHaveAttribute("aria-controls", palette.id);
      fireEvent.click(await screen.findByRole("button", { name: "配置 source" }));
      expect(screen.getByRole("complementary", { name: "节点配置" })).toBeVisible();
      expect(screen.queryByRole("complementary", { name: "算子选择器" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "算子" }));
      expect(screen.getByRole("complementary", { name: "算子选择器" })).toBeVisible();
      expect(screen.queryByRole("complementary", { name: "节点配置" })).not.toBeInTheDocument();
    } finally { measure.mockRestore(); }
  });

  it("keeps the complete long resource name as the heading, separate from the edit action", async () => {
    const name = "跨区域数据加工与质量检查流水线—".repeat(5);
    latest.name = name;
    mount();
    const heading = await screen.findByRole("heading", { level: 1, name });
    expect(heading).toHaveTextContent(name);
    expect(heading.querySelector("button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "修改流程名称" }));
    expect(await screen.findByRole("textbox", { name: "流程名称" })).toHaveValue(name);
  });

  it("opens naming directly from the flow heading", async () => {
    mount(); fireEvent.click(await screen.findByRole("button", { name: "修改流程名称" }));
    expect(await screen.findByRole("textbox", { name: "流程名称" })).toHaveValue("流程 v1");
    fireEvent.change(screen.getByRole("textbox", { name: "流程名称" }), { target: { value: "清晰的名称" } });
    fireEvent.click(screen.getByRole("button", { name: "应用到草稿" }));
    expect(screen.getByRole("button", { name: "保存版本" })).toBeEnabled();
  });

  it("seeds the exact enabled operator once and asks for a name before the first save", async () => {
    mount(undefined, "/pipelines?project_id=review-project&view=new&operator_id=test.source&operator_version=1");
    await screen.findByText(/已添加 测试接入 v1/);
    expect(graphValue().nodes).toHaveLength(1);
    expect(graphValue().nodes[0]).toMatchObject({ operator: source.id, version: "1" });
    expect(screen.getByRole("textbox", { name: "流程名称" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存版本" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "流程名称" }), { target: { value: "新流程" } });
    expect(graphValue().nodes).toHaveLength(1);
    expect(screen.getByRole("button", { name: "保存版本" })).toBeEnabled();
  });

  it("undoes and redoes node additions and deletion without losing dependencies", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "添加算子 测试接入 v1" }));
    expect(graphValue().nodes).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "撤销流程修改" }));
    expect(graphValue().nodes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "重做流程修改" }));
    expect(graphValue().nodes).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "配置 source_2" }));
    fireEvent.click(screen.getByRole("button", { name: "删除节点 source_2" }));
    expect(graphValue().nodes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "撤销流程修改" }));
    expect(graphValue().nodes).toHaveLength(2);
  });

  it("leaves a new processing node disconnected when no upstream was selected", async () => {
    const cut: OperatorManifest = { ...source, id: "test.cut", name: "镜头切分", kind: "transform", input_type: "video_assets", output_type: "shot_assets" };
    catalog = [source, cut];
    latest.graph.nodes.push({ ...latest.graph.nodes[0], id: "source_2" });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "添加算子 镜头切分 v1" }));
    expect(graphValue().nodes.find((node) => node.id === "cut")!.inputs).toEqual({});
    expect(screen.getByText(/尚未连接输入。请从画布连线或在参数中选择上游节点/)).toBeVisible();
  });

  it("connects a new processing node to the selected compatible source, not the last source", async () => {
    const cut: OperatorManifest = { ...source, id: "test.cut", name: "镜头切分", kind: "transform", input_type: "video_assets", output_type: "shot_assets" };
    catalog = [source, cut];
    latest.graph.nodes.push({ ...latest.graph.nodes[0], id: "source_2" });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "配置 source" }));
    fireEvent.click(screen.getByRole("button", { name: "算子" }));
    fireEvent.click(screen.getByRole("button", { name: "添加算子 镜头切分 v1" }));
    expect(graphValue().nodes.find((node) => node.id === "cut")!.inputs).toEqual({ data: "source" });
    expect(screen.getByText(/输入连接到选中的节点 source/)).toBeVisible();
  });

  it("does not connect a new node to a selected output operator even if its output type matches", async () => {
    const sink: OperatorManifest = { ...source, id: "test.sink", name: "数据输出", kind: "sink" };
    const cut: OperatorManifest = { ...source, id: "test.cut", name: "镜头切分", kind: "transform", input_type: "video_assets", output_type: "shot_assets" };
    catalog = [source, sink, cut];
    latest.graph.nodes.push({ id: "sink", operator: sink.id, version: "1", config: {}, inputs: {} });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "配置 sink" }));
    fireEvent.click(screen.getByRole("button", { name: "算子" }));
    fireEvent.click(screen.getByRole("button", { name: "添加算子 镜头切分 v1" }));
    expect(graphValue().nodes.find((node) => node.id === "cut")!.inputs).toEqual({});
    expect(screen.getByText(/尚未连接输入/)).toBeVisible();
  });

  it("paginates the directory from the URL and sends search/status filters to the server", async () => {
    const queries: URLSearchParams[] = [];
    const flows = Array.from({ length: 21 }, (_, index) => ({ ...definition(1), id: `flow-${index}`, name: index === 0 ? "目标流程" : `流程 ${index}`, latest_run: { id: `run-${index}`, status: index === 0 ? "failed" : "succeeded" } }));
    server.use(http.get("http://api.test/api/pipelines", ({ request }) => {
      const params = new URL(request.url).searchParams; queries.push(params);
      const offset = Number(params.get("offset")), limit = Number(params.get("limit"));
      const filtered = flows.filter((item) => (!params.get("q") || item.name.includes(params.get("q")!)) && (!params.get("status") || item.latest_run.status === params.get("status")));
      return HttpResponse.json({ items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit, has_more: offset + limit < filtered.length });
    }));
    mount(undefined, "/pipelines?project_id=review-project&page=2");
    await screen.findByRole("link", { name: "流程 20" });
    expect(screen.getByText("共 21 条 · 第 2 页")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await screen.findByRole("link", { name: "目标流程" });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索流水线" }), { target: { value: "目标" } });
    await screen.findByText("共 1 条 · 第 1 页");
    fireEvent.click(screen.getByRole("button", { name: "筛选最近运行状态" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "失败" }));
    await waitFor(() => expect(queries.at(-1)?.get("status")).toBe("failed"));
    expect(queries[0].get("offset")).toBe("20");
    expect(queries.at(-1)?.get("offset")).toBe("0");
    expect(queries.at(-1)?.get("q")).toBe("目标");
    expect(queries.every((params) => params.get("paginated") === "true" && params.get("project_id") === "review-project")).toBe(true);
  });

  it("filters old-version history on the server before pagination and preserves its run link", async () => {
    latest = { ...definition(2), versions: [{ version: 2, name: "最新版", created_at: latest.created_at }, { version: 1, name: "旧版", created_at: latest.created_at }] };
    const queries: URLSearchParams[] = [];
    const runs = Array.from({ length: 21 }, (_, index) => ({ id: `old-run-${index}`, pipeline_id: latest.id, pipeline_name: latest.name, pipeline_version: 1, status: "failed", created_at: latest.created_at, finished_at: null, error: "测试失败", tasks: [], artifacts: [] }));
    server.use(http.get("http://api.test/api/pipeline-runs", ({ request }) => {
      const params = new URL(request.url).searchParams;
      if (params.get("paginated") !== "true") return HttpResponse.json([]);
      queries.push(params); const offset = Number(params.get("offset")), limit = Number(params.get("limit"));
      return HttpResponse.json({ items: runs.slice(offset, offset + limit), total: runs.length, offset, limit, has_more: offset + limit < runs.length });
    }));
    mount(undefined, "/pipelines?project_id=review-project&pipelineId=review-flow&view=runs&version=1&status=failed&page=2");
    await screen.findByText("old-run-");
    expect(screen.getByText("共 21 条 · 第 2 页")).toBeInTheDocument();
    const runLink = screen.getByRole("link", { name: /v1/ });
    expect(runLink.getAttribute("href")).toContain("runId=old-run-20");
    expect(runLink.getAttribute("href")).toContain("page=2");
    expect(queries[0].get("pipeline_version")).toBe("1");
    expect(queries[0].get("status")).toBe("failed");
    expect(queries[0].get("offset")).toBe("20");
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(queries.at(-1)?.get("offset")).toBe("0"));
  });
});
