import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoGtFailureEvidence } from "./AutoGtFailureEvidence";
import { autoGtFailureEvidence } from "../pages/platform/auto-gt-display";
import { SamplePreview } from "../pages/platform/shared";
import type { Asset } from "../pages/platform/platform-store";
const input = JSON.stringify({ schema: "auto-gt-failure-candidate/v1", pair_id: "pair", job_id: "job", issue: "修复发丝边缘", reference_kind: "approximate_2d", input_sha256: "a".repeat(64), target_sha256: "b".repeat(64), seed: 42, recipe_snapshot: { recipe: "portrait_bokeh_v1", version: "1.0.0" }, review: { id: "review", pair_revision: 3, decision: "rejected", reason_codes: ["halo"], note: "右侧发丝有光晕", rois: [{ role: "target", normalized_xywh: [.1, .2, .3, .4], sha256: "b".repeat(64), width: 100, height: 80 }], created_at: "2026-10-14T00:00:00Z" } });
const assets: Asset[] = [{ id: "target", kind: "image", sha256: "b".repeat(64), playbackUrl: "/api/data-platform/assets/target/playback", metadata: { role: "target" } }, { id: "input", kind: "image", sha256: "a".repeat(64), playbackUrl: "/api/data-platform/assets/input/playback", metadata: { role: "input" } }];
function load(image: HTMLElement, width = 100, height = 80) { Object.defineProperty(image, "naturalWidth", { configurable: true, value: width }); Object.defineProperty(image, "naturalHeight", { configurable: true, value: height }); fireEvent.load(image); }
beforeEach(() => vi.stubEnv("VITE_API_BASE_URL", "http://api.test")); afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
describe("read-only frozen rejection evidence", () => {
  it("resolves role-labelled actual paired assets and draws the stored ROI only on the matching target bytes", () => {
    const { container } = render(<AutoGtFailureEvidence evidence={autoGtFailureEvidence(input)!} assets={assets} />);
    const region = screen.getByRole("region", { name: "冻结 AutoGT 拒绝证据" }); expect(within(region).getByText("人工拒绝原因：边缘光晕 · 右侧发丝有光晕")).toBeInTheDocument();
    const target = screen.getByRole("img", { name: "诊断目标参考" }); expect(target).toHaveAttribute("src", "http://api.test/api/data-platform/assets/target/playback"); expect(screen.getByRole("img", { name: "诊断输入图" })).toHaveAttribute("src", "http://api.test/api/data-platform/assets/input/playback");
    expect(screen.queryByTestId("frozen-rejection-roi-1")).not.toBeInTheDocument(); load(target);
    const overlay = screen.getByTestId("frozen-rejection-roi-1"); expect(overlay).toHaveAccessibleName("冻结拒绝 ROI 1"); expect(overlay).toHaveStyle({ left: "10%", top: "20%", width: "30%", height: "40%" }); expect(overlay.closest("figure")).toContainElement(target);
    expect(container.querySelectorAll("input,textarea,button")).toHaveLength(0);
  });
  it("suppresses overlay when role/hash or loaded pixel dimensions do not match the frozen record", () => {
    const changed = [{ ...assets[0], sha256: "c".repeat(64) }, assets[1]];
    const view = render(<AutoGtFailureEvidence evidence={autoGtFailureEvidence(input)!} assets={changed} />); load(screen.getByRole("img", { name: "诊断目标参考" })); expect(screen.queryByTestId("frozen-rejection-roi-1")).not.toBeInTheDocument(); expect(screen.getByText(/诊断目标参考资产摘要与冻结证据不一致/)).toBeInTheDocument();
    view.rerender(<AutoGtFailureEvidence evidence={autoGtFailureEvidence(input)!} assets={assets} />); load(screen.getByRole("img", { name: "诊断目标参考" }), 200, 160); expect(screen.queryByTestId("frozen-rejection-roi-1")).not.toBeInTheDocument(); expect(screen.getByText(/像素尺寸与冻结区域不一致/)).toBeInTheDocument();
  });
  it("is reused in the shared preview without leaking raw failure input JSON", () => {
    render(<SamplePreview input={input} output="" label="标注内容" assets={assets} />); expect(screen.getByRole("region", { name: "冻结 AutoGT 拒绝证据" })).toBeInTheDocument(); expect(screen.queryByText(input)).not.toBeInTheDocument(); expect(screen.getByRole("heading", { name: "标注内容" })).toBeInTheDocument();
  });
  it("does not paint a stored ROI whose own hash differs even when the paired asset hash is correct", () => {
    const evidence = autoGtFailureEvidence(input)!; evidence.review.rois[0].sha256 = "c".repeat(64);
    render(<AutoGtFailureEvidence evidence={evidence} assets={assets} />); load(screen.getByRole("img", { name: "诊断目标参考" }));
    expect(screen.queryByTestId("frozen-rejection-roi-1")).not.toBeInTheDocument(); expect(screen.getByText(/冻结区域摘要不一致/)).toBeInTheDocument();
  });
});
