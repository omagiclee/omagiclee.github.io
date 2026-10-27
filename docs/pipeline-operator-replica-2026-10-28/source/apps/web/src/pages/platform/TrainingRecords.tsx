import { ModelReleasePanel, TrainingLifecyclePanel } from "./ExecutionPanels";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { usePlatform, type Dataset } from "./platform-store";
import { Field, FormDialog, Table, ResourceEmptyState } from "./shared";

export function TrainingRecords({dataset}: {dataset:Dataset}) {
  const {state,write,can,path} = usePlatform();
  const [open,setOpen] = useState(false);
  const versions = dataset.versions.filter(version => (version.splitCounts?.train ?? 0) > 0 || version.samples.some(sample => sample.split === "train"));
  const records = state.trainingRuns.filter(run => dataset.versions.some(version => version.id === run.datasetVersionId));
  return <>{["视频", "video"].includes(dataset.modality) && <section className="platform-panel"><h2>视频训练平台</h2><p className="platform-help">使用固定视频版本创建帧预测训练，查看日志、指标、检查点与模型产物。</p><Link className="platform-action-link" to={path("training")} search={{datasetId:dataset.id}}>进入训练平台</Link></section>}<details className="platform-usage-disclosure"><summary><span>外部训练与模型记录</span><span>查看训练契约、固定版本和模型产物的使用关联</span></summary><div className="platform-usage-content"><TrainingLifecyclePanel datasetId={dataset.id} versions={versions} /><section className="platform-panel"><div className="platform-section-heading"><h2>训练与模型记录</h2><Button variant="outline" disabled={!can("data_platform:train") || !versions.length} onClick={() => setOpen(true)}>登记训练结果</Button></div><p className="platform-help">保存外部训练任务、代码、镜像和产出模型。训练只使用固定版本中的 train 样本。</p><Table headers={["任务","固定版本 / 样本数","产出模型","外部任务"]} empty={!records.length} emptyState={<ResourceEmptyState compact resource="外部训练结果" description={versions.length ? "登记固定训练版本、代码与模型产物，保留外部训练的使用记录。" : "先发布包含 train 样本的数据版本，再登记外部训练结果。"} />}>{records.map(run => <tr key={run.id}><td>{run.name}<small>{run.codeRevision}</small></td><td>{versions.find(version => version.id === run.datasetVersionId)?.version} · {(run as typeof run & {sampleCount?:number}).sampleCount ?? run.sampleIds.length}</td><td>{state.models.find(model => model.id === run.modelId)?.name ?? "未登记"}</td><td>{run.externalRef}</td></tr>)}</Table><FormDialog open={open} onOpenChange={setOpen} title="登记训练结果" description="登记已有外部训练结果，保存可追溯配置。" onSubmit={async event => {
    const values = new FormData(event.currentTarget);
    let config:Record<string,unknown>;
    try {config=JSON.parse(String(values.get("config")));if(!config || Array.isArray(config) || typeof config !== "object") throw new Error();} catch {return "训练配置需为有效 JSON 对象。";}
    await write("/training-runs",{name:String(values.get("name")),datasetVersionId:String(values.get("version")),externalRef:String(values.get("externalRef")),config,codeRevision:String(values.get("codeRevision")),image:String(values.get("image")),model:{name:String(values.get("modelName")),version:String(values.get("modelVersion")),artifactUri:String(values.get("artifactUri"))}});
    setOpen(false);
  }}><Field label="训练任务名称"><Input name="name" required /></Field><Field label="固定训练数据版本"><select name="version">{versions.map(version => <option key={version.id} value={version.id}>{version.version}</option>)}</select></Field><Field label="外部任务标识"><Input name="externalRef" required placeholder="训练系统的任务 ID 或链接" /></Field><Field label="代码修订"><Input name="codeRevision" required placeholder="完整 Git commit" /></Field><Field label="训练镜像"><Input name="image" required placeholder="镜像名称与不可变 digest" /></Field><Field label="训练配置 JSON"><textarea name="config" defaultValue="{}" required rows={4} /></Field><Field label="模型名称"><Input name="modelName" required /></Field><Field label="模型版本"><Input name="modelVersion" required /></Field><Field label="模型产物地址"><Input name="artifactUri" required placeholder="s3://bucket/model 或其他可追溯地址" /></Field></FormDialog></section></div></details><details className="platform-usage-disclosure"><summary><span>项目模型发布通道</span><span>管理当前项目的模型晋级与回滚</span></summary><div className="platform-usage-content"><ModelReleasePanel /></div></details></>;
}
