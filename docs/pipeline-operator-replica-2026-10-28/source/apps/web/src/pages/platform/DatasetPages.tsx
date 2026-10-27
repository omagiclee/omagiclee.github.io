import { Link, useNavigate } from "@tanstack/react-router";
import { Download, FileCheck2, Plus } from "lucide-react";
import { useState } from "react";
import { AutoGtPublishedExport } from "../../components/AutoGtPublishedExport";
import { DatasetSplitPlanner } from "../../components/DatasetSplitPlanner";
import { DatasetQualityPanel, type DatasetQualityReport } from "../../components/DatasetQualityPanel";
import { TrainingRecords } from "./TrainingRecords";
import { platformUrl } from "../../data-platform-api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { usePlatform } from "./platform-store";
import { Pagination, Breadcrumb, PlatformNotice, Details, Field, FilterBar, FormDialog, Heading, Message, NotFound, Page, SamplePreview, Select, Status, Table, Tabs, ResourceEmptyState, storageError, useView } from "./shared";

import { autoGtDatasetProvenance, autoGtFailureProvenance } from "./auto-gt-display";
import { datasetSourceLabel, reflowExploreUrl, reflowProvenance, reflowQueryLabel } from "./media-reflow-display";

const qualityPolicyNames: Record<string, string> = {"raw-pretrain-v1":"原始预训练", "sft-v1":"SFT 标注与审核", "structured-v1":"结构化标注", "evaluation-v1":"评测数据", "auto-gt-paired-v1":"AutoGT 配对 · 独立标注与审核"};

export function DatasetsPage() {
  const { state, write, path, can } = usePlatform();
  const navigate = useNavigate();
  const view = useView("数据");
  const query=view.get("q");const setQuery=(q:string)=>view.set({q});
  const modality=view.get("modality","全部模态");const setModality=(value:string)=>view.set({modality:value==="全部模态"?"":value});
  const [open, setOpen] = useState(false);
  const visible = state.datasets;
  return <Page><Heading title="数据集" description="管理训练与评测数据的样本、发布版本和使用关联。" action={<Button disabled={!can("data_platform:write")} onClick={() => setOpen(true)}><Plus />导入数据</Button>} /><PlatformNotice />
    <FilterBar query={query} onQuery={setQuery} placeholder="搜索数据集名称" count={state.page?.total ?? visible.length}><Select toolbar label="按模态筛选" value={modality} onChange={setModality} options={["全部模态", "视频", "图像", "音频", "点云", "文本"].map((value) => ({ value, label: value }))} /></FilterBar>
    <Table headers={["数据集", "用途", "样本数", "发布版本", "工作副本"]} empty={!visible.length} emptyState={<ResourceEmptyState resource="数据集" filtered={Boolean(query || modality !== "全部模态" || view.get("cursor"))} onReset={() => view.set({q:"",modality:"",cursor:"",pagingHistory:""})} description="导入样本并建立数据集，再发布固定版本用于标注、训练和评测。" action={<Button disabled={!can("data_platform:write")} onClick={() => setOpen(true)}>导入数据</Button>} />}>{visible.map((item) => <tr key={item.id}><td><Link to={path(`datasets/${item.id}`)}>{item.name}</Link><small>{[item.modality,datasetSourceLabel(item.source)].filter(Boolean).join(" · ")}</small></td><td>{item.purpose}</td><td>{item.sampleCount ?? item.samples.length}</td><td>{item.latestVersion?.version ?? item.versions.at(-1)?.version ?? "尚未发布"}</td><td><Status value={item.pendingCount === 0 && !!item.sampleCount ? "已通过" : "待审核"} /></td></tr>)}</Table><Pagination page={state.page} />
    <FormDialog open={open} onOpenChange={setOpen} title="导入数据" description="文本每行一条；多模态选择 JSONL，填写真实 videoId / shotId 或项目对象 URI，系统验证内容摘要。" submitLabel="创建数据集" onSubmit={async (event) => {
      const values = new FormData(event.currentTarget);
      const name = String(values.get("name") ?? "").trim();
      const lines = String(values.get("samples") ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
      if (!name || !lines.length) return "请填写数据集名称，并至少输入一个样本。";
      if (lines.length > 1000) return "单次表单导入最多支持 1,000 个样本；更大批次请使用批量接入接口。";
      let samples:unknown[];
      if(values.get("format")==="jsonl") {try {samples=lines.map(line=>JSON.parse(line));}catch{return "JSONL 每行必须是有效样本对象。";}}
      else samples=lines.map((input,index) => ({name:`样本 ${index+1}`,input,output:"",label:"",split:String(values.get("split") || "未划分")}));
      const created = await write("/datasets", {name, qualityProfile:String(values.get("qualityProfile")), modality:String(values.get("modality")), purpose:String(values.get("purpose")), source:String(values.get("source") ?? "").trim() || "手工导入", samples});
      const id = created.id;
      setOpen(false); void navigate({ to: path(`datasets/${id}`) });
    }}><Field label="数据集名称"><Input name="name" required maxLength={100} placeholder="例如：客服多轮对话数据集" /></Field><div className="platform-form-columns"><Field label="数据模态"><select name="modality"><option>文本</option><option>视频</option><option>图像</option><option>音频</option><option>点云</option></select></Field><Field label="数据用途"><select name="purpose"><option>训练</option><option>监督微调（SFT）</option><option>偏好训练</option><option>评测</option><option>诊断</option></select></Field></div><Field label="质量策略"><select name="qualityProfile"><option value="sft-v1">SFT · 完整标注与独立审核</option><option value="raw-pretrain-v1">原始预训练 · 媒体完整性，无标签要求</option><option value="structured-v1">结构化标注 · 几何与时序校验</option><option value="evaluation-v1">评测 · 固定参考与留出隔离</option></select></Field><Field label="导入格式"><select name="format"><option value="text">逐行文本</option><option value="jsonl">多模态 JSONL</option></select></Field><p className="platform-help">JSONL 示例：{"{\"name\":\"视频片段\",\"input\":\"场景\",\"split\":\"train\",\"assets\":[{\"kind\":\"video\",\"shotId\":\"真实片段ID\"}]}"}</p><Field label="样本划分"><select name="split"><option value="未划分">待划分</option><option value="train">训练</option><option value="validation">验证</option><option value="test">测试</option></select></Field><Field label="来源说明"><Input name="source" maxLength={200} placeholder="填写采集批次或来源名称" /></Field><Field label="样本内容"><textarea name="samples" rows={6} maxLength={3000000} required placeholder="每行文本或一个样本 JSON 对象；资产需要真实引用" /></Field></FormDialog>
  </Page>;
}

export function DatasetDetailPage() {
  const { state, write, id, path, projectId, can } = usePlatform();
  const view = useView("数据");
  const query=view.get("q");const setQuery=(q:string)=>view.set({q});
  const [publishOpen, setPublishOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState(false);
  const dataset = state.datasets.find((item) => item.id === id);
  if (!dataset) return <NotFound title="数据集" href={path("datasets")} />;
  const reflow = reflowProvenance(dataset.source);
  const autoGt = autoGtDatasetProvenance(dataset.source);
  const autoGtFailure = autoGtFailureProvenance(dataset.source);
  const tab = ["数据", "版本", "质量", "血缘与使用"].includes(view.tab) ? view.tab : "数据";
  const selectedVersion = view.get("version", "working");
  const version = dataset.versions.find((item) => item.id === selectedVersion);
  if (selectedVersion !== "working" && !version) return <NotFound title="数据版本" href={path(`datasets/${id}`)} />;
  const sourceSamples = version?.samples ?? dataset.samples;
  const selectionId = view.get("selection");
  const selection = state.selections.find((item) => item.id === selectionId && item.datasetId === id);
  if (selectionId && !selection) return <NotFound title="固定选集" href={path(`datasets/${id}`)} />;
  const samples = selection ? sourceSamples.filter((item) => selection.sampleIds.includes(item.id)) : sourceSamples;
  const visible = samples;
  const selectedSample = state.selectedSample ?? samples.find((item) => item.id === view.get("sample"));
  const pending = version ? 0 : dataset.pendingCount ?? 0;
  const report = version?.qualityReport as Partial<DatasetQualityReport> | undefined;
  const qualityPolicy = version?.qualityProfile ?? (autoGt ? "auto-gt-paired-v1" : autoGtFailure ? "evaluation-v1" : dataset.qualityProfile ?? "sft-v1");
  
  
  const relatedTasks = state.tasks.filter((item) => item.datasetId === id);
  const benchmarks = state.benchmarks.filter((item) => item.datasetId === id);
  const experiments = state.experiments.filter((item) => benchmarks.some((benchmark) => benchmark.id === item.benchmarkId));
  function download(_samples: unknown, versionId: string) {
    window.location.assign(platformUrl(projectId, `/datasets/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/export`));
  }
  return <Page><Breadcrumb parent="数据集" href={path("datasets")} name={dataset.name} /><Heading title={dataset.name} description={`${dataset.modality} · ${dataset.purpose} · ${version?.sampleCount ?? dataset.sampleCount ?? sourceSamples.length} 个样本`} action={version ? <Button variant="outline" onClick={() => download(version.samples, version.id)}><Download />导出版本</Button> : <Button disabled={!can("data_platform:write")} onClick={() => setPublishOpen(true)}><FileCheck2 />发布版本</Button>} /><PlatformNotice /><Message error={actionError}>{message}</Message>
    <div className="platform-object-context"><Select toolbar prefix="版本" label="选择数据版本" value={selectedVersion} onChange={(value) => view.set({ version: value, sample: "", selection: "" })} options={[{ value: "working", label: "工作副本" }, ...dataset.versions.map((item) => ({ value: item.id, label: `${item.version} · 已发布` }))]} /><span>{version ? "已发布版本固定样本与标注内容。" : "审核修订写入工作副本，发布后形成固定版本。"}</span></div>
    {version && (autoGt || autoGtFailure) && <AutoGtPublishedExport key={version.id} projectId={projectId} datasetId={id} versionId={version.id} datasetName={dataset.name} versionName={version.version} />}
    <Tabs tabs={["数据", "版本", "质量", "血缘与使用"]} active={tab} onChange={view.setTab} label="数据集详情" >
    {tab === "数据" && <><FilterBar query={query} onQuery={setQuery} placeholder="搜索样本名称、内容或标签" count={state.page?.total ?? visible.length} />{selection && <section className="platform-inline-summary"><div><strong>固定选集：{selection.name}</strong><p>{selection.sampleCount ?? selection.sampleIds.length} 个固定样本 · <Link to={path(`feedback/${selection.feedbackId}`)}>查看来源反馈</Link></p></div><Button variant="ghost" onClick={() => view.set({ selection: "", sample: "" })}>查看全部样本</Button></section>}<Table headers={["样本", "标签", "标注状态", "数据划分"]} empty={!visible.length} emptyState={<ResourceEmptyState resource="样本" filtered={Boolean(query)} onReset={() => view.set({q:"",cursor:"",pagingHistory:""})} description="当前数据范围内没有样本。可切换数据版本或返回数据集列表导入数据。" />}>{visible.map((row) => <tr key={row.id}><td><button type="button" className="platform-text-button" onClick={() => view.set({ sample: row.id })}>{row.name}</button><small title={row.id}>样本 ID · {row.id.slice(0,8)}</small></td><td>{row.label || "未标注"}</td><td><Status value={row.state} /></td><td>{row.split}</td></tr>)}</Table><Pagination page={state.page} />{view.get("sample") && !selectedSample && <Message error>当前版本中未找到该样本。</Message>}{selectedSample && <section className="platform-panel"><div className="platform-section-heading"><h2>{selectedSample.name}</h2><Button variant="ghost" onClick={() => view.set({ sample: "" })}>收起详情</Button></div><SamplePreview input={selectedSample.input} output={selectedSample.output} label="标注内容" assets={selectedSample.assets} /></section>}</>}
    {tab === "版本" && <><Table headers={["版本", "样本数", "发布说明", "发布日期", "操作"]} empty={!dataset.versions.length} emptyState={<ResourceEmptyState resource="发布版本" description="完成工作副本的质量检查后，发布固定版本供训练和评测使用。" action={<Button disabled={!can("data_platform:write")} onClick={() => setPublishOpen(true)}>发布版本</Button>} />}>{[...dataset.versions].reverse().map((item) => <tr key={item.id}><td><button className="platform-text-button" onClick={() => view.set({ tab: "数据", version: item.id, sample: "", selection: "" })}>{item.version}</button><small>已发布</small></td><td>{item.sampleCount ?? item.samples.length}</td><td>{item.description}</td><td>{item.created}</td><td><Button variant="ghost" onClick={() => download(item.samples, item.id)}>导出 JSONL</Button></td></tr>)}</Table><Pagination page={state.versionPage} /></>}
    {tab === "质量" && <section className="platform-panel"><h2>发布质量检查</h2><p className="platform-help">质量策略：{qualityPolicyNames[qualityPolicy] ?? qualityPolicy}</p>{version ? <><Details rows={[["检查结论", <Status value={report?.passed === true ? "已通过" : report?.passed === false ? "需修订" : "未记录"} />], ["检查样本", typeof report?.sampleCount === "number" ? `${report.sampleCount} 个` : "详见冻结报告"], ["问题数量", typeof report?.issueCount === "number" ? report.issueCount : "详见冻结报告"]]} />{Array.isArray(report?.issues) && report.issues.length > 0 && <ul className="platform-quality-issues">{report.issues.map((issue, index) => <li key={index}>{issue.message ?? issue.rule}</li>)}</ul>}<details className="platform-guidance"><summary>查看完整冻结报告</summary><pre className="platform-json" tabIndex={0} role="region" aria-label="完整冻结质量报告">{JSON.stringify(version.qualityReport,null,2)}</pre></details></> : <><DatasetQualityPanel projectId={projectId} datasetId={id} revision={dataset.revision} /><details className="platform-guidance"><summary>查看发布检查规则 · {pending} 个样本待审核</summary><p>原始预训练策略允许无标签；其他策略按标注与独立审核要求检查。</p><p>发布时验证媒体内容、解码与时段、采样帧清晰度、内容重复及训练与留出集合泄漏。</p><p>检测范围和阈值随版本报告固定保存；发布时会重新检查整个数据集。</p></details></>}</section>}

    {tab === "血缘与使用" && <><section className="platform-panel"><h2>来源与加工</h2>{dataset.pipelineSource && <Details rows={[["流水线运行", <Link to="/projects/$projectId/pipelines" params={{ projectId }} search={{ runId: dataset.pipelineSource.run_id }}>{dataset.pipelineSource.run_id}</Link>], ["来源产物", dataset.pipelineSource.artifact_id], ["内容指纹", dataset.pipelineSource.content_hash], ["映射版本", dataset.pipelineSource.mapping_version], ["映射指纹", dataset.pipelineSource.mapping_digest ?? "—"]]} />}<DatasetSplitPlanner datasetId={id} revision={dataset.revision} purpose={dataset.purpose} source={dataset.source} canWrite={can("data_platform:write")} write={write} /><Details rows={[["数据来源", datasetSourceLabel(dataset.source) || "未填写"], ...(autoGtFailure ? [["失败问题", autoGtFailure.issue], ["冻结诊断证据", `${autoGtFailure.pairCount} 对 · ${autoGtFailure.roiCount} 个 ROI · ${autoGtFailure.referenceKinds.join("、")}`], ["原 AutoGT 任务", <div className="platform-link-list">{autoGtFailure.jobIds.map((jobId, i) => <a key={jobId} href={`/projects/${encodeURIComponent(projectId)}/auto-gt?job_id=${encodeURIComponent(jobId)}`}>打开失败来源任务 {i + 1}</a>)}</div>]] as [string, React.ReactNode][] : []), ...(autoGt ? [["AutoGT 任务", autoGt.jobId ? <a href={`/projects/${encodeURIComponent(projectId)}/auto-gt?job_id=${encodeURIComponent(autoGt.jobId)}`}>打开原配对生成与审核任务</a> : "未记录任务"], ["配方版本", `${autoGt.recipe} · ${autoGt.version}`], ["参考类别", autoGt.referenceKinds.join("、") || "未记录类别"], ["候选配对", `${autoGt.pairCount} 对；人工接受不改变参考来源级别`]] as [string, React.ReactNode][] : []), ...(reflow ? [["问题说明", reflow.issue || "待人工确认"], ["原查询", reflowQueryLabel(reflow.query)], ["固定候选池", reflow.candidate_snapshot_id || "来自固定检索会话"], ["检索来源", <div className="platform-link-list">{reflow.evaluation_id && <a href={reflowExploreUrl(projectId, "evaluation_id", reflow.evaluation_id)}>打开原检索评测</a>}{reflow.search_id && <a href={reflowExploreUrl(projectId, "search_id", reflow.search_id)}>打开原检索会话</a>}{reflow.schemes?.map((scheme, index) => <a key={scheme.search_id} href={reflowExploreUrl(projectId, "search_id", scheme.search_id)}>打开{scheme.label || `方案 ${index + 1}`}会话</a>)}</div>], ...(reflow.review_source === "test_fixture" ? [["标注来源", "验收标注 / 非人工质量结论"]] : [])] as [string, React.ReactNode][] : []), ["标注任务", relatedTasks.length ? <div className="platform-link-list">{relatedTasks.map((item) => <Link key={item.id} to={path(`annotation/tasks/${item.id}`)}>{item.name}</Link>)}</div> : "暂无关联任务"], ["固定选集", state.selections.filter((item) => item.datasetId === id).length ? <div className="platform-link-list">{state.selections.filter((item) => item.datasetId === id).map((item) => <button key={item.id} className="platform-text-button" onClick={() => view.set({ tab: "数据", selection: item.id, version: item.datasetVersion ?? "working", sample: "" })}>{item.name}</button>)}</div> : "暂无固定选集"]]} /></section><section className="platform-panel"><h2>评测使用</h2><p className="platform-help">固定数据版本与模型、实验及外部训练记录关联。</p><Table headers={["实验", "模型版本", "固定数据版本"]} empty={!experiments.length} emptyState={<ResourceEmptyState resource="关联评测实验" description="为此数据集的固定版本创建评测基准，再创建实验验证模型效果。" action={<Button variant="outline" render={<Link to={path("benchmarks")} />}>查看评测基准</Button>} />}>{experiments.map((item) => <tr key={item.id}><td><Link to={path(`evaluations/${item.id}`)}>{item.name}</Link></td><td>{item.model}</td><td>{dataset.versions.find(version => version.id === benchmarks.find(benchmark => benchmark.id === item.benchmarkId)?.datasetVersion)?.version ?? "固定版本"}</td></tr>)}</Table></section><TrainingRecords dataset={dataset} /></>}
</Tabs>    <FormDialog open={publishOpen} onOpenChange={setPublishOpen} title="发布数据版本" description="发布当前工作副本的固定快照。按所选质量策略验证整个工作副本，冻结资产、样本、标注和质量报告。" submitLabel="确认发布" onSubmit={async (event) => {
      const current = state.datasets.find((item) => item.id === id)!;
      if (!(current.sampleCount ?? current.samples.length)) return "数据集暂无样本，无法发布。";
      const description = String(new FormData(event.currentTarget).get("description") ?? "").trim();
      if (!description) return "请填写发布说明。";
      const published = await write<{id:string;version:string}>(`/datasets/${encodeURIComponent(id)}/versions`, {expectedRevision:current.revision,description,qualityProfile:String(new FormData(event.currentTarget).get("qualityProfile"))});
      const versionId = published.id;
      setPublishOpen(false); setActionError(false); setMessage(`已发布 ${published.version}，可查看固定样本或导出文件。`); view.set({ tab: "版本", version: versionId });
    }}><Field label="冻结质量策略">{autoGt || autoGtFailure ? <><select aria-label="冻结质量策略" disabled value={autoGt ? "auto-gt-paired-v1" : "evaluation-v1"}><option value={autoGt ? "auto-gt-paired-v1" : "evaluation-v1"}>{autoGt ? "AutoGT 配对 · 独立人工标注与审核" : "失败诊断 · 评测留出，禁止训练文件导出"}</option></select><input type="hidden" name="qualityProfile" value={autoGt ? "auto-gt-paired-v1" : "evaluation-v1"} /></> : <select aria-label="冻结质量策略" name="qualityProfile" defaultValue={dataset.qualityProfile ?? "sft-v1"}><option value="raw-pretrain-v1">原始预训练</option><option value="sft-v1">SFT</option><option value="structured-v1">结构化标注</option><option value="evaluation-v1">评测</option></select>}</Field><Field label="发布说明"><textarea aria-label="发布说明" name="description" required rows={3} maxLength={500} placeholder="说明样本范围及本次修订内容" /></Field><p className="platform-help">当前检查：{dataset.pendingCount ?? 0} 个样本待审核；{autoGt ? "AutoGT 配对必须完成独立人工标注与审核，不能切换原始预训练策略绕过。" : "是否要求审核由冻结质量策略决定。"}</p></FormDialog>
  </Page>;
}
