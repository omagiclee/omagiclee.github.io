import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, Database, RefreshCw, Workflow } from "lucide-react";
import { useAuth } from "../auth-context";
import { overviewOptions, type InsightWindow } from "../insights-api";
import { Empty, InsightPageAccess, InsightState, OperationsPanels, Stat, TrendPanel, dateTime, insightHref, number, percent, useInsightAuth } from "../components/insights/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { PeriodMenu } from "../components/ui/period-menu";
import "./dashboard.css";

function compactTime(value: string, includeTime = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  });
}

function DashboardHeader({ scope, refresh, busy, generatedAt, window: timeWindow }: {
  scope: ReturnType<typeof useInsightAuth>["scope"]; refresh: () => void; busy: boolean; generatedAt?: string; window?: InsightWindow;
}) {
  const refreshing = busy || scope.projects.isFetching;
  return <header className="dashboard-header">
    <div className="dashboard-header-main">
      <h1 className="md-page-title">概览</h1>
      <div className="dashboard-controls" role="group" aria-label="概览统计设置">
        <PeriodMenu value={scope.filters.days ?? 7} disabled={!scope.ready} onChange={(days) => scope.update({ days })} />
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} aria-label="刷新统计"><RefreshCw className={refreshing ? "animate-spin" : ""} aria-hidden="true" />刷新</Button>
      </div>
    </div>
    <div className="dashboard-meta">
      <div className="dashboard-timestamps" aria-live="polite">
        {timeWindow && <span><CalendarDays aria-hidden="true" />{compactTime(timeWindow.start)} — {compactTime(timeWindow.end)}</span>}
        {generatedAt && <span><Clock3 aria-hidden="true" />更新于 {compactTime(generatedAt, true)}</span>}
      </div>
      <details className="dashboard-statistics-notes" onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}>
        <summary>统计口径</summary>
        <div>
          <p>数据产出、运行状态与需求交付进度按当前范围统计。</p>
          {timeWindow && <p>时间范围：{dateTime(timeWindow.start)} — {dateTime(timeWindow.end)}</p>}
          <p>显示时间：{Intl.DateTimeFormat().resolvedOptions().timeZone} · 日趋势按 UTC 统计</p>
          {generatedAt && <p>更新于 {dateTime(generatedAt)}</p>}
        </div>
      </details>
    </div>
  </header>;
}

function DashboardContent() {
  const { can: canSession } = useAuth();
  const { can, scope } = useInsightAuth();
  const query = useQuery({ ...overviewOptions({ days: scope.filters.days, project_id: scope.filters.project_id }), enabled: scope.ready });
  const data = query.data;
  const attentionPriority: Record<string, number> = { failed: 0, overdue: 1, pending_acceptance: 2, pending_review: 3 };
  const attention = [...(data?.attention ?? [])].sort((a, b) => (attentionPriority[a.status] ?? 4) - (attentionPriority[b.status] ?? 4)).slice(0, 6);
  const refresh = () => { void scope.projects.refetch(); void query.refetch(); };
  return <main className="md-page insights-page dashboard-page">
    <DashboardHeader scope={scope} refresh={refresh} busy={query.isFetching} generatedAt={data?.generated_at} window={data?.window} />
    <InsightState error={scope.projects.error || query.error} loading={scope.projects.isPending || query.isPending} retry={refresh} />
    {data && !query.isError && <>
      <section className="insights-stat-grid dashboard-summary" aria-label="核心指标">
        <Stat label="可检索镜头" value={number(data.media?.indexed_shots)} note={data.media ? `当前存量 · 索引完成率 ${percent(data.media.index_rate)}` : "暂无数据资产查看权限"} href={data.media && can("operations:read") ? insightHref("/operations", scope.filters, { kind: "shot", status: "indexed", period: "current" }) : undefined} icon={<Database className="size-5" />} />
        <Stat label="运行成功率" value={percent(data.production?.success_rate)} note={data.production ? `周期内提交 ${number(data.production.total)} 次 · 失败 ${number(data.production.failed)} 次` : "暂无运行查看权限"} href={data.production && can("operations:read") ? insightHref("/operations", scope.filters, { kind: "run" }) : undefined} icon={<Workflow className="size-5" />} />
        <Stat label="未完成需求" value={data.requirements ? number(data.requirements.open) : "—"} note={data.requirements ? `当前待交付需求 · 逾期 ${number(data.requirements.overdue)} 项` : "暂无需求查看权限"} href={data.requirements && can("operations:read") ? insightHref("/operations", scope.filters, { kind: "requirement", status: "open" }) : undefined} icon={<CheckCircle2 className="size-5" />} />
      </section>
      <section className="dashboard-priority-grid" aria-label="趋势与待办">
        <Card className="dashboard-attention">
          <CardHeader>
            <CardTitle className="dashboard-attention-heading">需要关注{data.attention.length > 0 && <span className="dashboard-attention-count">{number(data.attention.length)}</span>}</CardTitle>
            <CardDescription>优先处理失败运行与逾期交付</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {attention.length ? <ul className="dashboard-attention-list">{attention.map((item) => <li key={`${item.kind}:${item.id}`}>
              <a href={insightHref(item.href, scope.filters)} className="dashboard-attention-link group">
                <span className="min-w-0"><strong className="md-title-small block break-words [overflow-wrap:anywhere] group-hover:text-primary">{item.title}</strong><span className="md-body-small mt-1 block text-muted-foreground">{item.kind.includes("require") ? "需求交付" : "生产运行"} · {dateTime(item.created_at)}</span></span>
                <Badge variant={item.status === "failed" ? "destructive" : item.status === "overdue" ? "warning" : "info"} className="dashboard-attention-status" data-status={item.status}>{({ failed: "失败", overdue: "逾期", pending_review: "待评审", pending_acceptance: "待验收" } as Record<string, string>)[item.status] ?? item.status}</Badge>
              </a>
            </li>)}</ul> : <Empty title="当前没有待处理提醒">此范围内没有失败运行或待处理的交付提醒。</Empty>}
          </CardContent>
        </Card>
        <TrendPanel data={data} />
      </section>
      <section className="dashboard-details-section" aria-label="数据与交付">
        <div className="dashboard-detail-links">{canSession("events:read") && <a className="insights-action-link" href="/events">数据事件<ArrowRight aria-hidden="true" /></a>}{can("operations:read") && <a className="insights-action-link" href={insightHref("/operations", scope.filters)}>运营明细<ArrowRight aria-hidden="true" /></a>}</div>
        <details className="dashboard-details"><summary>查看资产、运行与交付详情</summary><OperationsPanels data={data} filters={scope.filters} /></details>
      </section>
    </>}
  </main>;
}

export default function DashboardPage() {
  return <InsightPageAccess permission="dashboard:view" title="概览"><DashboardContent /></InsightPageAccess>;
}
