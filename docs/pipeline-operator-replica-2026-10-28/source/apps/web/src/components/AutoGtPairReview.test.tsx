import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoGtPairReview } from "./AutoGtPairReview";
import type { AutoGtPair } from "../auto-gt-api";
import { server } from "../test/server";
vi.mock("../auth-context", () => ({ useProjectAuth: () => ({ me: { csrf_token: "csrf" }, can: () => true }) }));
const pair: AutoGtPair = { id: "pair", revision: 3, input_url: "/api/auto-gt/pairs/pair/content?role=input", target_url: "/api/auto-gt/pairs/pair/content?role=target", input_sha256: "a".repeat(64), target_sha256: "b".repeat(64), reference_kind: "approximate_2d", source_group: "source", quality: { input: { width: 100, height: 80 }, target: { width: 100, height: 80 } }, provenance: {}, review_status: "pending" };
const clients: QueryClient[] = [];
function mount(value: AutoGtPair = pair) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); const reviewed = vi.fn(); render(<QueryClientProvider client={client}><AutoGtPairReview projectId="demo" jobId="job" pair={value} index={1} disabled={false} onReviewed={reviewed} /></QueryClientProvider>); return reviewed; }
beforeEach(() => vi.stubEnv("VITE_API_BASE_URL", "http://api.test")); afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("manual AutoGT rejection with frozen local evidence", () => {
  it("requires an explicit manual reason and saves keyboard ROI against the selected target bytes", async () => {
    let body: any;
    server.use(http.post("http://api.test/api/auto-gt/pairs/pair/review", async ({ request }) => { body = await request.json(); expect(request.headers.get("X-CSRF-Token")).toBe("csrf"); return HttpResponse.json({ ...pair, review_status: "rejected", revision: 4 }); }));
    const reviewed = mount(); fireEvent.click(screen.getByRole("button", { name: "拒绝配对 1" })); expect(screen.getByRole("button", { name: "保存拒绝审核 1" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "边缘光晕" })); fireEvent.change(screen.getByLabelText("拒绝说明 · 配对 1"), { target: { value: "发丝边缘有光晕" } });
    for (const [name, value] of [["X", .1], ["Y", .2], ["宽", .3], ["高", .4]]) fireEvent.change(screen.getByLabelText(`配对 1 ROI ${name}（0–1）`), { target: { value: String(value) } });
    fireEvent.click(screen.getByRole("button", { name: "保存拒绝审核 1" })); await waitFor(() => expect(reviewed).toHaveBeenCalledOnce());
    expect(body).toEqual({ decision: "rejected", expected_revision: 3, reason_codes: ["halo"], note: "发丝边缘有光晕", rois: [{ role: "target", normalized_xywh: [.1, .2, .3, .4], sha256: "b".repeat(64), width: 100, height: 80 }] });
  });
  it("draws a reverse pointer rectangle in actual image coordinates", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    let body: any; server.use(http.post("http://api.test/api/auto-gt/pairs/pair/review", async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...pair, review_status: "rejected", revision: 4 }); }));
    const reviewed = mount(); fireEvent.click(screen.getByRole("button", { name: "拒绝配对 1" })); fireEvent.click(screen.getByRole("checkbox", { name: "边缘光晕" }));
    const canvas = screen.getByLabelText("配对 1 ROI 画框图像"); vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 160, right: 200, bottom: 160, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(canvas, { button: 0, clientX: 160, clientY: 120 }); fireEvent.pointerMove(canvas, { clientX: 40, clientY: 40 }); fireEvent.pointerUp(canvas, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole("button", { name: "保存拒绝审核 1" })); await waitFor(() => expect(reviewed).toHaveBeenCalledOnce()); expect(body.rois[0].normalized_xywh[0]).toBeCloseTo(.2); expect(body.rois[0].normalized_xywh[1]).toBeCloseTo(.25); expect(body.rois[0].normalized_xywh[2]).toBeCloseTo(.6); expect(body.rois[0].normalized_xywh[3]).toBeCloseTo(.5); expect(body.rois[0].sha256).toBe("b".repeat(64));
  });
  it("rejects an out-of-bounds ROI and keeps manual input after a server conflict", async () => {
    server.use(http.post("http://api.test/api/auto-gt/pairs/pair/review", () => HttpResponse.json({ detail: "审核版本已变化" }, { status: 409 })));
    const reviewed = mount(); fireEvent.click(screen.getByRole("button", { name: "拒绝配对 1" })); fireEvent.click(screen.getByRole("checkbox", { name: "其他问题" }));
    expect(screen.getByRole("button", { name: "保存拒绝审核 1" })).toBeDisabled(); fireEvent.change(screen.getByLabelText("拒绝说明 · 配对 1"), { target: { value: "主体形状错误" } });
    fireEvent.change(screen.getByLabelText("配对 1 ROI X（0–1）"), { target: { value: ".95" } }); fireEvent.change(screen.getByLabelText("配对 1 ROI 宽（0–1）"), { target: { value: ".3" } }); expect(screen.getByRole("button", { name: "保存拒绝审核 1" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "清除当前区域" })); fireEvent.click(screen.getByRole("button", { name: "保存拒绝审核 1" })); expect(await screen.findByRole("alert")).toHaveTextContent("审核版本已变化"); expect(screen.getByLabelText("拒绝说明 · 配对 1")).toHaveValue("主体形状错误"); expect(reviewed).not.toHaveBeenCalled();
  });
  it("renders append-only human history including persisted ROI without treating automatic checks as reasons", async () => {
    server.use(http.get("http://api.test/api/auto-gt/pairs/pair/reviews", () => HttpResponse.json({ items: [{ id: "review", pair_id: "pair", pair_revision: 2, decision: "rejected", reason_codes: ["misalignment"], note: "掩码向左偏移", rois: [{ role: "input", normalized_xywh: [.1, .1, .2, .2], width: 100, height: 80, sha256: "a".repeat(64) }], created_at: "2026-10-14T00:00:00+00:00" }] })));
    mount(); fireEvent.click(screen.getByRole("button", { name: "审核历史 1" })); expect(await screen.findByText("配准或掩码错位 · 掩码向左偏移")).toBeInTheDocument(); expect(screen.getByText(/输入图区域 · 100×80/)).toBeInTheDocument();
  });  it("allows a legacy accepted pair to create an explicit current acceptance without fabricating the old record", async () => {
    const legacy = { ...pair, review_status: "accepted" as const, review_history_status: "legacy_without_reason" as const, current_review: null };
    let body: unknown; server.use(http.post("http://api.test/api/auto-gt/pairs/pair/review", async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...legacy, revision: 4, review_history_status: "recorded", current_review: { id: "new-real-review", pair_id: "pair", pair_revision: 4, decision: "accepted", reason_codes: [], note: "", rois: [], created_at: "2026-10-14T00:00:00Z" } }); }));
    const reviewed = mount(legacy); expect(screen.getByText(/历史接受缺少详细审核记录，正式发布前请重新确认并创建新候选数据集/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "接受配对 1" })).toBeEnabled(); fireEvent.click(screen.getByRole("button", { name: "接受配对 1" })); await waitFor(() => expect(reviewed).toHaveBeenCalledOnce()); expect(body).toEqual({ decision: "accepted", expected_revision: 3, reason_codes: [], note: "", rois: [] }); expect(reviewed.mock.calls[0][0].current_review.id).toBe("new-real-review"); expect(reviewed.mock.calls[0][0].reference_kind).toBe("approximate_2d"); expect(legacy.current_review).toBeNull();
  });
  it("keeps an accepted pair with a real current review disabled for the duplicate acceptance shortcut", () => {
    const reviewed = mount({ ...pair, review_status: "accepted", review_history_status: "recorded", current_review: { id: "review", pair_id: "pair", pair_revision: 3, decision: "accepted", reason_codes: [], note: "", rois: [], created_at: "2026-10-14T00:00:00Z" } }); expect(screen.getByRole("button", { name: "接受配对 1" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "接受配对 1" })); expect(reviewed).not.toHaveBeenCalled(); expect(screen.queryByText(/历史接受缺少详细审核记录/)).not.toBeInTheDocument();
  });

});
