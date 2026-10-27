import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { AutoGtFailureReflow } from "./AutoGtFailureReflow";
import type { AutoGtJob } from "../auto-gt-api";
vi.mock("../auth-context", () => ({ useProjectAuth: () => ({ me: { csrf_token: "csrf" }, can: () => true }) }));
const job: AutoGtJob = { id: "job", name: "批次", recipe: "portrait_bokeh_v1", status: "succeeded", revision: 1, pair_count: 1, recipe_snapshot: {}, seed: 42, pairs: [{ id: "pair", revision: 3, input_url: "", target_url: "", input_sha256: "a".repeat(64), target_sha256: "b".repeat(64), reference_kind: "approximate_2d", source_group: "source", quality: {}, provenance: {}, review_status: "rejected", current_review: { id: "manual-review", pair_id: "pair", pair_revision: 3, decision: "rejected", reason_codes: ["halo"], note: "", rois: [], created_at: "2026-10-14T00:00:00+00:00" } }] };
const clients: QueryClient[] = []; function mount(value = job) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); render(<QueryClientProvider client={client}><AutoGtFailureReflow projectId="demo" job={value} disabled={false} /></QueryClientProvider>); fireEvent.click(screen.getByRole("button", { name: "失败配对回流" })); }
beforeEach(() => { vi.stubEnv("VITE_API_BASE_URL", "http://api.test"); server.use(http.get("http://api.test/api/auto-gt/reflows", () => HttpResponse.json({ items: [] }))); }); afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; vi.unstubAllEnvs(); });
describe("real failure reflows with frozen manual review identity", () => {
  it("allows reason-only manual rejection and preserves review identity/idempotency key during failed retry", async () => {
    const bodies: any[] = []; server.use(http.post("http://api.test/api/auto-gt/reflows", async ({ request }) => { bodies.push(await request.json()); return bodies.length === 1 ? HttpResponse.json({ detail: "源图校验暂不可用" }, { status: 503 }) : HttpResponse.json({ dataset_id: "dataset", feedback_ids: ["feedback"], selection_id: "selection", task_id: null, created: true, name: "失败返工", issue: "边缘光晕", url: "/projects/demo/datasets/dataset?selection=selection" }); }));
    mount(); fireEvent.click(screen.getByRole("checkbox", { name: "配对 1 · 边缘光晕 · 0 个区域" })); fireEvent.change(screen.getByLabelText("失败回流名称"), { target: { value: "失败返工" } }); expect(screen.getByLabelText("失败问题与处理要求")).toHaveValue("边缘光晕"); fireEvent.click(screen.getByRole("button", { name: "创建真实失败筛选工作集" })); expect(await screen.findByRole("alert")).toHaveTextContent("源图校验暂不可用");
    expect(screen.getByRole("checkbox", { name: "配对 1 · 边缘光晕 · 0 个区域" })).toBeChecked(); fireEvent.click(screen.getByRole("button", { name: "创建真实失败筛选工作集" })); expect(await screen.findByRole("link", { name: "打开失败筛选工作集" })).toHaveAttribute("href", "/projects/demo/datasets/dataset?selection=selection"); expect(bodies[0]).toMatchObject({ pair_ids: ["pair"], rejection_review_ids: { pair: "manual-review" }, action: "selection", issue: "边缘光晕" }); expect(bodies[0].idempotency_key).toBe(bodies[1].idempotency_key);
  });
  it("never substitutes old unreasoned rejects or automatic quality warnings for a manual failure record", async () => {
    mount({ ...job, pairs: [{ ...job.pairs[0], current_review: null, review_history_status: "legacy_without_reason" }] }); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); await waitFor(() => expect(screen.getByRole("button", { name: "创建真实失败筛选工作集" })).toBeDisabled()); expect(screen.getByText(/旧拒绝需先补充新审核/)).toBeInTheDocument();
  });
});
