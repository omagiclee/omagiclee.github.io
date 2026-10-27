import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { insightPeopleOptions, usageOptions, type InsightFilters, type UsageRow } from "../insights-api";
import { PageField, PersonField, pageLabels } from "../components/insights/FilterFields";
import { InsightRecordLink, ActiveFilters, Empty, InsightHeader, InsightPageAccess, InsightState, Stat, dateTime, duration, insightHref, number, percent, useInsightAuth } from "../components/insights/shared";
import { MaterialTabs } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { ToolbarSelect } from "../components/ui/period-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

const groups = [{ id: "page", label: "页面" }, { id: "menu", label: "菜单" }, { id: "button", label: "按钮 / 功能" }, { id: "user", label: "用户" }] as const;

function UsageContent() {
  const { can, scope } = useInsightAuth();
  const group = scope.filters.group_by ?? "page";
  const query = useQuery({ ...usageOptions({ ...scope.filters, group_by: group }), enabled: scope.ready, placeholderData: keepPreviousData });
  const people = useQuery({ ...insightPeopleOptions(scope.filters), enabled: scope.ready });
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState("activity");
  const [userDraft, setUserDraft] = useState(scope.filters.user_id ?? "");
  const [pageDraft, setPageDraft] = useState(scope.filters.page_id ?? "");
  useEffect(() => { setUserDraft(scope.filters.user_id ?? ""); setPageDraft(scope.filters.page_id ?? ""); }, [scope.filters.user_id, scope.filters.page_id]);
  const data = query.data;
  const refresh = () => { void scope.projects.refetch(); void query.refetch(); void people.refetch(); };
  const rows = data?.rows.filter((row) => `${row.label} ${row.id} ${row.page_id ?? ""}`.toLowerCase().includes(keyword.toLowerCase())).slice().sort((a, b) => sort === "users" ? b.users - a.users : sort === "recent" ? (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? "") : group === "page" ? b.views - a.views : b.clicks - a.clicks) ?? [];
  const eventLink = (row: UsageRow) => {
    const patch: Partial<InsightFilters> = group === "user" ? { user_id: row.id } : group === "page" ? { page_id: row.id } : { page_id: row.page_id ?? scope.filters.page_id, element_id: row.id, kind: group === "menu" ? "menu_click" : undefined };
    return insightHref("/admin/audit", scope.filters, { user_id: scope.filters.user_id, page_id: scope.filters.page_id, ...patch });
  };
  return <main className="md-page insights-page">
    <InsightHeader title="使用分析" description="汇总平台活跃人数、页面访问和功能使用情况，用于评估产品采用情况。" scope={scope} refresh={refresh} busy={query.isFetching} generatedAt={data?.generated_at} window={data?.window} />
    <InsightState error={scope.projects.error || query.error} loading={scope.projects.isPending || query.isPending} retry={refresh} />
    {data && !query.isError && <>
      <section className="insights-stat-grid" aria-label="使用指标"><Stat label="活跃人数" value={data.collection_started_at ? number(data.summary.active_users) : "—"} note={data.collection_started_at ? "按有效用户去重 · 排除代登录" : "尚未采集使用数据"} /><Stat label="页面访问" value={data.collection_started_at ? number(data.summary.page_views) : "—"} note={data.collection_started_at ? "每次真实进入页面计一次" : "尚未采集页面访问"} /><Stat label="交互点击" value={data.collection_started_at ? number(data.summary.clicks) : "—"} note={data.collection_started_at ? "菜单与按钮点击，不代表任务成功" : "尚未采集点击数据"} /><Stat label="核心业务操作" value={number(data.summary.business_actions)} note="服务端记录的业务动作" /></section>
      <section className="mt-6" aria-label="使用明细">
        <MaterialTabs tabs={groups} value={group} label="分析维度" onChange={(value) => { scope.update({ group_by: value as InsightFilters["group_by"] }); setKeyword(""); }}>
        {can("audit:read") && <div className="mb-2 flex justify-end"><a className="insights-action-link" href={insightHref("/admin/audit", scope.filters, { user_id: scope.filters.user_id, page_id: scope.filters.page_id })}>查看操作时间线 →</a></div>}
        <Card><CardHeader><CardTitle>{groups.find((item) => item.id === group)?.label}使用明细</CardTitle><CardDescription>{group === "button" ? "人数点击率 = 同窗口曝光且点击的人数 / 曝光人数" : group === "page" ? "页面访问与菜单点击分别统计；停留仅累计前台可见时间" : group === "user" ? "查看个人使用情况，点击姓名可追溯操作记录" : "菜单点击表示入口使用，直接访问页面不产生菜单点击"}</CardDescription></CardHeader><CardContent>
          <form className="insights-toolbar mb-4" onSubmit={(event) => { event.preventDefault(); scope.update({ user_id: userDraft.trim() || undefined, page_id: pageDraft.trim() || undefined }); }}>
            <PersonField label="使用人员" value={userDraft} onChange={(value) => setUserDraft(value ?? "")} people={people.data} loading={people.isPending} error={people.isError} />
            <PageField value={pageDraft} onChange={(value) => setPageDraft(value ?? "")} /><Button type="submit" variant="outline">应用筛选</Button>
            <label className="insights-field ml-auto"><span className="sr-only">搜索当前结果</span><input className="insights-input" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="名称或标识" /></label>
            <ToolbarSelect value={sort} onChange={setSort} label="排序" prefix="排序" options={[{ value: "activity", label: group === "page" ? "访问次数最多" : "点击次数最多" }, { value: "users", label: "使用人数最多" }, { value: "recent", label: "最近使用" }]} />
          </form>
          <ActiveFilters filters={scope.filters} update={scope.update} displayValues={{ user_id: people.data?.people.find((person) => person.id === scope.filters.user_id)?.name, actor_user_id: people.data?.people.find((person) => person.id === scope.filters.actor_user_id)?.name, page_id: pageLabels[scope.filters.page_id ?? ""] }} />
          {rows.length ? <div className="insights-table-wrap"><table className="insights-table"><thead><tr><th>{group === "user" ? "用户" : "名称 / 标识"}</th>{(group === "page" || group === "user") && <th>访问次数</th>}<th>点击次数</th>{group !== "user" && <th>使用人数</th>}{group === "button" && <><th>曝光次数</th><th>曝光人数</th><th>人数点击率</th><th>成功业务记录</th><th>失败业务记录</th></>}{(group === "page" || group === "user") && <th>已采集平均有效停留</th>}<th>最近使用</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.page_id}:${row.id}`}><td><div className="insights-label">{can("audit:read") ? <InsightRecordLink href={eventLink(row)} label={group === "page" ? pageLabels[row.id] ?? row.label ?? row.id : row.label || row.id} identifier={`${row.page_id && row.page_id !== row.id ? `${row.page_id} · ` : ""}${row.id}`} /> : <><span>{group === "page" ? pageLabels[row.id] ?? row.label ?? row.id : row.label || row.id}</span><small className="mt-1 block text-muted-foreground" title={row.id}>{row.page_id && row.page_id !== row.id ? `${row.page_id} · ` : ""}{row.id}</small></>}</div></td>{(group === "page" || group === "user") && <td>{number(row.views)}</td>}<td>{number(row.clicks)}</td>{group !== "user" && <td>{number(row.users)}</td>}{group === "button" && <><td>{number(row.exposures)}</td><td>{number(row.exposed_users)}</td><td>{percent(row.click_rate)}</td><td title={`已关联业务记录 ${number(row.business_actions)} 条 · 未结束 ${number(row.running)} 条`}>{number(row.succeeded)}</td><td>{number(row.failed)}</td></>}{(group === "page" || group === "user") && <td>{duration(row.avg_duration_ms)}</td>}<td>{dateTime(row.last_seen_at)}</td></tr>)}</tbody></table></div> : <Empty title={data.collection_started_at ? "当前筛选没有使用记录" : "尚未采集使用数据"}>{data.collection_started_at ? "调整时间、项目或筛选条件后重试。" : "真实访问和交互产生后，页面、菜单、按钮与用户统计会显示在这里。"}</Empty>}
          {group === "button" && <p className="md-body-small mt-4 text-muted-foreground">仅统计已关联审计，异步任务按当前结果；一条点击可关联多条业务记录。</p>}
          <p className="md-body-small mt-4 text-muted-foreground">共 {number(rows.length)} 项{data.collection_started_at ? ` · 开始采集于 ${dateTime(data.collection_started_at)}` : ""}。无曝光时点击率显示“—”；离开页面的停留上报可能不完整。</p>
        </CardContent></Card>
        </MaterialTabs>
      </section>
    </>}
  </main>;
}
export default function UsageAnalyticsPage() { return <InsightPageAccess permission="analytics:read" title="使用分析"><UsageContent /></InsightPageAccess>; }
