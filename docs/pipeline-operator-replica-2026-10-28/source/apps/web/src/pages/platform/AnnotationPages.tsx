import { Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { platformRequest, platformPageQuery } from "../../data-platform-api";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { taskSamples, taskSummaryStatus, usePlatform, type Sample, type Spec } from "./platform-store";
import { AnnotationBatch } from "./AnnotationBatch";
import { AutoGtFailureEvidence } from "../../components/AutoGtFailureEvidence";
import { autoGtFailureEvidence } from "./auto-gt-display";
import { GeometryEditor } from "./GeometryEditor";
import { EntitySelect, Pagination, Breadcrumb, PlatformNotice, Details, Field, FilterBar, FormDialog, Heading, Message, NotFound, Page, Select, Status, Table, Tabs, ResourceEmptyState, storageError, useView } from "./shared";

export function TaskCreateDialog({ open, onOpenChange, initialDatasetId, sampleIds, feedbackId, onCreated }: { open: boolean; onOpenChange: (value: boolean) => void; initialDatasetId?: string; sampleIds?: string[]; feedbackId?: string; onCreated?: (id: string) => void }) {
  const { state, write, path, userId, projectId } = usePlatform(); const navigate=useNavigate();
  const [datasetId,setDatasetId]=useState(initialDatasetId??state.datasets[0]?.id??"");const [specId,setSpecId]=useState(state.specs[0]?.id??"");
  const [assignee,setAssignee]=useState(userId);const [reviewer,setReviewer]=useState(state.users.find(item=>item.id!==userId&&item.canReview)?.id??"");
  const [checked,setChecked]=useState<string[]>(sampleIds??[]);const [cursor,setCursor]=useState("");const [history,setHistory]=useState<string[]>([]);
  const samples=useQuery({...platformPageQuery<Sample>(projectId,`/datasets/${datasetId}/samples?limit=50${cursor?"&cursor="+encodeURIComponent(cursor):""}`),enabled:open&&!!datasetId&&!sampleIds});
  const spec=useQuery({queryKey:["data-platform",projectId,"spec",specId],queryFn:()=>platformRequest<Spec>(projectId,`/specs/${specId}`),enabled:open&&!!specId});
  return <FormDialog open={open} onOpenChange={onOpenChange} title="新建标注任务" description="选择明确的样本范围，关联固定规范及标注、审核负责人。" onSubmit={async event=>{
    const name=String(new FormData(event.currentTarget).get("name")??"").trim();
    if(!name||!datasetId||!spec.data||!assignee||!reviewer)return "请填写名称并选择数据集、规范和负责人。";
    const ids=sampleIds??checked;if(!ids.length)return "请勾选至少一个任务样本。";
    const created=await write("/tasks",{name,datasetId,sampleIds:ids,specId,specVersion:spec.data.version,assignee,reviewer,feedbackId});onOpenChange(false);if(onCreated)onCreated(created.id);else void navigate({to:path(`annotation/tasks/${created.id}`)});
  }}><Field label="任务名称"><Input name="name" required maxLength={100}/></Field>{feedbackId?<p>数据集：{state.datasets.find(item=>item.id===datasetId)?.name??datasetId} · 固定反馈样本</p>:<EntitySelect resource="datasets" label="输入数据集" value={datasetId} onChange={value=>{setDatasetId(value);setChecked([]);setCursor("");setHistory([]);}} selected={state.datasets.find(item=>item.id===datasetId)}/>}
  <p className="platform-help">已选择 {(sampleIds??checked).length} 个样本{samples.data?` / 数据集共 ${samples.data.total} 个`:""}。任务仅包含已选成员，翻页不会自动纳入其他样本。反馈选集保留训练/留出边界。</p>
  {!sampleIds&&<><Button variant="outline" onClick={()=>setChecked([...new Set([...checked,...(samples.data?.items.map(item=>item.id)??[])])])}>选择本页全部样本</Button><div className="platform-member-picker">{samples.data?.items.map(item=><label key={item.id}><input type="checkbox" checked={checked.includes(item.id)} onChange={event=>setChecked(event.target.checked?[...checked,item.id]:checked.filter(id=>id!==item.id))}/>{item.name} · {item.state}</label>)}</div><Message error>{samples.error?.message}</Message>{(cursor || samples.data?.nextCursor) && <div className="platform-actions"><Button variant="ghost" disabled={!cursor} onClick={()=>{const next=[...history];setCursor(next.pop()??"");setHistory(next);}}>前一页样本</Button><Button variant="ghost" disabled={!samples.data?.nextCursor} onClick={()=>{setHistory([...history,cursor]);setCursor(samples.data?.nextCursor??"");}}>后一页样本</Button></div>}</>}
  <EntitySelect resource="specs" label="标注规范" value={specId} onChange={setSpecId} selected={state.specs.find(item=>item.id===specId)}/><EntitySelect resource="users" label="标注负责人" value={assignee} onChange={setAssignee} selected={state.users.find(item=>item.id===assignee)} filter="canAnnotate=true"/><EntitySelect resource="users" label="审核负责人" value={reviewer} onChange={setReviewer} selected={state.users.find(item=>item.id===reviewer)} filter="canReview=true"/></FormDialog>;
}

export function AnnotationTasksPage() {
  const { state, path, userName, can } = usePlatform();
  const view = useView("全部任务");
  const filter = ["全部任务", "标注中", "待审核", "需修订", "已完成"].includes(view.tab) ? view.tab : "全部任务";
  const query=view.get("q");const setQuery=(q:string)=>view.set({q});
  const [open, setOpen] = useState(false);
  const rows = state.tasks;
  return <Page><Heading title="标注任务" description="组织样本修订、人工审核与返工，形成可发布的数据版本。" action={<Button disabled={!can("data_platform:write")} onClick={() => setOpen(true)}><Plus />新建任务</Button>} /><PlatformNotice /><FilterBar query={query} onQuery={setQuery} placeholder="搜索标注任务" count={state.page?.total ?? rows.length}><Select toolbar label="任务状态" value={filter} onChange={value=>view.set({tab:value,status:value==="全部任务"?"":value})} options={["全部任务", "标注中", "待审核", "需修订", "已完成"].map((value) => ({ value, label: value }))} /></FilterBar><Table headers={["任务", "数据集", "审核进度", "负责人", "状态"]} empty={!rows.length} emptyState={<ResourceEmptyState resource="标注任务" filtered={Boolean(query || filter !== "全部任务" || view.get("cursor"))} onReset={() => view.set({q:"",tab:"",status:"",cursor:"",pagingHistory:""})} description="为数据集分配标注规范、标注负责人和审核负责人，开始组织样本修订。" action={<Button disabled={!can("data_platform:write")} onClick={() => setOpen(true)}>新建任务</Button>} />}>{rows.map((item) => <tr key={item.id}><td><Link to={path(`annotation/tasks/${item.id}`)}>{item.name}</Link><small>{state.specs.find((spec) => spec.id === item.specId)?.type}</small></td><td>{state.datasets.find((dataset) => dataset.id === item.datasetId)?.name}</td><td>{item.stateCounts?.["已通过"]??0} / {item.sampleCount??0}</td><td>{userName(item.assignee)}<small>审核：{userName(item.reviewer)}</small></td><td><Status value={taskSummaryStatus(item)} /></td></tr>)}</Table><Pagination page={state.page}/><TaskCreateDialog open={open} onOpenChange={setOpen} /></Page>;
}

function SampleEditor({ sample, spec, review, onSave, taskId }: { sample: Sample; spec?: Spec; review: boolean; taskId:string; onSave: (output: string, label: string, state: Sample["state"], geometry: Record<string,unknown>, displayed: {revision:number;annotationId?:string}) => Promise<Sample> }) {
  const {projectId} = usePlatform();
  const frozenEvidence = autoGtFailureEvidence(sample.input);
  const drafts=useQuery(platformPageQuery<{id:string;sampleId:string;output:string;label:string;geometry:Record<string,unknown>;source:string}>(projectId,`/tasks/${taskId}/preannotations?sampleId=${sample.id}&limit=50`));
  const [displayed,setDisplayed] = useState({revision:sample.revision,annotationId:sample.annotationId});
  const history = useQuery({queryKey:["data-platform-history",projectId,sample.id,sample.revision],queryFn:()=>platformRequest<unknown>(projectId,`/samples/${sample.id}/history`)});
  const [geometry,setGeometry] = useState(JSON.stringify(sample.geometry ?? {},null,2));
  const [output, setOutput] = useState(sample.output);
  const [label, setLabel] = useState(sample.label);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const save = async (next: Sample["state"]) => {
    if(pending) return;
    if (next !== "需修订" && (!output.trim() || !label.trim())) { setError(true); setMessage("请填写标注内容和标签。"); return; }
    setPending(true);
    try {const structured=JSON.parse(geometry);if(!structured || typeof structured !== "object" || Array.isArray(structured)) throw new Error("结构化标注需为 JSON 对象。");const saved=await onSave(output.trim(),label.trim(),next,structured,displayed);setDisplayed({revision:saved.revision,annotationId:saved.annotationId});setError(false);setMessage(next === "待审核" ? "已提交审核。" : next === "已通过" ? "审核已通过。" : "已退回修订。");}
    catch(failure) {setError(true);setMessage(failure instanceof Error ? failure.message : storageError);}
    finally {setPending(false);}

  };
  return <section className="platform-panel platform-annotation-editor"><div className="platform-section-heading"><h2>{sample.name}</h2><Status value={sample.state} /></div>{frozenEvidence ? <AutoGtFailureEvidence evidence={frozenEvidence} assets={sample.assets} /> : <section className="platform-sample-input"><h3>输入与上下文</h3><p>{sample.input}</p></section>}{spec && <details className="platform-guidance"><summary>标注规范 · {spec.name} {spec.version}</summary><p>{spec.instructions}</p><p>参考标签：{spec.labels.join("、")}</p></details>}{displayed.revision !== sample.revision && <Message error>当前样本已出现新修订。请核对后重新加载最新标注，再提交。</Message>}<Button variant="ghost" onClick={() => {setOutput(sample.output);setLabel(sample.label);setGeometry(JSON.stringify(sample.geometry ?? {},null,2));setDisplayed({revision:sample.revision,annotationId:sample.annotationId});}}>重新加载最新标注</Button><Field label="标注内容"><textarea aria-label="标注内容" rows={6} value={output} readOnly={review} onChange={(event) => setOutput(event.target.value)} placeholder="修订目标描述、参考回答或偏好判定" /></Field><Field label="标签"><Input aria-label="标签" value={label} readOnly={review} onChange={(event) => setLabel(event.target.value)} placeholder="多个标签以逗号分隔" /></Field>{!review && sample.state === "已通过" && <p role="status" className="platform-help">此样本已经独立审核通过；再次提交会生成新的标注修订，撤销当前通过状态，并使依赖旧审批的配方修订凭据失效。请确认要重新标注后再提交。</p>}{!review&&drafts.data?.items.map(draft=><Button key={draft.id} variant="outline" onClick={()=>{setOutput(draft.output);setLabel(draft.label);setGeometry(JSON.stringify(draft.geometry,null,2));}}>应用预标注草稿 · {draft.source}</Button>)}<GeometryEditor sample={sample} spec={spec} value={geometry} onChange={setGeometry} readOnly={review}/><Field label="结构化标注（片段、框、轨迹、掩码 JSON）"><textarea aria-label="结构化标注（片段、框、轨迹、掩码 JSON）" rows={4} value={geometry} readOnly={review} onChange={event => setGeometry(event.target.value)} /></Field><details><summary>标注与审核修订记录</summary>{history.isLoading ? "加载中…" : history.error ? <Message error>{history.error.message}</Message> : <pre tabIndex={0} role="region" aria-label="标注与审核修订记录">{JSON.stringify(history.data,null,2)}</pre>}</details><div className="platform-actions">{review ? <><Button disabled={pending || sample.state !== "待审核"} onClick={() => save("已通过")}>审核通过</Button><Button variant="outline" disabled={pending || sample.state !== "待审核"} onClick={() => save("需修订")}>退回修订</Button></> : <Button disabled={pending} onClick={() => save("待审核")}>提交审核</Button>}</div>{review && sample.state !== "待审核" && <p className="platform-help">仅待审核样本可执行审核；需修订的样本应先提交标注。</p>}<Message error={error}>{message}</Message></section>;
}

export function AnnotationTaskDetailPage() {
  const { state, write, id, path, userId, can, userName } = usePlatform();
  const view = useView("概览");
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignedAnnotator,setAssignedAnnotator]=useState("");
  const [assignedReviewer,setAssignedReviewer]=useState("");
  const [message, setMessage] = useState("");
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return <NotFound title="标注任务" href={path("annotation/tasks")} />;
  const dataset = state.datasets.find((item) => item.id === task.datasetId);
  const samples = taskSamples(state, task);
  const spec = state.specs.find((item) => item.id === task.specId);
  const tab = ["概览", "样本", "规范与分配"].includes(view.tab) ? view.tab : "概览";
  const mode = view.get("workspace");
  const workspace = mode === "annotate" || mode === "review";
  const currentSample = samples.find((item) => item.id === view.get("sample")) ?? (!view.get("sample") ? samples[0] : undefined);
  const enter = (mode: string, sampleId = samples[0]?.id ?? "") => {
    if (mode === "review" ? !can("data_platform:review") || task.reviewer !== userId : !can("data_platform:annotate") || task.assignee !== userId) {setMessage("当前用户未被分配此操作。");return;}
    view.set({workspace:mode,sample:sampleId});
  };
  return <Page><Breadcrumb parent="标注任务" href={path("annotation/tasks")} name={task.name} /><Heading title={workspace ? `${mode === "review" ? "审核" : "标注"}工作区` : task.name} description={`${workspace ? task.name + " · " : ""}${task.sampleCount??samples.length} 个样本 · ${taskSummaryStatus(task)}`} action={workspace ? <Button variant="outline" onClick={() => view.set({ workspace: "", sample: "" })}>返回任务详情</Button> : <div className="platform-heading-actions"><Button variant="outline" disabled={!can("data_platform:review") || task.reviewer !== userId} onClick={() => enter("review")}>进入审核</Button><Button disabled={!can("data_platform:annotate") || task.assignee !== userId} onClick={() => enter("annotate")}>进入标注</Button></div>} /><PlatformNotice /><Message>{message}</Message>
    {workspace && (mode === "review" ? !can("data_platform:review") || task.reviewer !== userId : !can("data_platform:annotate") || task.assignee !== userId) ? <Message error>当前用户未被分配此操作。</Message> : workspace ? <div className="platform-workspace"><aside aria-label="样本队列" className="platform-sample-queue"><h2>样本队列</h2>{mode==="annotate"&&<AnnotationBatch task={task}/>}{samples.map((item) => <button type="button" key={item.id} aria-current={item.id === currentSample?.id ? "true" : undefined} onClick={() => enter(mode, item.id)}><strong>{item.name}</strong><span>{item.state}</span></button>)}<Pagination page={state.page}/><Button variant="ghost" onClick={() => enter(mode === "review" ? "annotate" : "review", currentSample?.id)}>切换至{mode === "review" ? "标注" : "审核"}</Button></aside>{currentSample ? <SampleEditor key={`${currentSample.id}:${mode}:${mode === "review" ? currentSample.annotationId ?? "empty" : "draft"}`} taskId={task.id} sample={currentSample} spec={spec} review={mode === "review"} onSave={async (output,label,nextState,geometry,displayed) => { const endpoint=nextState === "待审核" ? "annotation" : "review"; return await write<Sample>(`/tasks/${task.id}/samples/${currentSample.id}/${endpoint}`, nextState === "待审核" ? {expectedRevision:displayed.revision,output,label,geometry} : {expectedRevision:displayed.revision,annotationId:displayed.annotationId,decision:nextState === "已通过" ? "approve" : "reject",note:nextState === "需修订" ? "请按规范修订标注。" : "审核通过"}); }} /> : <section className="platform-panel"><h2>未找到样本</h2><p>请从队列中选择有效样本。</p></section>}</div> : <><Tabs tabs={["概览", "样本", "规范与分配"]} active={tab} onChange={view.setTab} label="标注任务详情" >
      {tab === "概览" && <section className="platform-panel"><h2>任务信息</h2><Details rows={[["任务状态", <Status value={taskSummaryStatus(task)} />], ["输入数据集", <Link to={path(`datasets/${task.datasetId}`)}>{dataset?.name} · 工作副本</Link>], ["审核进度", `${task.stateCounts?.["已通过"]??0} / ${task.sampleCount??samples.length} 个样本已通过`], ["待处理样本", `${(task.stateCounts?.["待标注"]??0)+(task.stateCounts?.["需修订"]??0)} 个待标注或修订；${task.stateCounts?.["待审核"]??0} 个待审核`], ["来源反馈", task.feedbackId ? <Link to={path(`feedback/${task.feedbackId}`)}>查看问题反馈</Link> : "人工创建任务"]]} /></section>}
      {tab === "样本" && <><Table headers={["样本", "当前标签", "状态", "操作"]} empty={!samples.length} emptyState={<ResourceEmptyState resource="任务样本" description="当前任务没有可展示的样本。请检查任务分配的数据集与样本范围。" />}>{samples.map((item) => <tr key={item.id}><td><button className="platform-text-button" onClick={() => enter("annotate", item.id)}>{item.name}</button><small title={item.id}>样本 ID · {item.id.slice(0,8)}</small></td><td>{item.label || "未标注"}</td><td><Status value={item.state} /></td><td><Button variant="ghost" onClick={() => enter(item.state === "待审核" ? "review" : "annotate", item.id)}>{item.state === "待审核" ? "审核" : "标注"}</Button></td></tr>)}</Table><Pagination page={state.page}/></>}
      {tab === "规范与分配" && <section className="platform-panel"><div className="platform-section-heading"><h2>规范与负责人</h2><Button variant="outline" disabled={!can("data_platform:write")} onClick={() => setAssignmentOpen(true)}>调整分配</Button></div><Details rows={[["标注规范", <Link to={path(`annotation/specs/${task.specId}`)}>{spec?.name} · {task.specVersion}</Link>], ["标注说明", spec?.instructions ?? "暂无说明"], ["标注负责人", userName(task.assignee)], ["审核负责人", userName(task.reviewer)]]} /></section>}</Tabs></>}
    <FormDialog open={assignmentOpen} onOpenChange={setAssignmentOpen} title="调整任务分配" description="更新当前任务的标注与审核负责人。" submitLabel="保存分配" onSubmit={async (event) => { const values = new FormData(event.currentTarget); const assignee = String(values.get("assignee") ?? "").trim(); const reviewer = String(values.get("reviewer") ?? "").trim(); if (!assignee || !reviewer) return "请填写标注与审核负责人。"; await write(`/tasks/${id}/assignment`, {expectedRevision:task.revision,assignee,reviewer}, "PUT"); setAssignmentOpen(false); setMessage("任务分配已保存在当前项目。"); }}><Field label="标注负责人"><input type="hidden" name="assignee" value={assignedAnnotator||task.assignee}/><EntitySelect resource="users" filter="canAnnotate=true" label="标注负责人" value={assignedAnnotator||task.assignee} onChange={setAssignedAnnotator} selected={state.users.find(item=>item.id===(assignedAnnotator||task.assignee))}/></Field><Field label="审核负责人"><input type="hidden" name="reviewer" value={assignedReviewer||task.reviewer}/><EntitySelect resource="users" filter="canReview=true" label="审核负责人" value={assignedReviewer||task.reviewer} onChange={setAssignedReviewer} selected={state.users.find(item=>item.id===(assignedReviewer||task.reviewer))}/></Field></FormDialog>
  </Page>;
}

export function AnnotationSpecsPage() {
  const { state, write, path, userId, can, userName } = usePlatform();
  const navigate = useNavigate();
  const view=useView("");const query=view.get("q");const setQuery=(q:string)=>view.set({q});
  const [open, setOpen] = useState(false);
  const rows = state.specs;
  return <Page><Heading title="标注规范" description="维护任务可复用的标签定义、标注说明和规范版本。" action={<Button disabled={!can("data_platform:write")} onClick={() => setOpen(true)}><Plus />新建规范</Button>} /><PlatformNotice /><FilterBar query={query} onQuery={setQuery} placeholder="搜索规范名称或类型" count={state.page?.total??rows.length} /><Table headers={["规范名称", "任务类型", "标签数", "版本", "关联任务"]} empty={!rows.length} emptyState={<ResourceEmptyState resource="标注规范" filtered={Boolean(query || view.get("cursor"))} onReset={() => view.set({q:"",cursor:"",pagingHistory:""})} description="定义标签和判定标准，为标注与审核任务建立一致的规范。" action={<Button disabled={!can("data_platform:write")} onClick={() => setOpen(true)}>新建规范</Button>} />}>{rows.map((item) => <tr key={item.id}><td><Link to={path(`annotation/specs/${item.id}`)}>{item.name}</Link></td><td>{item.type}</td><td>{item.labels.length}</td><td>{item.version}</td><td>{item.taskCount??0}</td></tr>)}</Table><Pagination page={state.page}/><FormDialog open={open} onOpenChange={setOpen} title="新建标注规范" description="创建可供任务引用的规范版本。规范内容创建后固定。" onSubmit={async (event) => { const values = new FormData(event.currentTarget); const name = String(values.get("name") ?? "").trim(); const instructions = String(values.get("instructions") ?? "").trim(); const labels = [...new Set(String(values.get("labels") ?? "").split(/[,，\n]/).map((label) => label.trim()).filter(Boolean))]; if (!name || !instructions || !labels.length) return "请填写规范名称、标注说明，并至少定义一个标签。"; const created = await write("/specs", {name,type:String(values.get("type")),labels,instructions}); const id=created.id; setOpen(false); void navigate({ to: path(`annotation/specs/${id}`) }); }}><Field label="规范名称"><Input name="name" required maxLength={100} /></Field><Field label="任务类型"><select name="type"><option>文本 SFT</option><option>回答偏好</option><option>视频描述</option></select></Field><Field label="标签定义"><textarea name="labels" rows={3} required maxLength={1000} placeholder="每行一个标签，或用逗号分隔" /></Field><Field label="标注说明"><textarea name="instructions" rows={4} required maxLength={4000} placeholder="说明判定标准、特殊情况及处理方式" /></Field></FormDialog></Page>;
}

export function AnnotationSpecDetailPage() {
  const { state, id, path, userName } = usePlatform();
  const view = useView("标签定义");
  const spec = state.specs.find((item) => item.id === id);
  if (!spec) return <NotFound title="标注规范" href={path("annotation/specs")} />;
  const tab = ["标签定义", "标注说明", "规范版本"].includes(view.tab) ? view.tab : "标签定义";
  const tasks = state.tasks.filter((item) => item.specId === id);
  return <Page><Breadcrumb parent="标注规范" href={path("annotation/specs")} name={spec.name} /><Heading title={spec.name} description={`${spec.type} · ${spec.version} · ${spec.taskCount??tasks.length} 个关联任务`} /><PlatformNotice /><Tabs tabs={["标签定义", "标注说明", "规范版本"]} active={tab} onChange={view.setTab} label="标注规范详情" >{tab === "标签定义" && <Table headers={["标签", "字段类型"]}>{spec.labels.map((label) => <tr key={label}><td>{label}</td><td>分类标签</td></tr>)}</Table>}{tab === "标注说明" && <section className="platform-panel"><h2>标注要求</h2><p className="platform-prose">{spec.instructions}</p></section>}{tab === "规范版本" && <section className="platform-panel"><h2>{spec.version} · 固定版本</h2><p className="platform-help">任务引用固定的规范版本，保障审核口径一致。</p><Table headers={["关联任务", "规范版本", "负责人"]} empty={!tasks.length} emptyState={<ResourceEmptyState resource="关联任务" description="创建标注任务时选择此规范，任务会显示在这里。" action={<Button variant="outline" render={<Link to={path("annotation/tasks")} />}>查看标注任务</Button>} />}>{tasks.map((item) => <tr key={item.id}><td><Link to={path(`annotation/tasks/${item.id}`)}>{item.name}</Link></td><td>{item.specVersion}</td><td>{userName(item.assignee)}</td></tr>)}</Table></section>}</Tabs></Page>;
}
