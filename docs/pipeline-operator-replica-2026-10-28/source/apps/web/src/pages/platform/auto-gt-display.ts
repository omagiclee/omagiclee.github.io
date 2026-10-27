const kinds: Record<string, string> = { degraded_from_reference: "源图退化参考", approximate_2d: "二维虚化近似参考", rendered_physical: "物理渲染参考", generated_pseudo: "生成式伪参考", editor_reference: "编辑参考" };
export interface AutoGtDatasetProvenance { jobId: string; recipe: string; version: string; referenceKinds: string[]; pairCount: number }
function parse(value: unknown): Record<string, unknown> | null { if (typeof value !== "string" || !value.trimStart().startsWith("{")) return null; try { const data: unknown = JSON.parse(value); return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null; } catch { return null; } }
export function autoGtDatasetProvenance(source: unknown): AutoGtDatasetProvenance | null {
  const data = parse(source); if (data?.schema !== "auto-gt-dataset-source/v1") return null;
  const recipe = data.recipe_snapshot && typeof data.recipe_snapshot === "object" ? data.recipe_snapshot as Record<string, unknown> : {};
  return { jobId: typeof data.job_id === "string" ? data.job_id : "", recipe: typeof recipe.recipe === "string" ? recipe.recipe : "未记录配方", version: typeof recipe.version === "string" ? recipe.version : "未记录版本", referenceKinds: Array.isArray(data.reference_kinds) ? data.reference_kinds.filter((kind): kind is string => typeof kind === "string").map((kind) => kinds[kind] ?? kind) : [], pairCount: Array.isArray(data.pair_ids) ? data.pair_ids.length : 0 };
}
export function autoGtSampleInputLabel(input: unknown): string {
  if (typeof input !== "string") return "";
  const data = parse(input);
  if (data?.schema === "auto-gt-failure-candidate/v1") {
    const review = data.review && typeof data.review === "object" ? data.review as Record<string, unknown> : {};
    const reasonNames: Record<string, string> = { exposure:"曝光不合要求",color_cast:"色偏",halo:"边缘光晕",identity_drift:"主体身份漂移",misalignment:"配准或掩码错位",artifacts:"生成或压缩伪影",other:"其他问题" };
    const reasons = Array.isArray(review.reason_codes) ? review.reason_codes.filter((code): code is string => typeof code === "string").map((code) => reasonNames[code] ?? code).join("、") : "未记录原因";
    return `AutoGT 失败诊断配对 · ${typeof data.issue === "string" ? data.issue : "待处理问题"}；人工拒绝：${reasons}${typeof review.note === "string" && review.note ? ` · ${review.note}` : ""}；${Array.isArray(review.rois) ? review.rois.length : 0} 个冻结区域。参考来源级别保持不变。`;
  }
  if (!data || typeof data.reference_kind !== "string" || !kinds[data.reference_kind] || typeof data.input_sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(data.input_sha256) || typeof data.target_sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(data.target_sha256)) return input;
  return `AutoGT 候选配对 · 参考类型：${kinds[data.reference_kind]}。人工接受不改变来源级别；输入图与目标参考见配对资产。`;
}
export interface AutoGtFailureProvenance { jobIds: string[]; issue: string; pairCount: number; referenceKinds: string[]; roiCount: number }
export function autoGtFailureProvenance(source: unknown): AutoGtFailureProvenance | null {
  const data = parse(source); if (data?.schema !== "auto-gt-failure-reflow/v1") return null;
  const snapshots = Array.isArray(data.snapshots) ? data.snapshots.filter((item) => item && typeof item === "object") : [];
  return { jobIds: Array.isArray(data.job_ids) ? data.job_ids.filter((value): value is string => typeof value === "string") : [], issue: typeof data.issue === "string" ? data.issue : "待处理的人工拒绝问题", pairCount: Array.isArray(data.pair_ids) ? data.pair_ids.length : snapshots.length, referenceKinds: [...new Set(snapshots.map((item) => typeof item.reference_kind === "string" ? kinds[item.reference_kind] ?? item.reference_kind : "未声明参考类型"))], roiCount: snapshots.reduce((total, item) => total + (Array.isArray(item.review?.rois) ? item.review.rois.length : 0), 0) };
}
export interface FrozenAutoGtFailureEvidence {
  pairId: string; jobId: string; issue: string; referenceLabel: string; inputSha256: string; targetSha256: string; recipeLabel: string; seed: number | null;
  review: { id: string; revision: number | null; reasons: string[]; note: string; createdAt: string; rois: import("../../auto-gt-workbench-api").AutoGtRoi[]; invalidRoiCount: number };
}
export function autoGtFailureEvidence(input: unknown): FrozenAutoGtFailureEvidence | null {
  const data = parse(input); if (data?.schema !== "auto-gt-failure-candidate/v1") return null;
  const review = data.review && typeof data.review === "object" ? data.review as Record<string, unknown> : {};
  const recipe = data.recipe_snapshot && typeof data.recipe_snapshot === "object" ? data.recipe_snapshot as Record<string, unknown> : {};
  const reasonNames: Record<string, string> = { exposure:"曝光不合要求",color_cast:"色偏",halo:"边缘光晕",identity_drift:"主体身份漂移",misalignment:"配准或掩码错位",artifacts:"生成或压缩伪影",other:"其他问题" };
  const text = (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? record[key] as string : "";
  const rawRois = Array.isArray(review.rois) ? review.rois : [];
  const rois = rawRois.filter((roi) => {
    if (!roi || typeof roi !== "object" || !["input", "target"].includes(roi.role) || typeof roi.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(roi.sha256) || !Number.isInteger(roi.width) || !Number.isInteger(roi.height) || roi.width < 1 || roi.height < 1 || !Array.isArray(roi.normalized_xywh) || roi.normalized_xywh.length !== 4) return false;
    const [x, y, width, height] = roi.normalized_xywh;
    return [x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value)) && x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1;
  }) as import("../../auto-gt-workbench-api").AutoGtRoi[];
  return { pairId: text(data, "pair_id"), jobId: text(data, "job_id"), issue: text(data, "issue"), referenceLabel: kinds[text(data, "reference_kind")] ?? "未声明参考类别", inputSha256: text(data, "input_sha256"), targetSha256: text(data, "target_sha256"), recipeLabel: `${text(recipe, "recipe") || "未记录配方"} · ${text(recipe, "version") || "未记录版本"}`, seed: typeof data.seed === "number" && Number.isFinite(data.seed) ? data.seed : null, review: { id: text(review, "id"), revision: typeof review.pair_revision === "number" ? review.pair_revision : null, reasons: Array.isArray(review.reason_codes) ? review.reason_codes.filter((code): code is string => typeof code === "string").map((code) => reasonNames[code] ?? code) : [], note: text(review, "note"), createdAt: text(review, "created_at"), rois, invalidRoiCount: rawRois.length - rois.length } };
}
