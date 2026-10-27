import { interactionForEvent, type InteractionContext } from "../telemetry";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Check, CheckCircle2, Circle, Clock3, Download, ExternalLink, LockKeyhole, MessageSquare, Send } from "lucide-react";
import { useState } from "react";
import { commentRequirement, requirementQueryOptions, requirementsQueryOptions } from "../api";
import { useAuth } from "../auth-context";
import { RequirementActions } from "../components/RequirementActions";
import { RequirementForm } from "../components/RequirementForm";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { categoryLabels, checkPasses, formatDate, isOverdue, isPlatformRequirement, operatorLabels, priorityLabels, priorityScore, statusLabels, statusVariant, taskLabels } from "../requirements";
import type { AcceptanceCheck, Requirement, RequirementDelivery } from "../types";
import "./requirement-detail.css";

const actionLabels: Record<string, string> = {
  created: "创建需求", edited: "完善需求材料", commented: "发表讨论", submit: "提交评审", approve: "评审通过并锁定标准", request_changes: "要求补充材料",
  defer: "暂缓需求", resume: "恢复评审", cancel: "撤回需求", reject: "拒绝需求", schedule: "确认交付排期", deliver: "提交交付版本", accept: "验收通过", reject_acceptance: "验收退回",
};
const steps = ["需求提报", "范围评审", "交付排期", "执行交付", "用户验收", "完成归档"];
const flowIndex: Record<string, number> = { draft: 0, needs_info: 0, pending_review: 1, deferred: 1, pending_schedule: 2, in_progress: 3, pending_acceptance: 4, completed: 5 };
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className ? `req-detail-field ${className}` : "req-detail-field"}><dt>{label}</dt><dd>{children}</dd></div>;
}
function ArtifactReference({ value }: { value: string }) {
  let safe = false;
  try { const url = new URL(value); safe = url.protocol === "https:" || url.protocol === "http:"; } catch { /* Storage paths and report notes remain plain text. */ }
  return safe ? <a className="req-artifact-link md-state-layer inline-flex max-w-full items-center gap-1 break-all text-primary underline underline-offset-4" href={value} target="_blank" rel="noopener noreferrer">{value}<ExternalLink className="mt-1 size-3 shrink-0" aria-hidden="true" /></a> : <span className="whitespace-pre-wrap break-all">{value || "未提供"}</span>;
}
function Metrics({ checks, delivery }: { checks: AcceptanceCheck[]; delivery: RequirementDelivery | null }) {
  return <div className="req-metrics" role="table" aria-label="验收指标对照"><div className="req-metric-header" role="row"><span role="columnheader">验收指标</span><span role="columnheader">约定目标</span><span role="columnheader">实测结果</span><span role="columnheader">判定</span></div>{checks.map((check) => {
    const result = delivery?.results.find((item) => item.check_id === check.id);
    const passed = result && checkPasses(check, result.actual);
    return <div className="req-metric-entry" key={check.id}><div className="req-metric-row" role="row"><strong className="font-medium" role="cell">{check.label}</strong><span role="cell">{operatorLabels[check.operator]} {check.target} {check.unit}</span><span role="cell">{result ? `${result.actual} ${check.unit}` : "待交付"}</span><span role="cell"><Badge variant={!result ? "outline" : passed ? "success" : "warning"}>{!result ? "待验证" : passed ? "达标" : "未达标"}</Badge></span></div>{result && <p className="req-metric-evidence"><span>证据 · {result.source?.startsWith("server-frozen") ? "服务器冻结结果" : "外部人工证据（未验证）"}</span><ArtifactReference value={result.evidence} /></p>}</div>;
  })}</div>;
}
function Workflow({ status }: { status: Requirement["status"] }) {
  const current = flowIndex[status] ?? -1;
  return <ol className="md-workflow req-workflow" aria-label="需求交付进度" data-status={status}>{steps.map((label, index) => {
    const done = index < current || status === "completed";
    const active = index === current && !["completed", "deferred"].includes(status);
    return <li key={label} data-state={done ? "done" : active ? "active" : "pending"} aria-current={active ? "step" : undefined}><span className="md-workflow-dot">{done ? <Check /> : active ? <Clock3 /> : <Circle />}</span><span className="text-sm">{label}</span></li>;
  })}</ol>;
}
function ActivityFeed({ requirement }: { requirement: Requirement }) {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [filter, setFilter] = useState("all");
  const mutation = useMutation({
    mutationFn: (interaction: InteractionContext | undefined) => commentRequirement(requirement.id, comment.trim(), requirement.revision, me.csrf_token, interaction),
    onSuccess: async (updated) => {
      setComment(""); queryClient.setQueryData(requirementQueryOptions(requirement.id).queryKey, updated);
      await queryClient.invalidateQueries({ queryKey: requirementsQueryOptions.queryKey });
    },
  });
  const activities = requirement.activities.filter((item) => filter === "all" || (filter === "comments" ? item.action === "commented" : item.action !== "commented"));
  return <Card id="req-activity"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle role="heading" aria-level={2}>协作与处理记录</CardTitle><div className="req-segmented" role="group" aria-label="记录类型">{[["all", "全部"], ["decisions", "处理记录"], ["comments", "讨论"]].map(([key, label]) => <button key={key} aria-pressed={filter === key} data-track-id={`requirements.activity.${key}`} data-track-label={label} onClick={() => setFilter(key)}><span className="req-segment-content">{label}</span></button>)}</div></div><CardDescription>保留每次交付、退回与确认时的内容，参与人均可查看讨论。</CardDescription></CardHeader><CardContent>
    {requirement.allowed_actions.includes("comment") && <form className="mb-6 space-y-3" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) mutation.mutate(interactionForEvent(e.nativeEvent)); }}><label className="md-field"><span className="md-field-label">讨论内容</span><textarea aria-label="讨论内容" className="md-textarea" disabled={mutation.isPending} value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="澄清场景、同步进展，或说明验收问题…" maxLength={3000} /></label><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-muted-foreground">对本需求的参与人可见</span><Button data-track-id="requirements.comment.submit" data-track-label="发表需求讨论" type="submit" variant="outline" disabled={mutation.isPending || !comment.trim()}><Send />发表讨论</Button></div>{mutation.isError && <p className="text-sm text-destructive" role="alert">{mutation.error.message} <Button type="button" variant="ghost" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: requirementQueryOptions(requirement.id).queryKey })}>刷新后重试</Button></p>}</form>}
    <ol className="md-timeline">{activities.map((activity) => {
      const historicalDelivery = activity.details.delivery as RequirementDelivery | undefined;
      return <li key={activity.id}><span className="md-timeline-dot" /><div className="flex flex-wrap items-baseline justify-between gap-2"><strong className="md-title-small">{activity.actor_name} · {actionLabels[activity.action] ?? activity.action}</strong><time className="md-body-small text-muted-foreground" dateTime={activity.created_at}>{new Date(activity.created_at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div>{activity.comment && <p className="mt-2 whitespace-pre-wrap break-words text-base text-muted-foreground">{activity.comment}</p>}{activity.from_status && activity.from_status !== activity.to_status && <p className="mt-2 text-sm text-muted-foreground">{statusLabels[activity.from_status]} → {statusLabels[activity.to_status]}</p>}
        {(activity.action === "accept" || activity.action === "reject_acceptance") && typeof activity.details.acceptance_notes === "string" && <p className="req-history-note">{activity.details.acceptance_notes}</p>}
        {activity.action === "deliver" && <details className="req-history-details"><summary>查看本次交付记录{historicalDelivery?.dataset_version && ` · ${historicalDelivery.dataset_version}`}</summary><div className="space-y-3 pt-3">{typeof activity.details.delivery_notes === "string" && <p className="whitespace-pre-wrap text-sm">{activity.details.delivery_notes}</p>}{historicalDelivery && <><p className="text-sm"><ArtifactReference value={historicalDelivery.dataset_uri} /></p><Metrics checks={(activity.details.checks as AcceptanceCheck[]) ?? []} delivery={historicalDelivery} /></>}</div></details>}
      </li>;
    })}</ol>{!activities.length && <p className="py-4 text-sm text-muted-foreground">暂无此类记录。</p>}
  </CardContent></Card>;
}
function exportAcceptance(item: Requirement) {
  const platform = isPlatformRequirement(item);
  const accepted = item.activities.find((activity) => activity.action === "accept");
  const lines = [
    `# ${item.requirement_no} · ${item.title}`, "", `状态：${statusLabels[item.status]}`, `提报人：${item.requester_name}`, `负责人：${item.owner_name ?? "未分配"}`,
    `期望日期：${item.desired_due_date ?? "未设置"}`, `承诺日期：${item.committed_due_date ?? "未设置"}`, `目标版本：${item.planned_version ?? "未设置"}`,
    "", "## 需求范围", item.description, "", "## 期望结果", item.expected_result, "", platform ? "## 平台开发规格" : "## 数据规格",
    ...(platform && item.platform_spec ? [`功能模块：${item.platform_spec.module}`, `使用对象：${item.platform_spec.affected_users}`, `功能范围：${item.platform_spec.scope}`, `范围外事项：${item.platform_spec.non_goals || "未指定"}`, `依赖与约束：${item.platform_spec.dependencies || "未指定"}`] : item.data_spec && !platform ? [`类型：${taskLabels[item.data_spec.task_type]}`, `场景：${item.data_spec.scenario}`, `模态：${item.data_spec.modalities.join("、")}`, `数量：${item.data_spec.quantity} ${item.data_spec.unit}`, `来源：${item.data_spec.source}`, `目标模型：${item.data_spec.target_model}`] : ["通用需求"]),
    "", "## 验收标准", item.acceptance_criteria, "", "## 交付记录", item.delivery_notes ?? "未交付",
    ...(item.delivery ? [`${platform ? "功能 / 发布入口" : "数据集"}：${item.delivery.dataset_uri}`, `${platform ? "发布版本" : "数据集版本"}：${item.delivery.dataset_version}`, `${platform ? "测试报告" : "质量报告"}：${item.delivery.report_uri}`, platform ? `运行环境：${item.delivery.environment || "未指定"}` : `验证模型：${item.delivery.model_version || "未指定"}`] : []),
    "", ...item.checks.flatMap((check) => { const result = item.delivery?.results.find((entry) => entry.check_id === check.id); return [`### ${check.label}`, `目标：${operatorLabels[check.operator]} ${check.target} ${check.unit}`, `实测：${result ? `${result.actual} ${check.unit}` : "未提供"}`, `证据：${result?.evidence ?? "未提供"}`, `判定：${result ? checkPasses(check, result.actual) ? "达标" : "未达标" : "待验证"}`, ""]; }),
    "## 验收结论", item.acceptance_notes ?? "待验收", `验收人：${accepted?.actor_name ?? "待确认"}`, `验收时间：${accepted?.created_at ?? "未完成"}`, "", "## 处理历史",
    ...item.activities.map((activity) => `${activity.created_at} · ${activity.actor_name} · ${actionLabels[activity.action] ?? activity.action}\n${activity.comment}`),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `${item.requirement_no}-验收记录.md`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function RequirementDetailPage() {
  const { requirementId } = useParams({ from: "/requirements/$requirementId" });
  const { data: requirement } = useSuspenseQuery(requirementQueryOptions(requirementId));
  const [editing, setEditing] = useState(false);
  const [actionGeneration, setActionGeneration] = useState(0);
  const platform = isPlatformRequirement(requirement);
  const latestDecision = requirement.activities.find((activity) => !["commented", "edited"].includes(activity.action));
  const accepted = requirement.activities.find((activity) => activity.action === "accept");
  const contractLocked = requirement.activities.some((activity) => activity.action === "approve") || ["pending_schedule", "in_progress", "pending_acceptance", "completed"].includes(requirement.status);
  return <main className="md-page req-detail">
    <Link to="/requirements" className="req-detail-back"><ArrowLeft className="size-4" />返回需求管理</Link>
    <header className="req-detail-header"><div className="min-w-0"><h1 className="md-page-title">{requirement.title}</h1><div className="req-detail-meta"><span>{requirement.requirement_no}</span><Badge variant={statusVariant(requirement.status)}>{statusLabels[requirement.status]}</Badge><span className={`req-priority req-priority-${requirement.priority}`}>{priorityLabels[requirement.priority]}优先级</span><span>{platform ? `平台开发 · ${categoryLabels[requirement.category]}` : requirement.data_spec ? taskLabels[requirement.data_spec.task_type] : categoryLabels[requirement.category]}</span><span>{requirement.requester_name} 提报 · {new Date(requirement.created_at).toLocaleDateString("zh-CN")}</span></div></div>{requirement.status === "completed" && <Button variant="outline" data-track-id="requirements.acceptance.export" data-track-label="导出验收记录" onClick={() => exportAcceptance(requirement)}><Download />导出验收记录</Button>}</header>
    <div className="req-detail-progress"><Workflow status={requirement.status} />{["needs_info", "deferred", "rejected", "cancelled"].includes(requirement.status) && latestDecision && <p className="req-notice">{actionLabels[latestDecision.action] ?? statusLabels[requirement.status]}{latestDecision.comment && `：${latestDecision.comment}`}</p>}{requirement.status === "completed" && accepted && <div className="req-completed"><CheckCircle2 /><span>{accepted.actor_name} 已于 {new Date(accepted.created_at).toLocaleString("zh-CN")} 确认验收通过。</span></div>}</div>
    <nav className="req-detail-section-nav" aria-label="需求详情章节"><a href="#req-description">需求内容</a><a href="#req-delivery">交付与验收</a><a href="#req-activity">处理记录</a><a href="#req-actions">当前处理</a></nav>
    {editing && requirement.allowed_actions.includes("edit") && <RequirementForm key={requirement.id} requirement={requirement} onClose={() => { setEditing(false); setActionGeneration((value) => value + 1); }} />}
    <div className="req-detail-grid"><div className="req-detail-document">
      <Card id="req-description"><CardHeader><CardTitle role="heading" aria-level={2}>需求说明</CardTitle></CardHeader><CardContent><dl className="grid gap-5"><Field label="背景与问题">{requirement.description || "待补充"}</Field><Field label="期望结果">{requirement.expected_result || "待补充"}</Field></dl></CardContent></Card>
      {requirement.platform_spec && <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle role="heading" aria-level={2}>平台开发规格</CardTitle>{contractLocked && <span className="flex items-center gap-1 text-sm text-muted-foreground"><LockKeyhole className="size-4" />评审基线已锁定</span>}</div></CardHeader><CardContent><dl className="grid gap-5 sm:grid-cols-2"><Field label="功能模块">{requirement.platform_spec.module || "待补充"}</Field><Field label="使用对象">{requirement.platform_spec.affected_users || "待补充"}</Field><Field className="sm:col-span-2" label="功能范围">{requirement.platform_spec.scope || "待补充"}</Field><Field label="范围外事项">{requirement.platform_spec.non_goals || "未指定"}</Field><Field label="依赖与约束">{requirement.platform_spec.dependencies || "未指定"}</Field></dl></CardContent></Card>}
      {requirement.data_spec && !platform && <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle role="heading" aria-level={2}>数据规格</CardTitle>{contractLocked && <span className="flex items-center gap-1 text-sm text-muted-foreground"><LockKeyhole className="size-4" />评审基线已锁定</span>}</div></CardHeader><CardContent><dl className="grid gap-5 sm:grid-cols-2"><Field label="目标模型 / 基线">{requirement.data_spec.target_model || "待补充"}</Field><Field label="需求规模">{requirement.data_spec.quantity.toLocaleString()} {requirement.data_spec.unit}</Field><Field label="数据模态">{requirement.data_spec.modalities.join("、") || "待补充"}</Field><Field label="数据来源">{requirement.data_spec.source || "待补充"}</Field><Field className="sm:col-span-2" label="场景范围与排除条件">{requirement.data_spec.scenario || "待补充"}</Field></dl></CardContent></Card>}
      <Card id="req-delivery"><CardHeader><CardTitle role="heading" aria-level={2}>交付与验收</CardTitle><CardDescription>{platform ? "根据功能范围与验收用例核验发布版本，结合测试报告确认结果。" : contractLocked ? "按评审确认的标准核验交付。录入的实测结果需结合证据人工复核。" : "评审时确认验收方法和量化指标，作为交付依据。"}</CardDescription></CardHeader><CardContent className="space-y-5">
        <dl><Field label="验收方法与补充条件">{requirement.acceptance_criteria || "待评审确认"}</Field></dl>
        {requirement.checks.length > 0 && <Metrics checks={requirement.checks} delivery={requirement.delivery} />}
        {requirement.delivery && <dl className="req-delivery-references grid gap-4 sm:grid-cols-2"><Field label={platform ? "发布版本" : "数据集版本"}>{requirement.delivery.dataset_version || "未提供"}</Field><Field label={platform ? "运行环境" : "验证模型版本"}>{(platform ? requirement.delivery.environment : requirement.delivery.model_version) || "未指定"}</Field><Field className="sm:col-span-2" label={platform ? "功能 / 发布入口" : "数据集 / 交付物"}><ArtifactReference value={requirement.delivery.dataset_uri} /></Field><Field className="sm:col-span-2" label={platform ? "测试报告" : "质量 / 评测报告"}><ArtifactReference value={requirement.delivery.report_uri} /></Field></dl>}
        {requirement.delivery_notes && <dl><Field label="交付说明">{requirement.delivery_notes}</Field></dl>}{requirement.acceptance_notes && <dl className="req-acceptance-note"><Field label="最近验收记录">{requirement.acceptance_notes}</Field></dl>}
        {!requirement.delivery_notes && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="size-4" />交付提交后展示交付物、验证结果与验收记录。</p>}
      </CardContent></Card>
      <ActivityFeed requirement={requirement} />
    </div><aside id="req-actions" className="req-detail-sidebar">
      <RequirementActions key={`${requirement.id}-${requirement.status}-${actionGeneration}`} requirement={requirement} onEdit={() => { setEditing(true); window.setTimeout(() => document.querySelector(".req-form")?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }), 0); }} />
      <Card><CardHeader><CardTitle>责任与计划</CardTitle></CardHeader><CardContent><dl className="grid grid-cols-2 gap-x-4 gap-y-5"><Field label="提报 / 验收人">{requirement.requester_name}</Field><Field label="交付负责人">{requirement.owner_name ?? "待分配"}</Field><Field label="用户期望">{formatDate(requirement.desired_due_date)}</Field><Field label="团队承诺"><span className={isOverdue(requirement) ? "text-warning" : ""}>{formatDate(requirement.committed_due_date)}{isOverdue(requirement) && " · 已逾期"}</span></Field><Field label="目标版本">{requirement.planned_version ?? "待排期"}</Field><Field label="最后更新">{new Date(requirement.updated_at).toLocaleDateString("zh-CN")}</Field></dl>{requirement.prioritization && <div className="req-score"><strong>{priorityScore(requirement.prioritization).toFixed(1)}</strong><span>价值评分<small>影响 {requirement.prioritization.impact} · 紧迫 {requirement.prioritization.urgency} · 置信 {requirement.prioritization.confidence} · {requirement.prioritization.effort} 人日</small></span></div>}</CardContent></Card>
      <p className="md-body-medium flex items-start gap-2 px-2 text-muted-foreground"><MessageSquare className="mt-0.5 size-4 shrink-0" />范围变化请先在讨论中澄清。已通过评审的规格与指标作为本轮交付基线。</p>
    </aside></div>
  </main>;
}
