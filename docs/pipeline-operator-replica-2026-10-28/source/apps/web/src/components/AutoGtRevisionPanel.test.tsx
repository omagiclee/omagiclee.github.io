import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoGtRevisionPanel } from "./AutoGtRevisionPanel";
import type { AutoGtJob } from "../auto-gt-api";
import type { AutoGtRevisionContext, AutoGtRevisionLineage } from "../auto-gt-workbench-api";
import { server } from "../test/server";
vi.mock("../auth-context", () => ({ useProjectAuth: () => ({ me: { csrf_token: "csrf" }, can: () => true }) }));
const parent: AutoGtJob = { id: "parent", name: "父批次", recipe: "portrait_bokeh_v1", status: "succeeded", revision: 1, pair_count: 12, pairs: [], seed: 42, recipe_snapshot: { version: "1.0.0", params: { bokeh_radius: 8 } } };
const lineage: AutoGtRevisionLineage = { revision_id: "recipe-revision", parent_job_id: "parent", task_id: "task", dataset_id: "diagnostic", parent_pair_ids: ["old-pair"], annotation_ids: ["annotation"], review_ids: ["review"], approval_digest: "a".repeat(64), reason: "test_fixture 减少边缘光晕", params_before: { bokeh_radius: 8 }, params_after: { bokeh_radius: 6 } };
const context = (): AutoGtRevisionContext => ({ parent_job_id: "parent", recipe: "portrait_bokeh_v1", params: { bokeh_radius: 8 }, editable_params: { bokeh_radius: { min: 1, max: 32, value: 8 } }, eligible_tasks: [{ task_id: "task", name: "真实返工", dataset_id: "diagnostic", eligible: true, approval_digest: "a".repeat(64), task_revision: 2, dataset_revision: 3, samples: [{ sample_id: "sample", pair_id: "old-pair", sample_revision: 4, annotation_id: "annotation", review_id: "review", decision: "approve" }] }] });
let current: AutoGtRevisionContext; const clients: QueryClient[] = [];
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); const created = vi.fn(); render(<QueryClientProvider client={client}><AutoGtRevisionPanel projectId="demo" job={parent} disabled={false} onCreated={created} /></QueryClientProvider>); fireEvent.click(screen.getByRole("button", { name: "审核后修订本地配方" })); return created; }
beforeEach(() => { current = context(); vi.stubEnv("VITE_API_BASE_URL", "http://api.test"); server.use(http.get("http://api.test/api/auto-gt/jobs/parent/revision-context", () => HttpResponse.json(current)), http.get("http://api.test/api/auto-gt/revisions", () => HttpResponse.json({ items: [{ id: "recipe-revision", lineage, job: { ...parent, id: "child-job", name: "修订批次", status: "queued", revision_lineage: lineage } }] }))); }); afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; vi.unstubAllEnvs(); });
describe("independently approved diagnostic evidence drives a new recipe revision", () => {
  it("submits changed parameters with the exact approval digest and uses actual nested child-job history links", async () => {
    let body: any; server.use(http.post("http://api.test/api/auto-gt/revisions", async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...parent, id: "child-job", status: "queued", pairs: [], pair_count: 0, revision_lineage: lineage }, { status: 202 }); }));
    const created = mount(); await screen.findByRole("option", { name: /真实返工/ }); fireEvent.change(screen.getByLabelText("已完成独立审核的返工任务"), { target: { value: "task" } }); await screen.findByText("当前返工任务满足修订门禁");
    expect(await screen.findByRole("link", { name: "修订批次" })).toHaveAttribute("href", "/projects/demo/auto-gt?job_id=child-job");
    fireEvent.change(screen.getByLabelText("修订任务名称"), { target: { value: "修订批次" } }); fireEvent.change(screen.getByLabelText("配方修订依据与说明"), { target: { value: "test_fixture 减少边缘光晕" } }); expect(screen.getByRole("button", { name: "提交冻结审批的配方修订" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("修订背景模糊半径"), { target: { value: "6" } }); expect(screen.getByText("背景模糊半径：8 → 6")).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "提交冻结审批的配方修订" })); await waitFor(() => expect(created).toHaveBeenCalledOnce()); expect(body).toEqual({ parent_job_id: "parent", task_id: "task", approval_digest: "a".repeat(64), name: "修订批次", reason: "test_fixture 减少边缘光晕", params: { bokeh_radius: 6 }, idempotency_key: expect.any(String) }); expect(created.mock.calls[0][0].status).toBe("queued"); expect(created.mock.calls[0][0].pairs).toEqual([]);
  });
  it("blocks unapproved tasks and does not hide server CAS conflicts or erase the intended diff", async () => {
    current.eligible_tasks[0] = { ...current.eligible_tasks[0], eligible: false, approval_digest: null, blocked_reason: "独立审核尚未完成" };
    server.use(http.post("http://api.test/api/auto-gt/revisions", () => HttpResponse.json({ detail: "审批凭据已经变化" }, { status: 409 })));
    const created = mount(); await screen.findByRole("option", { name: /真实返工/ }); fireEvent.change(screen.getByLabelText("已完成独立审核的返工任务"), { target: { value: "task" } }); fireEvent.change(screen.getByLabelText("修订任务名称"), { target: { value: "修订批次" } }); fireEvent.change(screen.getByLabelText("配方修订依据与说明"), { target: { value: "修复边缘" } }); fireEvent.change(await screen.findByLabelText("修订背景模糊半径"), { target: { value: "6" } }); expect(screen.getByRole("button", { name: "提交冻结审批的配方修订" })).toBeDisabled();
    current = context(); fireEvent.click(screen.getByRole("button", { name: "刷新最新审批依据" })); await screen.findByText("当前返工任务满足修订门禁"); fireEvent.click(screen.getByRole("button", { name: "提交冻结审批的配方修订" })); expect(await screen.findByRole("alert")).toHaveTextContent("审批凭据已经变化"); expect(screen.getByLabelText("配方修订依据与说明")).toHaveValue("修复边缘"); expect(created).not.toHaveBeenCalled();
  });
});
