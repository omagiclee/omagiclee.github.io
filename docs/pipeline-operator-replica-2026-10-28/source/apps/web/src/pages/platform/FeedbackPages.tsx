import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { TaskCreateDialog } from "./AnnotationPages";
import { usePlatform, type Feedback } from "./platform-store";
import { Breadcrumb, EntitySelect, Pagination, PlatformNotice, Details, Field, FilterBar, FormDialog, Heading, Message, NotFound, Page, SamplePreview, Select, Status, Table, Tabs, ResourceEmptyState, storageError, useView } from "./shared";

export function FeedbackPage() {
  const { state, path } = usePlatform();
  const view = useView("全部状态");
  const query=view.get("q");const setQuery=(q:string)=>view.set({q,cursor:""});
  const status=view.get("status") || "全部状态";
  const rows = state.feedback;
  return <Page><Heading title="问题反馈" description="关联模型问题、来源样本与修订任务，跟踪数据回流和验证结论。" /><PlatformNotice /><FilterBar query={query} onQuery={setQuery} placeholder="搜索问题标题或说明" count={state.page?.total ?? rows.length}><Select toolbar label="反馈状态" value={status} onChange={value=>view.set({status:value==="全部状态"?"":value,cursor:""})} options={["全部状态", "待处理", "处理中", "已验证"].map((value) => ({ value, label: value }))} /></FilterBar><Table headers={["问题", "来源", "关联样本", "处置状态", "标注任务"]} empty={!rows.length} emptyState={<ResourceEmptyState resource="问题反馈" filtered={Boolean(query || status !== "全部状态" || view.get("cursor"))} onReset={() => view.set({q:"",status:"",cursor:"",pagingHistory:""})} description="在评测实验的样本明细中记录问题，关联修订任务并跟踪复测结论。" action={<Button variant="outline" render={<Link to={path("evaluations")} />}>查看评测实验</Button>} />}>{rows.map((item) => <tr key={item.id}><td><Link to={path(`feedback/${item.id}`)}>{item.title}</Link></td><td>{item.experimentId ? state.experiments.find((experiment) => experiment.id === item.experimentId)?.name : "人工问题复核"}</td><td><Link to={path(`datasets/${item.datasetId}`)} search={{sample:item.sampleId}} title={item.sampleId}>查看样本</Link></td><td><Status value={item.status} /></td><td>{item.taskId ? <Link to={path(`annotation/tasks/${item.taskId}`)}>查看任务</Link> : "未关联"}</td></tr>)}</Table><Pagination page={state.page}/></Page>;
}

export function FeedbackDetailPage() {
  const { state, write, id, path, can } = usePlatform();
  const view = useView("问题详情");
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [verificationExperimentId,setVerificationExperimentId] = useState("");
  const feedback = state.feedback.find((item) => item.id === id);
  if (!feedback) return <NotFound title="问题反馈" href={path("feedback")} />;
  const experiment = state.experiments.find((item) => item.id === feedback.experimentId);
  const benchmark = state.benchmarks.find((item) => item.id === experiment?.benchmarkId);
  const dataset = state.datasets.find((item) => item.id === feedback.datasetId);
  const version = dataset?.versions.find((item) => item.id === benchmark?.datasetVersion);
  const sample = (version?.samples ?? dataset?.samples ?? []).find((item) => item.id === feedback.sampleId);
  const result = experiment?.results.find((item) => item.sampleId === feedback.sampleId);
  const selection = state.selections.find((item) => item.id === feedback.selectionId);
  const task = state.tasks.find((item) => item.id === feedback.taskId);
  const tab = ["问题详情", "处置记录"].includes(view.tab) ? view.tab : "问题详情";
  return <Page><Breadcrumb parent="问题反馈" href={path("feedback")} name={feedback.title} /><Heading title={feedback.title} description={experiment ? "来自评测实验的样本问题，跟踪修订与验证结论。" : "人工复核发现的样本问题，跟踪修订与验证结论。"} action={<Button variant="outline" disabled={!can("data_platform:write") && !can("data_platform:evaluate")} onClick={() => setDispositionOpen(true)}>更新处置状态</Button>} /><PlatformNotice /><Message>{message}</Message><Tabs tabs={["问题详情", "处置记录"]} active={tab} onChange={view.setTab} label="问题反馈详情" >
    {tab === "问题详情" && <><section className="platform-panel"><h2>问题证据</h2><Details rows={[["处置状态", <Status value={feedback.status} />], ["来源实验", experiment ? <Link to={path(`evaluations/${experiment.id}`)}>{experiment.name}</Link> : "人工问题复核"], ["来源数据", dataset ? <Link to={path(`datasets/${dataset.id}`)} search={{ version: version?.id ?? "working", sample: feedback.sampleId }}>{dataset.name} · {version?.version ?? "工作副本"}</Link> : "来源数据不可用"], ["模型与基准", experiment && benchmark ? `${experiment.model} · ${benchmark.name} ${benchmark.version}` : "未关联评测实验"], ["问题说明", feedback.evidence]]} />{sample ? <SamplePreview assets={sample.assets} input={feedback.input ?? sample.input} output={feedback.output ?? result?.output ?? sample.output} label={experiment ? "模型输出" : "待复核内容"} /> : <Message error>来源样本不可用，请核对关联记录。</Message>}</section><section className="platform-panel"><h2>数据回流</h2><p className="platform-help">固定选集保留问题样本范围。评测样本保留留出范围，修订不会改变已发布评测基准。</p><div className="platform-actions">{selection ? <Link className="platform-action-link" to={path(`datasets/${selection.datasetId}`)} search={{ tab: "数据", selection: selection.id, version: selection.datasetVersion ?? "working" }}>查看固定选集</Link> : <Button variant="outline" disabled={!sample || !can("data_platform:write")} onClick={() => setSelectionOpen(true)}>加入固定选集</Button>}{task ? <Link className="platform-action-link" to={path(`annotation/tasks/${task.id}`)}>查看标注任务</Link> : <Button variant="outline" disabled={!sample || !can("data_platform:write")} onClick={() => setTaskOpen(true)}>创建标注任务</Button>}<Link className="platform-action-link" to="/requirements">前往需求管理</Link></div><Details rows={[["固定选集", selection?.name ?? "尚未创建"], ["标注任务", task?.name ?? "尚未关联"]]} /></section></>}
    {tab === "处置记录" && <section className="platform-panel"><h2>处理进展</h2>{feedback.records.length ? <ol className="platform-history">{feedback.records.map((record, index) => <li key={`${index}-${record}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{record}</p></li>)}</ol> : <ResourceEmptyState compact resource="处置记录" description="更新处置状态并填写处理说明，进展会保存在这里。" action={<Button variant="outline" disabled={!can("data_platform:write") && !can("data_platform:evaluate")} onClick={() => setDispositionOpen(true)}>更新处置状态</Button>} />}</section>}
</Tabs>    <FormDialog open={selectionOpen} onOpenChange={setSelectionOpen} title="创建固定选集" description="将当前问题样本加入一个可追溯的固定选集，保留来源反馈。" submitLabel="保存选集" onSubmit={async (event) => { const name = String(new FormData(event.currentTarget).get("name") ?? "").trim(); if (!name || !sample || !dataset) return "请填写选集名称，并确认来源样本有效。"; await write(`/feedback/${id}/selection`, {expectedRevision:feedback.revision,name,sampleIds:[feedback.sampleId]}); setSelectionOpen(false); setMessage("固定选集已保存在当前项目，可通过「查看固定选集」访问。"); }}><Field label="选集名称"><Input name="name" defaultValue={`${feedback.title} · 问题样本`} maxLength={120} required /></Field><p className="platform-help">包含 1 个样本：{sample?.name}。用途：问题诊断。</p></FormDialog>
    {dataset && <TaskCreateDialog key={id} open={taskOpen} onOpenChange={setTaskOpen} initialDatasetId={dataset.id} sampleIds={[feedback.sampleId]} feedbackId={id} onCreated={() => setMessage("标注任务已创建，可通过「查看标注任务」进入工作区。")} />}
    <FormDialog open={dispositionOpen} onOpenChange={setDispositionOpen} title="更新处置状态" description="记录处理进展；标记已验证时，请注明复测版本与验证结论。" submitLabel="保存记录" onSubmit={async (event) => { const values = new FormData(event.currentTarget); const next = String(values.get("status")) as Feedback["status"]; const note = String(values.get("note") ?? "").trim(); if (!note) return "请填写处理说明。"; if (!["处理中", "已验证"].includes(next)) return "请选择有效的处置状态。"; await write(`/feedback/${id}/transition`, {expectedRevision:feedback.revision,status:next,note,verificationExperimentId:verificationExperimentId || undefined}); setDispositionOpen(false); setMessage("处置状态及处理记录已保存。"); }}><Field label="处置状态"><select name="status" defaultValue={feedback.status === "待处理" ? "处理中" : feedback.status}><option>处理中</option><option>已验证</option></select></Field><EntitySelect resource="experiments" label="验证实验" required={false} emptyLabel="暂不关联验证实验" value={verificationExperimentId} onChange={setVerificationExperimentId} filter="status=已完成" selected={state.experiments.find(item=>item.id===verificationExperimentId)}/><Field label="处理说明"><textarea name="note" rows={4} required maxLength={1000} placeholder="填写处理动作、关联版本或复测结论" /></Field></FormDialog>
  </Page>;
}
