import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import type { MediaEvaluation } from "../media-evaluation-api";
import { MediaEvaluationPanel } from "./MediaEvaluationPanel";

const access = vi.hoisted(() => ({ denied: [] as string[] }));
vi.mock("../auth-context", () => ({ useProjectAuth: () => ({ me: { csrf_token: "test-csrf" }, can: (permission: string) => !access.denied.includes(permission) }) }));
const session = (searchId: string, profile = "baseline") => ({ searchId, label: "森林", input: { mode: "text" as const, query: "森林", limit: 24, retrieval_profile: "baseline" as const }, profile });
const fixture = (): MediaEvaluation => ({
  id: "evaluation", name: "森林基准", status: "unreviewed", revision: 1, candidate_count: 2, judged_count: 0, reviewed: false, scheme_count: 1, created_at: "2026-10-13T00:00:00+00:00",
  query: { mode: "text", query: "森林", limit: 24 }, candidate_snapshot_id: "snapshot", k: 5, review_source: null, metrics_kind: "not_evaluated", metrics: null, drift: [], failures: [],
  candidates: ["a", "b"].map((id, index) => ({ id, video_id: "video", video_title: `镜头${index + 1}`, start_ms: 0, end_ms: 1000, duration_ms: 1000, person_status: "unknown" as const, index_state: "ready", keyframe_url: null, video_url: null, mask_url: null, score: null, matched_frame_id: null, frame_count: 1, grade: null })),
  schemes: [{ search_id: "real-a", label: "基础检索", retrieval: { profile: "baseline" }, items: ["a", "b"] }],
});
const metrics = () => [{ search_id: "real-a", label: "基础检索", report: { k: 5, queries: [{ precision_at_k: 0.2, recall_at_k: 1, ndcg_at_k: 1, judged_fraction: 0.5, elapsed_ms: 43, known_relevant: 1, evaluated: 2, unjudged_returned: ["b"] }] } }];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MediaEvaluationPanel projectId="demo" currentSearch={session("real-a")} disabled={false} /></QueryClientProvider>);
  return { client, rerender: (id: string) => view.rerender(<QueryClientProvider client={client}><MediaEvaluationPanel projectId="demo" currentSearch={session(id, "multimodal")} disabled={false} /></QueryClientProvider>) };
}
async function openSaved() {
  fireEvent.click(screen.getByRole("button", { name: "检索质量评测" }));
  fireEvent.change(await screen.findByLabelText("已有评测基准"), { target: { value: "evaluation" } });
  await screen.findByRole("heading", { name: "森林基准" });
}
describe("media evaluation workbench with isolated API fixtures", () => {
  let current: MediaEvaluation;
  beforeEach(() => {
    access.denied = []; current = fixture(); vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(
      http.get("http://api.test/api/media/evaluations", () => HttpResponse.json({ items: [current] })),
      http.get("http://api.test/api/media/evaluations/evaluation", () => HttpResponse.json(current)),
      http.get("http://api.test/api/media/reflows", () => HttpResponse.json({ items: [] })),
    );
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
  it("freezes two real sessions and retains the benchmark while another search is run", async () => {
    let body: unknown;
    server.use(http.post("http://api.test/api/media/evaluations", async ({ request }) => { body = await request.json(); return HttpResponse.json(current); }));
    const { client, rerender } = mount(); rerender("real-b");
    fireEvent.click(screen.getByRole("button", { name: "检索质量评测" }));
    fireEvent.change(screen.getByLabelText("评测基准名称"), { target: { value: "森林基准" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "森林 · 基础检索" }));
    fireEvent.click(screen.getByRole("button", { name: "创建固定评测候选池" }));
    await screen.findByRole("heading", { name: "森林基准" });
    expect(body).toEqual({ name: "森林基准", search_ids: ["real-b", "real-a"], k: 20 });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    rerender("real-c");
    expect(screen.getByLabelText("相关性等级 · 镜头 1")).toHaveValue("unknown");
    expect(screen.getByRole("button", { name: "附加当前检索方案" })).toBeEnabled();
    client.clear();
  });
  it("requires explicit human review and invalidates metrics when a grade is changed", async () => {
    server.use(
      http.post("http://api.test/api/media/evaluations/evaluation/judgments", async ({ request }) => { const body = await request.json() as { shot_id: string; grade: 0 | 1 | 2 | "clear"; expected_revision: number }; expect(body.expected_revision).toBe(current.revision); current = { ...current, revision: current.revision + 1, reviewed: false, review_source: null, metrics: null, candidates: current.candidates.map((item) => item.id === body.shot_id ? { ...item, grade: body.grade === "clear" ? null : body.grade } : item) }; return HttpResponse.json(current); }),
      http.post("http://api.test/api/media/evaluations/evaluation/review", async ({ request }) => { expect(await request.json()).toEqual({ reviewed: true, review_source: "human", expected_revision: 2 }); current = { ...current, reviewed: true, review_source: "human", revision: 3, metrics: metrics() }; return HttpResponse.json(current); }),
    );
    const { client } = mount(); await openSaved();
    expect(screen.getByRole("button", { name: "确认人工复核" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("相关性等级 · 镜头 1"), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByLabelText("相关性等级 · 镜头 1")).toHaveValue("2"));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /我已查看候选镜头/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认人工复核" }));
    const table = await screen.findByRole("table", { name: "人工复核候选池上的检索指标" });
    expect(table).toHaveTextContent("20.0%"); expect(table).toHaveTextContent("43 ms");
    fireEvent.change(screen.getByLabelText("相关性等级 · 镜头 1"), { target: { value: "unknown" } });
    await waitFor(() => expect(screen.queryByRole("table")).not.toBeInTheDocument());
    expect(screen.getByText("尚未人工复核，不提供质量结论。")).toBeInTheDocument();
    client.clear();
  });
  it("marks fixture metrics as acceptance data and suppresses metrics if candidate drift blocks comparison", async () => {
    current = { ...current, reviewed: true, review_source: "test_fixture", metrics_kind: "fixture_validation", metrics: metrics() };
    const { client } = mount(); await openSaved();
    expect(await screen.findByRole("table", { name: "验收流程指标（非人工质量结论）" })).toBeInTheDocument();
    expect(screen.getByText(/验收标注 \/ 非人工质量结论/)).toBeInTheDocument();
    current = { ...current, status: "blocked", drift: [{ shot_id: "a", reason: "原始视频字节已改变" }] };
    fireEvent.click(screen.getByRole("button", { name: "刷新评测" }));
    await screen.findByText(/原始视频字节已改变/);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    client.clear();
  });
  it("shows a rejected scheme attachment and keeps the fixed candidate pool", async () => {
    server.use(http.post("http://api.test/api/media/evaluations/evaluation/schemes", async ({ request }) => { expect(await request.json()).toEqual({ search_id: "real-b", expected_revision: 1 }); return HttpResponse.json({ detail: "新候选超出固定候选池，请重建并集基准" }, { status: 409 }); }));
    const { client, rerender } = mount(); await openSaved(); rerender("real-b");
    fireEvent.click(screen.getByRole("button", { name: "附加当前检索方案" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请重建并集基准");
    expect(screen.getByLabelText("相关性等级 · 镜头 2")).toHaveValue("unknown");
    expect(screen.getByRole("button", { name: "附加当前检索方案" })).toBeEnabled();
    client.clear();
  });
  it("rebuilds the union using the persisted original session and the current compatible session", async () => {
    const { client, rerender } = mount(); await openSaved(); rerender("real-b");
    fireEvent.click(screen.getByRole("button", { name: "新建并集基准" }));
    expect(screen.getByRole("checkbox", { name: "森林 · 基础检索" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "森林 · 增强组合检索" })).toBeChecked();
    client.clear();
  });
  it("opens a linked evaluation directly without requiring a new creation flow", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MediaEvaluationPanel projectId="demo" initialEvaluationId="evaluation" disabled={false} /></QueryClientProvider>);
    await screen.findByRole("heading", { name: "森林基准" });
    expect(screen.getByRole("button", { name: "检索质量评测" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "创建固定评测候选池" })).not.toBeInTheDocument();
    client.clear();
  });
  it("preserves failed reflow inputs and retries with the same UUID before showing the real saved link", async () => {
    const bodies: { idempotency_key: string; shot_ids: string[]; issue: string; action: string }[] = [];
    server.use(http.post("http://api.test/api/media/reflows", async ({ request }) => { const body = await request.json() as typeof bodies[number]; bodies.push(body); return bodies.length === 1 ? HttpResponse.json({ detail: "回流暂不可用" }, { status: 503 }) : HttpResponse.json({ created: true, dataset_id: "dataset", feedback_ids: ["feedback"], selection_id: "selection", task_id: null, url: "/projects/demo/datasets/dataset?selection=selection" }, { status: 201 }); }));
    const { client } = mount(); await openSaved();
    fireEvent.click(screen.getByRole("checkbox", { name: "回流镜头 1" }));
    fireEvent.change(screen.getByLabelText("回流名称"), { target: { value: "错误镜头返工" } });
    fireEvent.change(screen.getByLabelText("问题原因与处理要求"), { target: { value: "人工确认该镜头不是森林" } });
    fireEvent.click(screen.getByRole("button", { name: "创建真实筛选工作集" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("回流暂不可用");
    expect(screen.getByLabelText("问题原因与处理要求")).toHaveValue("人工确认该镜头不是森林");
    expect(screen.getByRole("checkbox", { name: "回流镜头 1" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "创建真实筛选工作集" }));
    expect(await screen.findByRole("link", { name: "打开筛选工作集" })).toHaveAttribute("href", "/projects/demo/datasets/dataset?selection=selection");
    expect(bodies[0].idempotency_key).toBe(bodies[1].idempotency_key); expect(bodies[0].shot_ids).toEqual(["a"]); expect(bodies[0].action).toBe("selection");
    client.clear();
  });
  it("gates mutations by actual project permissions", async () => {
    access.denied = ["media:curate", "data_platform:write"];
    const { client } = mount(); await openSaved();
    expect(screen.getByLabelText("相关性等级 · 镜头 1")).toBeDisabled();
    expect(screen.getByRole("button", { name: "确认人工复核" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "创建真实筛选工作集" })).toBeDisabled();
    client.clear();
  });
  it("creates a real annotation request using a selected specification and distinct project participants", async () => {
    let body: unknown;
    server.use(
      http.get("http://api.test/api/data-platform/specs", () => HttpResponse.json({ items: [{ id: "spec", name: "视频相关性规范", version: "v1" }], total: 1, nextCursor: null })),
      http.get("http://api.test/api/data-platform/participants", () => HttpResponse.json({ items: [{ id: "annotator", name: "标注员", canAnnotate: true, canReview: true }, { id: "reviewer", name: "审核员", canAnnotate: false, canReview: true }] })),
      http.post("http://api.test/api/media/reflows", async ({ request }) => { body = await request.json(); return HttpResponse.json({ created: true, dataset_id: "dataset", feedback_ids: ["feedback"], selection_id: null, task_id: "task", url: "/projects/demo/annotation/tasks/task" }); }),
    );
    const { client } = mount(); await openSaved();
    fireEvent.click(screen.getByRole("checkbox", { name: "回流镜头 2" }));
    fireEvent.change(screen.getByLabelText("回流名称"), { target: { value: "未知镜头标注" } });
    fireEvent.change(screen.getByLabelText("问题原因与处理要求"), { target: { value: "请按规范人工确认相关性" } });
    fireEvent.change(screen.getByLabelText("回流目的"), { target: { value: "annotation" } });
    await screen.findByRole("option", { name: "视频相关性规范 · v1" });
    await screen.findByRole("option", { name: "审核员" });
    fireEvent.change(screen.getByLabelText("标注规范"), { target: { value: "spec" } });
    fireEvent.change(screen.getByLabelText("标注负责人"), { target: { value: "annotator" } });
    expect(screen.getByLabelText("审核负责人")).not.toHaveTextContent("标注员");
    expect(screen.getByRole("button", { name: "创建真实标注任务" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("审核负责人"), { target: { value: "reviewer" } });
    fireEvent.click(screen.getByRole("button", { name: "创建真实标注任务" }));
    expect(await screen.findByRole("link", { name: "打开标注任务" })).toHaveAttribute("href", "/projects/demo/annotation/tasks/task");
    expect(body).toEqual({ evaluation_id: "evaluation", idempotency_key: expect.any(String), shot_ids: ["b"], name: "未知镜头标注", issue: "请按规范人工确认相关性", action: "annotation", spec_id: "spec", assignee_id: "annotator", reviewer_id: "reviewer" });
    client.clear();
  });
});
