import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineExecutionPlan } from "../pipelines-api";
import { server } from "../test/server";
import { PipelineDebugControls } from "./PipelineDebugControls";

const plan: PipelineExecutionPlan = {
  mode: "debug", version: 3, targets: ["filter"], node_ids: ["documents", "filter"],
  graph: { nodes: [] }, semantic_digest: "semantic-fingerprint", plan_digest: "fixed-plan-fingerprint",
  sample: { fixed: true, limit: 20, sources: [{ node_id: "documents", record_ids: ["sample-1"], record_count: 1, content_hash: "input-fingerprint" }] }, warnings: [], blocked: [],
};
const props = { projectId: "project-a", pipelineId: "pipeline-a", version: 3, nodeId: "filter", csrf: "csrf-a", target: { environment_id: "local" }, useCache: true, onRunCreated: vi.fn() };
function mount(overrides: Partial<typeof props> & { disabledReason?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const content = (values: typeof props & { disabledReason?: string }) => <QueryClientProvider client={client}><PipelineDebugControls {...values} /></QueryClientProvider>;
  const view = render(content({ ...props, ...overrides }));
  return { ...view, change: (values: Partial<typeof props> & { disabledReason?: string }) => view.rerender(content({ ...props, ...overrides, ...values })), client };
}
beforeEach(() => { vi.stubEnv("VITE_API_BASE_URL", "http://api.test"); sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("saved version target debugging", () => {
  it("preflights the selected dependency closure and submits its exact digest and fixed sample", async () => {
    let submitted: Record<string, unknown> | undefined;
    server.use(
      http.post("http://api.test/api/projects/project-a/pipelines/pipeline-a/run-plan", async ({ request }) => {
        expect(request.headers.get("x-csrf-token")).toBe("csrf-a");
        expect(await request.json()).toEqual({ version: 3, mode: "debug", targets: ["filter"], sample_limit: 20, environment_id: "local", use_cache: true });
        return HttpResponse.json(plan);
      }),
      http.post("http://api.test/api/pipelines/pipeline-a/runs", async ({ request }) => {
        expect(new URL(request.url).searchParams.get("project_id")).toBe("project-a");
        submitted = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ id: "debug-run", mode: "debug", execution_plan: plan });
      }),
    );
    const view = mount();
    expect(screen.getByRole("button", { name: "运行到此节点" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "预检调试计划" }));
    await screen.findByText("依赖顺序：documents → filter");
    expect(screen.getByText("固定输入 · documents · 1 条")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "运行到此节点" }));
    await waitFor(() => expect(props.onRunCreated).toHaveBeenCalledTimes(1));
    expect(submitted).toMatchObject({ version: 3, mode: "debug", targets: ["filter"], sample_limit: 20, use_cache: true, plan_digest: plan.plan_digest, environment_id: "local" });
    expect(typeof submitted?.idempotency_key).toBe("string"); view.client.clear();
  });

  it("blocks a dirty draft and reports why without preflighting the unsaved graph", () => {
    const view = mount({ disabledReason: "有未保存的修改，请先保存版本。" });
    expect(screen.getByText("有未保存的修改，请先保存版本。")).toBeVisible();
    expect(screen.getByRole("button", { name: "预检调试计划" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "运行到此节点" })).toBeDisabled(); view.client.clear();
  });

  it("preflights and runs with the same explicit disabled cache setting", async () => {
    server.use(
      http.post("http://api.test/api/projects/project-a/pipelines/pipeline-a/run-plan", async ({ request }) => {
        expect(await request.json()).toMatchObject({ use_cache: false }); return HttpResponse.json(plan);
      }),
      http.post("http://api.test/api/pipelines/pipeline-a/runs", async ({ request }) => {
        expect(await request.json()).toMatchObject({ use_cache: false, plan_digest: plan.plan_digest }); return HttpResponse.json({ id: "uncached-debug" });
      }),
    );
    const view = mount({ useCache: false }); fireEvent.click(screen.getByRole("button", { name: "预检调试计划" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "运行到此节点" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "运行到此节点" })); await waitFor(() => expect(props.onRunCreated).toHaveBeenCalledTimes(1)); view.client.clear();
  });

  it("invalidates preflight on target change and ignores a late response from the old target", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post("http://api.test/api/projects/project-a/pipelines/pipeline-a/run-plan", async () => { await gate; return HttpResponse.json(plan); }));
    const view = mount(); fireEvent.click(screen.getByRole("button", { name: "预检调试计划" }));
    view.change({ nodeId: "other" }); release();
    await waitFor(() => expect(screen.getByRole("button", { name: "预检调试计划" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "运行到此节点" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "不可变执行计划" })).not.toBeInTheDocument(); view.client.clear();
  });

  it("shows backend rejection reasons instead of permitting execution", async () => {
    server.use(http.post("http://api.test/api/projects/project-a/pipelines/pipeline-a/run-plan", () => HttpResponse.json({ detail: { message: "调试计划不可执行", errors: ["source：媒体输入暂不支持小样本调试"] } }, { status: 422 })));
    const view = mount(); fireEvent.click(screen.getByRole("button", { name: "预检调试计划" }));
    await screen.findByRole("alert"); expect(screen.getByRole("alert")).toHaveTextContent("媒体输入暂不支持小样本调试");
    expect(screen.getByRole("button", { name: "运行到此节点" })).toBeDisabled(); view.client.clear();
  });

  it("retries uncertain submission with the original idempotency key and options", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post("http://api.test/api/projects/project-a/pipelines/pipeline-a/run-plan", () => HttpResponse.json(plan)),
      http.post("http://api.test/api/pipelines/pipeline-a/runs", async ({ request }) => {
        bodies.push(await request.json() as Record<string, unknown>);
        return bodies.length === 1 ? HttpResponse.json({ detail: "提交响应超时" }, { status: 503 }) : HttpResponse.json({ id: "same-debug-run" });
      }),
    );
    const view = mount(); fireEvent.click(screen.getByRole("button", { name: "预检调试计划" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "运行到此节点" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "运行到此节点" }));
    await screen.findByRole("button", { name: "重试同次调试提交" });
    expect(screen.getByRole("spinbutton", { name: "调试样本条数" })).toBeDisabled();
    view.change({ nodeId: "other", target: { environment_id: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "重试同次调试提交" }));
    await waitFor(() => expect(props.onRunCreated).toHaveBeenCalledTimes(1));
    expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]); view.client.clear();
  });
});
