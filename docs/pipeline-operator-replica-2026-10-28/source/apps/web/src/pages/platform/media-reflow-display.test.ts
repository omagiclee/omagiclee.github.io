import { describe, expect, it } from "vitest";
import { datasetSourceLabel, reflowExploreUrl, reflowProvenance, sampleInputLabel } from "./media-reflow-display";

describe("human-readable media reflow provenance", () => {
  it("treats absent or malformed source and input values as undeclared without throwing", () => {
    for (const value of [undefined, null, 0, {}]) {
      expect(reflowProvenance(value)).toBeNull();
      expect(datasetSourceLabel(value)).toBe("");
      expect(sampleInputLabel(value)).toBe("");
    }
  });
  it("summarizes structured dataset sources while preserving ordinary source text", () => {
    expect(datasetSourceLabel(JSON.stringify({ schema: "media.failure-reflow.v1", issue: "误召回", schemes: [{ search_id: "s" }] }))).toBe("检索失败回流");
    expect(datasetSourceLabel("手工导入，批次 01")).toBe("手工导入，批次 01");
    expect(datasetSourceLabel("{invalid")).toBe("{invalid");
    expect(datasetSourceLabel(JSON.stringify({ original_source: "采集批次 01", split_history: [{ seed: "42" }] }))).toBe("采集批次 01");
    expect(reflowProvenance(JSON.stringify({ schema: "media.failure-reflow.v1", issue: {}, schemes: {} }))).toMatchObject({ issue: undefined, schemes: undefined });
  });
  it("shows only issue and natural query text in a media failure sample", () => {
    const input = JSON.stringify({ schema: "media.failure-candidate.v1", issue: "请确认画面", query: { mode: "text", query: "森林" }, source: { source_sha256: "internal-digest", id: "shot" } });
    expect(sampleInputLabel(input)).toBe("问题：请确认画面；检索条件：森林");
    expect(sampleInputLabel(input)).not.toContain("internal-digest");
    expect(sampleInputLabel("普通文本输入")).toBe("普通文本输入");
  });
  it("builds same-project links with escaped reference IDs", () => {
    expect(reflowExploreUrl("demo/project", "evaluation_id", "eval/id")).toBe("/projects/demo%2Fproject/explore?evaluation_id=eval%2Fid");
  });
});
