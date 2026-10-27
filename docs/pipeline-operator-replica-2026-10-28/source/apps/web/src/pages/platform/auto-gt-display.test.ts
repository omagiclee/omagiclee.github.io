import { describe, expect, it } from "vitest";
import { autoGtDatasetProvenance, autoGtFailureProvenance, autoGtSampleInputLabel } from "./auto-gt-display";
import { datasetSourceLabel } from "./media-reflow-display";
describe("AutoGT candidate dataset readable provenance", () => {
  it("allows undeclared source and input values in ordinary dataset fixtures", () => {
    for (const value of [undefined, null, 0, {}]) { expect(autoGtDatasetProvenance(value)).toBeNull(); expect(autoGtSampleInputLabel(value)).toBe(""); }
  });
  it("summarizes structured source metadata without displaying raw JSON", () => { const source = JSON.stringify({ schema: "auto-gt-dataset-source/v1", job_id: "job", recipe_snapshot: { recipe: "degradation_v1", version: "1.0.0" }, reference_kinds: ["degraded_from_reference"], pair_ids: ["pair"] }); expect(datasetSourceLabel(source)).toBe("AutoGT 配对候选"); expect(autoGtDatasetProvenance(source)).toEqual({ jobId: "job", recipe: "degradation_v1", version: "1.0.0", referenceKinds: ["源图退化参考"], pairCount: 1 }); });
  it("explains source level while keeping ordinary JSON inputs intact", () => { expect(autoGtSampleInputLabel(JSON.stringify({ input_sha256: "a".repeat(64), target_sha256: "b".repeat(64), reference_kind: "generated_pseudo" }))).toContain("生成式伪参考。人工接受不改变来源级别"); expect(autoGtSampleInputLabel('{"query":"ordinary"}')).toBe('{"query":"ordinary"}'); });
  it("displays frozen failure issue and region counts rather than serialized review metadata", () => {
    const review = { reason_codes: ["halo"], note: "", rois: [{ role: "target", normalized_xywh: [.1, .1, .2, .2] }] };
    const source = JSON.stringify({ schema: "auto-gt-failure-reflow/v1", issue: "修复发丝", job_ids: ["job"], pair_ids: ["pair"], snapshots: [{ reference_kind: "approximate_2d", review }] });
    expect(datasetSourceLabel(source)).toBe("AutoGT 失败回流"); expect(autoGtFailureProvenance(source)).toMatchObject({ issue: "修复发丝", pairCount: 1, roiCount: 1, jobIds: ["job"] });
    expect(autoGtSampleInputLabel(JSON.stringify({ schema: "auto-gt-failure-candidate/v1", issue: "修复发丝", review }))).toContain("人工拒绝：边缘光晕；1 个冻结区域");
  });
});
