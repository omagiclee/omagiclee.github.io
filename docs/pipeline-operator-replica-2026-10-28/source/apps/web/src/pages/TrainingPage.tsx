import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { useProjectAuth } from "../auth-context";
import { platformRequest, type PageResult } from "../data-platform-api";
import { trainingGet, trainingWrite, trainingArtifactUrl, trainingStatus, type TrainingJob, type TrainingTemplate, type TrainingMetric, type TrainingCheckpoint, type TrainingPageResult } from "../training-platform-api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ToolbarSelect } from "../components/ui/period-menu";
import { Field, FormDialog, Heading, Message, Page, Table, Tabs, Details, Status, ResourceEmptyState } from "./platform/shared";
import "./platform-mock.css";
import "../styles.css";
import "./training-platform.css";

type Choice={id:string;name?:string;version?:string;sampleCount?:number;splitCounts?:Record<string,number>;digest?:string};
function CatalogPicker({project,endpoint,value,onChange,label,modality}: {project:string;endpoint:string;value:string;onChange:(id:string)=>void;label:string;modality?:string}) {
 const [q,setQ]=useState("");const deferred=useDeferredValue(q);const [cursor,setCursor]=useState("");const [history,setHistory]=useState<string[]>([]);
 const params=new URLSearchParams({limit:"50",q:deferred});if(cursor)params.set("cursor",cursor);if(modality)params.set("modality",modality);
 const query=useQuery({queryKey:["training-catalog",project,endpoint,deferred,cursor],queryFn:()=>platformRequest<PageResult<Choice>>(project,`${endpoint}?${params}`)});
 const [selected,setSelected]=useState<Choice>();
 const retained=useQuery({queryKey:["training-catalog",project,"selected",endpoint,value],queryFn:()=>platformRequest<Choice>(project,`${endpoint.endsWith("/versions")?"/versions":endpoint}/${encodeURIComponent(value)}`),enabled:!!value&&!selected&&!query.data?.items.some(row=>row.id===value)});
 const rows=[...(query.data?.items??[])];const chosen=selected??retained.data;if(chosen&&!rows.some(row=>row.id===chosen.id))rows.unshift(chosen);
 return <div className="training-catalog"><Input aria-label={`搜索${label}`} value={q} onChange={event=>{setQ(event.target.value);setCursor("");setHistory([]);}} placeholder={`搜索${label}`}/><select aria-label={label} value={value} required onChange={event=>{onChange(event.target.value);setSelected(rows.find(row=>row.id===event.target.value));}}><option value="">选择{label}</option>{rows.map(row=><option key={row.id} value={row.id}>{row.name??row.version??row.id}{row.splitCounts?` · train ${row.splitCounts.train??0} / val ${row.splitCounts.val??0}`:""}</option>)}</select><div className="platform-actions"><span>共 {query.data?.total??0} 项</span>{(cursor||query.data?.nextCursor)&&<><Button type="button" variant="ghost" disabled={!cursor} onClick={()=>{const previous=[...history];setCursor(previous.pop()??"");setHistory(previous);}}>前一页{label}</Button><Button type="button" variant="ghost" disabled={!query.data?.nextCursor} onClick={()=>{setHistory([...history,cursor]);setCursor(query.data?.nextCursor??"");}}>后一页{label}</Button></>}</div><Message error>{query.error?.message}</Message></div>;
}

export function TrainingLossChart({rows}:{rows:TrainingMetric[]}) {
 const chart=useRef<SVGSVGElement>(null);const [chartWidth,setChartWidth]=useState(700);
 const keys=[...new Set(rows.flatMap(row=>Object.keys(row.metrics).filter(key=>Number.isFinite(row.metrics[key]))))];const [selected,setSelected]=useState("train_loss");const key=keys.includes(selected)?selected:keys[0];
 const attempt=Math.max(0,...rows.map(row=>row.attempt));const points=rows.filter(row=>row.attempt===attempt&&Number.isFinite(row.metrics[key])).sort((a,b)=>a.step-b.step||a.epoch-b.epoch);
 useEffect(()=>{const element=chart.current;if(!element||typeof ResizeObserver==="undefined")return;const observer=new ResizeObserver(([entry])=>setChartWidth(Math.max(280,entry.contentRect.width)));observer.observe(element);return()=>observer.disconnect();},[points.length]);
 if(!points.length)return <p className="platform-help">尚无训练实测指标，任务执行后将显示曲线。</p>;
 const values=points.map(row=>row.metrics[key]);const low=Math.min(...values),high=Math.max(...values);const span=Math.max(high-low,1e-9);const first=points[0].step,last=points[points.length-1].step;
 const right=chartWidth-35;const position=(row:TrainingMetric,index:number)=>`${50+(last>first?(row.step-first)/(last-first):points.length>1?index/(points.length-1):.5)*(right-50)},${185-(row.metrics[key]-low)/span*150}`;
 return <section aria-label="训练指标曲线"><div className="platform-actions"><h3>实测指标</h3><ToolbarSelect label="曲线指标" value={key} onChange={setSelected} options={keys.map(metric=>({value:metric,label:metric}))}/></div><svg role="img" aria-label={`${key} 曲线，${points.length} 个实测点`} ref={chart} viewBox={`0 0 ${chartWidth} 220`} className="training-loss-chart"><title>{key} · 第 {attempt} 次执行</title><line x1="50" y1="190" x2={right} y2="190" stroke="currentColor"/><line x1="50" y1="30" x2="50" y2="190" stroke="currentColor"/><text x="4" y="38">{high.toPrecision(3)}</text><text x="4" y="190">{low.toPrecision(3)}</text><text x="50" y="212">step {first}</text><text x={right} y="212" textAnchor="end">step {last}</text><polyline points={points.map(position).join(" ")} fill="none" stroke="var(--primary)" strokeWidth="3"/>{points.map((row,i)=>{const [cx,cy]=position(row,i).split(",");return <circle key={row.id} cx={cx} cy={cy} r="3" fill="var(--primary)"><title>step {row.step}: {row.metrics[key]}</title></circle>;})}</svg><p className="platform-help">当前指标页 · 执行 {attempt} · 最新值 {values[values.length-1].toPrecision(5)}。验证指标仅来自 val 分区。</p></section>;
}

function TrainingCreateDialog({project,csrf,open,setOpen,templates,onCreated,initialDataset}: {project:string;csrf:string;open:boolean;setOpen:(open:boolean)=>void;templates:TrainingTemplate[];onCreated:(job:TrainingJob)=>void;initialDataset:string}) {
 const [dataset,setDataset]=useState(initialDataset);const [version,setVersion]=useState("");const [chosenTemplate,setTemplate]=useState("");const template=templates.find(row=>row.id===chosenTemplate)??templates[0];const templateId=template?.id??"";const defaults=template?.defaults?.parameters;
 return <FormDialog open={open} onOpenChange={setOpen} title="新建视频训练" description="固定已发布的视频数据版本，训练读取 train，验证读取 val；test 保持留出。" submitLabel="保存训练配置" onSubmit={async event=>{
   const values=new FormData(event.currentTarget);if(!version||!template)return "请选择模板和固定数据版本。";
   const parameters=Object.fromEntries(["epochs","batchSize","learningRate","frameSize","maxFramesPerVideo","sampleFps","seed","maxVideos"].map(key=>[key,Number(values.get(key))]));
   if(template.backend!=="external"&&Object.values(parameters).some(value=>!Number.isFinite(value)))return "请填写有效的训练参数。";
   const external=template.backend==="external";
   const job=await trainingWrite<TrainingJob>(project,"/jobs",csrf,{name:String(values.get("name")).trim(),datasetVersionId:version,templateId,backend:template.backend,modelName:String(values.get("modelName")).trim(),modelVersion:String(values.get("modelVersion")).trim(),parameters:external?{}:parameters,resources:{cpu:1,memoryMiB:1024,device:external?String(values.get("device")):"cpu",gpuCount:external&&values.get("device")==="gpu"?1:0},...(external?{codeRevision:String(values.get("codeRevision")),image:String(values.get("image"))}:{})});
   setOpen(false);onCreated(job);
 }}><Field label="任务名称"><Input name="name" maxLength={160} required placeholder="例如：道路视频帧预测实验"/></Field><Field label="训练模板"><select aria-label="训练模板" value={templateId} onChange={event=>setTemplate(event.target.value)}>{templates.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></Field><p className="platform-help">{template?.description}</p><CatalogPicker project={project} endpoint="/datasets" modality="视频" label="视频数据集" value={dataset} onChange={id=>{setDataset(id);setVersion("");}}/>{dataset&&<CatalogPicker key={dataset} project={project} endpoint={`/datasets/${encodeURIComponent(dataset)}/versions`} label="已发布数据版本" value={version} onChange={setVersion}/>}<div className="platform-form-columns"><Field label="模型名称"><Input name="modelName" maxLength={160} required/></Field><Field label="模型版本"><Input name="modelVersion" maxLength={160} defaultValue="v1" required/></Field></div>{template?.backend!=="external"&&<fieldset key={templateId} className="training-parameters"><legend>时序预测训练参数</legend><div className="platform-form-columns">{([
 ["epochs","训练轮数",5,1,100,1],["batchSize","批次大小",4,1,32,1],["learningRate","学习率",.01,.0001,.2,.0001],["frameSize","低分辨率帧边长",8,8,16,8],["maxFramesPerVideo","每个视频最大帧数",16,4,64,1],["sampleFps","采样帧率",2,.2,10,.1],["seed","随机种子",42,0,2147483647,1],["maxVideos","最大视频数量",32,1,64,1]
 ] as const).map(([name,label,value,min,max,step])=><Field key={name} label={label}><Input name={name} type="number" min={min} max={max} step={step} defaultValue={defaults?.[name]??value} required/></Field>)}</div></fieldset>}{template?.backend==="external"?<><Field label="资源类型"><select name="device"><option value="gpu">外部 GPU</option><option value="cpu">外部 CPU</option></select></Field><Field label="代码修订"><Input name="codeRevision" required placeholder="完整 Git commit"/></Field><Field label="训练镜像"><Input name="image" required placeholder="镜像名称与不可变 digest"/></Field><p className="platform-help">外部资源由训练适配器分配。模板需接入真实模型训练代码与服务。</p></>:<p className="platform-help">本机 CPU · 单线程数值计算 · 小分辨率下一帧预测基线。它用于实际训练、检查点和模型产物验证。</p>}</FormDialog>;
}

function TrainingJobDetail({project,csrf,jobId,onClose,canTrain,onCreated}: {project:string;csrf:string;jobId:string;onClose:()=>void;canTrain:boolean;onCreated:(job:TrainingJob)=>void}) {
 const client=useQueryClient();const [tab,setTab]=useState("概览");const [message,setMessage]=useState("");const [actionError,setActionError]=useState(false);const [pending,setPending]=useState(false);const [cursor,setCursor]=useState("");const [history,setHistory]=useState<string[]>([]);const [checkpointCursor,setCheckpointCursor]=useState("");const [checkpointHistory,setCheckpointHistory]=useState<string[]>([]);
 const job=useQuery({queryKey:["training-platform",project,"job",jobId],queryFn:()=>trainingGet<TrainingJob>(project,`/jobs/${encodeURIComponent(jobId)}`),refetchInterval:query=>["queued","running","pausing","cancelling"].includes(query.state.data?.runtimeStatus??"")?3000:false});
 const active=!!job.data&&["queued","running","pausing","cancelling"].includes(job.data.runtimeStatus);
 const metrics=useQuery({queryKey:["training-platform",project,"metrics",jobId,cursor],queryFn:()=>trainingGet<PageResult<TrainingMetric>>(project,`/jobs/${encodeURIComponent(jobId)}/metrics?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`),enabled:tab==="指标与日志"&&job.isSuccess,refetchInterval:active?3000:false});
 const checkpoints=useQuery({queryKey:["training-platform",project,"checkpoints",jobId,checkpointCursor],queryFn:()=>trainingGet<PageResult<TrainingCheckpoint>>(project,`/jobs/${encodeURIComponent(jobId)}/checkpoints?limit=100${checkpointCursor?`&cursor=${encodeURIComponent(checkpointCursor)}`:""}`),enabled:tab==="检查点与模型"&&job.isSuccess,refetchInterval:active?5000:false});
 async function action(kind:string){if(!job.data||pending)return;setPending(true);setMessage("");setActionError(false);try{const result=await trainingWrite<TrainingJob>(project,`/jobs/${jobId}/${kind}`,csrf,{expectedRevision:job.data.revision});if(kind==="clone")onCreated(result);else setMessage({submit:"任务已排队，由训练 Worker 执行。",pause:"已请求在批次边界保存检查点并暂停。",resume:"已从检查点重新排队。",cancel:"取消请求已保存。",retry:"失败任务已重新排队，已有有效检查点保留。"}[kind]??"操作已完成。");await client.invalidateQueries({queryKey:["training-platform",project]});}catch(error){setActionError(true);setMessage(error instanceof Error?error.message:"操作失败");}finally{setPending(false);}}
 if(job.error)return <Message error>{job.error.message}</Message>;if(!job.data)return <p role="status">正在读取训练任务…</p>;
 const row=job.data;const local=row.backend==="local-cpu";const state=row.runtimeStatus;
 return <section className="platform-panel training-detail"><div className="platform-section-heading"><h2>{row.name}</h2><Button variant="ghost" onClick={onClose}>关闭任务详情</Button></div><div className="platform-actions"><Status value={trainingStatus[state]??state}/>{canTrain&&<>{state==="draft"&&<Button disabled={pending} onClick={()=>void action("submit")}>开始训练</Button>}{local&&state==="running"&&<Button variant="outline" disabled={pending} onClick={()=>void action("pause")}>暂停并保存</Button>}{local&&state==="paused"&&<Button disabled={pending} onClick={()=>void action("resume")}>从检查点恢复</Button>}{local&&state==="failed"&&<Button disabled={pending} onClick={()=>void action("retry")}>重试训练</Button>}{local&&["draft","queued","running","paused","pausing"].includes(state)&&<Button variant="outline" disabled={pending} onClick={()=>void action("cancel")}>取消训练</Button>}<Button variant="outline" disabled={pending} onClick={()=>void action("clone")}>复制配置</Button></>}</div><Message error={actionError}>{message}</Message><Message error>{row.error}</Message><Tabs tabs={["概览","指标与日志","检查点与模型"]} active={tab} onChange={setTab} label="训练详情">
 {tab==="概览"&&<><Details rows={[["执行方式",local?"本机 CPU 帧预测基线":"外部视频／世界模型训练"],["模板",row.templateId],["数据版本",<Link to="/projects/$projectId/datasets/$datasetId" params={{projectId:project,datasetId:row.datasetId}} search={{version:row.datasetVersionId}}>固定版本 {row.datasetVersionId}</Link>],["数据摘要",row.datasetDigest],["样本范围",`train ${row.trainSampleCount} · val ${row.valSampleCount} · test 不参与训练`],["训练进度",Object.entries(row.progress??{}).map(([key,value])=>`${key}: ${value}`).join(" · ")||"等待 Worker"],["模型版本",`${row.modelName}@${row.modelVersion}`],["代码修订",row.codeRevision],["执行环境",row.image]]}/><h3>冻结配置</h3><pre className="training-json">{JSON.stringify({parameters:row.parameters,resources:row.resources},null,2)}</pre></>}
 {tab === "指标与日志" && <>
   {metrics.isPending ? <p role="status">正在读取训练指标…</p> : metrics.isError ? <ResourceEmptyState resource="训练指标" error={metrics.error.message} action={<Button variant="outline" onClick={() => void metrics.refetch()}>重新加载指标</Button>} /> : !metrics.data?.items.length ? <ResourceEmptyState resource="训练指标" title="尚无实测指标" description="尚无训练实测指标，任务执行后将显示曲线。" /> : <>
     <TrainingLossChart rows={metrics.data.items} />
     <Table headers={["执行 / 轮次 / 步骤", "指标", "日志"]}>{metrics.data.items.map(metric => <tr key={metric.id}><td>{metric.attempt} / {metric.epoch} / {metric.step}</td><td>{Object.entries(metric.metrics).map(([key, value]) => <div key={key}>{key}: {Number.isFinite(value) ? value.toPrecision(5) : "—"}</div>)}</td><td><pre className="training-log" tabIndex={0} role="region" aria-label={`训练日志 · 执行 ${metric.attempt} / 轮次 ${metric.epoch} / 步骤 ${metric.step}`}>{metric.logs || "无日志"}</pre></td></tr>)}</Table>
   </>}
   {metrics.data && !metrics.isError && (metrics.data.total > 0 || cursor || metrics.data.nextCursor) && <div className="platform-actions"><span>共 {metrics.data.total} 条</span>{(cursor || metrics.data.nextCursor) && <><Button variant="outline" disabled={!cursor} onClick={() => { const prev = [...history]; setCursor(prev.pop() ?? ""); setHistory(prev); }}>上一页指标</Button><Button variant="outline" disabled={!metrics.data.nextCursor} onClick={() => { setHistory([...history, cursor]); setCursor(metrics.data.nextCursor ?? ""); }}>下一页指标</Button></>}</div>}
 </>}
 {tab === "检查点与模型" && <>
   <p className="platform-help">检查点保存实际模型状态、数据摘要与训练位置。恢复不会改动固定数据版本。</p>
   <Details rows={[["产出模型", row.modelId ?? "尚未登记"], ["模型 SHA256", row.artifactDigest ?? "尚未生成"], ["最新检查点", row.checkpointSha256 ?? "尚无检查点"]]} />
   {row.runtimeStatus === "completed" && row.modelId && <div className="platform-actions"><a className="platform-action-link" href={trainingArtifactUrl(project, jobId)}>下载模型产物</a><Link className="platform-action-link" to="/projects/$projectId/evaluations" params={{ projectId: project }} search={{ modelId: row.modelId, create: "new" }}>创建模型评测</Link></div>}
   {checkpoints.isPending ? <p role="status">正在读取检查点…</p> : checkpoints.isError ? <ResourceEmptyState resource="检查点" error={checkpoints.error.message} action={<Button variant="outline" onClick={() => void checkpoints.refetch()}>重新加载检查点</Button>} /> : !checkpoints.data?.items.length ? <ResourceEmptyState resource="检查点" title="尚无检查点" description="训练保存检查点后，可在这里查看实际执行位置与制品摘要。" /> : <Table headers={["执行 / 轮次 / 步骤", "制品摘要", "对象地址"]}>{checkpoints.data.items.map(point => <tr key={point.id}><td>{point.attempt} / {point.epoch} / {point.step}</td><td><code>{point.digest}</code></td><td><code>{point.uri}</code></td></tr>)}</Table>}
   {checkpoints.data && !checkpoints.isError && (checkpoints.data.total > 0 || checkpointCursor || checkpoints.data.nextCursor) && <nav className="platform-pagination" aria-label="检查点分页"><span>共 {checkpoints.data.total} 条</span>{(checkpointCursor || checkpoints.data.nextCursor) && <><Button variant="outline" disabled={!checkpointCursor} onClick={() => { const previous = [...checkpointHistory]; setCheckpointCursor(previous.pop() ?? ""); setCheckpointHistory(previous); }}>上一页检查点</Button><Button variant="outline" disabled={!checkpoints.data.nextCursor} onClick={() => { setCheckpointHistory([...checkpointHistory, checkpointCursor]); setCheckpointCursor(checkpoints.data.nextCursor ?? ""); }}>下一页检查点</Button></>}</nav>}
 </>}

 </Tabs></section>;
}

export default function TrainingPage() {
  const pathname = useRouterState({ select: state => state.location.pathname });
  const search = useRouterState({ select: state => state.location.searchStr });
  const project = decodeURIComponent(pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? "demo");
  const { me, can } = useProjectAuth(project);
  const client = useQueryClient();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const jobId = params.get("job") ?? "";
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q);
  const [status, setStatus] = useState("");
  const [backend, setBackend] = useState("");
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const templates = useQuery({ queryKey: ["training-platform", project, "templates"], queryFn: () => trainingGet<{ items: TrainingTemplate[]; externalConfigured?: boolean; localAvailable?: boolean }>(project, "/templates") });
  const query = new URLSearchParams({ limit: "50", q: deferred });
  if (status) query.set("status", status);
  if (backend) query.set("backend", backend);
  if (cursor) query.set("cursor", cursor);
  const jobs = useQuery({ queryKey: ["training-platform", project, me.user.id, "jobs", deferred, status, backend, cursor], queryFn: () => trainingGet<TrainingPageResult<TrainingJob>>(project, `/jobs?${query}`), refetchInterval: 5000 });
  const selectJob = (id: string) => {
    const next = new URLSearchParams(search);
    id ? next.set("job", id) : next.delete("job");
    void navigate({ to: pathname, search: Object.fromEntries(next) });
  };
  const created = (job: TrainingJob) => { void client.invalidateQueries({ queryKey: ["training-platform", project] }); selectJob(job.id); };
  const reset = () => { setCursor(""); setHistory([]); };
  const filtered = Boolean(q.trim() || status || backend);
  const clearFilters = () => { setQ(""); setStatus(""); setBackend(""); reset(); };
  const total = jobs.data?.summary?.total ?? jobs.data?.total;
  const canCreate = can("data_platform:train") && Boolean(templates.data?.items.length);
  const newTraining = <Button disabled={!canCreate} onClick={() => setOpen(true)}><Plus aria-hidden="true" />新建训练</Button>;
  const empty = jobs.isSuccess && !jobs.data.items.length;
  const initialEmpty = empty && !filtered && !cursor;
  const refresh = () => { void client.invalidateQueries({ queryKey: ["training-platform", project] }); };

  return <Page>
    <Heading title="视频训练平台" description="管理训练任务、查看实测指标与模型产物。" action={newTraining} />
    <section className="training-jobs" aria-labelledby="training-jobs-heading">
      <div className="training-directory-heading"><h2 id="training-jobs-heading">训练任务{total != null && <span>{total}</span>}</h2><Button variant="ghost" aria-label="刷新训练任务" onClick={refresh}><RefreshCw aria-hidden="true" />刷新</Button></div>
      {!initialEmpty && <div className="platform-toolbar">
        <label className="platform-toolbar-search"><Input aria-label="搜索训练任务" value={q} placeholder="搜索任务名称" onChange={event => { setQ(event.target.value); reset(); }} /></label>
        <ToolbarSelect label="训练状态" value={status} onChange={value => { setStatus(value); reset(); }} options={[{value:"",label:"全部状态"},...Object.entries(trainingStatus).filter(([key])=>key!=="pending").map(([value,label])=>({value,label}))]}/>
        <ToolbarSelect label="训练执行方式" value={backend} onChange={value=>{setBackend(value);reset();}} options={[{value:"",label:"全部执行方式"},{value:"local-cpu",label:"本机 CPU"},{value:"external",label:"外部训练"}]}/>
      </div>}
      {jobs.isError ? <ResourceEmptyState resource="训练任务" error={jobs.error.message} action={<Button variant="outline" onClick={refresh}>重新加载</Button>} /> : jobs.isPending ? <p className="training-loading" role="status">正在读取训练任务…</p> : <Table headers={["训练任务", "模型与数据", "执行方式", "状态", "进度"]} empty={empty} emptyState={<ResourceEmptyState resource="训练任务" title={cursor&&!filtered?"当前页没有训练任务":undefined} filtered={filtered} onReset={clearFilters} description={cursor ? "当前页没有任务，可返回上一页继续查看。" : can("data_platform:train") ? "选择已发布的视频数据版本，创建训练任务并跟踪执行进度。" : "当前还没有训练任务。任务创建后，可在这里查看进度和产物。"} action={canCreate && !cursor ? newTraining : undefined} />}>
        {jobs.data?.items.map(job => <tr key={job.id}><td><button className="platform-text-button" onClick={() => selectJob(job.id)}>{job.name}</button></td><td>{job.modelName}@{job.modelVersion}<small>训练 {job.trainSampleCount} · 验证 {job.valSampleCount}</small></td><td>{job.backend === "local-cpu" ? "本机 CPU" : "外部训练"}</td><td><Status value={trainingStatus[job.runtimeStatus] ?? job.runtimeStatus} /></td><td>轮次 {job.progress?.epoch ?? 0} · 步骤 {job.progress?.step ?? 0}</td></tr>)}
      </Table>}
      {jobs.data && !jobs.isError && (jobs.data.total > 0 || cursor || jobs.data.nextCursor) && <nav className="platform-pagination" aria-label="训练任务分页"><span>共 {jobs.data.total} 项 · 第 {history.length + 1} 页</span><Button variant="outline" disabled={!cursor} onClick={() => { const previous = [...history]; setCursor(previous.pop() ?? ""); setHistory(previous); }}>上一页任务</Button><Button variant="outline" disabled={!jobs.data.nextCursor} onClick={() => { setHistory([...history, cursor]); setCursor(jobs.data.nextCursor ?? ""); }}>下一页任务</Button></nav>}
    </section>
    {jobId && <TrainingJobDetail key={jobId} project={project} csrf={me.csrf_token} jobId={jobId} canTrain={can("data_platform:train")} onClose={() => selectJob("")} onCreated={created} />}
    <details className="training-environments"><summary>执行环境与训练说明</summary>
      <Message error>{templates.error?.message}</Message>
      {templates.isPending ? <p role="status">正在读取执行环境…</p> : templates.data && <dl><div><dt>本机 CPU</dt><dd>{templates.data.localAvailable === false ? "不可用" : "可用"} · 帧预测基线训练</dd></div><div><dt>外部训练服务</dt><dd>{templates.data.externalConfigured ? "已配置" : "尚未接入"}</dd></div></dl>}
      <p>本机模板训练小分辨率下一帧预测模型。大规模视频模型需要接入外部训练代码与计算资源；指标始终来自实际执行。</p>
    </details>
    <TrainingCreateDialog project={project} csrf={me.csrf_token} open={open} setOpen={setOpen} templates={templates.data?.items ?? []} onCreated={created} initialDataset={params.get("datasetId") ?? ""} />
  </Page>;
}
