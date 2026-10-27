import { useState } from "react";
import { apiUrl } from "../auth-api";
import type { Asset } from "../pages/platform/platform-store";
import type { FrozenAutoGtFailureEvidence } from "../pages/platform/auto-gt-display";
import "./auto-gt-failure-evidence.css";
function EvidenceImage({ asset, role, evidence }: { asset?: Asset; role: "input" | "target"; evidence: FrozenAutoGtFailureEvidence }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null); const [failed, setFailed] = useState(false);
  const label = role === "input" ? "诊断输入图" : "诊断目标参考"; const expectedSha = role === "input" ? evidence.inputSha256 : evidence.targetSha256;
  const bound = Boolean(asset && /^[a-fA-F0-9]{64}$/.test(expectedSha) && asset.sha256.toLowerCase() === expectedSha.toLowerCase());
  const rois = evidence.review.rois.map((roi, index) => ({ roi, index })).filter(({ roi }) => roi.role === role);
  if (!asset) return <figure><figcaption>{label}</figcaption><p role="alert">此样本缺少带明确 {role} 角色的图像资产，不能展示对应冻结区域。</p></figure>;
  const safePath = asset.playbackUrl.startsWith("/api/data-platform/") ? apiUrl(asset.playbackUrl) : undefined;
  return <figure><figcaption>{label} · SHA-256 {asset.sha256.slice(0, 12)}</figcaption><div className="autogt-frozen-image">
    {safePath && !failed ? <img src={safePath} alt={label} loading="lazy" onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} /> : <p role="alert">{label}读取失败，冻结区域未叠加。</p>}
    {bound && !failed && rois.map(({ roi, index }) => roi.sha256.toLowerCase() === asset.sha256.toLowerCase() && size?.width === roi.width && size?.height === roi.height ? <span key={index} role="img" aria-label={`冻结拒绝 ROI ${index + 1}`} data-testid={`frozen-rejection-roi-${index + 1}`} className="autogt-frozen-roi" style={{ left: `${roi.normalized_xywh[0] * 100}%`, top: `${roi.normalized_xywh[1] * 100}%`, width: `${roi.normalized_xywh[2] * 100}%`, height: `${roi.normalized_xywh[3] * 100}%` }} /> : null)}
  </div>{!bound && <p role="alert">{label}资产摘要与冻结证据不一致，区域未叠加。</p>}{bound && rois.some(({ roi }) => roi.sha256.toLowerCase() !== asset.sha256.toLowerCase()) && <p role="alert">{label}有冻结区域摘要不一致，相关区域未叠加。</p>}{bound && size && rois.some(({ roi }) => roi.width !== size.width || roi.height !== size.height) && <p role="alert">{label}像素尺寸与冻结区域不一致，相关区域未叠加。</p>}</figure>;
}
export function AutoGtFailureEvidence({ evidence, assets }: { evidence: FrozenAutoGtFailureEvidence; assets?: Asset[] }) {
  const input = assets?.find((asset) => asset.kind === "image" && asset.metadata?.role === "input"); const target = assets?.find((asset) => asset.kind === "image" && asset.metadata?.role === "target");
  return <section className="autogt-frozen-evidence" aria-label="冻结 AutoGT 拒绝证据"><h3>冻结拒绝证据</h3><p>问题与返工要求：{evidence.issue || "未附处理要求"}</p><p>人工拒绝原因：{evidence.review.reasons.join("、") || "未记录原因"}{evidence.review.note ? ` · ${evidence.review.note}` : ""}</p><p className="platform-help">{evidence.referenceLabel} · 配方 {evidence.recipeLabel}{evidence.seed !== null ? ` · Seed ${evidence.seed}` : ""} · 审核版本 {evidence.review.revision ?? "未记录"}</p><p className="platform-help">框与原因是原拒绝审核的只读证据，不是本次新标注；不会自动写入结构化标注，也不会将待标注样本判为通过。</p><div className="autogt-frozen-pair"><EvidenceImage key={`input:${input?.id}:${input?.sha256}`} asset={input} role="input" evidence={evidence} /><EvidenceImage key={`target:${target?.id}:${target?.sha256}`} asset={target} role="target" evidence={evidence} /></div>
  {!!evidence.review.rois.length && <ol>{evidence.review.rois.map((roi, index) => <li key={index}>冻结拒绝 ROI {index + 1} · {roi.role === "input" ? "输入图" : "目标参考"} · {roi.width}×{roi.height} 像素 · SHA-256 {roi.sha256.slice(0, 12)} · 归一化 x/y/w/h：{roi.normalized_xywh.map((value) => value.toFixed(3)).join(" / ")}</li>)}</ol>}{evidence.review.invalidRoiCount > 0 && <p role="alert">{evidence.review.invalidRoiCount} 个历史区域数据无效，未叠加到图像。</p>}
  </section>;
}
