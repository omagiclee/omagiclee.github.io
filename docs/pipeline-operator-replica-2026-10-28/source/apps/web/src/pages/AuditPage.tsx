import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Filter, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { insightEventsOptions, insightPeopleOptions, type InsightEvent, type InsightFilters } from "../insights-api";
import { PageField, PersonField, pageLabels } from "../components/insights/FilterFields";
import { ActiveFilters, Empty, InsightHeader, InsightPageAccess, InsightState, dateTime, insightHref, number, useInsightFilters } from "../components/insights/shared";
import { Badge } from "../components/ui/badge";
import { statusVariant } from "../lib/status-variant";
import { Button } from "../components/ui/button";
import { ToolbarSelect } from "../components/ui/period-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { actionLabel } from "../components/insights/action-labels";

const kinds: Record<string, string> = { page_view: "页面访问", page_leave: "页面离开", menu_click: "菜单点击", button_click: "按钮点击", button_exposure: "按钮曝光", audit: "业务审计" };
const statuses: Record<string, string> = { success: "成功", succeeded: "成功", failed: "失败", failure: "失败", error: "错误", denied: "拒绝", accepted: "已接受", running: "运行中", completed: "完成", cancelled: "取消" };
const statusOptions: Record<string, string> = { succeeded: "成功", failed: "失败", running: "运行中", cancelled: "取消", denied: "拒绝", accepted: "提交已接受" };

function AuditEvent({ event, filters }: { event: InsightEvent; filters: InsightFilters }) {
  const impersonating = event.actor_user_id !== event.effective_user_id;
  const details = event.details ?? {};
  const title = event.kind === "audit" && (!event.label || event.label === event.action) ? actionLabel(event.action) : event.label || event.action || kinds[event.kind] || "操作记录";
  const before = details.before ?? details.before_snapshot;
  const after = details.after ?? details.after_snapshot;
  const other = Object.fromEntries(Object.entries(details).filter(([key]) => !["before", "after", "before_snapshot", "after_snapshot"].includes(key)));
  return <li><details className="insights-event"><summary>
    <time className="md-body-small text-muted-foreground" dateTime={event.created_at}>{dateTime(event.created_at)}<span className="mt-1 block">{kinds[event.kind] ?? event.kind}</span></time>
    <div className="min-w-0"><strong className="md-title-small block break-words">{title}</strong><span className="md-body-small mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground"><UserRound className="size-3.5" /><span>{event.user_name || event.effective_user_id}</span>{impersonating && <Badge variant="warning">代登录 · 实际操作 {event.actor_name || event.actor_user_id}</Badge>}{event.page_id && <span>· {pageLabels[event.page_id] ?? event.page_id}</span>}</span></div>
    <div className="flex items-center gap-3">{event.status ? <Badge variant={statusVariant(event.status)}>{statuses[event.status] ?? event.status}</Badge> : <span className="md-body-small text-muted-foreground">交互记录</span>}<ChevronDown className="insights-chevron size-4 shrink-0 text-muted-foreground" /></div>
  </summary><div className="insights-event-details">
    <dl className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">{[{ label: "有效用户", value: `${event.user_name || event.effective_user_id} (${event.effective_user_id})`, href: insightHref("/admin/audit", filters, { user_id: event.effective_user_id }) }, { label: "实际操作者", value: `${event.actor_name || event.actor_user_id} (${event.actor_user_id})`, href: insightHref("/admin/audit", filters, { actor_user_id: event.actor_user_id }) }, { label: "动作", value: event.action }, { label: "关联对象", value: event.object_id }, { label: "页面 / 元素", value: [event.page_id, event.element_id].filter(Boolean).join(" / ") }, { label: "会话", value: event.session_id, href: event.session_id ? insightHref("/admin/audit", filters, { session_id: event.session_id }) : undefined }, { label: "交互关联 ID", value: event.interaction_id }, { label: "记录 ID", value: event.id }].map((item) => <div key={item.label}><dt className="text-muted-foreground">{item.label}</dt><dd className="mt-1 break-all">{item.href ? <a className="insights-audit-link" href={item.href}>{item.value}</a> : item.value || "—"}</dd></div>)}</dl>
    {event.href && <a className="insights-action-link mt-2" href={insightHref(event.href, filters)}>查看关联对象<ExternalLink className="size-3.5" /></a>}
    {(before !== undefined || after !== undefined) && <div className="mt-5 grid gap-3 md:grid-cols-2">{[{ label: "修改前", value: before }, { label: "修改后", value: after }].map((snapshot) => <div key={snapshot.label}><h3 className="md-label-large mb-2">{snapshot.label}</h3><pre className="insights-json" role="region" aria-label={`${title}：${snapshot.label}详情`} tabIndex={0}>{snapshot.value === undefined ? "未记录快照" : JSON.stringify(snapshot.value, null, 2)}</pre></div>)}</div>}
    {Object.keys(other).length > 0 && <div className="mt-4"><h3 className="md-label-large mb-2">操作详情与业务结果</h3><pre className="insights-json" role="region" aria-label={`${title}：操作详情与业务结果`} tabIndex={0}>{JSON.stringify(other, null, 2)}</pre></div>}
    {event.kind !== "audit" && <p className="md-body-small mt-4 text-muted-foreground">此记录证明页面交互。业务提交与异步执行结果以关联审计、任务记录为准。</p>}
  </div></details></li>;
}

function AuditContent() {
  const scope = useInsightFilters();
  const auditFilters = { ...scope.filters, kind: scope.filters.kind ?? "audit" };
  const query = useQuery({ ...insightEventsOptions(auditFilters), enabled: scope.ready });
  const people = useQuery({ ...insightPeopleOptions(scope.filters), enabled: scope.ready });
  const [draft, setDraft] = useState<InsightFilters>(auditFilters);
  const filterKey = JSON.stringify(scope.filters);
  useEffect(() => setDraft({ ...scope.filters, kind: scope.filters.kind ?? "audit" }), [filterKey]);
  const data = query.data;
  const refresh = () => { void scope.projects.refetch(); void query.refetch(); void people.refetch(); };
  const fields = [{ key: "element_id", label: "按钮 / 元素标识", placeholder: "例如 media.search" }, { key: "action", label: "业务动作", placeholder: "例如 pipeline.run" }, { key: "session_id", label: "会话 ID", placeholder: "查看同一次会话" }] as const;
  return <main className="md-page insights-page">
    <InsightHeader title="操作审计" description="追溯服务端记录的业务操作、身份、对象及执行结果；页面交互记录可按需查询。" scope={scope} refresh={refresh} busy={query.isFetching} />
    <Card className="mb-5"><CardHeader><CardTitle className="flex items-center gap-2"><Filter className="size-4" />筛选操作记录</CardTitle><CardDescription>支持同时筛选实际操作者与有效身份；结果按时间倒序展示</CardDescription></CardHeader><CardContent><form onSubmit={(event) => { event.preventDefault(); scope.update(draft); }}>
      <div className="insights-filter-grid"><PersonField label="使用人员（有效身份）" value={draft.user_id} onChange={(value) => setDraft({ ...draft, user_id: value })} people={people.data} loading={people.isPending} error={people.isError} /><PersonField label="实际操作者" value={draft.actor_user_id} onChange={(value) => setDraft({ ...draft, actor_user_id: value })} people={people.data} loading={people.isPending} error={people.isError} /><PageField label="页面 / 模块" value={draft.page_id} onChange={(value) => setDraft({ ...draft, page_id: value })} />
        <ToolbarSelect label="记录类型" prefix="类型" value={draft.kind ?? "audit"} onChange={(kind) => setDraft({ ...draft, kind })} options={Object.entries(kinds).map(([value, label]) => ({ value, label: `${label}${value === "audit" ? "（默认）" : ""}` }))} />
        <ToolbarSelect label="操作结果" prefix="结果" value={draft.status ?? ""} onChange={(status) => setDraft({ ...draft, status: status || undefined })} options={[{ value: "", label: "全部结果" }, ...Object.entries(statusOptions).map(([value, label]) => ({ value, label }))]} />
      </div><details className="insights-compact-disclosure mt-4"><summary><span>高级筛选：按钮、业务动作和会话</span></summary><div className="insights-filter-grid mt-3">{fields.map((field) => <label key={field.key} className="insights-field">{field.label}<input className="insights-input" value={draft[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value.trim() || undefined })} /></label>)}</div></details><div className="mt-4 flex flex-wrap gap-2"><Button type="submit">查询记录</Button><Button type="button" variant="ghost" onClick={() => { scope.update({ kind: "audit" }, true); setDraft({ kind: "audit" }); }}>重置筛选</Button></div>
    </form></CardContent></Card>
    <ActiveFilters filters={scope.filters} update={scope.update} displayValues={{ user_id: people.data?.people.find((person) => person.id === scope.filters.user_id)?.name, actor_user_id: people.data?.people.find((person) => person.id === scope.filters.actor_user_id)?.name, page_id: pageLabels[scope.filters.page_id ?? ""], kind: kinds[scope.filters.kind ?? ""] }} />
    <InsightState error={scope.projects.error || query.error} loading={scope.projects.isPending || query.isPending} retry={refresh} />
    {data && !query.isError && <Card><CardHeader><CardTitle>{scope.filters.user_id ? "个人操作时间线" : "操作时间线"}</CardTitle><CardDescription>共 {number(data.total)} 条{auditFilters.kind === "audit" ? "业务操作" : "交互"}记录 · 展开查看身份、关联对象、前后快照和结果</CardDescription></CardHeader>{data.items.length ? <ol className="insights-timeline">{data.items.map((event) => <AuditEvent key={event.id} event={event} filters={auditFilters} />)}</ol> : <Empty title="当前筛选没有操作记录">调整用户、时间或其他条件后重新查询。</Empty>}<div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"><span className="md-body-small text-muted-foreground">{data.total ? `${number(data.offset + 1)}–${number(Math.min(data.offset + data.items.length, data.total))} / ${number(data.total)}` : "0 条记录"}</span>{(data.total > data.limit || data.offset > 0) && <div className="flex min-w-0 max-w-full flex-wrap gap-2"><Button size="sm" variant="outline" disabled={data.offset === 0 || query.isFetching} onClick={() => scope.update({ offset: Math.max(0, data.offset - data.limit) })}><ChevronLeft />上一页</Button><Button size="sm" variant="outline" disabled={data.offset + data.items.length >= data.total || query.isFetching} onClick={() => scope.update({ offset: data.offset + data.limit })}>下一页<ChevronRight /></Button></div>}</div></Card>}
  </main>;
}
export default function AuditPage() { return <InsightPageAccess permission="audit:read" title="操作审计"><AuditContent /></InsightPageAccess>; }
