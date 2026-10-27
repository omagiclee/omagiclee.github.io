import { AutoGtFailureEvidence } from "../../components/AutoGtFailureEvidence";
import { autoGtFailureEvidence, autoGtSampleInputLabel } from "./auto-gt-display";
import { sampleInputLabel } from "./media-reflow-display";
import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { apiUrl } from "../../auth-api";
import { useQuery } from "@tanstack/react-query";
import { platformRequest, platformPageQuery } from "../../data-platform-api";
import { usePlatform } from "./platform-store";
import { ChevronDown, Search, X } from "lucide-react";
import { Children, cloneElement, isValidElement, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { statusVariant } from "../../lib/status-variant";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ToolbarSelect } from "../../components/ui/period-menu";

export const storageError = "保存失败，请核对权限或最新记录后重试。";
export function Heading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <header className="platform-page-heading"><div><h1 className="md-page-title">{title}</h1><p>{description}</p></div>{action && <div className="platform-heading-actions">{action}</div>}</header>;
}
// Project scope is already visible in the application shell. Fixed-version semantics
// are explained beside version selectors instead of repeated on every resource page.
export function PlatformNotice() { return null; }
export function Page({ children }: { children: ReactNode }) { return <main className="md-page platform-page">{children}</main>; }
export function Breadcrumb({ href, parent, name }: { href: string; parent: string; name: string }) { return <nav className="platform-breadcrumb" aria-label="面包屑"><Link to={href}>{parent}</Link><span aria-hidden="true">/</span><span aria-current="page">{name}</span></nav>; }
export function Status({ value }: { value: string }) {
  const variant = statusVariant(value);
  return <Badge variant={variant}>{value}</Badge>;
}
export function useView(fallback: string) {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const get = (key: string, defaultValue = "") => params.get(key) ?? defaultValue;
  const set = (values: Record<string, string>) => { const next = new URLSearchParams(params); if(Object.keys(values).some(key => ["q","tab","version","selection","modality","status","benchmarkId"].includes(key))) {next.delete("cursor");next.delete("pagingHistory");} for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key); void navigate({ to: pathname, search: Object.fromEntries(next), replace: false }); };
  return { tab: get("tab", fallback), setTab: (tab: string) => set({ tab, sample: "", workspace: "" }), get, set };
}
/** Content remains controlled by the URL (or caller state), including browser history. */
export function Tabs({ tabs, active, onChange, label, children }: { tabs: string[]; active: string; onChange: (value: string) => void; label: string; children: ReactNode }) {
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(0, tabs.indexOf(active));
  const activate = (index: number) => {
    buttons.current[index]?.focus();
    onChange(tabs[index]);
  };
  return <div className="platform-tab-workspace"><div className="platform-tabs" role="tablist" aria-label={label}>{tabs.map((tab, index) => <button type="button" role="tab" key={tab} ref={element => { buttons.current[index] = element; }} id={`${id}-tab-${index}`} aria-selected={index === selectedIndex} aria-controls={`${id}-panel`} tabIndex={index === selectedIndex ? 0 : -1} onClick={() => onChange(tab)} onKeyDown={event => {
    let next: number | undefined;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); activate(next); }
  }}>{tab}</button>)}</div><div className="platform-tab-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${selectedIndex}`} tabIndex={0}>{children}</div></div>;
}
/** An empty catalog needs a next step; an empty search needs a way to reset. */
export function ResourceEmptyState({ resource, filtered = false, onReset, description, action, error, compact = false, title }: { title?: string; compact?: boolean; resource: string; filtered?: boolean; onReset?: () => void; description?: string; action?: ReactNode; error?: string }) {
  return <section className={`platform-resource-empty${compact ? " is-compact" : ""}${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
        <h2>{title ?? (error ? `${resource}加载失败` : filtered ? "没有匹配的结果" : `还没有${resource}`)}</h2>
    <p>{error || (filtered ? "尝试其他关键词，或清除筛选条件查看全部记录。" : description ?? `创建${resource}后，即可在这里查看和管理。`)}</p>
    <div className="platform-empty-actions">{filtered && onReset ? <Button variant="outline" onClick={onReset}>清除筛选</Button> : action}</div>
  </section>;
}
export function FilterBar({ query, onQuery, placeholder, count, children }: { query: string; onQuery: (value: string) => void; placeholder: string; count: number; children?: ReactNode }) {
  return <section className="platform-toolbar" aria-label="筛选"><label className="platform-search"><Search aria-hidden="true" /><Input aria-label={placeholder} placeholder={placeholder} value={query} onChange={(event) => onQuery(event.target.value)} /></label>{children}<span className="platform-count">{count} 项</span></section>;
}
export function Table({ headers, children, empty, emptyState, loading = false, error }: { headers: string[]; children: ReactNode; empty?: boolean; emptyState?: ReactNode; loading?: boolean; error?: string }) {
  const id = useId();
  if (loading) return <p className="platform-list-loading" role="status">正在加载{headers[0]}…</p>;
  if (error) return <ResourceEmptyState resource={headers[0]} error={error} />;
  if (empty) return emptyState ?? <ResourceEmptyState resource="记录" description="当前没有可展示的记录。数据准备完成后会显示在这里。" />;
  const rows = Children.map(children, row => {
    if (!isValidElement<{ children?: ReactNode; role?: string }>(row) || row.type !== "tr") return row;
    return cloneElement(row, { role: "row" }, Children.map(row.props.children, (cell, index) => {
      if (!isValidElement<{ children?: ReactNode; role?: string; "data-label"?: string }>(cell) || cell.type !== "td") return cell;
      return cloneElement(cell, { role: "cell", "data-label": headers[index] });
    }));
  });
  return <div className="platform-table-container"><p className="platform-table-scroll-hint" id={`${id}-layout`}>小屏幕按记录展示全部字段</p><div className="platform-table-wrap" tabIndex={0} role="region" aria-label={`${headers[0]}列表`} aria-describedby={`${id}-layout`}><table role="table" className={`platform-table${headers[0] === "选择" ? " has-selection" : ""}`}><thead role="rowgroup"><tr role="row">{headers.map((label) => <th role="columnheader" key={label} scope="col">{label}</th>)}</tr></thead><tbody role="rowgroup">{rows}</tbody></table></div></div>;
}
export function Details({ rows }: { rows: [string, ReactNode][] }) { return <dl className="platform-detail-list">{rows.map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>)}</dl>; }
export function Message({ children, error = false }: { children: ReactNode; error?: boolean }) { return children ? <p className={`platform-message${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{children}</p> : null; }
export function NotFound({ title, href }: { title: string; href: string }) { return <Page><Heading title="未找到记录" description={`该${title}不存在，或不属于当前项目。`} /><Link to={href}>返回{title}列表</Link></Page>; }
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="platform-field"><span>{label}</span>{children}</label>; }
export function Select({ label, value, onChange, options, required = false, toolbar = false, prefix }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; required?: boolean; toolbar?: boolean; prefix?: string }) { return toolbar ? <ToolbarSelect label={label} prefix={prefix} value={value} onChange={next => onChange(next)} options={options} /> : <select aria-label={label} value={value} required={required} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>; }
export function FormDialog({ open, onOpenChange, title, description, submitLabel = "创建", onSubmit, children }: { open: boolean; onOpenChange: (value: boolean) => void; title: string; description: string; submitLabel?: string; onSubmit: (event: FormEvent<HTMLFormElement>) => string | void | Promise<string | void>; children: ReactNode }) {
  const [error, setError] = useState("");
  const id = useId();
  const [pending, setPending] = useState(false);
  return <Dialog.Root open={open} onOpenChange={(value) => { if (pending) return; setError(""); onOpenChange(value); }}><Dialog.Portal><Dialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-40" /><Dialog.Viewport className="platform-dialog-viewport"><Dialog.Popup className="platform-dialog"><header><Dialog.Title>{title}</Dialog.Title><Dialog.Close render={<Button variant="ghost" size="icon" disabled={pending} />} aria-label="关闭"><X /></Dialog.Close></header><Dialog.Description>{description}</Dialog.Description><form id={id} onSubmit={async (event) => { event.preventDefault(); if (pending) return; setPending(true); setError(""); try { setError(await onSubmit(event) ?? ""); } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请重试。"); } finally { setPending(false); } }}><fieldset className="platform-dialog-fields" disabled={pending}>{children}</fieldset><Message error>{error}</Message><footer><Dialog.Close render={<Button variant="ghost" disabled={pending} />}>取消</Dialog.Close><Button type="submit" variant="ghost" disabled={pending}>{pending ? "保存中…" : submitLabel}</Button></footer></form></Dialog.Popup></Dialog.Viewport></Dialog.Portal></Dialog.Root>;
}
export function SamplePreview({ input, output, label, assets }: { input: string; output: string; label: string; assets?: import("./platform-store").Asset[] }) { const evidence = autoGtFailureEvidence(input); return <div className="platform-evidence">{evidence ? <AutoGtFailureEvidence evidence={evidence} assets={assets} /> : assets?.map(asset=><AssetPlayer key={asset.id} asset={asset} />)}<section><h3>输入与上下文</h3><p>{autoGtSampleInputLabel(sampleInputLabel(input))}</p></section><section><h3>{label}</h3><p>{output || "暂无内容"}</p></section></div>; }

export function Pagination({ page }: {page?: import("./platform-store").PageInfo}) {
  const view=useView("");
  if(!page || (page.total === 0 && !view.get("cursor") && !page.nextCursor)) return null;
  let history:string[]=[];
  try {const parsed=JSON.parse(view.get("pagingHistory","[]"));if(Array.isArray(parsed)&&parsed.every(x=>typeof x==="string"))history=parsed;}catch{/* Old URL has no page history. */}
  if (!view.get("cursor") && !page.nextCursor) return <p className="platform-record-count">共 {page.total} 项</p>;
  const previous=()=>{const previous=history.pop()??"";view.set({cursor:previous,pagingHistory:history.length?JSON.stringify(history):"",sample:""});};
  const next=()=>{if(page.nextCursor)view.set({cursor:page.nextCursor,pagingHistory:JSON.stringify([...history,view.get("cursor")]),sample:""});};
  return <nav className="platform-pagination" aria-label="分页"><span>共 {page.total} 项 · 第 {history.length+1} 页</span><Button variant="outline" disabled={!view.get("cursor")} onClick={previous}>上一页</Button><Button variant="outline" disabled={!page.nextCursor} onClick={next}>下一页</Button></nav>;
}

export function AssetPlayer({asset,onTime}: {asset:import("./platform-store").Asset;onTime?:(timeMs:number)=>void}) {
 const source=apiUrl(asset.playbackUrl);
 const range=asset.startMs!=null?`#t=${asset.startMs/1000}${asset.endMs!=null?","+asset.endMs/1000:""}`:"";
 return <figure className="platform-asset"><figcaption>{asset.kind === "image" && ["input", "target"].includes(String(asset.metadata?.role)) ? asset.metadata?.role === "input" ? "输入图" : "目标参考" : {video:"视频",image:"图像",audio:"音频",pointcloud:"点云",text:"文本"}[asset.kind]} · SHA-256 {asset.sha256.slice(0,12)}{asset.startMs!=null?` · ${asset.startMs}–${asset.endMs} ms`:""}</figcaption>{asset.kind==="video"?<video controls preload="metadata" src={source+range} onTimeUpdate={event=>onTime?.(Math.round(event.currentTarget.currentTime*1000))} />:asset.kind==="image"?<img src={source} alt="标注输入资产"/>:asset.kind==="audio"?<audio controls preload="metadata" src={source}/>:<a className="platform-action-link" href={source} target="_blank" rel="noreferrer">打开{asset.kind==="pointcloud"?"点云":"文本"}资产</a>}</figure>;
}
// Every selector can search and advance through the catalog; it never implies
// that the first page represents all datasets, specifications, or users.
export function EntitySelect({resource,value,onChange,label,selected,filter="",required=true,emptyLabel,compact=false}: {compact?:boolean;resource:string;value:string;onChange:(id:string)=>void;label:string;selected?:{id:string;name:string;version?:string};filter?:string;required?:boolean;emptyLabel?:string}) {
 const {projectId}=usePlatform();const [filterOpen,setFilterOpen]=useState(false);const [q,setQ]=useState("");const [cursor,setCursor]=useState("");const [history,setHistory]=useState<string[]>([]);
 const params=new URLSearchParams({limit:"50",q});if(cursor)params.set("cursor",cursor);
 const page=useQuery(platformPageQuery<{id:string;name:string;version?:string;canAnnotate?:boolean;canReview?:boolean}>(projectId,`/${resource}?${params}${filter?"&"+filter:""}`));
 const selection=useQuery({queryKey:["data-platform",projectId,"selector-detail",resource,value],queryFn:()=>platformRequest<{id:string;name:string;version?:string}>(projectId,`/${resource}/${encodeURIComponent(value)}`),enabled:!!value&&!selected&&!page.data?.items.some(item=>item.id===value),staleTime:10_000});
 const options=[...(page.data?.items??[])];const retained=selected??selection.data;if(retained&&!options.some(item=>item.id===retained.id))options.unshift(retained);
 const searchControl = <Input aria-label={`搜索${label}`} placeholder={`搜索${label}`} value={q} onChange={event=>{setQ(event.target.value);setCursor("");setHistory([]);}}/>;
 const control = <div className="platform-entity-select">{compact ? <label className="platform-toolbar-search">{searchControl}</label> : searchControl}<Select toolbar={compact} label={compact ? `选择${label}` : label} value={value} onChange={next => { onChange(next); setFilterOpen(false); }} options={[{value:"",label:emptyLabel??`选择${label}`},...options.map(item=>({value:item.id,label:resource==="models"&&item.version?`${item.name}@${item.version}`:item.name}))]} required={required}/>{page.isPending?<p className="platform-selector-status" role="status">正在加载{label}…</p>:page.error?<Message error>{page.error.message}</Message>:q&&!page.data?.items.length?<p className="platform-selector-status" role="status">没有匹配的{label}，请尝试其他关键词。</p>:(cursor||page.data?.nextCursor)&&<div className="platform-actions"><span>共 {page.data?.total??0} 项</span><Button type="button" variant="ghost" disabled={!cursor} onClick={()=>{const next=[...history];setCursor(next.pop()??"");setHistory(next);}}>前一页</Button><Button type="button" variant="ghost" disabled={!page.data?.nextCursor} onClick={()=>{setHistory([...history,cursor]);setCursor(page.data?.nextCursor??"");}}>后一页</Button></div>}</div>;
 return compact ? <Popover.Root open={filterOpen} onOpenChange={setFilterOpen}><Popover.Trigger render={<Button variant="outline" size="sm" className="platform-entity-filter-trigger" />} aria-label={label}><span className="toolbar-select-label">{retained?.name ?? options.find(item => item.id === value)?.name ?? (value ? "已选择" : emptyLabel ?? label)}</span><ChevronDown aria-hidden="true" /></Popover.Trigger><Popover.Portal><Popover.Positioner className="platform-entity-filter-positioner" sideOffset={4} align="start"><Popover.Popup className="platform-entity-filter-popup" aria-label={label}>{control}</Popover.Popup></Popover.Positioner></Popover.Portal></Popover.Root> : control;
}
