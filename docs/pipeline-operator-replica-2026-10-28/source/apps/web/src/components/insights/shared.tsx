import { useQuery } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowUpRight, BarChart3, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useProjectAuth } from "../../auth-context";
import { insightProjectsOptions, insightSearch, type InsightFilters, type InsightWindow, type Overview } from "../../insights-api";
import { PermissionRequestButton } from "../PermissionRequestButton";
import { Button } from "../ui/button";
import { PeriodMenu, ToolbarSelect } from "../ui/period-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import "./insights.css";

export const number = (value: number | undefined | null) => value == null ? "—" : new Intl.NumberFormat("zh-CN").format(value);
export const percent = (value: number | undefined | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
export const duration = (value: number | undefined | null) => value == null ? "—" : value < 1000 ? `${Math.round(value)} 毫秒` : value < 60_000 ? `${(value / 1000).toFixed(1)} 秒` : `${(value / 60_000).toFixed(1)} 分钟`;
export function dateTime(value: string | undefined | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function useInsightFilters() {
  const router = useRouter();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const params = new URLSearchParams(search);
  const days = [7, 30, 90].includes(Number(params.get("days"))) ? Number(params.get("days")) : 7;
  const filters: InsightFilters = { days };
  for (const key of ["project_id", "user_id", "actor_user_id", "page_id", "element_id", "kind", "action", "status", "session_id"] as const) {
    if (params.get(key)) filters[key] = params.get(key)!;
  }
  const offset = Number(params.get("offset"));
  if (Number.isSafeInteger(offset) && offset > 0) filters.offset = offset;
  const groupBy = params.get("group_by");
  if (["page", "menu", "button", "user"].includes(groupBy ?? "")) filters.group_by = groupBy as InsightFilters["group_by"];
  if (["current", "window"].includes(params.get("period") ?? "")) filters.period = params.get("period") as InsightFilters["period"];
  const projects = useQuery(insightProjectsOptions);
  const projectId = filters.project_id || projects.data?.default_project_id;
  const resolved = { ...filters, project_id: projectId };
  function update(patch: Partial<InsightFilters>, reset = false) {
    const next = reset ? { days, project_id: projectId, ...patch } : { ...filters, project_id: projectId, offset: undefined, ...patch };
    const values = Object.fromEntries(new URLSearchParams(insightSearch(next)));
    void router.navigate({ search: values as never });
  }
  return { filters: resolved, update, projects, ready: projects.isSuccess && !!projectId };
}

/** Statistics and their actions use the project scope resolved from the URL. */
export function useInsightAuth() {
  const scope = useInsightFilters();
  const projectId = scope.filters.project_id && scope.filters.project_id !== "*" ? scope.filters.project_id : undefined;
  const auth = useProjectAuth(projectId);
  return { ...auth, scope, projectId };
}

export function InsightPageAccess({ permission, title, children }: { permission: string; title: string; children: ReactNode }) {
  const { can, scope, projectId } = useInsightAuth();
  if (!scope.ready) return <main className="md-page insights-page">
    <h1 className="md-page-title mb-6">{title}</h1>
    <InsightState error={scope.projects.error} loading={scope.projects.isPending} retry={() => void scope.projects.refetch()} />
    {scope.projects.isSuccess && <Empty title="暂无可访问的统计项目">请通过账号菜单查看权限，或联系管理员配置统计访问范围。</Empty>}
  </main>;
  return can(permission) ? children : <InsightPermission permission={permission} title={title} projectId={projectId} />;
}

export function insightHref(path: string, filters: InsightFilters, patch: Partial<InsightFilters> = {}) {
  const localPath = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  const [base, rawSearch = ""] = localPath.split("?");
  const query = new URLSearchParams(rawSearch);
  const combined = new URLSearchParams(insightSearch({ days: filters.days, project_id: filters.project_id }));
  combined.forEach((value, key) => { if (!query.has(key)) query.set(key, value); });
  new URLSearchParams(insightSearch(patch)).forEach((value, key) => query.set(key, value));
  return `${base}?${query.toString()}`;
}

export function InsightPermission({ permission, title, projectId }: { permission: string; title: string; projectId?: string }) {
  return <main className="md-page"><ShieldCheck className="mb-4 size-8 text-muted-foreground" /><h1 className="md-page-title">{title}</h1><p className="md-body-medium mt-3 text-muted-foreground">当前身份没有查看此页面的权限。</p><PermissionRequestButton permission={permission} projectId={projectId} className="mt-4" /></main>;
}

export function InsightHeader({ title, description, scope, refresh, busy, generatedAt, window: timeWindow }: {
  title: string; description: string; scope: ReturnType<typeof useInsightFilters>; refresh: () => void; busy?: boolean; generatedAt?: string; window?: InsightWindow;
}) {
  return <>
    <header className="insights-header">
      <div className="insights-heading"><h1 className="md-page-title">{title}</h1><span className="sr-only">{description}</span></div>
      <div className="insights-toolbar">
        <PeriodMenu value={scope.filters.days ?? 7} disabled={!scope.ready} onChange={(days) => scope.update({ days })} />
        <Button size="icon" variant="outline" onClick={refresh} disabled={busy || scope.projects.isFetching} aria-label="刷新统计"><RefreshCw className={busy || scope.projects.isFetching ? "animate-spin" : ""} /></Button>
      </div>
    </header>
    <div className="insights-header-meta" aria-live="polite">
      {timeWindow && <span title={`${dateTime(timeWindow.start)} — ${dateTime(timeWindow.end)}`}><span className="sr-only">统计范围：{dateTime(timeWindow.start)}至{dateTime(timeWindow.end)}</span><span aria-hidden="true">{new Date(timeWindow.start).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} — {new Date(timeWindow.end).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</span></span>}
      <span title={`显示时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}；日趋势按 UTC 统计`}>日趋势 UTC</span>
      {generatedAt && <time dateTime={generatedAt} title={dateTime(generatedAt)} ><span className="sr-only">更新于{dateTime(generatedAt)}</span><span aria-hidden="true">更新 {new Date(generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</span></time>}
    </div>
  </>;
}

export function InsightState({ error, loading, retry }: { error?: unknown; loading?: boolean; retry: () => void }) {
  if (error) return <Card><CardContent className="insights-empty" role="alert"><strong>统计暂时无法读取</strong><p className="md-body-small">{error instanceof Error ? error.message : "请求失败，请重试。"}</p><Button variant="outline" size="sm" onClick={retry}>重新加载</Button></CardContent></Card>;
  if (loading) return <div role="status" aria-label="正在加载统计" className="insights-stat-grid">{[0, 1, 2, 3].map((key) => <div className="insights-stat animate-pulse" key={key}><div className="h-3 w-20 rounded bg-muted" /><div className="my-5 h-9 w-28 rounded bg-muted" /><div className="h-3 w-36 rounded bg-muted" /></div>)}</div>;
  return null;
}

export function Empty({ title = "当前范围暂无数据", children }: { title?: string; children?: ReactNode }) {
  return <div className="insights-empty"><BarChart3 className="size-7 opacity-50" /><strong className="md-title-small">{title}</strong>{children && <p className="md-body-small max-w-md">{children}</p>}</div>;
}

export function Stat({ label, value, note, href, icon }: { label: string; value: string; note: string; href?: string; icon?: ReactNode }) {
  const content = <><div className="md-body-medium flex items-center justify-between gap-3 text-muted-foreground"><span>{label}</span>{(icon || href) && <span className="text-primary">{icon ?? <ArrowUpRight className="size-4" />}</span>}</div><strong className="insights-stat-value">{value}</strong><span className="insights-stat-note">{note}</span></>;
  return href ? <a className="insights-stat" href={href}>{content}</a> : <article className="insights-stat">{content}</article>;
}

/** Treat the name and identifier as one reachable link without growing the table row. */
export function InsightRecordLink({ href, label, identifier }: { href: string; label: string; identifier?: string }) {
  return <a className="insights-record-link" href={href} aria-label={label}><span className="insights-record-title">{label}</span>{identifier && <small title={identifier}>{identifier}</small>}</a>;
}

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="insights-detail-row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export function ActiveFilters({ filters, update, displayValues = {} }: { filters: InsightFilters; update: (patch: Partial<InsightFilters>) => void; displayValues?: Partial<Record<keyof InsightFilters, string>> }) {
  const labels: Partial<Record<keyof InsightFilters, string>> = { user_id: "用户", actor_user_id: "实际操作者", page_id: "页面", element_id: "元素", kind: "类型", action: "动作", status: "结果", session_id: "会话" };
  return <div className="mb-4 flex flex-wrap gap-2">{Object.entries(labels).filter(([key]) => filters[key as keyof InsightFilters]).map(([key, label]) => <button key={key} type="button" className="insights-filter-chip" onClick={() => update({ [key]: undefined })} aria-label={`清除${label}筛选`}><span className="insights-filter-chip-container md-state-layer"><span>{label}：{displayValues[key as keyof InsightFilters] ?? filters[key as keyof InsightFilters]}</span><X className="size-[18px] shrink-0" /></span></button>)}</div>;
}

export function OperationsPanels({ data, filters }: { data: Overview; filters: InsightFilters }) {
  const { can } = useInsightAuth();
  return <div className="insights-panels">
    <Card><CardHeader><CardTitle>数据资产</CardTitle><CardDescription>当前存量与窗口内新增</CardDescription></CardHeader><CardContent>{data.media ? <><dl><DetailRow label="视频总量" value={number(data.media.videos)} /><DetailRow label="镜头总量" value={number(data.media.shots)} /><DetailRow label="关键帧" value={number(data.media.keyframes)} /><DetailRow label="可检索镜头" value={number(data.media.indexed_shots)} /><DetailRow label="索引完成率" value={percent(data.media.index_rate)} /><DetailRow label="窗口新增视频 / 镜头" value={`${number(data.media.new_videos)} / ${number(data.media.new_shots)}`} /></dl>{can("operations:read") && <a href={insightHref("/operations", filters, { kind: "video", period: "current" })} className="insights-action-link mt-2">查看资产明细<ArrowUpRight className="size-4" /></a>}</> : <Empty title="暂无数据资产查看权限" />}</CardContent></Card>
    <Card><CardHeader><CardTitle>生产运行</CardTitle><CardDescription>按窗口内创建的任务统计</CardDescription></CardHeader><CardContent>{data.production ? <><dl><DetailRow label="提交运行" value={number(data.production.total)} /><DetailRow label="执行成功" value={number(data.production.succeeded)} /><DetailRow label="执行失败" value={<span className={data.production.failed ? "text-destructive" : ""}>{number(data.production.failed)}</span>} /><DetailRow label="运行中" value={number(data.production.running)} />{data.production.cancelled != null && <DetailRow label="已取消" value={number(data.production.cancelled)} />}<DetailRow label="已结束运行成功率" value={percent(data.production.success_rate)} /><DetailRow label="平均完成耗时" value={duration(data.production.avg_duration_ms)} /></dl>{can("operations:read") && <a href={insightHref("/operations", filters, { kind: "run" })} className="insights-action-link mt-2">查看运行明细<ArrowUpRight className="size-4" /></a>}</> : <Empty title="暂无运行查看权限" />}</CardContent></Card>
    <Card><CardHeader><CardTitle>需求交付</CardTitle><CardDescription>当前需求状态；逾期按承诺日期</CardDescription></CardHeader><CardContent>{data.requirements ? <><dl><DetailRow label="需求总量" value={number(data.requirements.total)} /><DetailRow label="待评审" value={number(data.requirements.pending_review)} /><DetailRow label="进行中" value={number(data.requirements.in_progress)} /><DetailRow label="待验收" value={number(data.requirements.pending_acceptance)} /><DetailRow label="已逾期" value={<span className={data.requirements.overdue ? "text-warning" : ""}>{number(data.requirements.overdue)}</span>} /><DetailRow label="当前已完成" value={number(data.requirements.completed)} /></dl>{can("operations:read") && <a href={insightHref("/operations", filters, { kind: "requirement" })} className="insights-action-link mt-2">查看需求明细<ArrowUpRight className="size-4" /></a>}</> : <Empty title="暂无需求查看权限" />}</CardContent></Card>
  </div>;
}

export function TrendPanel({ data, allowUsage = false }: { data: Overview; allowUsage?: boolean }) {
  const series = [ ...(data.media ? [{ key: "shots" as const, label: "新增镜头" }, { key: "videos" as const, label: "新增视频" }] : []), ...(data.production ? [{ key: "runs" as const, label: "提交运行" }] : []), ...(allowUsage && data.usage?.available ? [{ key: "active_users" as const, label: "活跃人数" }, { key: "page_views" as const, label: "页面访问" }] : []) ];
  const [selected, setSelected] = useState<string>("shots");
  const metric = series.find((item) => item.key === selected) ?? series[0];
  const points = data.trend;
  const values = metric ? points.map((point) => point[metric.key]) : [];
  const max = Math.max(1, ...values);
  const x = (index: number) => 45 + (index / Math.max(1, points.length - 1)) * 685;
  const y = (value: number) => 175 - value / max * 145;
  const line = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const hasActivity = values.some((value) => value > 0);
  return <Card><CardHeader className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>每日趋势</CardTitle><CardDescription className="mt-1">最近 {data.window.days} 天的实际变化</CardDescription></div>{metric && <ToolbarSelect value={metric.key} onChange={setSelected} label="趋势指标" options={series.map((item) => ({ value: item.key, label: item.label }))} />}</CardHeader><CardContent>{!metric || !points.length ? <Empty /> : !hasActivity ? <Empty title={`当前周期暂无${metric.label}`}>可切换指标或扩大统计周期查看历史活动。</Empty> : <>
      <svg className="insights-trend" viewBox="0 0 755 220" role="img" aria-label={`${metric.label}每日趋势，合计 ${number(values.reduce((a, b) => a + b, 0))}`}>
        {(max === 1 ? [0, 1] : [0, .5, 1]).map((factor) => <g key={factor}><line x1="45" x2="730" y1={y(max * factor)} y2={y(max * factor)} stroke="var(--border)" strokeDasharray="3 4" opacity=".6" /><text x="36" y={y(max * factor) + 4} textAnchor="end">{number(max * factor)}</text></g>)}
        <polygon points={`45,175 ${line} ${x(points.length - 1)},175`} fill="var(--primary)" opacity=".07" />
        <polyline points={line} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((point, index) => <circle key={point.date} cx={x(index)} cy={y(values[index])} r={points.length <= 30 ? 3 : 2} fill="var(--primary)"><title>{point.date} · {metric.label} {number(values[index])}</title></circle>)}
        {[...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])].map((index) => <text key={index} x={x(index)} y="204" textAnchor="middle">{points[index].date.slice(5, 10)}</text>)}
      </svg>
      <details className="insights-compact-disclosure insights-trend-values"><summary><span>查看每日数值</span></summary><div className="insights-table-wrap insights-scroll-region mt-3 max-h-60 overflow-y-auto" role="region" aria-label={`${metric.label}每日数值`} tabIndex={0}><table className="insights-table"><thead><tr><th>日期（UTC）</th><th>{metric.label}</th></tr></thead><tbody>{points.map((point, index) => <tr key={point.date}><td>{point.date.slice(0, 10)}</td><td>{number(values[index])}</td></tr>)}</tbody></table></div></details>
    </>}</CardContent></Card>;
}
