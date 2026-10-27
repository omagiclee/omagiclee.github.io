import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoGtComparisonPanel } from "./AutoGtComparisonPanel";
import type { AutoGtJob } from "../auto-gt-api";
import type { AutoGtComparison } from "../auto-gt-workbench-api";
import { server } from "../test/server";
vi.mock("../auth-context", () => ({ useProjectAuth: () => ({ me: { csrf_token: "csrf" }, can: () => true }) }));
const jobs = ["a", "b"].map((id): AutoGtJob => ({ id, name: `批次${id}`, recipe: id === "a" ? "degradation_v1" : "portrait_bokeh_v1", status: "succeeded", revision: 1, seed: 42, recipe_snapshot: { version: "1.0.0" }, pair_count: 1, pairs: [{ id: `pair-${id}`, input_url: `/api/auto-gt/pairs/pair-${id}/content?role=input`, target_url: `/api/auto-gt/pairs/pair-${id}/content?role=target`, input_sha256: "a".repeat(64), target_sha256: id.repeat(64), reference_kind: "approximate_2d", source_group: "same-source", quality: { input: { width: 64, height: 64 }, target: { width: 64, height: 64 } }, provenance: {}, review_status: "pending", revision: 1 }] }));
const fixture = (): AutoGtComparison => ({ id: "comparison", name: "同源比较", status: "succeeded", revision: 1, snapshot: { jobs, pairs: jobs.flatMap((job) => job.pairs.map((pair) => ({ ...pair, job_id: job.id }))) }, compatibility: { psnr_common_ranking_allowed: false, reason: "目标与任务不兼容" }, metrics: jobs.map((job) => ({ pair_id: `pair-${job.id}`, job_id: job.id, source_group: "same-source", input: { mean_luminance: .4, sharpness_proxy: .02 }, target: { mean_luminance: .5 }, psnr_db: null, psnr_status: "incomparable_target_or_task", roi_metrics: [] })), preferences: [] });
let current: AutoGtComparison; const clients: QueryClient[] = [];
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); render(<QueryClientProvider client={client}><AutoGtComparisonPanel projectId="demo" jobs={jobs} disabled={false} /></QueryClientProvider>); fireEvent.click(screen.getByRole("button", { name: "打开真实比较工作台" })); }
beforeEach(() => { current = fixture(); vi.stubEnv("VITE_API_BASE_URL", "http://api.test"); server.use(http.get("http://api.test/api/auto-gt/comparisons", () => HttpResponse.json({ items: [current] })), http.get("http://api.test/api/auto-gt/comparisons/comparison", () => HttpResponse.json(current)), http.get("http://api.test/api/auto-gt/jobs/:id", ({ params }) => HttpResponse.json(jobs.find((job) => job.id === params.id)))); });
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; vi.unstubAllEnvs(); });
describe("actual same-source job comparisons", () => {
  it("creates only from selected real jobs and records explicit human preference while incompatible targets suppress PSNR", async () => {
    let created: any, preference: any;
    server.use(http.post("http://api.test/api/auto-gt/comparisons", async ({ request }) => { created = await request.json(); return HttpResponse.json(current, { status: 202 }); }), http.post("http://api.test/api/auto-gt/comparisons/comparison/preferences", async ({ request }) => { preference = await request.json(); current = { ...current, revision: 2, preferences: [{ ...preference, id: "preference" }] }; return HttpResponse.json(current); }));
    mount(); fireEvent.change(screen.getByLabelText("比较工作台名称"), { target: { value: "同源比较" } });
    for (const label of ["批次a · degradation_v1 · Seed 42", "批次b · portrait_bokeh_v1 · Seed 42"]) fireEvent.click(screen.getByRole("checkbox", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: "提交真实同源比较" })); await screen.findByRole("heading", { name: "同源比较" });
    expect(created).toEqual({ name: "同源比较", job_ids: ["a", "b"], idempotency_key: expect.any(String) }); expect(screen.getByText(/^禁止 PSNR 总排名：目标或任务不兼容。/)).toBeInTheDocument(); expect(screen.getAllByText(/PSNR：不用于比较/)).toHaveLength(2); expect(screen.getByLabelText("人工偏好")).toHaveValue("unknown");
    fireEvent.change(screen.getByLabelText("方案 A 配对"), { target: { value: "pair-a" } }); fireEvent.change(screen.getByLabelText("方案 B 配对"), { target: { value: "pair-b" } }); fireEvent.change(screen.getByLabelText("人工偏好"), { target: { value: "incomparable" } }); fireEvent.change(screen.getByLabelText("人工判定依据"), { target: { value: "目标任务不同" } }); fireEvent.click(screen.getByRole("button", { name: "保存人工 A/B 判定" }));
    await screen.findByText("不可比较 · 目标任务不同"); expect(preference).toEqual({ source_group: "same-source", a_pair_id: "pair-a", b_pair_id: "pair-b", choice: "incomparable", note: "目标任务不同", expected_revision: 1 });
  });
  it("can freeze an explicit keyboard ROI for real local pixel checks", async () => {
    let body: any; server.use(http.post("http://api.test/api/auto-gt/comparisons", async ({ request }) => { body = await request.json(); return HttpResponse.json(current); })); mount(); fireEvent.change(screen.getByLabelText("比较工作台名称"), { target: { value: "局部比较" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "批次a · degradation_v1 · Seed 42" })); fireEvent.click(screen.getByRole("checkbox", { name: "批次b · portrait_bokeh_v1 · Seed 42" })); await screen.findByRole("option", { name: "same-source" }); fireEvent.change(screen.getByLabelText("局部比较来源分组"), { target: { value: "same-source" } });
    for (const [name, value] of [["X", .2], ["Y", .2], ["宽", .4], ["高", .4]]) fireEvent.change(screen.getByLabelText(`比较 ROI ${name}（0–1）`), { target: { value: String(value) } }); fireEvent.click(screen.getByRole("button", { name: "提交真实同源比较" })); await waitFor(() => expect(body).toBeDefined()); expect(body.rois).toEqual([{ source_group: "same-source", normalized_xywh: [.2, .2, .4, .4] }]);
  });
  it("shows identical-image PSNR as infinite rather than zero or a poor quality conclusion", async () => {
    current.compatibility = { psnr_common_ranking_allowed: true, reason: "同目标差异" }; current.metrics![0].psnr_status = "identical_images"; current.metrics![0].psnr_infinite = true;
    mount(); fireEvent.change(await screen.findByLabelText("已有比较工作台"), { target: { value: "comparison" } }); expect(await screen.findByText(/完全一致（PSNR 无穷，不视为低质量）/)).toBeInTheDocument();
  });
});
