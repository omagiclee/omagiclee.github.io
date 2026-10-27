import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { insightRecordsOptions, type Overview } from "../../insights-api";
import { MaterialTabs } from "../ui/tabs";
import { Button } from "../ui/button";
import { ToolbarSelect } from "../ui/period-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { InsightRecordLink, Empty, InsightState, dateTime, insightHref, number, useInsightFilters } from "./shared";

const labels: Record<string, string> = { open: "未完成", draft: "草稿", needs_info: "待补充", pending_schedule: "待排期", deferred: "已暂缓", rejected: "已拒绝", pending: "待处理", queued: "排队中", succeeded: "成功", failed: "失败", running: "运行中", cancelled: "取消", ready: "就绪", indexed: "已索引", pending_review: "待评审", in_progress: "进行中", pending_acceptance: "待验收", completed: "完成", overdue: "逾期" };
function statusTone(status: string) {
  if (["failed", "rejected"].includes(status)) return "error";
  if (["overdue", "needs_info"].includes(status)) return "warning";
  if (["succeeded", "completed", "ready", "indexed"].includes(status)) return "success";
  if (["pending", "queued", "running", "pending_review", "pending_schedule", "in_progress", "pending_acceptance"].includes(status)) return "info";
  return "neutral";
}

export function OperationsRecords({ scope, data }: { scope: ReturnType<typeof useInsightFilters>; data: Overview }) {
  const groups = [ ...(data.media ? [{ id: "video", label: "视频" }, { id: "shot", label: "镜头" }] : []), ...(data.production ? [{ id: "run", label: "运行" }] : []), ...(data.requirements ? [{ id: "requirement", label: "需求" }] : []) ];
  const group = groups.find((item) => item.id === scope.filters.kind)?.id ?? groups[0]?.id;
  const period = group === "requirement" ? "current" : group === "run" ? "window" : scope.filters.period ?? "window";
  const query = useQuery({ ...insightRecordsOptions({ days: scope.filters.days, project_id: scope.filters.project_id, kind: group, period, status: scope.filters.status, offset: scope.filters.offset }), enabled: scope.ready && !!group });
  const statuses = group === "run" ? ["succeeded", "failed", "running", "cancelled"] : group === "requirement" ? ["open", "overdue", "draft", "needs_info", "pending_review", "pending_schedule", "in_progress", "pending_acceptance", "completed", "deferred", "rejected", "cancelled"] : group === "shot" ? ["indexed"] : [];
  if (!group) return null;
  return <Card className="mt-6" id="records"><CardHeader><CardTitle>运营对象明细</CardTitle><CardDescription>{group === "requirement" ? "当前可见需求存量，不按创建时间截断" : period === "current" ? "当前资产存量；运行仍按周期内提交筛选" : "按当前项目和统计周期内的创建时间筛选"}</CardDescription></CardHeader><CardContent>
    <MaterialTabs tabs={groups} value={group} label="运营对象类型" onChange={(value) => scope.update({ kind: value, status: undefined, offset: undefined })}>
    <div className="insights-toolbar mb-4">
      {group !== "requirement" && group !== "run" && <ToolbarSelect value={period} label="资产口径" prefix="资产口径" onChange={(value) => scope.update({ period: value as "window" | "current" })} options={[{ value: "window", label: "周期内新增" }, { value: "current", label: "当前全部存量" }]} />}
      {!!statuses.length && <ToolbarSelect value={scope.filters.status ?? ""} label="对象状态" prefix="状态" onChange={(status) => scope.update({ status: status || undefined })} options={[{ value: "", label: "全部状态" }, ...statuses.map((status) => ({ value: status, label: labels[status] }))]} />}
    </div>
    <InsightState error={query.error} loading={query.isPending} retry={() => void query.refetch()} />
    {query.data && !query.isError && <>{query.data.items.length ? <div className="insights-table-wrap insights-scroll-region" role="region" aria-label="业务对象列表" tabIndex={0}><table className="insights-table"><thead><tr><th>对象名称 / 标识</th><th>当前状态</th><th>创建时间</th></tr></thead><tbody>{query.data.items.map((item) => <tr key={item.id}><td><div className="insights-label">{item.href ? <InsightRecordLink href={insightHref(item.href, scope.filters)} label={item.title} identifier={item.id} /> : <>{item.title}<small className="md-body-small mt-1 block text-muted-foreground">{item.id}</small></>}</div></td><td>{item.status ? <span className="insights-status" data-tone={statusTone(item.status)}>{labels[item.status] ?? item.status}</span> : "—"}</td><td>{dateTime(item.created_at)}</td></tr>)}</tbody></table></div> : <Empty title="当前筛选没有业务对象" />}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="md-body-small text-muted-foreground">共 {number(query.data.total)} 项{query.data.total > 0 ? ` · ${number(query.data.offset + 1)}–${number(query.data.offset + query.data.items.length)}` : ""}</span>{(query.data.total > query.data.limit || query.data.offset > 0) && <div className="flex min-w-0 max-w-full flex-wrap gap-2"><Button variant="outline" size="sm" disabled={query.data.offset === 0 || query.isFetching} onClick={() => scope.update({ offset: Math.max(0, query.data!.offset - query.data!.limit) })}><ChevronLeft />上一页</Button><Button variant="outline" size="sm" disabled={query.data.offset + query.data.items.length >= query.data.total || query.isFetching} onClick={() => scope.update({ offset: query.data!.offset + query.data!.limit })}>下一页<ChevronRight /></Button></div>}</div>
    </>}
  </MaterialTabs></CardContent></Card>;
}
