import { interactionForEvent, type InteractionContext } from "../telemetry";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, CheckCircle2, Pencil, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { participantsQueryOptions, requirementQueryOptions, requirementsQueryOptions, transitionRequirement } from "../api";
import { useAuth } from "../auth-context";
import { checkPasses, isPlatformRequirement, nextStep, operatorLabels, priorityScore } from "../requirements";
import type { Prioritization, Requirement, RequirementDelivery, RequirementTransitionInput } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { RequirementDeliveryBinding } from "./RequirementDeliveryBinding";
import { PermissionRequestButton } from "./PermissionRequestButton";

export function RequirementActions(props: { requirement: Requirement; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const [generation, setGeneration] = useState(0);
  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: requirementQueryOptions(props.requirement.id).queryKey });
    setGeneration((value) => value + 1);
  };
  return <ActionForm key={`${props.requirement.id}-${props.requirement.status}-${generation}`} {...props} onReload={() => void reload()} />;
}

function ActionForm({ requirement: currentRequirement, onEdit, onReload }: { requirement: Requirement; onEdit: () => void; onReload: () => void }) {
  const [requirement] = useState(currentRequirement);
  const contractLocked = requirement.activities.some((item) => item.action === "approve");
  const { me, can } = useAuth();
  const queryClient = useQueryClient();
  const allowed = (action: string) => requirement.allowed_actions.includes(action);
  const primaryAction = ({ draft: "submit", needs_info: "submit", pending_review: "approve", pending_schedule: "schedule", deferred: "resume", in_progress: "deliver", pending_acceptance: "accept" } as Record<string, string>)[requirement.status];
  const primaryLabel = ({ submit: "提交评审", approve: "需求评审", schedule: "需求排期", resume: "恢复评审", deliver: "提交交付", accept: "需求验收" } as Record<string, string>)[primaryAction];
  const eligibleForRequest = primaryAction && (!new Set(["submit", "accept"]).has(primaryAction) || requirement.requester_id === me.user.id)
    && (primaryAction !== "deliver" || requirement.owner_id === me.user.id || can("requirements:manage"));
  const participants = useQuery({ ...participantsQueryOptions, enabled: allowed("schedule") });
  const [comment, setComment] = useState("");
  const [criteria, setCriteria] = useState(requirement.acceptance_criteria);
  const [ownerId, setOwnerId] = useState(requirement.owner_id ?? "");
  const [committedDate, setCommittedDate] = useState(requirement.committed_due_date ?? "");
  const [version, setVersion] = useState(requirement.planned_version ?? "");
  const [deliveryNotes, setDeliveryNotes] = useState(requirement.delivery_notes ?? "");
  const [acceptanceNotes, setAcceptanceNotes] = useState("");
  const [signed, setSigned] = useState(false);
  const [score, setScore] = useState<Prioritization>(requirement.prioritization ?? { impact: 3, urgency: 3, confidence: 3, effort: 5 });
  const [delivery, setDelivery] = useState<RequirementDelivery>(requirement.delivery ?? { dataset_uri: "", dataset_version: "", report_uri: "", model_version: "", results: [] });
  const [actuals, setActuals] = useState<Record<string, string>>(() => Object.fromEntries(requirement.checks.map((check) => [check.id, requirement.delivery?.results.find((item) => item.check_id === check.id)?.actual.toString() ?? ""])));
  const [evidence, setEvidence] = useState<Record<string, string>>(() => Object.fromEntries(requirement.checks.map((check) => [check.id, requirement.delivery?.results.find((item) => item.check_id === check.id)?.evidence ?? ""])));
  const [showCancel, setShowCancel] = useState(false);
  const mutation = useMutation({
    mutationFn: ({ payload, interaction }: { payload: RequirementTransitionInput; interaction?: InteractionContext }) => transitionRequirement(requirement.id, { ...payload, expected_revision: requirement.revision }, me.csrf_token, interaction),
    onSuccess: async (updated) => {
      queryClient.setQueryData(requirementQueryOptions(requirement.id).queryKey, updated);
      await queryClient.invalidateQueries({ queryKey: requirementsQueryOptions.queryKey });
    },
  });
  const run = (payload: RequirementTransitionInput, event: React.MouseEvent) => mutation.mutate({ payload: { ...payload, comment }, interaction: interactionForEvent(event.nativeEvent) });
  const platform = isPlatformRequirement(requirement);
  const structured = Boolean(requirement.data_spec && requirement.data_spec.task_type !== "platform");
  const allPassed = requirement.checks.every((check) => { const result = requirement.delivery?.results.find((item) => item.check_id === check.id); return result && result.evidence.trim() && checkPasses(check, result.actual); });
  const entityDelivery = Boolean(delivery.dataset_version_id || delivery.experiment_id);
  const metricResultsComplete = requirement.checks.every((check) => actuals[check.id]?.trim() && Number.isFinite(Number(actuals[check.id])) && evidence[check.id]?.trim());
  const deliveryComplete = entityDelivery || metricResultsComplete && (!(structured || requirement.platform_spec) || Boolean(delivery.dataset_uri.trim() && delivery.dataset_version.trim() && delivery.report_uri.trim()));
  const feedbackField = (label = "处理意见", placeholder = "说明决策依据、依赖或风险；退回、暂缓或拒绝时必填。") => <label className="md-field"><span className="md-field-label">{label}</span><textarea aria-label={label} className="md-textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={placeholder} maxLength={3000} /></label>;
  const deliveryField = (key: "dataset_uri" | "dataset_version" | "report_uri" | "model_version" | "environment", label: string, placeholder: string) => <label className="md-field"><span className="md-field-label">{label}</span><Input value={delivery[key] ?? ""} onValueChange={(value) => setDelivery((previous) => ({ ...previous, [key]: value }))} placeholder={placeholder} maxLength={key.includes("uri") ? 2000 : 160} /></label>;
  let body: React.ReactNode;
  let title = "当前进展";
  let description = nextStep(requirement, me.user.id);
  if (allowed("submit") || allowed("edit")) {
    title = requirement.status === "draft" ? "完成提报" : "补充需求材料";
    description = "保存完善后的规格与指标，再提交到评审队列。";
    body = <>{allowed("edit") && <Button variant="outline" data-track-id="requirements.edit.open" data-track-label="编辑需求材料" onClick={onEdit}><Pencil />编辑需求材料</Button>}{feedbackField("补充说明", "本次补充或调整了哪些内容？")}{allowed("submit") && <Button disabled={mutation.isPending} data-track-id="requirements.action.submit" data-track-label="提交评审" onClick={(event) => run({ action: "submit" }, event)}><Send />提交评审</Button>}</>;
  } else if (requirement.status === "pending_review" && ["approve", "request_changes", "defer", "reject"].some(allowed)) {
    title = "需求评审"; description = "确认范围与验收方法，结合价值和投入确定排期顺序。";
    body = <><label className="md-field"><span className="md-field-label">验收方法与补充条件</span><textarea aria-label="验收方法与补充条件" className="md-textarea" rows={4} readOnly={contractLocked} value={criteria} onChange={(e) => setCriteria(e.target.value)} maxLength={3000} /></label>
      <fieldset><legend className="mb-3 text-sm font-medium">价值评估</legend><div className="grid grid-cols-2 gap-3">{(["impact", "urgency", "confidence"] as const).map((key) => <label className="md-field" key={key}><span className="md-field-label">{{ impact: "业务影响", urgency: "时间紧迫性", confidence: "证据置信度" }[key]}</span><select className="md-select" value={score[key]} onChange={(e) => setScore({ ...score, [key]: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option value={n} key={n}>{n} · {n === 1 ? "最低" : n === 5 ? "最高" : ""}</option>)}</select></label>)}<label className="md-field"><span className="md-field-label">预计投入（人日）</span><Input type="number" min={0.1} max={10000} step={0.5} value={score.effort || ""} onChange={(e) => setScore({ ...score, effort: Number(e.target.value) })} /></label></div><div className="req-score"><strong>{score.effort > 0 ? priorityScore(score).toFixed(1) : "—"}</strong><span>价值评分<small>（影响 + 紧迫性）× 置信度 ÷ 人日</small></span></div></fieldset>
      {feedbackField("评审意见")}
      {allowed("approve") && <Button disabled={mutation.isPending || !criteria.trim() || score.effort <= 0} data-track-id="requirements.action.approve" data-track-label="通过评审" onClick={(event) => run({ action: "approve", acceptance_criteria: criteria, prioritization: score }, event)}><Check />通过评审并锁定标准</Button>}
      <div className="flex flex-wrap gap-2">{allowed("request_changes") && <Button variant="outline" disabled={mutation.isPending || !comment.trim()} data-track-id="requirements.action.request_changes" data-track-label="要求补充材料" onClick={(event) => run({ action: "request_changes" }, event)}>补充材料</Button>}{allowed("defer") && <Button variant="ghost" disabled={mutation.isPending || !comment.trim()} data-track-id="requirements.action.defer" data-track-label="暂缓需求" onClick={(event) => run({ action: "defer" }, event)}>暂缓</Button>}{allowed("reject") && <Button variant="ghost" className="text-destructive" disabled={mutation.isPending || !comment.trim()} data-track-id="requirements.action.reject" data-track-label="拒绝需求" onClick={(event) => run({ action: "reject" }, event)}>拒绝</Button>}</div></>;
  } else if (requirement.status === "pending_schedule" && ["schedule", "defer", "reject"].some(allowed)) {
    title = "安排交付"; description = "确定负责人、团队承诺日期与目标版本。";
    body = <><label className="md-field"><span className="md-field-label">负责人</span><select className="md-select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">请选择交付负责人</option>{participants.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{participants.isError && <p role="alert" className="text-sm text-destructive">负责人加载失败。<Button variant="ghost" size="sm" onClick={() => void participants.refetch()}>重试</Button></p>}
      <label className="md-field"><span className="md-field-label">承诺交付日期</span><Input type="date" value={committedDate} onChange={(e) => setCommittedDate(e.target.value)} /></label><label className="md-field"><span className="md-field-label">目标版本</span><Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="例如 wm-data-2026.09" maxLength={80} /></label>{feedbackField("排期说明")}
      {allowed("schedule") && <Button disabled={mutation.isPending || !ownerId || !committedDate || !version.trim()} data-track-id="requirements.action.schedule" data-track-label="确认排期" onClick={(event) => run({ action: "schedule", owner_id: ownerId, committed_due_date: committedDate, planned_version: version }, event)}><CalendarDays />确认排期并开始</Button>}
      <div className="flex gap-2">{allowed("defer") && <Button variant="ghost" disabled={mutation.isPending || !comment.trim()} data-track-id="requirements.action.defer" data-track-label="暂缓需求" onClick={(event) => run({ action: "defer" }, event)}>暂缓排期</Button>}{allowed("reject") && <Button variant="ghost" className="text-destructive" disabled={mutation.isPending || !comment.trim()} data-track-id="requirements.action.reject" data-track-label="拒绝需求" onClick={(event) => run({ action: "reject" }, event)}>拒绝需求</Button>}</div></>;
  } else if (allowed("resume")) {
    title = "恢复评审"; description = "恢复后重新确认范围和排期条件。";
    body = <>{feedbackField("恢复说明")}{allowed("resume") && <Button disabled={mutation.isPending} data-track-id="requirements.action.resume" data-track-label="恢复评审" onClick={(event) => run({ action: "resume" }, event)}><RotateCcw />恢复到评审队列</Button>}</>;
  } else if (allowed("deliver")) {
    title = "提交交付"; description = "填写本轮交付版本与实测证据，提交后由提报人验收。";
    body = <><label className="md-field"><span className="md-field-label">交付说明</span><textarea aria-label="交付说明" className="md-textarea" rows={3} value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} placeholder={platform ? "功能变更、发布说明、使用方式、测试结论与已知限制" : "交付清单、使用方式、质量结论与已知限制"} maxLength={5000} /></label>
      {!platform && <RequirementDeliveryBinding value={delivery} onChange={setDelivery} checks={requirement.checks} />}
      {!entityDelivery && <>{deliveryField("dataset_uri", platform ? "功能 / 发布入口" : "数据集 / 交付物地址", platform ? "功能页面、发布记录或制品链接" : "https://… 或 s3://bucket/path")}{deliveryField("dataset_version", platform ? "发布版本" : "数据集版本", platform ? "例如 platform-v1.8.0" : "不可变的数据集版本")}{deliveryField("report_uri", platform ? "测试报告地址" : "质量 / 评测报告地址", "https://…")}{platform ? deliveryField("environment", "运行环境（选填）", "例如预发布环境 / 生产环境") : deliveryField("model_version", "验证模型版本（选填）", "固定用于验证的模型版本")}</>}
      {!entityDelivery && requirement.checks.map((check) => <fieldset className="req-result-editor" key={check.id}><legend>{check.label}<span>{operatorLabels[check.operator]} {check.target} {check.unit}</span></legend><label className="md-field"><span className="md-field-label">实测值 · {check.unit}</span><Input type="number" step="any" value={actuals[check.id]} onValueChange={(value) => setActuals((previous) => ({ ...previous, [check.id]: value }))} /></label><label className="md-field"><span className="md-field-label">验证证据</span><textarea aria-label="验证证据" className="md-textarea" rows={2} value={evidence[check.id]} onChange={(e) => { const value = e.target.value; setEvidence((previous) => ({ ...previous, [check.id]: value })); }} placeholder="报告链接、抽样结果或验证记录" maxLength={3000} /></label>{actuals[check.id]?.trim() && <Badge className="mt-3 h-auto min-h-8 max-w-full whitespace-normal py-1" variant={checkPasses(check, Number(actuals[check.id])) ? "success" : "warning"}>{checkPasses(check, Number(actuals[check.id])) ? "达到目标" : "未达目标，无法通过最终验收"}</Badge>}</fieldset>)}
      {allowed("deliver") && <Button disabled={mutation.isPending || !deliveryNotes.trim() || !deliveryComplete} data-track-id="requirements.action.deliver" data-track-label="提交用户验收" onClick={(event) => run({ action: "deliver", delivery_notes: deliveryNotes, delivery: { ...delivery, metric_bindings: entityDelivery ? requirement.checks.map(check => delivery.metric_bindings?.find(row=>row.check_id===check.id) ?? {check_id:check.id,source:delivery.experiment_id ? "evaluation" as const : "quality" as const,metric:delivery.experiment_id ? "score":"sampleCount",slice:"all"}) : [], results: entityDelivery ? [] : requirement.checks.map((check) => ({ check_id: check.id, actual: Number(actuals[check.id]), evidence: evidence[check.id] })) } }, event)}><Send />提交用户验收</Button>}</>;
  } else if (allowed("accept") || allowed("reject_acceptance")) {
    title = "用户验收"; description = "核验交付物与指标，并留下你的验收结论。";
    body = <>{!allPassed && <p className="req-notice">还有未达标或缺少证据的指标，请退回交付方修正。</p>}<label className="md-field"><span className="md-field-label">验收记录</span><textarea aria-label="验收记录" className="md-textarea" rows={4} value={acceptanceNotes} onChange={(e) => setAcceptanceNotes(e.target.value)} placeholder="记录核验方法、结论，或具体的退回原因" maxLength={3000} /></label><label className="req-signoff"><input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} /><span>我已核对交付版本、验收指标和验证证据。</span></label>{allowed("accept") && <Button disabled={mutation.isPending || !allPassed || !signed || !acceptanceNotes.trim()} data-track-id="requirements.action.accept" data-track-label="验收通过" onClick={(event) => run({ action: "accept", acceptance_notes: acceptanceNotes }, event)}><CheckCircle2 />验收通过</Button>}{allowed("reject_acceptance") && <Button variant="outline" disabled={mutation.isPending || !acceptanceNotes.trim()} data-track-id="requirements.action.reject_acceptance" data-track-label="退回交付" onClick={(event) => run({ action: "reject_acceptance", acceptance_notes: acceptanceNotes }, event)}><RotateCcw />退回重新交付</Button>}</>;
  } else {
    body = <div className="req-waiting"><ShieldCheck className="size-6 text-primary" /><p>{requirement.status === "pending_acceptance" ? `由提报人 ${requirement.requester_name} 确认验收。` : requirement.status === "completed" ? "验收已完成，交付版本和处理记录已保留。" : "状态变化和处理意见会更新在下方记录中。"}</p></div>;
  }
  return <Card className="req-action-panel"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><fieldset className="min-w-0 space-y-4" disabled={mutation.isPending} aria-busy={mutation.isPending}>{currentRequirement.revision !== requirement.revision && <div className="req-notice">需求有新动态，未提交的内容已保留。<Button className="mt-2" variant="ghost" size="sm" onClick={onReload}>重新载入操作表单（清空未提交内容）</Button></div>}{body}
    {eligibleForRequest && !can(`requirements:${primaryAction}`) && <PermissionRequestButton permission={`requirements:${primaryAction}`} label={`申请${primaryLabel}权限`} />}
    {mutation.isError && <div role="alert" className="text-sm text-destructive"><p>{mutation.error.message}</p><Button className="mt-1" variant="ghost" size="sm" onClick={onReload}>重新载入操作表单（清空未提交内容）</Button></div>}
    {allowed("cancel") && <div className="pt-3">{!showCancel ? <Button variant="ghost" className="text-muted-foreground" data-track-id="requirements.cancel.open" data-track-label="打开撤回需求" onClick={() => setShowCancel(true)}>撤回需求…</Button> : <div className="space-y-3"><p className="text-sm text-muted-foreground">撤回后关闭本需求，已有记录仍会保留。</p>{feedbackField("撤回原因", "为什么不再需要此项交付？")}<div className="flex gap-2"><Button variant="destructive" disabled={mutation.isPending || !comment.trim()} data-track-id="requirements.action.cancel" data-track-label="撤回需求" onClick={(event) => run({ action: "cancel" }, event)}>确认撤回</Button><Button variant="ghost" onClick={() => setShowCancel(false)}>保留需求</Button></div></div>}</div>}
  </fieldset></CardContent></Card>;
}
