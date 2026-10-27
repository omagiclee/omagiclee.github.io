import { ExecutionHealth } from "../components/insights/ExecutionHealth";
import { useQuery } from "@tanstack/react-query";
import { operationsOptions } from "../insights-api";
import { Empty, InsightHeader, InsightPageAccess, InsightState, OperationsPanels, Stat, TrendPanel, dateTime, insightHref, number, useInsightFilters } from "../components/insights/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { OperationsRecords } from "../components/insights/OperationsRecords";

function DataOperationsContent() {
  const scope = useInsightFilters();
  const query = useQuery({ ...operationsOptions({ days: scope.filters.days, project_id: scope.filters.project_id }), enabled: scope.ready });
  const data = query.data;
  const refresh = () => { void scope.projects.refetch(); void query.refetch(); };
  return <main className="md-page insights-page">
    <InsightHeader title="数据运营明细" description="追踪视频资产增长、处理运行与需求交付，定位影响产出的环节。" scope={scope} refresh={refresh} busy={query.isFetching} generatedAt={data?.generated_at} window={data?.window} />
    <InsightState error={scope.projects.error || query.error} loading={scope.projects.isPending || query.isPending} retry={refresh} />
    {data && !query.isError && <>
      <section className="insights-stat-grid" aria-label="运营指标"><Stat label="新增视频" value={number(data.media?.new_videos)} note={`最近 ${scope.filters.days} 天新增`} href={data.media ? insightHref("/operations", scope.filters, { kind: "video", period: "window" }) : undefined} /><Stat label="新增镜头" value={number(data.media?.new_shots)} note="按镜头创建时间统计" href={data.media ? insightHref("/operations", scope.filters, { kind: "shot", period: "window" }) : undefined} /><Stat label="成功运行" value={number(data.production?.succeeded)} note={data.production ? `窗口内提交 ${number(data.production.total)} 次` : "暂无运行查看权限"} href={data.production ? insightHref("/operations", scope.filters, { kind: "run", status: "succeeded" }) : undefined} /><Stat label="逾期需求" value={number(data.requirements?.overdue)} note="当前未终结且超过承诺日期" href={data.requirements ? insightHref("/operations", scope.filters, { kind: "requirement", status: "overdue" }) : undefined} /></section>
      <section className="mt-6"><OperationsPanels data={data} filters={scope.filters} /></section>
      <section className="mt-6"><TrendPanel data={data} /></section>
      <OperationsRecords scope={scope} data={data} />
      <ExecutionHealth projectId={scope.filters.project_id}/>
      <Card className="mt-6"><CardHeader><CardTitle>运营待办</CardTitle><CardDescription>定位业务对象并查看详情</CardDescription></CardHeader><CardContent>{data.attention.length ? <div className="insights-table-wrap"><table className="insights-table"><thead><tr><th>对象</th><th>类型</th><th>当前状态</th><th>创建时间</th></tr></thead><tbody>{data.attention.map((item) => <tr key={`${item.kind}:${item.id}`}><td><a className="insights-record-link" href={insightHref(item.href, scope.filters)}><span className="insights-record-title">{item.title}</span></a></td><td>{item.kind.includes("require") ? "需求" : "运行"}</td><td>{({ failed: "失败", overdue: "逾期", pending_review: "待评审", pending_acceptance: "待验收" } as Record<string, string>)[item.status] ?? item.status}</td><td>{dateTime(item.created_at)}</td></tr>)}</tbody></table></div> : <Empty title="当前没有运营待办" />}</CardContent></Card>
      <p className="md-body-small mt-4 text-muted-foreground">索引完成率表示镜头可检索的比例；运行成功率只计算已成功或失败的任务。零分母显示“—”。需求状态为当前存量，不随统计周期截断。</p>
    </>}
  </main>;
}
export default function DataOperationsPage() { return <InsightPageAccess permission="operations:read" title="数据运营明细"><DataOperationsContent /></InsightPageAccess>; }
