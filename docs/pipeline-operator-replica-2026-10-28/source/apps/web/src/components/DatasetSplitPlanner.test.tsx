import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatasetSplitPlanner, type SourceSplitPlan } from "./DatasetSplitPlanner";
const plan: SourceSplitPlan = { datasetId: "dataset", revision: 4, seed: "42", ratios: { train: .8, validation: .1, test: .1 }, counts: { train: 3, validation: 0, test: 0 }, groupCounts: { train: 1, validation: 0, test: 0 }, groups: [{ key: "same-source", sampleIds: ["a", "b", "c"], split: "train" }], assignments: { a: "train", b: "train", c: "train" }, planDigest: "a".repeat(64), note: "小池可能无法覆盖每个集合" };
afterEach(cleanup);
describe("source-group split preview and explicit application", () => {
  it("shows requested versus actual counts and only applies the exact preview after confirmation", async () => {
    const write = vi.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce({ plan, revision: 5 }); render(<DatasetSplitPlanner datasetId="dataset" revision={4} purpose="训练" canWrite write={write} />);
    fireEvent.click(screen.getByRole("button", { name: "预览同源分组划分" })); await screen.findByRole("table", { name: "真实划分计划 · Seed 42" }); expect(write).toHaveBeenCalledTimes(1); expect(screen.getByText("100.0%")).toBeInTheDocument(); expect(screen.getByText("same-source · 3 个样本 → 训练")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认应用此分组计划" })); await screen.findByText(/已应用预览中的同源分组计划/); expect(write.mock.calls[1]).toEqual(["/datasets/dataset/split-apply", { expectedRevision: 4, seed: "42", ratios: plan.ratios, planDigest: plan.planDigest }]);
  });
  it("disables training for diagnostic sources and invalidates a preview if ratios change", async () => {
    const diagnosticPlan = { ...plan, ratios: { train: 0, validation: .5, test: .5 } }; const write = vi.fn().mockResolvedValue(diagnosticPlan); render(<DatasetSplitPlanner datasetId="dataset" revision={4} purpose="影像画质诊断" canWrite write={write} />);
    expect(screen.getByLabelText("训练请求比例（0–1）")).toBeDisabled(); expect(screen.getByLabelText("训练请求比例（0–1）")).toHaveValue(0); fireEvent.click(screen.getByRole("button", { name: "预览同源分组划分" })); await screen.findByRole("button", { name: "确认应用此分组计划" });
    fireEvent.change(screen.getByLabelText("划分随机种子"), { target: { value: "43" } }); expect(screen.queryByRole("button", { name: "确认应用此分组计划" })).not.toBeInTheDocument(); expect(write).toHaveBeenCalledTimes(1);
  });
  it("does not claim a successful application after the frozen plan drifts", async () => {
    const write = vi.fn().mockResolvedValueOnce(plan).mockRejectedValueOnce(new Error("划分预览已变化，请重新预览")); render(<DatasetSplitPlanner datasetId="dataset" revision={4} purpose="训练" canWrite write={write} />); fireEvent.click(screen.getByRole("button", { name: "预览同源分组划分" })); await screen.findByRole("button", { name: "确认应用此分组计划" }); fireEvent.click(screen.getByRole("button", { name: "确认应用此分组计划" })); expect(await screen.findByRole("alert")).toHaveTextContent("划分预览已变化"); await waitFor(() => expect(screen.queryByRole("button", { name: "确认应用此分组计划" })).not.toBeInTheDocument());
  });
});
