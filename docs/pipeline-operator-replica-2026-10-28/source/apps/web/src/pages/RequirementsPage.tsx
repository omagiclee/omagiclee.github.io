import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardCheck, Clock3, Columns3, Filter, List, Plus, Search, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { requirementsQueryOptions } from "../api";
import { useAuth } from "../auth-context";
import { PermissionRequestButton } from "../components/PermissionRequestButton";
import { RequirementForm } from "../components/RequirementForm";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ToolbarSelect } from "../components/ui/period-menu";
import { Input } from "../components/ui/input";
import { categoryLabels, closedStatuses, formatDate, isOverdue, isPlatformRequirement, nextStep, priorityLabels, priorityScore, statusLabels, statusVariant, taskLabels } from "../requirements";
import type { DataTaskType, Requirement, RequirementStatus } from "../types";
import "./requirements.css";

type FilterKey = "all" | "todo" | "overdue" | RequirementStatus;
const boardColumns: { label: string; statuses: RequirementStatus[] }[] = [
  { label: "提报与补充", statuses: ["draft", "needs_info"] }, { label: "需求评审", statuses: ["pending_review", "deferred"] },
  { label: "交付排期", statuses: ["pending_schedule"] }, { label: "执行交付", statuses: ["in_progress"] },
  { label: "用户验收", statuses: ["pending_acceptance"] }, { label: "已关闭", statuses: ["completed", "rejected", "cancelled"] },
];
function pendingAction(item: Requirement, admin: boolean, userId: string) {
  return admin ? ["pending_review", "pending_schedule"].includes(item.status) :
    (item.requester_id === userId && ["draft", "needs_info", "pending_acceptance"].includes(item.status)) ||
    (item.owner_id === userId && item.status === "in_progress");
}
function RequirementCard({ item }: { item: Requirement }) {
  return <Link data-track-id="requirements.detail.open" data-track-label="打开需求详情" className="req-board-card md-state-layer" to="/requirements/$requirementId" params={{ requirementId: item.id }}>
    <div className="flex items-center justify-between gap-2"><span className="md-body-small text-muted-foreground">{item.requirement_no}</span><span className={`req-priority req-priority-${item.priority}`}>{priorityLabels[item.priority]}</span></div>
    <strong className="md-title-medium my-3 block">{item.title}</strong><Badge variant={statusVariant(item.status)}>{statusLabels[item.status]}</Badge>
    <p className="my-3 text-sm text-muted-foreground">{isPlatformRequirement(item) ? `平台开发 · ${categoryLabels[item.category]}` : item.data_spec ? taskLabels[item.data_spec.task_type] : categoryLabels[item.category]}</p>
    <div className="flex flex-wrap justify-between gap-2 pt-3 text-sm"><span>{item.owner_name ?? "待分配"}</span><span className={isOverdue(item) ? "text-warning" : "text-muted-foreground"}>{isOverdue(item) && "逾期 · "}{formatDate(item.committed_due_date)}</span></div>
  </Link>;
}
export default function RequirementsPage() {
  const { data: requirements } = useSuspenseQuery(requirementsQueryOptions);
  const { me, can } = useAuth();
  const canManage = can("requirements:manage") && can("requirements:read_all");
  const [perspective, setPerspective] = useState<"admin" | "user">(canManage ? "admin" : "user");
  const admin = perspective === "admin" && canManage;
  const createPanelId = useId();
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [task, setTask] = useState<"all" | DataTaskType>("all");
  const [direction, setDirection] = useState("all");
  const availableTasks = (Object.entries(taskLabels) as [DataTaskType, string][]).filter(([key]) => direction === "all" || (direction === "platform" ? key === "platform" : key !== "platform"));
  const effectiveTask = task === "all" || availableTasks.some(([key]) => key === task) ? task : "all";
  const [sort, setSort] = useState("updated");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [compact, setCompact] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 479px)").matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 479px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [relation, setRelation] = useState("involved");
  const scoped = useMemo(() => requirements.filter((item) => admin || (relation === "requested" ? item.requester_id === me.user.id : relation === "assigned" ? item.owner_id === me.user.id : item.requester_id === me.user.id || item.owner_id === me.user.id)), [requirements, admin, relation, me.user.id]);
  const overdue = scoped.filter(isOverdue).length;
  const todo = scoped.filter((item) => pendingAction(item, admin, me.user.id)).length;
  const filtered = useMemo(() => scoped.filter((item) =>
    (filter === "all" || (filter === "todo" ? pendingAction(item, admin, me.user.id) : filter === "overdue" ? isOverdue(item) : item.status === filter)) &&
    (direction === "all" || (direction === "platform" ? isPlatformRequirement(item) : !isPlatformRequirement(item))) &&
    (effectiveTask === "all" || (effectiveTask === "platform" ? isPlatformRequirement(item) : item.data_spec?.task_type === effectiveTask)) &&
    (!query.trim() || `${item.requirement_no} ${item.title} ${item.requester_name} ${item.owner_name ?? ""} ${item.data_spec?.scenario ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
  ).sort((a, b) => sort === "score" ? priorityScore(b.prioritization) - priorityScore(a.prioritization) : sort === "due" ? (a.committed_due_date ?? "9999").localeCompare(b.committed_due_date ?? "9999") : b.updated_at.localeCompare(a.updated_at)), [scoped, filter, effectiveTask, direction, query, sort, admin, me.user.id]);
  const clearFilters = () => { setFilter("all"); setQuery(""); setTask("all"); setDirection("all"); setRelation("involved"); };
  const activeExtraFilters = Number(effectiveTask !== "all") + Number(!admin && relation !== "involved") + Number(compact && direction !== "all");
  const hasFilters = filter !== "all" || Boolean(query.trim()) || effectiveTask !== "all" || direction !== "all" || (!admin && relation !== "involved");
  const viewToggle = <div className="req-segmented req-view-toggle" role="group" aria-label="展示方式"><button aria-pressed={layout === "list"} data-track-id="requirements.layout.list" data-track-label="需求列表" onClick={() => setLayout("list")}><span className="req-segment-content"><List />列表</span></button><button aria-pressed={layout === "board"} data-track-id="requirements.layout.board" data-track-label="需求看板" onClick={() => setLayout("board")}><span className="req-segment-content"><Columns3 />看板</span></button></div>;
  return <main className="md-page req-workspace">
    <header className="req-page-header">
      <div><div className="req-title-line"><h1 className="md-page-title">需求管理</h1><span className="req-result-count" aria-live="polite">{filtered.length} 条{hasFilters && ` / 共 ${scoped.length} 条`}</span>{compact && viewToggle}</div><p className="req-page-description">{admin ? "跟踪项目需求的评审、交付与验收。" : "提交需求，跟进交付并确认验收结果。"}</p></div>
      <div className="req-page-actions">
        {canManage && <div className="req-segmented" role="group" aria-label="需求工作视角"><button aria-pressed={!admin} onClick={() => { setPerspective("user"); setFilter("all"); }}><span className="req-segment-content"><UserRound />用户视角</span></button><button aria-pressed={admin} onClick={() => { setPerspective("admin"); setFilter("all"); }}><span className="req-segment-content"><ShieldCheck />管理员视角</span></button></div>}
        {can("requirements:create") ? <Button data-track-id="requirements.create.open" data-track-label="打开需求提报" aria-expanded={showCreate} aria-controls={createPanelId} onClick={() => setShowCreate(!showCreate)}><Plus />提交需求</Button> : <PermissionRequestButton permission="requirements:create" label="申请提交需求权限" />}
      </div>
    </header>
    <div id={createPanelId} hidden={!showCreate}>{showCreate && <RequirementForm existing={requirements} onClose={() => setShowCreate(false)} />}</div>
    <section className="req-summary" aria-label="需求概览" tabIndex={compact ? 0 : undefined} aria-describedby={compact ? "req-summary-scroll-hint" : undefined}>
      {[
        { label: admin ? "待我决策" : "待我处理", value: todo, icon: ClipboardCheck },
        { label: "进行中", value: scoped.filter((item) => item.status === "in_progress").length, icon: Clock3 },
        { label: "待验收", value: scoped.filter((item) => item.status === "pending_acceptance").length, icon: CheckCircle2 },
        { label: "交付逾期", value: overdue, icon: AlertTriangle },
      ].map(({ label, value, icon: Icon }) => <div className="req-summary-item" key={label} data-overdue={label === "交付逾期" && value > 0 ? "true" : undefined}><Icon aria-hidden="true" /><span>{label}</span><strong>{value}</strong></div>)}
    </section>
    {compact && <span id="req-summary-scroll-hint" className="sr-only">可左右滚动查看所有需求状态统计。</span>}
    <section aria-label={admin ? "项目需求池" : "我的需求列表"}>
      <div className="req-toolbar">
        <label className="md-search req-search"><Search aria-hidden="true" /><Input aria-label="搜索需求" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称、编号或人员" /></label>
        <ToolbarSelect label="筛选全部状态" value={filter} onChange={setFilter} options={[{value:"all",label:"全部状态"},{value:"todo",label:admin ? "待我决策" : "待我处理"},{value:"overdue",label:"交付逾期"},...Object.entries(statusLabels).map(([value,label])=>({value:value as FilterKey,label}))]} />
        {!compact && <ToolbarSelect label="筛选需求方向" value={direction} onChange={(value)=>{setDirection(value);setTask("all");}} options={[{value:"all",label:"全部方向"},{value:"data",label:"数据需求"},{value:"platform",label:"平台开发"}]} />}
        <details className="req-extra-filters">
          <summary><span className="req-filter-action"><Filter aria-hidden="true" />更多筛选{activeExtraFilters > 0 && <span className="req-filter-count">{activeExtraFilters}</span>}</span></summary>
          <div className="req-extra-fields">
            {compact && <label><span>需求方向</span><ToolbarSelect label="筛选需求方向" value={direction} onChange={(value)=>{setDirection(value);setTask("all");}} options={[{value:"all",label:"全部方向"},{value:"data",label:"数据需求"},{value:"platform",label:"平台开发"}]} /></label>}
            <label><span>需求类型</span><ToolbarSelect label="筛选需求模板" value={effectiveTask} onChange={(value)=>setTask(value === "all" || availableTasks.some(([key])=>key === value) ? value : "all")} options={[{value:"all",label:"全部类型"},...availableTasks.map(([value,label])=>({value,label}))]} /></label>
            {!admin && <label><span>与我的关系</span><ToolbarSelect label="需求与我的关系" value={relation} onChange={setRelation} options={[{value:"involved",label:"与我相关"},{value:"requested",label:"我提交的"},{value:"assigned",label:"我负责的"}]} /></label>}
            {compact && filtered.length > 0 && <Button disabled={!hasFilters} variant="link" size="sm" data-track-id="requirements.filter.clear" data-track-label="清除需求筛选" onClick={clearFilters}>清除筛选</Button>}
          </div>
        </details>
        <ToolbarSelect label="需求排序" value={sort} onChange={setSort} options={[{value:"updated",label:"最近更新"},{value:"due",label:"承诺日期"},{value:"score",label:"价值评分"}]} />
        {!compact && hasFilters && filtered.length > 0 && <Button variant="link" size="sm" data-track-id="requirements.filter.clear" data-track-label="清除需求筛选" onClick={clearFilters}>清除筛选</Button>}
        {!compact && viewToggle}
      </div>
      {filtered.length === 0 ? <div className="req-empty"><ClipboardCheck className="size-8 text-muted-foreground" aria-hidden="true" /><h3>{scoped.length ? "没有符合条件的需求" : "暂无相关需求"}</h3><p>{scoped.length ? "调整筛选条件，查看其他需求。" : "提交第一条需求，明确目标、交付范围与验收标准。"}</p>{scoped.length > 0 && <Button variant="outline" data-track-id="requirements.filter.clear" data-track-label="清除需求筛选" onClick={clearFilters}>清除筛选</Button>}</div> : layout === "board" ? <div className="req-board">{boardColumns.map((column) => { const items = filtered.filter((item) => column.statuses.includes(item.status)); return <section className="req-board-column" key={column.label}><h3>{column.label}<span>{items.length}</span></h3><div className="space-y-3">{items.map((item) => <RequirementCard key={item.id} item={item} />)}{!items.length && <p className="py-8 text-center text-sm text-muted-foreground">暂无需求</p>}</div></section>; })}</div> : <div className="req-table">
        <div className="req-table-head"><span>编号</span><span>需求</span><span>状态</span><span>优先级 / 评分</span><span>负责人</span><span>承诺日期</span><span /></div>
        {filtered.map((item) => <Link data-track-id="requirements.detail.open" data-track-label="打开需求详情" className="req-table-row md-state-layer" title={nextStep(item, me.user.id)} to="/requirements/$requirementId" params={{ requirementId: item.id }} key={item.id}>
          <span className="req-item-number">{item.requirement_no}</span><div className="req-item-main"><strong className="req-item-title">{item.title}</strong><div className="req-item-meta"><span>{isPlatformRequirement(item) ? `平台开发 · ${categoryLabels[item.category]}` : item.data_spec ? taskLabels[item.data_spec.task_type] : categoryLabels[item.category]} · {item.requester_name}</span></div><span className="sr-only">下一步：{nextStep(item, me.user.id)}</span></div>
          <div><Badge variant={statusVariant(item.status)}>{statusLabels[item.status]}</Badge></div>
          <div className="flex items-center gap-2"><span className={`req-priority req-priority-${item.priority}`}>{priorityLabels[item.priority]}</span>{item.prioritization && <span className="text-sm text-muted-foreground" title="(影响 + 紧迫性) × 置信度 ÷ 投入">{priorityScore(item.prioritization).toFixed(1)}</span>}</div>
          <span className="text-sm">{item.owner_name ?? "待分配"}</span><span className={`text-sm ${isOverdue(item) ? "text-warning" : "text-muted-foreground"}`}>{formatDate(item.committed_due_date)}{isOverdue(item) && <small className="mt-1 block">已逾期</small>}</span><ArrowUpRight className="req-row-arrow size-4 text-muted-foreground" />
        </Link>)}
      </div>}
      <div className="req-list-footer"><span>显示 {filtered.length} / {scoped.length} 条需求</span><span>{scoped.filter((item) => !closedStatuses.includes(item.status)).length} 条未关闭 · 以用户验收作为完成依据</span></div>
    </section>
  </main>;
}
