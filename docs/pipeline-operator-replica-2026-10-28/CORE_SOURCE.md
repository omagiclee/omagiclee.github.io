# 两个页面的核心完整源码

按原路径分段，内容原样复制。公共 UI、全局样式、字体、完整路由和后端请使用 zip 中的 source；本文件不是独立可运行应用。

## apps/web/src/pages/PipelinesPage.tsx

````tsx
import { ExecutionSelection, type ExecutionTarget } from "../components/ExecutionSelection";
import { interactionForEvent, type InteractionContext } from "../telemetry";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate, useRouterState, useSearch, useParams } from "@tanstack/react-router";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Tabs } from "@base-ui/react/tabs";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, CircleAlert, Database, Download, FileJson, FilePenLine, GitBranch, History, Layers3, LoaderCircle, MoreHorizontal, PanelLeft, Play, Plus, Puzzle, Redo2, Save, Search, ShieldCheck, SlidersHorizontal, Trash2, Undo2, Workflow, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { PermissionRequestButton } from "../components/PermissionRequestButton";
import { useAuth, useProjectAuth } from "../auth-context";
import { ApiError, apiUrl } from "../auth-api";
import { Button, buttonVariants } from "../components/ui/button";
import { ToolbarSelect } from "../components/ui/period-menu";
import { Badge } from "../components/ui/badge";
import { statusVariant } from "../lib/status-variant";
import { connectionError, layoutPipeline, PipelineCanvas } from "../components/PipelineCanvas";
import { operatorInputPorts } from "../pipeline-graph";
import { fieldSchema, resolveSchema } from "../pipeline-schema";
import { TaskProgress } from "../components/TaskProgress";
import { PipelineDeployments } from "../components/PipelineDeployments";
import { TaskRecordCounts, TASK_RECORD_COUNTS_HELP } from "../components/TaskRecordCounts";
import { cancelMediaRun, createDemoPipeline, loadMediaRun, reconcileMediaSubmission, retryMediaSubmission } from "../media-api";
import { artifactQuery, operatorsQueryFor, pipelineDirectoryQueryFor, pipelineQueryFor, pipelineRunHistoryQueryFor, pipelineRunsQueryFor, pipelineVersionQueryFor, pipelinesQueryFor, runPipeline, savePipeline, validatePipeline, type GraphValidation, type JsonSchema, type OperatorManifest, type Pipeline, type PipelineGraph, type PipelineNode, type PipelineRun } from "../pipelines-api";
import { ExecutionPlanSummary, PipelineDebugControls } from "../components/PipelineDebugControls";
import { ArtifactDatasetActions } from "../components/ArtifactDatasetActions";
import { TextPipelineTemplate } from "../components/TextPipelineTemplate";
import "./pipelines.css";

const kindLabels: Record<string, string> = { source: "数据接入", transform: "数据处理", sink: "数据输出", check: "质量检查" };
const typeLabels: Record<string, string> = { documents: "文档集", video_assets: "视频资产", shot_assets: "镜头集", frame_assets: "关键帧集", annotated_frames: "已标注关键帧", frame_embeddings: "关键帧向量", shot_index: "镜头索引", videos: "视频资产", shots: "镜头集", keyframes: "关键帧集", media_index: "媒体索引", embeddings: "向量集", index: "索引" };
export const statusLabels: Record<string, string> = { pending: "待执行", queued: "排队中", running: "运行中", succeeded: "已完成", cached: "复用缓存", failed: "失败", skipped: "已跳过", interrupted: "已中断", cancelled: "已取消", cancelling: "取消中" };
const fieldLabels: Record<string, string> = { min_length: "最少字符数", contains: "包含文本", urls: "YouTube 视频链接", max_height: "视频最大高度", threshold: "镜头切分阈值", frames_per_shot: "每个镜头关键帧数量", max_width: "关键帧最大宽度", score_threshold: "人物置信度阈值", backend: "分割模型", fps: "视频采样帧率", max_frames: "视频采样帧上限", records: "输入文档", lowercase: "转换为小写", strip_html: "清除 HTML 标签", collapse_whitespace: "合并连续空白", keywords: "匹配关键词", label: "标签名称", size: "每段字符数", overlap: "重叠字符数", dimensions: "向量维度", min_records: "最少记录数", prefix: "文本前缀", suffix: "文本后缀", field: "处理字段", name: "索引名称", case_sensitive: "区分大小写" };
const emptyDraft = () => ({ name: "", description: "", graph: { nodes: [] } as PipelineGraph });
type PipelineRouteSearch = {
  project_id?: string; pipelineId?: string; runId?: string; view?: "builder" | "runs" | "versions" | "new";
  template?: "video" | "text"; version?: number; q?: string; status?: string; page?: number;
  operator_id?: string; operator_version?: string;
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sameJson = (left: unknown, right: unknown) => {
  const normalized = (value: unknown) => JSON.stringify(value, (_, item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  return normalized(left) === normalized(right);
};
function withDefaultPositions(graph: PipelineGraph): PipelineGraph {
  const layout = layoutPipeline(graph);
  return { ...graph, nodes: graph.nodes.map((node, index) => node.position ? node : { ...node, position: layout.nodes[index].position }) };
}
function usePipelineSearch() {
  return useSearch({ strict: false }) as PipelineRouteSearch;
}
function usePipelineBasePath(projectId: string) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname.startsWith(`/projects/${projectId}/pipelines`)
    ? `/projects/${projectId}/pipelines`
    : "/pipelines";
}
// SQLite returns UTC timestamps without an offset; preserve that timezone when displaying them.
export const dateLabel = (value: string) => new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function RunStatus({ status }: { status: string }) {
  return <Badge variant={statusVariant(status)}>{statusLabels[status] ?? status}</Badge>;
}
export function durationLabel(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (!seconds) return "不足 1 秒";
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}
function ErrorNotice({ error }: { error: unknown }) {
  return error ? <div className="pipe-notice pipe-error" role="alert"><CircleAlert /><span>{error instanceof Error ? error.message : String(error)}</span></div> : null;
}

function OperatorInputFields({ graph, catalog, node, manifest, disabled, onChange, onError }: {
  graph: PipelineGraph; catalog: OperatorManifest[]; node: PipelineNode; manifest: OperatorManifest;
  disabled: boolean; onChange: (inputs: Record<string, string>) => void; onError: (message: string) => void;
}) {
  const named = Boolean(manifest.input_ports && Object.keys(manifest.input_ports).length);
  return <>{Object.entries(operatorInputPorts(manifest)).map(([port, type]) => <div className="pipe-field" key={port}>
    <label htmlFor={`node-upstream-${port}`}>{named ? `上游节点 · ${port}` : "上游节点"}</label>
    <select id={`node-upstream-${port}`} value={node.inputs[port] ?? ""} disabled={disabled} onChange={(event) => {
      const source = event.target.value;
      const error = source ? connectionError(graph, catalog, { source, target: node.id, targetHandle: port }) : null;
      if (error) { onError(error); return; }
      onError("");
      const inputs = { ...node.inputs };
      if (source) inputs[port] = source; else delete inputs[port];
      onChange(inputs);
    }}><option value="">选择输入节点</option>{graph.nodes.filter((item) => item.id !== node.id).map((item) => {
      const error = connectionError(graph, catalog, { source: item.id, target: node.id, targetHandle: port });
      const upstream = catalog.find((op) => op.id === item.operator && op.version === item.version);
      return <option key={item.id} value={item.id} disabled={Boolean(error)}>{item.id} · {error ?? (typeLabels[upstream?.output_type ?? ""] ?? "未知类型")}</option>;
    })}</select>
    <small>{named ? `${port} 接受 ${typeLabels[type] ?? type}。` : ""}仅可连接类型兼容且不会形成循环的上游节点；不可用项标明原因。</small>
  </div>)}</>;
}

function OperatorExecutionHints({ manifest }: { manifest: OperatorManifest }) {
  const fallback = manifest.deterministic && !manifest.side_effects;
  const cacheable = manifest.cacheable ?? fallback, retrySafe = manifest.retry_safe ?? fallback;
  return <p className="pipe-inspector-footer"><ShieldCheck />{[
    ...(manifest.side_effects ? ["包含外部写入"] : []),
    ...(manifest.execution_protocol === "batch-v1" ? [`有界分批 · 每批最多 ${manifest.batch_size ?? 500} 条`] : []),
    cacheable ? "支持结果缓存" : "每次重新计算", retrySafe ? "失败后可自动重试" : "失败后需确认再重试",
  ].join(" · ")}</p>;
}

interface FieldProps { name: string; value: unknown; disabled: boolean; onChange: (value: unknown) => void; onValidity: (name: string, valid: boolean) => void; rawText?: string; onRawText: (text: string) => void; objectOnly?: boolean }
function JsonField({ name, value, disabled, onChange, onValidity, rawText, onRawText, objectOnly }: FieldProps) {
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const text = rawText ?? JSON.stringify(value ?? [], null, 2);
  let error = "";
  const validObject = (parsed: unknown) => !objectOnly || Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  try { if (!validObject(JSON.parse(text))) error = "完整配置必须是 JSON 对象。"; } catch { error = "请输入合法的 JSON，保存前需修正。"; }
  return <div className="pipe-field"><label htmlFor={fieldId}>{fieldLabels[name] ?? name}<span>JSON</span></label><textarea id={fieldId} aria-describedby={error ? errorId : undefined} className="pipe-code-input" spellCheck={false} rows={name === "records" ? 15 : 5} value={text} disabled={disabled} aria-invalid={Boolean(error)} onChange={(event) => {
    onRawText(event.target.value);
    try { const parsed: unknown = JSON.parse(event.target.value); const valid = validObject(parsed); onValidity(name, valid); if (valid) onChange(parsed); }
    catch { onValidity(name, false); }
  }} />{error && <small id={errorId} className="text-destructive" role="alert">{error}</small>}{name === "records" && <small>每条文档包含 id、text，可附带 metadata。最多 1,000 条。</small>}</div>;
}

function ConfigField(props: FieldProps & { schema: JsonSchema; rootSchema: JsonSchema; required?: boolean }) {
  let resolved: ReturnType<typeof fieldSchema>;
  try { resolved = fieldSchema(props.schema, props.rootSchema); }
  catch (error) { return <ErrorNotice error={error} />; }
  const { name, value, disabled, onChange, required } = props;
  const emptyValue = resolved.schema.default ?? (resolved.type === "boolean" ? false : resolved.type === "integer" || resolved.type === "number" ? 0 : resolved.type === "array" ? [] : resolved.type === "object" ? {} : "");
  return <div>{resolved.nullable && <label className="pipe-checkbox"><input type="checkbox" checked={value === null} disabled={disabled} onChange={(event) => { const next = event.target.checked ? null : emptyValue; props.onValidity(name, true); props.onRawText(JSON.stringify(next, null, 2)); onChange(next); }} />{fieldLabels[name] ?? resolved.schema.title ?? name}：使用空值（null）</label>}{value === null && resolved.nullable ? null : <ResolvedConfigField {...props} schema={resolved.schema} type={resolved.type} />}{required && <small className="text-muted-foreground">必填参数</small>}</div>;
}

function ResolvedConfigField({ name, schema, type, value, disabled, onChange, onValidity, rawText, onRawText }: FieldProps & { schema: JsonSchema; type?: string }) {
  if (type === "array" || type === "object" || (value !== null && typeof value === "object")) return <JsonField name={name} value={value} disabled={disabled} onChange={onChange} onValidity={onValidity} rawText={rawText} onRawText={onRawText} />;
  if (type === "boolean") return <label className="pipe-checkbox"><input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{fieldLabels[name] ?? schema.title ?? name}</label>;
  return <div className="pipe-field"><label htmlFor={`config-${name}`}>{fieldLabels[name] ?? schema.title ?? name}</label>{schema.enum ? <select id={`config-${name}`} value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(schema.enum?.find((option) => String(option) === e.target.value))}>{schema.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select> : <input id={`config-${name}`} type={type === "integer" || type === "number" ? "number" : "text"} value={String(value ?? "")} min={schema.minimum} max={schema.maximum} step={type === "integer" ? 1 : "any"} disabled={disabled} onChange={(e) => { const numeric = type === "integer" || type === "number"; const valid = !numeric || e.target.value !== ""; onValidity(name, valid); onChange(numeric && valid ? Number(e.target.value) : e.target.value); }} />}{schema.description && <small>{schema.description}</small>}</div>;
}

function ArtifactPanel({ id, projectId, mode, succeeded = false, showInputs = false, allowDelivery = true }: { id: string; projectId: string; mode?: "debug" | "production"; succeeded?: boolean; showInputs?: boolean; allowDelivery?: boolean }) {
  const artifact = useQuery(artifactQuery(id, projectId));
  if (artifact.isPending) return <p className="pipe-loading"><LoaderCircle className="animate-spin" />正在读取产物…</p>;
  if (artifact.error) return <ErrorNotice error={artifact.error} />;
  const data = artifact.data;
  return <section className="pipe-artifact" aria-label="数据产物"><div className="pipe-section-heading"><div><h3><Database className="size-4" />节点产物 · {data.node_id}</h3><p>{typeLabels[data.type] ?? data.type} · {data.record_count} 条记录</p></div><a className={buttonVariants({ variant: "outline", size: "sm" })} data-track-id="pipelines.artifact.download" data-track-label="下载产物" href={apiUrl(`/api/pipeline-artifacts/${encodeURIComponent(data.id)}/export?project_id=${encodeURIComponent(projectId)}`)} download data-variant="outline" data-size="sm"><span className="md-button-container md-state-layer"><Download />下载产物</span></a></div>
    <dl className="pipe-metadata"><div><dt>内容指纹</dt><dd title={data.content_hash}>{data.content_hash.slice(0, 20)}…</dd></div><div><dt>输入产物</dt><dd>{data.parent_artifact_ids?.length ?? 0} 个</dd></div><div><dt>缓存来源</dt><dd>{data.cache_origin_id ? data.cache_origin_id.slice(0, 12) : "本次计算"}</dd></div></dl>
    <details><summary>查看元数据与血缘</summary><pre tabIndex={0}>{JSON.stringify({ metadata: data.metadata, parent_artifact_ids: data.parent_artifact_ids, cache_origin_id: data.cache_origin_id }, null, 2)}</pre></details>
    {data.type === "documents" && <><div className="pipe-document-preview"><table><thead><tr><th>样本 ID</th><th>文档文本</th></tr></thead><tbody>{data.records.slice(0, 20).map((record, index) => <tr key={index}><td>{String(record.id ?? index + 1)}</td><td>{String(record.text ?? "")}</td></tr>)}</tbody></table><p>预览前 {Math.min(data.records.length, 20)} 条{data.has_more || data.record_count > 20 ? "，完整结果请下载产物。" : "。"}</p></div>{allowDelivery && <ArtifactDatasetActions projectId={projectId} artifactId={data.id} nodeId={data.node_id} recordCount={data.record_count} debug={mode === "debug" || data.metadata.execution_mode === "debug"} succeeded={succeeded} />}</>}
    <details><summary>数据预览 · 前 {Math.min(data.records.length, 20)} 条</summary><pre className="pipe-records" tabIndex={0}>{JSON.stringify(data.records.slice(0, 20), null, 2)}</pre></details>
    {showInputs && <details className="pipe-input-preview"><summary>输入产物 · {data.parent_artifact_ids?.length ?? 0} 个</summary>{data.parent_artifact_ids?.length ? data.parent_artifact_ids.map((parentId) => <ArtifactPanel key={parentId} id={parentId} projectId={projectId} mode={mode} allowDelivery={false} />) : <p>源节点使用执行计划中固定的输入记录。</p>}</details>}
  </section>;
}

export function RunDetail({ run, projectId, onRunUpdate }: { run: PipelineRun; projectId: string; onRunUpdate?: (run: PipelineRun) => void }) {
  const { me, can } = useProjectAuth(projectId);
  const client = useQueryClient();
  const cancel = useMutation({ mutationFn: (interaction: InteractionContext | undefined) => cancelMediaRun(projectId, run.id, me.csrf_token, interaction), onSuccess: (updated) => { updateRun(updated); void client.invalidateQueries({ queryKey: ["pipeline-runs", projectId] }); } });
  const retryLocked = useRef(false);
  const [refreshError, setRefreshError] = useState<Error | null>(null);
  const reconcileOnly = run.can_reconcile_submission ?? run.submission_status === "SUBMISSION_UNKNOWN";
  const updateRun = (updated: PipelineRun) => {
    client.setQueryData<PipelineRun[]>(["pipeline-runs", projectId], (existing) => existing?.map((item) => item.id === updated.id ? updated : item));
    client.setQueryData(["media-run", projectId, updated.id], updated);
    onRunUpdate?.(updated);
  };
  const retry = useMutation({
    retry: false,
    mutationFn: (interaction: InteractionContext | undefined) => (reconcileOnly ? reconcileMediaSubmission : retryMediaSubmission)(projectId, run.id, me.csrf_token, interaction),
    onSuccess: updateRun,
    onSettled: async () => {
      try {
        const results = await Promise.allSettled([
          loadMediaRun(projectId, run.id).then(updateRun),
          client.invalidateQueries({ queryKey: ["pipeline-runs", projectId] }),
          client.invalidateQueries({ queryKey: ["media-status", projectId] }),
        ]);
        if (results[0].status === "rejected") setRefreshError(new Error("运行状态刷新失败，请稍后刷新运行记录。"));
      } finally { retryLocked.current = false; }
    },
  });
  const inspectionId = useId();
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const runOperators = useQuery({ ...operatorsQueryFor(projectId), enabled: Boolean(run.execution_plan?.graph) && !run.operator_snapshot });
  const selectRunNode = (nodeId: string) => setSelectedTaskId(run.tasks.find((task) => task.node_id === nodeId)?.id ?? "");
  const task = run.tasks.find((item) => item.id === selectedTaskId);
  const upstreamArtifactIds = task ? Object.values(run.execution_plan?.graph.nodes.find((node) => node.id === task.node_id)?.inputs ?? {}).flatMap((id) => { const artifact = run.tasks.find((item) => item.node_id === id)?.artifact_id; return artifact ? [artifact] : []; }) : [];
  const inspection = task ? <section className="pipe-task-inspection" tabIndex={0} aria-label={`${task.node_id} 节点检查`}><h3>节点检查 · {task.node_id}</h3>{task.error && <p className="pipe-task-error" role="alert">{task.error}</p>}<p>{task.artifact_id ? "节点已产出数据，可以检查本次输出。" : task.status === "failed" || task.status === "interrupted" ? "节点未产出可查看的数据，请根据上方错误检查算子配置与执行环境。" : activeStatuses.has(task.status) ? "节点尚未产出数据。这里会持续更新执行状态与处理进度。" : "本次节点没有可查看的输出产物。"}</p><dl className="pipe-metadata"><div><dt>算子</dt><dd>{task.operator}</dd></div><div><dt>执行状态</dt><dd>{statusLabels[task.status] ?? task.status}</dd></div></dl>{task.artifact_id && <ArtifactPanel key={task.artifact_id} id={task.artifact_id} projectId={projectId} mode={run.mode} succeeded={run.status === "succeeded"} showInputs />}{!task.artifact_id && upstreamArtifactIds.length > 0 && <details><summary>已就绪输入 · {upstreamArtifactIds.length} 个</summary>{upstreamArtifactIds.map((id) => <ArtifactPanel key={id} id={id} projectId={projectId} mode={run.mode} allowDelivery={false} />)}</details>}</section> : <p className="pipe-empty-copy">选择画布或列表节点，检查状态、输入与输出。</p>;
  return <section aria-label="运行详情" className="pipe-run-detail"><div className="pipe-section-heading"><div><h2>{run.pipeline_name} <span className="text-muted-foreground">v{run.pipeline_version}</span></h2><p>{dateLabel(run.created_at)} · {run.id.slice(0, 8)} · {run.mode === "debug" ? "小样本调试" : "正式运行"}</p></div><RunStatus status={run.cancellation_pending ? "cancelling" : run.status} /></div><ErrorNotice error={run.error} />
    {((reconcileOnly && can("pipelines:read")) || (!reconcileOnly && run.status === "pending" && (run.can_retry_submission ?? Boolean(run.error)) && can("pipelines:run"))) && <Button variant="secondary" size="sm" className="mt-4 mr-2" disabled={retry.isPending || cancel.isPending} data-track-id={reconcileOnly ? "pipelines.reconcile_submission" : "pipelines.retry_submission"} data-track-label={reconcileOnly ? "对账提交状态" : "重试提交"} onClick={(event) => { if (retryLocked.current || cancel.isPending) return; retryLocked.current = true; setRefreshError(null); retry.mutate(interactionForEvent(event.nativeEvent)); }}>{retry.isPending ? <LoaderCircle className="animate-spin" /> : <Play />}{reconcileOnly ? "对账提交状态" : "重试提交"}</Button>}
    {run.cancellation_pending && <div className="pipe-notice" role="status"><LoaderCircle className="animate-spin" /><span>取消请求已记录，正在等待执行引擎确认终止。终止确认前继续保留运行状态跟踪。</span></div>}
    {["pending", "queued", "running"].includes(run.status) && can("pipelines:cancel") && <Button variant="outline" size="sm" className="mt-4" disabled={cancel.isPending || retry.isPending} data-track-id="pipelines.run.cancel" data-track-label="取消运行" onClick={(event) => cancel.mutate(interactionForEvent(event.nativeEvent))}>{cancel.isPending && <LoaderCircle className="animate-spin" />}取消运行</Button>}<ErrorNotice error={retry.error ?? refreshError ?? cancel.error} />
    {run.execution_plan && <><ExecutionPlanSummary plan={run.execution_plan} /><div className="pipe-run-inspection-grid"><div className="pipe-run-canvas"><PipelineCanvas graph={run.execution_plan.graph} catalog={run.operator_snapshot ?? runOperators.data ?? []} tasks={run.tasks} selectedNode={run.tasks.find((task) => task.id === selectedTaskId)?.node_id ?? ""} onSelect={selectRunNode} readOnly onChange={() => {}} onError={() => {}} /></div><aside id={inspectionId} aria-label="运行节点检查面板">{inspection}</aside></div></>}
    <div className="pipe-task-table"><div className="pipe-task-head"><span>执行节点</span><span>状态</span><span>输入 → 输出（条）</span><span>耗时</span></div>{run.tasks.map((task) => <div key={task.id} className="pipe-task-block"><button className="pipe-task-row" aria-pressed={selectedTaskId === task.id} aria-controls={inspectionId} aria-label={`检查节点 ${task.node_id}`} data-track-id="pipelines.artifact.open" data-track-label="检查运行节点" onClick={() => setSelectedTaskId(selectedTaskId === task.id ? "" : task.id)}><span><strong>{task.node_id}</strong><small>{task.operator}</small></span><RunStatus status={task.status} /><TaskRecordCounts task={task} /><span title={task.duration_ms ? `${Math.round(task.duration_ms)} ms` : undefined}>{durationLabel(task.duration_ms)}</span></button>{(activeStatuses.has(task.status) || selectedTaskId === task.id) && <TaskProgress task={task} />}{task.error && <p className="pipe-task-error">{task.error}</p>}</div>)}</div>
    {!run.execution_plan && <div id={inspectionId}>{task && inspection}</div>}
    {run.tasks.length > 0 && <p className="pipe-scope-note">{run.tasks.some((item) => item.operator.startsWith("media.")) ? TASK_RECORD_COUNTS_HELP : "输入/输出统计节点的记录数。输出在节点完成或检查点提交后更新；处理进度单独显示，数量不代表数据质量检查结果。"}</p>}
  </section>;
}

const activeStatuses = new Set(["pending", "queued", "running", "cancelling"]);
const isActiveRun = (run: PipelineRun) => activeStatuses.has(run.status) || Boolean(run.cancellation_pending);

function PipelinePagination({ label, page, total, hasMore, busy, onPage }: { label: string; page: number; total: number; hasMore: boolean; busy: boolean; onPage: (page: number) => void }) {
  if (total === 0 && page <= 1 && !hasMore) return null;
  return <nav className="pipe-pagination" aria-label={label}><span>共 {total} 条 · 第 {page} 页</span><div><Button size="sm" variant="outline" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>上一页</Button><Button size="sm" variant="outline" disabled={busy || !hasMore} onClick={() => onPage(page + 1)}>下一页</Button></div></nav>;
}

function useWorkspaceSize(workspace: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(() => window.innerWidth - (window.innerWidth >= 1024 ? 304 : 48));
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const update = () => { const measured = element.getBoundingClientRect().width; if (measured > 0) setWidth(measured); };
    update();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", update); return () => window.removeEventListener("resize", update); }
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, [workspace]);
  return { narrow: width < 720, compact: width < 1120 };
}

function directoryContext(projectId: string): { project_id: string; q?: string; status?: string; page?: number } {
  try {
    const value = JSON.parse(sessionStorage.getItem(`pipeline-directory:${projectId}`) ?? "{}");
    return { project_id: projectId, ...(typeof value.q === "string" ? { q: value.q } : {}), ...(typeof value.status === "string" ? { status: value.status } : {}), ...(Number.isSafeInteger(value.page) && value.page > 0 ? { page: value.page } : {}) };
  } catch { return { project_id: projectId }; }
}

function PipelineList({ projectId }: { projectId: string }) {
  const { can } = useProjectAuth(projectId);
  const search = usePipelineSearch();
  const navigate = useNavigate();
  const basePath = usePipelineBasePath(projectId);
  const page = search.page ?? 1;
  useEffect(() => { try { sessionStorage.setItem(`pipeline-directory:${projectId}`, JSON.stringify({ q: search.q, status: search.status, page: search.page })); } catch { /* Storage can be disabled. */ } }, [projectId, search.q, search.status, search.page]);
  const pipelines = useQuery({ ...pipelineDirectoryQueryFor(projectId, { page, q: search.q, status: search.status }), refetchInterval: (query) => query.state.data?.items.some((item) => item.latest_run && (activeStatuses.has(item.latest_run.status) || item.latest_run.cancellation_pending)) ? 2000 : false });
  const rows = pipelines.data?.items ?? [];
  const latest = new Map(rows.flatMap((pipeline) => pipeline.latest_run ? [[pipeline.id, pipeline.latest_run] as const] : []));
  return <main className="md-page pipe-page">
    <div className="pipe-page-heading"><div><h1 className="md-page-title">数据流水线</h1><p>管理流程定义、版本和运行。</p></div>{can("pipelines:write") && <Link to={basePath} search={{ project_id: projectId, view: "new" }} className={buttonVariants()} data-track-id="pipelines.create.open" data-track-label="新建流水线" data-variant="default" data-size="default"><span className="md-button-container md-state-layer"><Plus />新建流水线</span></Link>}</div>
    <div className="pipe-list-toolbar"><label className="pipe-search"><Search /><input aria-label="搜索流水线" placeholder="搜索名称或说明" value={search.q ?? ""} onChange={(event) => void navigate({ to: basePath, search: { ...search, project_id: projectId, q: event.target.value || undefined, page: undefined }, replace: true })} /></label><ToolbarSelect label="筛选最近运行状态" prefix="最近运行" value={search.status ?? ""} onChange={(status) => void navigate({ to: basePath, search: { ...search, project_id: projectId, status: status || undefined, page: undefined }, replace: true })} options={[{value:"",label:"全部状态"},{value:"none",label:"暂无运行记录"},...["pending", "running", "succeeded", "failed", "cancelled"].map(value=>({value,label:statusLabels[value]}))]} /><Link to="/projects/$projectId/operators" params={{ projectId }} className={buttonVariants({ variant: "ghost", size: "sm" })} data-variant="ghost" data-size="sm"><span className="md-button-container md-state-layer"><Puzzle />算子与插件</span></Link></div>
    {pipelines.error && <div className="pipe-directory-error"><ErrorNotice error={pipelines.error} /><Button variant="outline" size="sm" disabled={pipelines.isFetching} onClick={() => void pipelines.refetch()}>重新读取流水线</Button></div>}
    {pipelines.isPending ? <p className="pipe-loading"><LoaderCircle className="animate-spin" />正在读取流水线…</p> : rows.length ? <div className="pipe-directory"><table><thead><tr><th>流水线</th><th>版本</th><th>最近运行</th><th>更新时间</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{rows.map((pipeline) => <tr key={pipeline.id}><td><Link to={basePath} search={{ project_id: projectId, pipelineId: pipeline.id, view: "builder" }} data-track-id="pipelines.open" data-track-label="打开流水线">{pipeline.name}</Link><p>{pipeline.description || "暂无说明"}</p></td><td>v{pipeline.version}</td><td>{latest.has(pipeline.id) ? <Link to={basePath} search={{ project_id: projectId, pipelineId: pipeline.id, view: "runs", runId: latest.get(pipeline.id)!.id }} aria-label={`查看 ${pipeline.name} 最近运行`}><RunStatus status={latest.get(pipeline.id)!.cancellation_pending ? "cancelling" : latest.get(pipeline.id)!.status} /></Link> : <span className="text-muted-foreground">暂无运行记录</span>}</td><td>{dateLabel(pipeline.updated_at)}</td><td><Link to={basePath} search={{ project_id: projectId, pipelineId: pipeline.id, view: "builder" }} aria-label={`打开 ${pipeline.name}`}><ChevronRight /></Link></td></tr>)}</tbody></table></div> : !pipelines.error && <div className="pipe-empty"><Workflow /><h2>{search.q || search.status ? "没有符合条件的流水线" : page > 1 ? "当前页暂无流水线" : "创建第一条流水线"}</h2><p>{search.q || search.status ? "调整搜索词或状态筛选，也可以清除条件查看全部流水线。" : page > 1 ? "列表可能已更新，请返回第一页查看。" : "从空白画布开始，或选择文本调试与视频处理模板。"}</p>{search.q || search.status || page > 1 ? <Link to={basePath} search={{ project_id: projectId }} className={buttonVariants({ variant: "outline" })} data-variant="outline" data-size="default"><span className="md-button-container md-state-layer">查看全部流水线</span></Link> : can("pipelines:write") && <Link to={basePath} search={{ project_id: projectId, view: "new" }} className={buttonVariants()} data-track-id="pipelines.create.empty" data-track-label="创建第一条流水线" data-variant="default" data-size="default"><span className="md-button-container md-state-layer"><Plus />创建流水线</span></Link>}</div>}
    {pipelines.data && <PipelinePagination label="流水线分页" page={page} total={pipelines.data.total} hasMore={pipelines.data.has_more} busy={pipelines.isFetching} onPage={(next) => void navigate({ to: basePath, search: { ...search, page: next, project_id: projectId } })} />}
    {!can("pipelines:write") && <PermissionRequestButton projectId={projectId} permission="pipelines:write" label="申请流程编辑权限" />}
  </main>;
}

function NewPipeline({ projectId }: { projectId: string }) {
  const { me, can } = useProjectAuth(projectId);
  const search = usePipelineSearch();
  const navigate = useNavigate();
  const basePath = usePipelineBasePath(projectId);
  const client = useQueryClient();
  const [urls, setUrls] = useState("");
  const createLock = useRef(false);
  const create = useMutation({ mutationFn: (interaction?: InteractionContext) => createDemoPipeline(projectId, me.csrf_token, urls.trim() ? urls.trim().split(/\s+/) : undefined, interaction), onSuccess: (pipeline) => { client.setQueryData(pipelineQueryFor(projectId, pipeline.id).queryKey, pipeline); void client.invalidateQueries({ queryKey: pipelinesQueryFor(projectId).queryKey }); void navigate({ to: basePath, search: { project_id: projectId, pipelineId: pipeline.id, view: "builder" }, replace: true }); }, onSettled: () => { createLock.current = false; } });
  if (!can("pipelines:write")) return <main className="md-page"><h1 className="md-page-title">新建流水线</h1><PermissionRequestButton projectId={projectId} permission="pipelines:write" label="申请流程编辑权限" /></main>;
  return <main className="md-page pipe-page pipe-detail-page">
    <Link className="pipe-back-link" to={basePath} search={directoryContext(projectId)}><ArrowLeft />流水线列表</Link>
    <div className="pipe-page-heading"><div><h1 className="md-page-title">新建流水线</h1></div></div>
    <div className="pipe-template-choice" role="group" aria-label="创建方式"><Link to={basePath} search={{ project_id: projectId, view: "new" }} data-active={!search.template}>空白流程</Link><Link to={basePath} search={{ project_id: projectId, view: "new", template: "video" }} data-active={search.template === "video"}>视频处理模板</Link><Link to={basePath} search={{ project_id: projectId, view: "new", template: "text" }} data-active={search.template === "text"}>文本调试模板</Link></div>
    {search.template === "text" ? <TextPipelineTemplate projectId={projectId} csrf={me.csrf_token} canRegister={can("operators:register")} onCreated={(pipeline) => { client.setQueryData(pipelineQueryFor(projectId, pipeline.id).queryKey, pipeline); void client.invalidateQueries({ queryKey: ["pipeline-operators", projectId] }); void client.invalidateQueries({ queryKey: ["pipelines", projectId] }); void navigate({ to: basePath, search: { project_id: projectId, pipelineId: pipeline.id, view: "builder" }, replace: true }); }} /> : search.template === "video" ? <section className="pipe-template-form"><h2>YouTube → Shot → 向量索引</h2><p>创建包含视频接入、AutoShot、关键帧、人物分割、SigLIP2、豆包视频向量和 Milvus 索引的可编辑流程。</p><label className="pipe-field"><span>示例视频链接（可选）</span><textarea aria-label="示例视频链接" value={urls} rows={3} onChange={(event) => setUrls(event.target.value)} placeholder="留空使用平台示例；自定义时每行一个 YouTube 链接" disabled={create.isPending} /></label><ErrorNotice error={create.error} /><Button data-track-id="pipelines.sample.create" data-track-label="创建视频处理流程" disabled={create.isPending || !can("operators:register")} onClick={(event) => { if (createLock.current) return; createLock.current = true; create.mutate(interactionForEvent(event.nativeEvent)); }}>{create.isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}创建视频处理流程</Button><p className="pipe-scope-note">创建后先进入编排，不会自动启动模型运行。</p>{!can("operators:register") && <PermissionRequestButton projectId={projectId} permission="operators:register" label="申请算子注册权限" />}</section> : <PipelineEditor projectId={projectId} runs={[]} onSaved={(saved) => void navigate({ to: basePath, search: { project_id: projectId, pipelineId: saved.id, view: "builder" }, replace: true })} />}
  </main>;
}

function VersionsPanel({ projectId, pipeline }: { projectId: string; pipeline: Pipeline }) {
  const search = usePipelineSearch();
  const navigate = useNavigate();
  const basePath = usePipelineBasePath(projectId);
  const selectedVersion = search.version ?? pipeline.version;
  const snapshot = useQuery(pipelineVersionQueryFor(projectId, pipeline.id, selectedVersion));
  return <section className="pipe-version-workspace"><div className="pipe-version-list"><h2>已保存版本</h2>{(pipeline.versions ?? [{ version: pipeline.version, name: pipeline.name, created_at: pipeline.updated_at }]).map((version) => <button key={version.version} className="pipe-version-item" aria-pressed={selectedVersion === version.version} data-track-id="pipelines.version.open" data-track-label="查看历史版本" onClick={() => void navigate({ to: basePath, search: { project_id: projectId, pipelineId: pipeline.id, view: "versions", version: version.version } })}><strong>v{version.version}{version.version === pipeline.version ? " · 当前" : ""}</strong><span>{version.name}</span><small>{dateLabel(version.created_at)}</small></button>)}</div><div className="pipe-version-detail"><ErrorNotice error={snapshot.error} />{snapshot.isPending ? <p className="pipe-loading">正在读取版本定义…</p> : snapshot.data && <><div className="pipe-section-heading"><div><h2>{snapshot.data.name} · v{snapshot.data.version}</h2><p>{snapshot.data.description || "暂无说明"}</p></div><Badge variant="secondary">只读版本</Badge></div><p className="pipe-scope-note">此处显示保存时的定义。历史版本不可修改；当前编排中的修改需要另存为新版本。</p><Button variant="ghost" size="sm" onClick={() => void navigate({ to: basePath, search: { project_id: projectId, pipelineId: pipeline.id, view: "runs", version: selectedVersion } })}>查看此版本的运行<ArrowRight /></Button><ol className="pipe-version-nodes">{snapshot.data.graph.nodes.map((node) => <li key={node.id}><strong>{node.id}</strong><small>{node.operator} · v{node.version}</small><details><summary>参数与输入</summary><pre>{JSON.stringify({ config: node.config, inputs: node.inputs }, null, 2)}</pre></details></li>)}</ol><details><summary>完整流程定义</summary><pre className="pipe-records">{JSON.stringify(snapshot.data.graph, null, 2)}</pre></details></>}</div></section>;
}

function PipelineDetail({ projectId, pipelineId }: { projectId: string; pipelineId: string }) {
  const search = usePipelineSearch();
  const navigate = useNavigate();
  const basePath = usePipelineBasePath(projectId);
  const client = useQueryClient();
  const pipeline = useQuery(pipelineQueryFor(projectId, pipelineId));
  const [metadataRequested, setMetadataRequested] = useState(false);
  const runs = useQuery({ ...pipelineRunsQueryFor(projectId, pipelineId), refetchInterval: (query) => query.state.data?.some(isActiveRun) ? 1500 : false });
  const run = useQuery({ queryKey: ["media-run", projectId, search.runId], queryFn: () => loadMediaRun(projectId, search.runId!), enabled: Boolean(search.runId), refetchInterval: (query) => query.state.data && isActiveRun(query.state.data) ? 1500 : false });
  const view = search.view && search.view !== "new" ? search.view : search.runId ? "runs" : "builder";
  const tabContext = useRef<Partial<Record<"builder" | "runs" | "versions", { runId?: string; version?: number; status?: string; page?: number }>>>({});
  tabContext.current[view] = { runId: search.runId, version: search.version, status: search.status, page: search.page };
  const history = useQuery({ ...pipelineRunHistoryQueryFor(projectId, pipelineId, { page: search.page, version: search.version, status: search.status }), enabled: view === "runs", refetchInterval: (query) => query.state.data?.items.some(isActiveRun) ? 1500 : false });
  const scopedRuns = (history.data?.items ?? []).filter((item) => item.pipeline_id === pipelineId && (!search.version || item.pipeline_version === search.version));
  const selectedRun = run.data?.pipeline_id === pipelineId ? run.data : undefined;
  const onSaved = (saved: Pipeline) => { client.setQueryData(pipelineQueryFor(projectId, pipelineId).queryKey, (current: Pipeline | undefined) => ({ ...saved, versions: [{ version: saved.version, name: saved.name, created_at: saved.updated_at }, ...(current?.versions ?? []).filter((item) => item.version !== saved.version)] })); void client.invalidateQueries({ queryKey: pipelineQueryFor(projectId, pipelineId).queryKey }); };
  return <main className="md-page pipe-page pipe-detail-page"><Link className="pipe-back-link" to={basePath} search={directoryContext(projectId)}><ArrowLeft />流水线列表</Link>
    <ErrorNotice error={pipeline.error} />{pipeline.isPending ? <p className="pipe-loading">正在读取流水线…</p> : pipeline.data && <>
      <div className="pipe-detail-heading"><h1>{pipeline.data.name}</h1><Button variant="ghost" size="icon" onClick={() => { setMetadataRequested(true); if (view !== "builder") void navigate({ to: basePath, search: { project_id: projectId, pipelineId, view: "builder" } }); }} aria-label="修改流程名称"><FilePenLine /></Button><Badge variant="secondary">最新 v{pipeline.data.version}</Badge><span>{projectId} 项目</span></div>
      <Tabs.Root value={view} onValueChange={(value) => void navigate({ to: basePath, search: { project_id: projectId, pipelineId, ...tabContext.current[value as "builder" | "runs" | "versions"], view: value as "builder" | "runs" | "versions" } })}>
        <Tabs.List className="pipe-tabs" aria-label="当前流水线" activateOnFocus><Tabs.Tab value="builder" data-track-id="pipelines.tab.builder" data-track-label="流程编排"><GitBranch />编排</Tabs.Tab><Tabs.Tab value="runs" data-track-id="pipelines.tab.runs" data-track-label="运行记录"><History />运行记录</Tabs.Tab><Tabs.Tab value="versions" data-track-id="pipelines.tab.versions" data-track-label="历史版本"><Layers3 />版本</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="builder" keepMounted><PipelineEditor projectId={projectId} metadataRequested={metadataRequested} onMetadataOpened={() => setMetadataRequested(false)} initial={pipeline.data} runs={(runs.data ?? []).filter((item) => item.pipeline_id === pipelineId)} runsReady={Boolean(runs.data) && !runs.isFetching && !runs.error} runsError={runs.error} refreshRuns={() => void runs.refetch()} onSaved={onSaved} /></Tabs.Panel>
        <Tabs.Panel value="runs"><div className="pipe-section-heading pipe-run-filters mb-4"><h2>当前流程的运行</h2><ToolbarSelect label="筛选运行版本" prefix="版本" value={String(search.version ?? "")} onChange={(version) => void navigate({ to: basePath, search: { project_id: projectId, pipelineId, view: "runs", version: version ? Number(version) : undefined, status: search.status } })} options={[{value:"",label:"全部版本"},...(pipeline.data.versions ?? [{version:pipeline.data.version}]).map(item=>({value:String(item.version),label:`v${item.version}`}))]} /><ToolbarSelect label="筛选运行状态" prefix="运行状态" value={search.status ?? ""} onChange={(status) => void navigate({ to: basePath, search: { project_id: projectId, pipelineId, view: "runs", version: search.version, status: status || undefined } })} options={[{value:"",label:"全部状态"},...["pending", "running", "succeeded", "failed", "cancelled"].map(value=>({value,label:statusLabels[value]}))]} /></div><ErrorNotice error={history.error ?? run.error ?? (run.data && run.data.pipeline_id !== pipelineId ? "该运行不属于当前流水线。" : null)} /><div className="pipe-runs-workspace"><aside className="pipe-run-list">{history.isPending ? <p>正在读取运行…</p> : scopedRuns.length ? scopedRuns.map((item) => <Link className="pipe-run-item" key={item.id} to={basePath} search={{ project_id: projectId, pipelineId, view: "runs", runId: item.id, version: search.version, status: search.status, page: search.page }} aria-current={search.runId === item.id ? "true" : undefined} data-track-id="pipelines.run.open" data-track-label="查看运行记录"><span><strong>v{item.pipeline_version} · {dateLabel(item.created_at)}</strong><small>{item.id.slice(0, 8)}</small></span><RunStatus status={item.cancellation_pending ? "cancelling" : item.status} /></Link>) : <p className="pipe-empty-copy">这个流程{search.version ? `的 v${search.version}` : ""}暂无符合条件的运行记录。</p>}{history.data && <PipelinePagination label="运行记录分页" page={search.page ?? 1} total={history.data.total} hasMore={history.data.has_more} busy={history.isFetching} onPage={(page) => void navigate({ to: basePath, search: { ...search, project_id: projectId, pipelineId, view: "runs", runId: undefined, page } })} />}</aside><div className="pipe-run-content">{selectedRun ? <RunDetail key={selectedRun.id} run={selectedRun} projectId={projectId} onRunUpdate={(updated) => client.setQueryData(["media-run", projectId, updated.id], updated)} /> : run.isPending && search.runId ? <p>正在读取运行详情…</p> : <div className="pipe-empty"><History /><h3>选择一次运行</h3><p>查看这个流程的节点进度、错误和产物。</p></div>}</div></div></Tabs.Panel>
        <Tabs.Panel value="versions"><VersionsPanel projectId={projectId} pipeline={pipeline.data} /></Tabs.Panel>
      </Tabs.Root>
      <PipelineDeployments projectId={projectId} pipeline={pipeline.data} onRunCreated={(id) => void navigate({ to: basePath, search: { project_id: projectId, pipelineId, view: "runs", runId: id } })} />
    </>}
  </main>;
}

function PipelineEditor({ projectId, initial, runs, runsReady = true, runsError, refreshRuns, onSaved, metadataRequested, onMetadataOpened }: { metadataRequested?: boolean; onMetadataOpened?: () => void; projectId: string; initial?: Pipeline; runs: PipelineRun[]; runsReady?: boolean; runsError?: Error | null; refreshRuns?: () => void; onSaved: (pipeline: Pipeline) => void }) {
  const paletteId = useId();
  const parametersId = useId();
  const drawerId = useId();
  const drawerTrigger = useRef<HTMLButtonElement | null>(null);
  const { me, can } = useProjectAuth(projectId);
  const client = useQueryClient();
  const navigate = useNavigate();
  const basePath = usePipelineBasePath(projectId);
  const operators = useQuery(operatorsQueryFor(projectId));
  const entrySearch = usePipelineSearch();
  const seededOperator = useRef(false);
  const [current, setCurrent] = useState(initial);
  const [draft, setDraft] = useState(() => initial ? { name: initial.name, description: initial.description, graph: withDefaultPositions(clone(initial.graph)) } : emptyDraft());
  const [history, setHistory] = useState<{ past: PipelineGraph[]; future: PipelineGraph[] }>({ past: [], future: [] });
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const [selectedNode, setSelectedNode] = useState("");
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const [rawFields, setRawFields] = useState<Record<string, string>>({});
  const [jsonConfig, setJsonConfig] = useState(false);
  const [configModeWarning, setConfigModeWarning] = useState(false);
  const [validation, setValidation] = useState<GraphValidation | null>(null);
  const [notice, setNotice] = useState("");
  const [canvasError, setCanvasError] = useState("");
  const [metadataOpen, setMetadataOpen] = useState(false);
  useEffect(() => { if (metadataRequested) { setMetadataOpen(true); onMetadataOpened?.(); } }, [metadataRequested, onMetadataOpened]);
  const [operatorQuery, setOperatorQuery] = useState("");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [drawer, setDrawer] = useState<"operators" | "parameters" | null>(null);
  const [useCache, setUseCache] = useState(true);
  const [executionTarget,setExecutionTarget]=useState<ExecutionTarget>({});
  const [uncertain, setUncertain] = useState(false);
  const [invalidIntent, setInvalidIntent] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  const { narrow, compact } = useWorkspaceSize(workspace);
  const paletteVisible = leftOpen && (!compact || !rightOpen);
  const fileInput = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);
  const intent = useRef<{ key: string; version: number; use_cache: boolean; environment_id?:string;worker_pool_id?:string } | null>(null);
  const intentStorageKey = `pipeline-submit:${projectId}:${current?.id ?? "new"}:${current?.version ?? 0}`;
  useEffect(() => {
    intent.current = null; setInvalidIntent(false); setUncertain(false);
    try {
      const raw = sessionStorage.getItem(intentStorageKey);
      if (!raw) return;
      const stored: unknown = JSON.parse(raw);
      if (!stored || typeof stored !== "object" || !("key" in stored) || typeof stored.key !== "string" || !("use_cache" in stored) || typeof stored.use_cache !== "boolean" || !("version" in stored) || stored.version !== current?.version) { setInvalidIntent(true); return; }
      const saved=stored as Record<string,unknown>;
      if ((saved.environment_id !== undefined && typeof saved.environment_id !== "string") || (saved.worker_pool_id !== undefined && typeof saved.worker_pool_id !== "string") || (saved.worker_pool_id && !saved.environment_id)) { setInvalidIntent(true); return; }
      const target:ExecutionTarget={environment_id:saved.environment_id as string|undefined,worker_pool_id:saved.worker_pool_id as string|undefined};
      intent.current = { key: stored.key, use_cache: stored.use_cache, version: stored.version as number,...target }; setExecutionTarget(target); setUseCache(stored.use_cache); setUncertain(true);
    } catch { setInvalidIntent(true); }
  }, [intentStorageKey, current?.version]);
  const clearIntent = () => { intent.current = null; setUncertain(false); try { sessionStorage.removeItem(intentStorageKey); } catch { /* Session storage can be disabled by the browser. */ } };
  const blocker = useBlocker({ withResolver: true, enableBeforeUnload: dirty, shouldBlockFn: ({ current: from, next }) => {
    if (!dirtyRef.current) return false;
    const fromSearch = from.search as { pipelineId?: string; project_id?: string; view?: string; template?: string };
    const nextSearch = next.search as typeof fromSearch;
    return next.pathname !== "/pipelines" || fromSearch.pipelineId !== nextSearch.pipelineId || (fromSearch.project_id ?? projectId) !== (nextSearch.project_id ?? projectId) || (!current && (nextSearch.view !== "new" || nextSearch.template === "video"));
  } });
  const save = useMutation({ mutationFn: (interaction?: InteractionContext) => savePipeline(draft, me.csrf_token, current, projectId, interaction), onError: (error) => { if (current && error instanceof ApiError && error.status === 409) void client.invalidateQueries({ queryKey: pipelineQueryFor(projectId, current.id).queryKey }); }, onSuccess: (saved) => { dirtyRef.current = false; setDirty(false); setCurrent(saved); setDraft({ name: saved.name, description: saved.description, graph: withDefaultPositions(clone(saved.graph)) }); setRawFields({}); setHistory({ past: [], future: [] }); setNotice(`已保存 ${saved.name} v${saved.version}`); void client.invalidateQueries({ queryKey: pipelinesQueryFor(projectId).queryKey }); onSaved(saved); } });
  const validate = useMutation({ mutationFn: (interaction?: InteractionContext) => validatePipeline(draft.graph, me.csrf_token, projectId, interaction), onSuccess: setValidation });
  const submit = useMutation({ retry: false, mutationFn: ({ key, version, use_cache, interaction,environment_id,worker_pool_id }: { key: string; version: number; use_cache: boolean; interaction?: InteractionContext } & ExecutionTarget) => runPipeline(current!.id, version, use_cache, me.csrf_token, projectId, key, interaction,{environment_id,worker_pool_id}), onSuccess: (run) => {
    clearIntent(); client.setQueryData(["media-run", projectId, run.id], run); client.setQueryData<PipelineRun[]>(pipelineRunsQueryFor(projectId, current!.id).queryKey, (existing) => [run, ...(existing ?? []).filter((item) => item.id !== run.id)]);
    void navigate({ to: basePath, search: { project_id: projectId, pipelineId: current!.id, view: "runs", runId: run.id } });
  }, onError: () => { setUncertain(true); }, onSettled: async () => { await client.invalidateQueries({ queryKey: ["pipeline-runs", projectId] }); submitLock.current = false; } });
  const active = current && runs.find((run) => run.pipeline_version === current.version && isActiveRun(run));
  const busy = save.isPending || validate.isPending || submit.isPending;
  const newerVersion = initial && current && initial.version > current.version ? initial : undefined;
  function loadLatest() {
    if (!initial) return;
    setCurrent(initial); setDraft({ name: initial.name, description: initial.description, graph: withDefaultPositions(clone(initial.graph)) });
    setDirty(false); dirtyRef.current = false; setHistory({ past: [], future: [] });
    setRawFields({}); setInvalidFields({}); setValidation(null); setNotice(`已加载 v${initial.version}`);
    setSelectedNode(""); save.reset();
  }
  useEffect(() => {
    if (initial && current && initial.version > current.version && !dirty && !busy) loadLatest();
  }, [initial, current?.version, dirty, busy]);
  const hasInvalid = Object.values(invalidFields).some(Boolean);
  const write = can("pipelines:write");
  const catalog = operators.data ?? [];
  const findOperator = (node: PipelineNode) => catalog.find((operator) => operator.id === node.operator && operator.version === node.version);
  const node = draft.graph.nodes.find((item) => item.id === selectedNode);
  const manifest = node && findOperator(node);
  let configSchema: JsonSchema = {};
  let schemaError: unknown;
  if (manifest) {
    try { configSchema = resolveSchema(manifest.config_schema, manifest.config_schema); }
    catch (error) { schemaError = error; }
  }
  const markDirty = () => { setDirty(true); setValidation(null); setNotice(""); };
  function edit(graph: PipelineGraph, recordHistory = true) {
    if (JSON.stringify(graph) === JSON.stringify(draft.graph)) return;
    setHistory((value) => ({ past: recordHistory ? [...value.past.slice(-49), clone(draft.graph)] : value.past, future: [] }));
    setDraft((value) => ({ ...value, graph: withDefaultPositions(graph) })); markDirty();
  }
  function discardInvalidConfig(id: string) {
    const fieldKey = `${id}:$config`;
    const remainingRaw = Object.fromEntries(Object.entries(rawFields).filter(([key]) => key !== fieldKey));
    const remainingInvalid = Object.fromEntries(Object.entries(invalidFields).filter(([key]) => key !== fieldKey));
    const pendingRaw = Object.entries(remainingRaw).some(([key, text]) => {
      const separator = key.indexOf(":");
      const target = draft.graph.nodes.find((item) => item.id === key.slice(0, separator));
      if (!target) return false;
      const field = key.slice(separator + 1);
      try { return !sameJson(JSON.parse(text), field === "$config" ? target.config : target.config[field]); } catch { return true; }
    });
    const changed = !current || !sameJson(draft, { name: current.name, description: current.description, graph: withDefaultPositions(current.graph) }) || Object.values(remainingInvalid).some(Boolean) || pendingRaw;
    setRawFields(remainingRaw); setInvalidFields(remainingInvalid);
    setDirty(changed); dirtyRef.current = changed;
    setConfigModeWarning(false); setJsonConfig(false);
  }
  function travelHistory(direction: "undo" | "redo") {
    if (busy || !write) return;
    const candidates = direction === "undo" ? history.past : history.future;
    const graph = candidates.at(-1); if (!graph) return;
    setHistory(direction === "undo" ? { past: history.past.slice(0, -1), future: [...history.future, clone(draft.graph)] } : { past: [...history.past, clone(draft.graph)], future: history.future.slice(0, -1) });
    setDraft((value) => ({ ...value, graph: clone(graph) })); setRawFields({}); setInvalidFields({});
    if (!graph.nodes.some((item) => item.id === selectedNode)) setSelectedNode("");
    markDirty();
  }
  function selectNode(id: string) { setSelectedNode(id); setConfigModeWarning(false); if (id) { setRightOpen(true); if (narrow) setDrawer("parameters"); } }
  function updateNode(value: Partial<PipelineNode>) { if (node) edit({ ...draft.graph, nodes: draft.graph.nodes.map((item) => item.id === node.id ? { ...item, ...value } : item) }); }
  useEffect(() => {
    if (initial || seededOperator.current || operators.isPending || !entrySearch.operator_id) return;
    seededOperator.current = true;
    const operator = catalog.find((item) => item.id === entrySearch.operator_id && item.version === String(entrySearch.operator_version));
    if (!operator) { setCanvasError("指定算子版本尚未在当前项目启用，请从可用算子中选择，或前往项目算子库启用。"); return; }
    addNode(operator);
    setNotice(`已添加 ${operator.name} v${operator.version}；请为流程命名并配置输入。`);
  }, [initial, operators.isPending, catalog, entrySearch.operator_id, entrySearch.operator_version]);
  function addNode(operator: OperatorManifest) {
    const stem = operator.id.split(".").at(-1) ?? "node"; let id = stem; let count = 2;
    while (draft.graph.nodes.some((item) => item.id === id)) id = `${stem}_${count++}`;
    const added: PipelineNode = { id, operator: operator.id, version: operator.version, config: clone(operator.default_config), inputs: {} };
    const graph = { ...draft.graph, nodes: [...draft.graph.nodes, added] };
    const ports = Object.keys(operatorInputPorts(operator));
    const port = selectedNode ? ports.find((port) => !connectionError(graph, catalog, { source: selectedNode, target: id, targetHandle: port })) : undefined;
    const upstream = port ? selectedNode : undefined;
    if (upstream && port) added.inputs = { [port]: upstream };
    edit(graph); selectNode(id);
    if (ports.length) setNotice(upstream ? `已添加 ${operator.name}，${ports.length > 1 ? `${port} 输入` : "输入"}连接到选中的节点 ${upstream}。${ports.length > 1 ? "请继续连接其他输入端口。" : ""}` : `已添加 ${operator.name}，尚未连接输入。请从画布连线或在参数中选择上游节点。`);
  }
  async function importGraph(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("流程文件不能超过 2 MB。");
      const data = JSON.parse(await file.text()) as ReturnType<typeof emptyDraft>;
      if (!data.graph || !Array.isArray(data.graph.nodes) || !data.graph.nodes.every((item) => item && typeof item.id === "string" && typeof item.operator === "string" && typeof item.version === "string" && item.config && typeof item.config === "object" && !Array.isArray(item.config) && item.inputs && typeof item.inputs === "object" && !Array.isArray(item.inputs) && Object.values(item.inputs).every((source) => typeof source === "string"))) throw new Error("流程文件需要合法的 graph.nodes、算子版本、配置和输入。");
      setDraft({ name: typeof data.name === "string" ? data.name : "导入的流程", description: typeof data.description === "string" ? data.description : "", graph: withDefaultPositions(data.graph) }); setHistory((value) => ({ past: [...value.past.slice(-49), clone(draft.graph)], future: [] })); setSelectedNode(data.graph.nodes[0]?.id ?? ""); setInvalidFields({}); setRawFields({}); markDirty();
    } catch (error) { setCanvasError(error instanceof Error ? error.message : "无法读取流程文件"); }
  }
  function startRun(event: React.MouseEvent<HTMLButtonElement>) {
    if (submitLock.current || busy || !current || dirty || hasInvalid || newerVersion) return;
    if (active) { void navigate({ to: basePath, search: { project_id: projectId, pipelineId: current.id, view: "runs", runId: active.id } }); return; }
    if (!runsReady || invalidIntent) return;
    submitLock.current = true;
    intent.current ??= { key: crypto.randomUUID(), version: current.version, use_cache: useCache,...executionTarget };
    try { sessionStorage.setItem(intentStorageKey, JSON.stringify(intent.current)); } catch { /* The ref still protects this page's submission. */ }
    submit.mutate({ ...intent.current, interaction: interactionForEvent(event.nativeEvent) });
  }
  const operatorPanel = <><div className="pipe-section-heading"><h2>可用算子</h2><Link to="/operators" search={{ project_id: projectId }} aria-label="打开算子与插件"><Puzzle /></Link></div><label className="pipe-search pipe-search-small"><Search /><input aria-label="搜索可用算子" placeholder="搜索名称或 ID" value={operatorQuery} onChange={(event) => setOperatorQuery(event.target.value)} /></label><ErrorNotice error={operators.error} />{operators.isPending ? <p>正在读取算子…</p> : <div className="pipe-palette-items">{catalog.filter((operator) => `${operator.name} ${operator.id}`.toLowerCase().includes(operatorQuery.toLowerCase())).map((operator) => <button key={`${operator.id}@${operator.version}`} disabled={!write || busy} aria-label={`添加算子 ${operator.name} v${operator.version}`} data-track-id="pipelines.node.add" data-track-label="添加节点" onClick={() => addNode(operator)}><span><strong>{operator.name}</strong><small>{kindLabels[operator.kind] ?? operator.kind} · v{operator.version}</small></span><Plus /></button>)}</div>}{!operators.isPending && !catalog.length && <p className="pipe-empty-copy">注册插件后，算子会出现在这里。<Link to="/operators" search={{ project_id: projectId }}>前往算子注册</Link></p>}</>;
  const debugPanel = can("pipelines:run") && <PipelineDebugControls projectId={projectId} pipelineId={current?.id} version={current?.version} nodeId={selectedNode} csrf={me.csrf_token} target={executionTarget} useCache={useCache} disabledReason={dirty || hasInvalid ? "有未保存的修改，请先保存版本；调试使用已保存的输入与配置。" : newerVersion ? "已有更新版本，请先加载最新版或保存草稿。" : busy || Boolean(active) || uncertain ? "请先处理当前运行或提交。" : !runsReady ? "正在确认运行状态，请稍后调试。" : undefined} onRunCreated={(run) => { client.setQueryData(["media-run", projectId, run.id], run); void client.invalidateQueries({ queryKey: ["pipeline-runs", projectId] }); void navigate({ to: basePath, search: { project_id: projectId, pipelineId: current!.id, view: "runs", runId: run.id } }); }} />;
  const parameterPanel = <>{debugPanel}<div className="pipe-section-heading"><h2>{manifest?.name ?? "节点参数"}</h2>{node && write && <Button variant="destructive-text" size="icon" aria-label={`删除节点 ${node.id}`} disabled={busy} data-track-id="pipelines.node.remove" data-track-label="删除节点" onClick={() => { const id = node.id; edit({ ...draft.graph, nodes: draft.graph.nodes.filter((item) => item.id !== id).map((item) => ({ ...item, inputs: Object.fromEntries(Object.entries(item.inputs).filter(([, source]) => source !== id)) })) }); setSelectedNode(""); setInvalidFields((fields) => Object.fromEntries(Object.entries(fields).filter(([key]) => !key.startsWith(`${id}:`)))); }}><Trash2 /></Button>}</div>{draft.graph.nodes.length > 0 && <div className="pipe-field"><label htmlFor="inspect-node">选择配置节点</label><select id="inspect-node" value={selectedNode} onChange={(event) => setSelectedNode(event.target.value)}><option value="">选择一个节点</option>{draft.graph.nodes.map((item) => <option key={item.id} value={item.id}>{findOperator(item)?.name ?? item.operator} · {item.id}</option>)}</select></div>}{node && manifest ? <><details className="pipe-parameter-help"><summary>算子说明与数据类型</summary><p className="pipe-parameter-description">{manifest.description}</p><div className="pipe-contract"><span>{Object.entries(operatorInputPorts(manifest)).length ? Object.entries(operatorInputPorts(manifest)).map(([port, type]) => `${manifest.input_ports && Object.keys(manifest.input_ports).length ? `${port}: ` : ""}${typeLabels[type] ?? type}`).join(" + ") : "源数据"}</span><ArrowRight /><span>{typeLabels[manifest.output_type] ?? manifest.output_type}</span></div></details><OperatorInputFields graph={draft.graph} catalog={catalog} node={node} manifest={manifest} disabled={!write || busy} onError={setCanvasError} onChange={(inputs) => updateNode({ inputs })} /><div className="pipe-section-heading"><h3>算子配置</h3><Button size="sm" variant="ghost" aria-pressed={jsonConfig} onClick={() => { if (jsonConfig && node && invalidFields[`${node.id}:$config`]) { setConfigModeWarning(true); return; } setConfigModeWarning(false); setJsonConfig(!jsonConfig); }}>{jsonConfig ? "使用参数表单" : "使用 JSON 编辑"}</Button></div>{configModeWarning && <div className="pipe-notice pipe-error" role="alert"><span>JSON 尚未有效。请先修正，或丢弃这段未生效的文本后返回表单。</span><Button size="sm" variant="outline" onClick={() => discardInvalidConfig(node.id)}>丢弃无效文本并返回表单</Button></div>}{schemaError && <ErrorNotice error={schemaError} />}<div className="pipe-config-fields" key={node.id}>{jsonConfig ? <JsonField name="完整配置" objectOnly value={node.config} disabled={!write || busy} rawText={rawFields[`${node.id}:$config`]} onRawText={(text) => { setRawFields((fields) => ({ ...fields, [`${node.id}:$config`]: text })); markDirty(); }} onValidity={(_, valid) => setInvalidFields((fields) => ({ ...fields, [`${node.id}:$config`]: !valid }))} onChange={(value) => { const valid = value !== null && typeof value === "object" && !Array.isArray(value); setInvalidFields((fields) => ({ ...fields, [`${node.id}:$config`]: !valid })); if (valid) { setRawFields((fields) => Object.fromEntries(Object.entries(fields).filter(([key]) => !key.startsWith(`${node.id}:`) || key === `${node.id}:$config`))); setInvalidFields((fields) => Object.fromEntries(Object.entries(fields).filter(([key]) => !key.startsWith(`${node.id}:`)))); updateNode({ config: value as Record<string, unknown> }); } }} /> : Object.entries(configSchema.properties ?? {}).map(([name, schema]) => <ConfigField key={name} name={name} schema={schema} rootSchema={manifest.config_schema} required={configSchema.required?.includes(name)} value={node.config[name] !== undefined ? node.config[name] : schema.default} disabled={!write || busy} rawText={rawFields[`${node.id}:${name}`]} onRawText={(text) => { setRawFields((fields) => ({ ...fields, [`${node.id}:${name}`]: text })); markDirty(); }} onValidity={(field, valid) => setInvalidFields((fields) => ({ ...fields, [`${node.id}:${field}`]: !valid }))} onChange={(value) => { setRawFields((fields) => Object.fromEntries(Object.entries(fields).filter(([key]) => key !== `${node.id}:$config`))); updateNode({ config: { ...node.config, [name]: value } }); }} />)}{!jsonConfig && !Object.keys(configSchema.properties ?? {}).length && <p>{configSchema.anyOf || configSchema.oneOf || schemaError ? "此配置请使用 JSON 编辑，保存时会按插件 Schema 校验。" : "此算子无需额外参数；也可用 JSON 配置扩展字段。"}</p>}{jsonConfig && <small>填写完整配置对象。支持嵌套结构和组合 Schema；保存与校验以插件契约为准。</small>}</div><OperatorExecutionHints manifest={manifest} /></> : <p className="pipe-empty-copy">{node ? "该算子版本不可用，请检查插件注册状态。" : "从画布或列表选择节点，查看参数。"}</p>}</>;
  return <section ref={workspace} className="pipe-editing-workspace" aria-label="流程编排工作区" onKeyDown={(event) => { if (!(event.metaKey || event.ctrlKey) || (event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return; const key = event.key.toLowerCase(); if (key === "z" || key === "y") { event.preventDefault(); travelHistory(key === "y" || event.shiftKey ? "redo" : "undo"); } }}>
    {!current && <div className="pipe-editor-identity"><label><span>流程名称</span><input aria-label="流程名称" placeholder="为这条流水线命名" value={draft.name} maxLength={120} disabled={!write || busy} onChange={(event) => { setDraft((value) => ({ ...value, name: event.target.value })); markDirty(); }} /></label><Button variant="ghost" size="sm" onClick={() => setMetadataOpen(true)}>流程说明</Button></div>}
    <div className="pipe-object-toolbar"><div className="pipe-panel-toggles"><Button size="sm" variant="ghost" aria-expanded={narrow ? drawer === "operators" : paletteVisible} aria-controls={narrow ? drawer === "operators" ? drawerId : undefined : paletteId} aria-haspopup={narrow ? "dialog" : undefined} onClick={(event) => { if (narrow) { drawerTrigger.current = event.currentTarget; setDrawer("operators"); } else { setLeftOpen(!paletteVisible); if (compact) setRightOpen(false); } }}><PanelLeft />算子</Button><Button size="sm" variant="ghost" aria-expanded={narrow ? drawer === "parameters" : rightOpen} aria-controls={narrow ? drawer === "parameters" ? drawerId : undefined : parametersId} aria-haspopup={narrow ? "dialog" : undefined} onClick={(event) => { if (narrow) { drawerTrigger.current = event.currentTarget; setDrawer("parameters"); } else setRightOpen(!rightOpen); }}><SlidersHorizontal />参数</Button><span className="pipe-save-indicator">{dirty ? "有未保存的修改" : current ? `已保存 · v${current.version}` : "待配置"}</span></div><div className="pipe-object-actions">{can("pipelines:run") && <ExecutionSelection projectId={projectId} value={executionTarget} onChange={setExecutionTarget} disabled={busy||uncertain||Boolean(active)} />}{write && <><Button size="icon" variant="ghost" aria-label="撤销流程修改" title="撤销（⌘/Ctrl Z）" aria-keyshortcuts="Control+Z Meta+Z" disabled={busy || !history.past.length} onClick={() => travelHistory("undo")}><Undo2 /></Button><Button size="icon" variant="ghost" aria-label="重做流程修改" title="重做（⌘/Ctrl Shift Z）" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" disabled={busy || !history.future.length} onClick={() => travelHistory("redo")}><Redo2 /></Button></>}{write && <Button variant="outline" size="sm" disabled={busy || hasInvalid || !draft.graph.nodes.length} data-track-id="pipelines.validate" data-track-label="校验流程" onClick={(event) => validate.mutate(interactionForEvent(event.nativeEvent))}>{validate.isPending ? <LoaderCircle className="animate-spin" /> : <Check />}校验</Button>}{write && <Button variant={dirty || !current ? "default" : "outline"} size="sm" disabled={busy || Boolean(newerVersion) || hasInvalid || !draft.graph.nodes.length || !draft.name.trim() || (Boolean(current) && !dirty)} data-track-id="pipelines.version.save" data-track-label="保存流程版本" onClick={(event) => save.mutate(interactionForEvent(event.nativeEvent))}>{save.isPending ? <LoaderCircle className="animate-spin" /> : <Save />}保存版本</Button>}{can("pipelines:run") && <Button size="sm" variant={dirty || !current ? "outline" : "default"} disabled={busy || Boolean(newerVersion) || !current || dirty || hasInvalid || (!active && (!runsReady || invalidIntent))} data-track-id={active ? "pipelines.run.view_active" : "pipelines.run"} data-track-label={active ? "查看当前运行" : uncertain ? "重试同次提交" : "启动新运行"} onClick={startRun}>{submit.isPending ? <LoaderCircle className="animate-spin" /> : active ? <History /> : <Play />}{submit.isPending ? "正在提交…" : active ? "查看运行" : !runsReady ? (runsError ? "运行状态不可用" : "读取运行状态…") : uncertain ? `重试同次提交 · v${current?.version}` : current ? `正式运行 · v${current.version}` : "正式运行"}</Button>}<Menu.Root><Menu.Trigger render={<Button variant="ghost" size="icon" />} aria-label="更多流程操作"><MoreHorizontal /></Menu.Trigger><Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="z-40"><Menu.Popup className="pipe-more-menu"><Menu.Item disabled={busy} onClick={() => setMetadataOpen(true)}><FilePenLine />流程信息</Menu.Item><Menu.CheckboxItem checked={useCache} disabled={busy || uncertain} onCheckedChange={setUseCache}><Menu.CheckboxItemIndicator><Check /></Menu.CheckboxItemIndicator>复用节点缓存</Menu.CheckboxItem><Menu.Item data-track-id="pipelines.export" data-track-label="导出流程定义" onClick={() => downloadJson(`${draft.name || "pipeline"}.json`, draft)}><Download />导出流程定义</Menu.Item>{write && <Menu.Item disabled={busy || dirty} data-track-id="pipelines.import" data-track-label="导入流程定义" onClick={() => fileInput.current?.click()}><FileJson />导入流程定义</Menu.Item>}</Menu.Popup></Menu.Positioner></Menu.Portal></Menu.Root></div></div>
    {newerVersion && dirty && <div className="pipe-notice" role="alert"><CircleAlert /><span>正在编辑 v{current?.version}，已有最新版 v{newerVersion.version}。加载最新版会替换当前草稿；保留草稿会将它作为最新版之后的新版本保存，不会自动合并他人的修改。</span><Button size="sm" variant="outline" disabled={busy} onClick={loadLatest}>加载最新版</Button><Button size="sm" disabled={busy} onClick={() => { setCurrent(newerVersion); save.reset(); setNotice(`已保留草稿，以 v${newerVersion.version} 为保存基线`); }}>保留草稿</Button></div>}
    {runsError && <div className="pipe-notice pipe-error" role="alert"><CircleAlert /><span>无法确认当前版本的运行状态：{runsError.message}</span><Button variant="outline" size="sm" onClick={refreshRuns}>重试读取运行状态</Button></div>}{invalidIntent && <div className="pipe-notice pipe-error" role="alert">上次提交信息不完整，请先在运行记录中确认原运行。</div>}
    <input type="file" ref={fileInput} accept=".json,application/json" className="hidden" aria-label="导入流程文件" onChange={(event) => { void importGraph(event.target.files?.[0]); event.target.value = ""; }} />
    {notice && <div className="pipe-notice pipe-success" role="status"><CheckCircle2 />{notice}</div>}<ErrorNotice error={save.error ?? validate.error ?? submit.error ?? canvasError} />{uncertain && !active && <div className="pipe-notice"><CircleAlert /><span>上次提交结果未确认。重试同次提交会复用请求标识，获取原来的运行。</span></div>}
    {hasInvalid && <div className="pipe-notice pipe-error" role="alert"><span>部分节点配置尚未有效，修正后即可保存。</span>{Object.entries(invalidFields).filter(([, invalid]) => invalid).map(([key]) => { const [id, field] = key.split(":"); return <Button key={key} variant="outline" size="sm" onClick={() => { selectNode(id); setJsonConfig(field === "$config"); }}>修正 {id} · {field === "$config" ? "完整 JSON" : fieldLabels[field] ?? field}</Button>; })}</div>}
    {validation && <div className={`pipe-notice ${validation.valid ? "pipe-success" : "pipe-error"}`} role="status">{validation.valid ? <CheckCircle2 /> : <CircleAlert />}<div>{validation.valid ? `校验通过 · ${validation.order.length} 个节点可执行` : <><strong>流程需要调整</strong><ul>{validation.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></>}</div></div>}

    <div className="pipe-development-grid" style={{ gridTemplateColumns: narrow ? "minmax(0, 1fr)" : `${paletteVisible ? "13rem " : ""}minmax(0, 1fr)${rightOpen ? " 20rem" : ""}` }}>
      {!narrow && <aside id={paletteId} hidden={!paletteVisible} className="pipe-palette" aria-label="算子选择器">{operatorPanel}</aside>}
      <div className="pipe-canvas-workspace" role="group" aria-label="流程节点">{draft.graph.nodes.length ? <PipelineCanvas graph={draft.graph} catalog={catalog} selectedNode={selectedNode} onSelect={selectNode} readOnly={!write || busy} onError={setCanvasError} onChange={(graph, recordHistory) => { const ids = new Set(graph.nodes.map((item) => item.id)); setInvalidFields((fields) => Object.fromEntries(Object.entries(fields).filter(([key]) => ids.has(key.split(":")[0])))); setRawFields((fields) => Object.fromEntries(Object.entries(fields).filter(([key]) => ids.has(key.split(":")[0])))); edit(graph, recordHistory); }} /> : <div className="pipe-empty"><GitBranch /><h2>添加第一个算子</h2><p>从算子面板添加节点，连接输入输出并配置参数。</p>{narrow && <Button variant="outline" onClick={() => setDrawer("operators")}>选择算子</Button>}<Link to="/operators" search={{ project_id: projectId }}>前往算子注册</Link></div>}</div>
      {!narrow && <aside id={parametersId} hidden={!rightOpen} className="pipe-parameters" aria-label="节点配置">{parameterPanel}</aside>}
    </div>
    {(dirty || !current) && <p className="pipe-scope-note">运行前请先保存版本。导入会替换当前定义，请先保存未完成的修改。</p>}
    {!write && <PermissionRequestButton projectId={projectId} permission="pipelines:write" label="申请流程编辑权限" />}{!can("pipelines:run") && <PermissionRequestButton projectId={projectId} permission="pipelines:run" label="申请流程运行权限" />}
    <Dialog.Root open={Boolean(drawer && narrow)} onOpenChange={(open) => { if (!open) setDrawer(null); }}><Dialog.Portal><Dialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-40" /><Dialog.Viewport className="pipe-drawer-viewport"><Dialog.Popup id={drawerId} finalFocus={drawerTrigger} className="pipe-editor-drawer"><div className="pipe-section-heading"><Dialog.Title>{drawer === "operators" ? "选择算子" : "配置参数"}</Dialog.Title><Dialog.Close render={<Button size="icon" variant="ghost" />} aria-label="关闭面板"><X /></Dialog.Close></div><Dialog.Description className="sr-only">{drawer === "operators" ? "向当前流程添加节点" : "修改当前节点的参数"}</Dialog.Description>{drawer === "operators" ? operatorPanel : parameterPanel}</Dialog.Popup></Dialog.Viewport></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={metadataOpen} onOpenChange={setMetadataOpen}><Dialog.Portal><Dialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-40" /><Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"><Dialog.Popup className="pipe-dialog pipe-metadata-dialog"><div className="pipe-section-heading"><Dialog.Title>流程信息</Dialog.Title><Dialog.Close render={<Button size="icon" variant="ghost" />} aria-label="关闭流程信息"><X /></Dialog.Close></div><Dialog.Description>名称与说明会随下一个版本保存。</Dialog.Description>{current && <p>流程 ID：{current.id}</p>}<label className="pipe-field"><span>流程名称</span><input aria-label="流程名称" value={draft.name} maxLength={120} disabled={!write || busy} onChange={(event) => { setDraft((value) => ({ ...value, name: event.target.value })); markDirty(); }} /></label><label className="pipe-field"><span>流程说明</span><textarea aria-label="流程说明" value={draft.description} rows={3} maxLength={2000} disabled={!write || busy} onChange={(event) => { setDraft((value) => ({ ...value, description: event.target.value })); markDirty(); }} /></label><Dialog.Close render={<Button variant="ghost" />}>应用到草稿</Dialog.Close></Dialog.Popup></Dialog.Viewport></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={blocker.status === "blocked"} onOpenChange={(open) => { if (!open) blocker.reset?.(); }}><Dialog.Portal><Dialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-40" /><Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center p-4"><Dialog.Popup className="pipe-dialog pipe-metadata-dialog"><Dialog.Title>保留当前修改？</Dialog.Title><Dialog.Description>离开当前流程会丢失尚未保存的修改。</Dialog.Description><div className="pipe-dialog-actions"><Button variant="ghost" onClick={() => blocker.reset?.()}>继续编辑</Button><Button variant="destructive-text" onClick={() => blocker.proceed?.()}>放弃修改并离开</Button></div></Dialog.Popup></Dialog.Viewport></Dialog.Portal></Dialog.Root>
  </section>;
}

export default function PipelinesPage() {
  const { me } = useAuth();
  const search = usePipelineSearch();
  const projectId = search.project_id ?? (me.scope.type === "project" ? me.scope.id : "demo");
  return <ProjectPipelinesPage key={`${me.user.id}:${projectId}`} projectId={projectId} />;
}

export function ProjectPipelinesRoute() {
  const { projectId } = useParams({ from: "/projects/$projectId/pipelines" });
  const { me } = useAuth();
  return <ProjectPipelinesPage key={`${me.user.id}:${projectId}`} projectId={projectId} />;
}

function ProjectPipelinesPage({ projectId }: { projectId: string }) {
  const { me, can } = useProjectAuth(projectId);
  const search = usePipelineSearch();
  const legacyRun = useQuery({ queryKey: ["media-run", projectId, search.runId], queryFn: () => loadMediaRun(projectId, search.runId!), enabled: can("pipelines:read") && Boolean(search.runId && !search.pipelineId) });
  if (!can("pipelines:read")) return <main className="md-page"><h1 className="md-page-title">数据流水线</h1><PermissionRequestButton projectId={projectId} permission="pipelines:read" label="申请流水线访问权限" /></main>;
  const pipelineId = search.pipelineId ?? legacyRun.data?.pipeline_id;
  if (pipelineId) return <PipelineDetail key={`${me.user.id}:${projectId}:${pipelineId}`} projectId={projectId} pipelineId={pipelineId} />;
  if (search.runId) return <main className="md-page"><ErrorNotice error={legacyRun.error} />{legacyRun.isPending && <p className="pipe-loading">正在定位运行所属流程…</p>}</main>;
  if (search.view === "new") return <NewPipeline key={`${me.user.id}:${projectId}:new`} projectId={projectId} />;
  return <PipelineList key={`${me.user.id}:${projectId}`} projectId={projectId} />;
}
````

## apps/web/src/pages/OperatorsPage.tsx

````tsx
import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowRight, CircleAlert, FlaskConical, LoaderCircle, Plus, Puzzle, Search, ShieldCheck, Workflow, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth, useProjectAuth } from "../auth-context";
import { PermissionRequestButton } from "../components/PermissionRequestButton";
import { PluginDevelopmentWorkspace, ReleaseStatus } from "../components/PluginDevelopmentWorkspace";
import { PluginReleasePagination } from "../components/PluginReleasePagination";
import { PluginCapabilities } from "../components/PluginCapabilities";
import { ToolbarSelect } from "../components/ui/period-menu";
import { Badge } from "../components/ui/badge";
import { Button, buttonVariants } from "../components/ui/button";
import { operatorPluginsQueryFor, operatorsQueryFor, registerOperatorPlugin, type OperatorManifest } from "../pipelines-api";
import { activatePluginRelease, pluginReleasesKey, pluginReleasesQuery } from "../plugin-releases-api";
import { useOperatorBasePath, useOperatorSearch } from "../operator-route";
import { interactionForEvent, type InteractionContext } from "../telemetry";
import "./pipelines.css";
import "./plugins.css";

const types: Record<string, string> = { video_assets: "视频资产", shot_assets: "镜头集", frame_assets: "关键帧集", annotated_frames: "已标注关键帧", frame_embeddings: "关键帧向量", shot_index: "镜头索引" };
const operatorCategories = ["数据接入", "解析与切分", "清洗与去重", "质量与筛选", "模型推理与增强", "数据输出", "数据处理"] as const;
const operatorModalities = ["文本", "图像", "音频", "视频", "通用"] as const;
type OperatorCategory = typeof operatorCategories[number];
type OperatorModality = typeof operatorModalities[number];

const categorySignals: { category: OperatorCategory; pattern: RegExp }[] = [
  { category: "解析与切分", pattern: /parse|parser|extract|split|chunk|tokeniz|keyframe|frame.?extract|解析|抽取|提取|切分|分段|分句|分词|关键帧|镜头边界/i },
  { category: "清洗与去重", pattern: /clean|dedup|duplicate|normalize|standardi[sz]|sanitize|清洗|去重|查重|规范化|标准化|纠错/i },
  { category: "质量与筛选", pattern: /quality|filter|score|sample|select|check|validat|detect.?quality|质量|过滤|筛选|评分|采样|校验|检查/i },
  { category: "模型推理与增强", pattern: /embed|embedding|infer|model|llm|vision|caption|describe|classif|detect|recogn|segment(?:ation)?|ocr|augment|synthe|generat|vector|mask|向量|推理|模型|识别|检测|分割|描述|合成|生成|增强/i },
];

function operatorSearchText(operator: OperatorManifest) {
  return `${operator.id} ${operator.name} ${operator.description}`.toLowerCase();
}

function operatorCategory(operator: OperatorManifest): OperatorCategory {
  if (operator.kind === "source") return "数据接入";
  if (operator.kind === "sink") return "数据输出";
  if (operator.kind === "check") return "质量与筛选";
  const identity = `${operator.id} ${operator.name}`.toLowerCase();
  return categorySignals.find(({ pattern }) => pattern.test(identity))?.category
    ?? categorySignals.find(({ pattern }) => pattern.test(operator.description.toLowerCase()))?.category
    ?? "数据处理";
}

function operatorModalitiesFor(operator: OperatorManifest): OperatorModality[] {
  const contract = `${operator.input_type ?? ""} ${operator.output_type ?? ""}`.toLowerCase();
  const description = operatorSearchText(operator);
  const modalities = new Set<OperatorModality>();
  if (/text|document|token|caption|文本|文档|语料/.test(contract) || /\btext\b|文本|文档|语料/.test(description)) modalities.add("文本");
  if (/image|frame|picture|photo|图像|图片|帧/.test(contract) || /\bimage\b|图像|图片|关键帧/.test(description)) modalities.add("图像");
  if (/audio|speech|voice|音频|语音/.test(contract) || /\baudio\b|音频|语音/.test(description)) modalities.add("音频");
  if (/video|shot|clip|视频|镜头/.test(contract) || /\bvideo\b|视频|镜头/.test(description)) modalities.add("视频");
  return modalities.size ? [...modalities] : ["通用"];
}

export default function OperatorsPage({ projectId: routeProjectId }: { projectId?: string }) {
  const { me } = useAuth(); const search = useOperatorSearch(); const navigate = useNavigate();
  const projectId = routeProjectId ?? search.project_id ?? (me.scope.type === "project" ? me.scope.id : "demo");
  const basePath = useOperatorBasePath(projectId);
  const { can } = useProjectAuth(projectId);
  const view = search.view === "development" ? "development" : "project";
  const [developmentVisited, setDevelopmentVisited] = useState(view === "development");
  useEffect(() => { if (view === "development") setDevelopmentVisited(true); }, [view]);
  if (!can("pipelines:read")) return <main className="md-page"><h1 className="md-page-title">算子与插件</h1><PermissionRequestButton projectId={projectId} permission="pipelines:read" label="申请算子库访问权限" /></main>;
  return <main className="md-page pipe-page plugin-page" key={`${me.user.id}:${projectId}`}>
    <div className="pipe-page-heading"><div><h1 className="md-page-title">算子与插件</h1></div><Link to="/projects/$projectId/pipelines" params={{ projectId }} className={buttonVariants({ variant: "ghost", size: "sm" })} data-variant="ghost" data-size="sm"><span className="md-button-container md-state-layer">流水线列表<ArrowRight /></span></Link></div>
    <Tabs.Root className="plugin-workspace-tabs" value={view} onValueChange={(value) => void navigate({ to: basePath, search: { ...(value === "development" ? { view: "development" as const, releaseId: search.releaseId } : {}) } })}>
      <Tabs.List className="pipe-object-tabs" aria-label="算子与插件工作区"><Tabs.Tab value="project"><Puzzle />算子库</Tabs.Tab><Tabs.Tab value="development"><FlaskConical />插件开发</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="project" className="plugin-workspace-panel"><ProjectOperatorLibrary projectId={projectId} /></Tabs.Panel>
      <Tabs.Panel value="development" className="plugin-workspace-panel" keepMounted>{(developmentVisited || view === "development") && <PluginDevelopmentWorkspace projectId={projectId} releaseId={search.releaseId} pluginId={search.pluginId} searchTerm={search.q ?? ""} offset={search.offset ?? 0} />}</Tabs.Panel>
    </Tabs.Root>
  </main>;
}

export function ProjectOperatorsRoute() {
  const { projectId } = useParams({ from: "/projects/$projectId/operators" });
  const { me } = useAuth();
  return <OperatorsPage key={`${me.user.id}:${projectId}`} projectId={projectId} />;
}

function ProjectOperatorLibrary({ projectId }: { projectId: string }) {
  const { me, can } = useProjectAuth(projectId); const client = useQueryClient();
  const basePath = useOperatorBasePath(projectId);
  const [query, setQuery] = useState(""); const [category, setCategory] = useState<OperatorCategory | "全部">("全部"); const [modality, setModality] = useState<OperatorModality | "全部">("全部"); const [open, setOpen] = useState(false); const lock = useRef(false);
  const [releaseQuery, setReleaseQuery] = useState(""); const [releaseSearch, setReleaseSearch] = useState(""); const [releaseOffset, setReleaseOffset] = useState(0);
  const operators = useQuery(operatorsQueryFor(projectId));
  const plugins = useQuery({ ...operatorPluginsQueryFor(projectId), enabled: open });
  const releases = useQuery({ ...pluginReleasesQuery(projectId, { status: "published", q: releaseSearch, offset: releaseOffset }), enabled: open });
  const activate = useMutation({
    mutationFn: async ({ id, release, interaction }: { id: string; release: boolean; interaction?: InteractionContext }) => release ? activatePluginRelease(projectId, id, me.csrf_token, interaction) : registerOperatorPlugin(id, me.csrf_token, projectId, interaction),
    onSettled: async () => { await Promise.allSettled([client.invalidateQueries({ queryKey: operatorsQueryFor(projectId).queryKey }), client.invalidateQueries({ queryKey: operatorPluginsQueryFor(projectId).queryKey }), client.invalidateQueries({ queryKey: pluginReleasesKey(projectId) }), client.invalidateQueries({ queryKey: ["plugin-release", projectId] })]); lock.current = false; },
  });
  const enable = (id: string, release: boolean, interaction?: InteractionContext) => { if (lock.current || activate.isPending) return; lock.current = true; activate.mutate({ id, release, interaction }); };
  const visible = (operators.data ?? []).filter((item) => {
    const matchesQuery = `${item.name} ${item.id} ${item.plugin_id} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesCategory = category === "全部" || operatorCategory(item) === category;
    const modalities = operatorModalitiesFor(item);
    const matchesModality = modality === "全部" || modalities.includes(modality) || (modality !== "通用" && modalities.includes("通用"));
    return matchesQuery && matchesCategory && matchesModality;
  });
  const published = (releases.data?.items ?? []).filter((release) => release.status === "published");
  const installed = (plugins.data ?? []).filter((plugin) => !published.some((release) => release.plugin_id === plugin.id && release.version === plugin.version));
  return <section aria-label="项目算子库">
    <div className="pipe-list-toolbar pipe-operator-toolbar"><label className="pipe-search"><Search /><input aria-label="搜索算子" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索算子名称、ID 或插件" /></label><ToolbarSelect<OperatorCategory | "全部"> label="按功能分类筛选算子" prefix="功能分类" value={category} onChange={setCategory} options={[{value:"全部",label:"全部"},...operatorCategories.map(value=>({value,label:value}))]} /><ToolbarSelect<OperatorModality | "全部"> label="按模态筛选算子" prefix="模态" value={modality} onChange={setModality} options={[{value:"全部",label:"全部"},...operatorModalities.map(value=>({value,label:value}))]} /><span className="pipe-operator-count">{operators.data ? `${visible.length} / ${operators.data.length} 个算子` : "正在读取项目目录"}</span><Button data-track-id="pipelines.plugin.registry.open" data-track-label="打开项目插件启用" onClick={() => { activate.reset(); setOpen(true); }}><Plus />启用插件</Button></div>
    {operators.error && <div className="pipe-notice pipe-error" role="alert"><CircleAlert />{operators.error.message}<Button variant="outline" size="sm" onClick={() => void operators.refetch()}>重试</Button></div>}
    {operators.isPending ? <p className="pipe-loading"><LoaderCircle className="animate-spin" />正在读取算子…</p> : visible.length ? <div className="pipe-operator-grid">{visible.map((operator) => <article className="pipe-operator-card" key={`${operator.id}@${operator.version}`}>
      <div className="pipe-operator-meta"><Workflow /><Badge variant="secondary">{operatorCategory(operator)}</Badge><Badge variant="outline">v{operator.version}</Badge></div><h2>{operator.name}</h2><p>{operator.description}</p><div className="pipe-contract"><span>{operator.input_type ? types[operator.input_type] ?? operator.input_type : "源数据"}</span><ArrowRight /><span>{types[operator.output_type] ?? operator.output_type}</span></div>
      <details><summary>参数与执行契约</summary><p>算子 {operator.id} · v{operator.version}</p><p>插件 {operator.plugin_id} · {operator.side_effects ? "包含外部写入" : operator.deterministic ? "支持结果缓存" : "每次重新计算"}</p><pre>{JSON.stringify(operator.config_schema, null, 2)}</pre></details>
      <Link to="/projects/$projectId/pipelines" params={{ projectId }} search={{ view: "new", operator_id: operator.id, operator_version: operator.version }} className={buttonVariants({ variant: "outline", size: "sm" })} data-variant="outline" data-size="sm"><span className="md-button-container md-state-layer">用于新流水线<ArrowRight /></span></Link>
    </article>)}</div> : !operators.error && <div className="pipe-empty"><Puzzle /><h2>{query || category !== "全部" || modality !== "全部" ? "没有匹配的算子" : "当前项目尚未启用算子"}</h2><p>{query || category !== "全部" || modality !== "全部" ? "调整搜索词或筛选条件后再试。" : "选择预装插件，或启用已发布且环境就绪的版本，开始编排数据处理流程。"}</p>{query || category !== "全部" || modality !== "全部" ? <Button variant="outline" onClick={() => { setQuery(""); setCategory("全部"); setModality("全部"); }}>清除算子筛选</Button> : can("operators:register") ? <Button onClick={() => { activate.reset(); setOpen(true); }} data-track-id="pipelines.plugin.registry.empty" data-track-label="选择插件并启用"><Plus />选择插件并启用</Button> : <PermissionRequestButton projectId={projectId} permission="operators:register" label="申请项目启用权限" />}</div>}
    <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-40" /><Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"><Dialog.Popup className="pipe-dialog plugin-activate-dialog">
      <div className="pipe-section-heading"><div><Dialog.Title>启用插件到项目</Dialog.Title><Dialog.Description>选择用于 {projectId} 项目编排的版本。现有流水线版本保持原有算子快照。</Dialog.Description></div><Dialog.Close render={<Button size="icon" variant="ghost" />} aria-label="关闭插件启用窗口"><X /></Dialog.Close></div>
      {!can("operators:register") && <div className="pipe-notice"><ShieldCheck /><span>当前账号没有项目启用权限，可以查看版本并申请权限。</span><PermissionRequestButton projectId={projectId} permission="operators:register" label="申请项目启用权限" /></div>}
      {[plugins.error, releases.error, activate.error].filter(Boolean).map((error, index) => <div className="pipe-notice pipe-error" role="alert" key={index}><CircleAlert />{error?.message}</div>)}
      <h3>已发布版本</h3>
      <form className="plugin-release-search" onSubmit={(event) => { event.preventDefault(); setReleaseSearch(releaseQuery.trim()); setReleaseOffset(0); }}><label className="pipe-search"><Search /><input aria-label="搜索已发布插件版本" placeholder="插件 ID 或版本" maxLength={200} value={releaseQuery} onChange={(event) => setReleaseQuery(event.target.value)} /></label><Button variant="outline" size="sm" type="submit">搜索</Button></form>
      {releases.isPending ? <p className="pipe-loading">正在读取发布版本…</p> : published.length ? <div className="pipe-registration-list">{published.map((release) => <article className="pipe-plugin-card" key={release.id}><div className="pipe-section-heading"><h3>{release.manifest.name} · {release.version}</h3><ReleaseStatus status={release.deployment_state} /></div><p>{release.manifest.description}</p><small>{release.plugin_id} · {release.manifest.operators.length} 个算子</small><details><summary>查看包含的算子 · {release.manifest.operators.length} 项</summary><PluginCapabilities operators={release.manifest.operators} projectId={projectId} active={release.active} /></details><div className="plugin-actions"><Button variant="secondary" disabled={activate.isPending || !can("operators:register") || release.active || release.deployment_state !== "ready"} data-track-id="plugins.release.activate" data-track-label="启用发布版本到项目" onClick={(event) => enable(release.id, true, interactionForEvent(event.nativeEvent))}>{release.active ? "项目已启用" : "启用到项目"}</Button><Link to={basePath} search={{ project_id: projectId, view: "development", releaseId: release.id }} onClick={() => setOpen(false)} className={buttonVariants({ size: "sm", variant: "ghost" })} data-variant="ghost" data-size="sm"><span className="md-button-container md-state-layer">查看验证记录<ArrowRight /></span></Link></div></article>)}</div> : !releases.error && <p className="plugin-muted">{releaseSearch ? "没有匹配的发布版本，请修改插件 ID 或版本号重新搜索。" : "暂无正式发布版本。可在插件开发创建和验证候选。"}</p>}
      {!releases.error && (!releases.data || releases.data.total > 0 || releaseOffset > 0) && <PluginReleasePagination page={releases.data} offset={releaseOffset} pending={releases.isFetching} onChange={setReleaseOffset} label="发布版本分页" />}
      <h3>平台预装插件</h3><p className="plugin-muted">平台已准备的插件，启用后即可在当前项目使用。</p>
      {plugins.isPending ? <p className="pipe-loading">正在读取预装插件…</p> : installed.length ? <div className="pipe-registration-list">{installed.map((plugin) => <article className="pipe-plugin-card" key={`${plugin.id}@${plugin.version}`}><div className="pipe-section-heading"><h3>{plugin.name}</h3><Badge variant={plugin.registered ? "success" : "outline"}>{plugin.registered ? "项目已启用" : "未启用"}</Badge></div><p>{plugin.description}</p><small>{plugin.id} · v{plugin.version} · {plugin.operators.length} 个算子</small><details><summary>查看包含的算子</summary><ul>{plugin.operators.map((operator) => <li key={operator.id}>{operator.name} · v{operator.version}</li>)}</ul></details>{!plugin.registered && <Button variant="secondary" disabled={activate.isPending || !can("operators:register")} data-track-id="pipelines.plugin.register" data-track-label="启用预装插件到项目" onClick={(event) => enable(plugin.id, false, interactionForEvent(event.nativeEvent))}>{activate.isPending && activate.variables?.id === plugin.id ? <LoaderCircle className="animate-spin" /> : <Plus />}启用到项目</Button>}</article>)}</div> : !plugins.error && <p className="plugin-muted">没有可启用的预装插件。</p>}
    </Dialog.Popup></Dialog.Viewport></Dialog.Portal></Dialog.Root>
  </section>;
}
````

## apps/web/src/components/PipelineCanvas.tsx

````tsx
import { Background, Handle, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider, useReactFlow, useViewport, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { Boxes, Database, GitBranch, LayoutGrid, Minus, Plus, Scan, Workflow } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { OperatorManifest, PipelineGraph, PipelineNode, PipelineTask } from "../pipelines-api";
import { connectPipelineInput, connectionError, operatorInputPorts } from "../pipeline-graph";
export { connectionError } from "../pipeline-graph";
import { Button } from "./ui/button";
import "@xyflow/react/dist/style.css";

type OperatorNode = Node<{ definition: PipelineNode; manifest?: OperatorManifest; task?: PipelineTask; inspecting: boolean; onSelect: () => void }, "operator">;
const taskLabels: Record<string, string> = { pending: "待执行", queued: "排队中", running: "运行中", succeeded: "已完成", cached: "复用缓存", failed: "失败", skipped: "已跳过", interrupted: "已中断", cancelled: "已取消" };
const mediaTypes: Record<string, string> = { video_assets: "视频资产", shot_assets: "镜头集", frame_assets: "关键帧集", annotated_frames: "已标注关键帧", frame_embeddings: "关键帧向量", shot_index: "镜头索引" };

function OperatorCard({ data, selected, isConnectable }: NodeProps<OperatorNode>) {
  const { definition, manifest } = data;
  const ports = Object.entries(operatorInputPorts(manifest));
  return <div className="pipe-canvas-card" data-selected={selected} data-status={data.task?.status}>
    {ports.map(([port, type], index) => <Handle key={port} type="target" position={Position.Top} id={port}
      style={{ left: `${(index + 1) / (ports.length + 1) * 100}%` }} isConnectable={isConnectable}
      role="img" aria-label={`${definition.id} 输入 ${port} ${type}`} />)}
    {manifest?.input_ports && ports.length > 0 && <div className="pipe-canvas-inputs">{ports.map(([port, type]) => <small key={port}>{port} · {mediaTypes[type] ?? type}</small>)}</div>}
    <div className="pipe-canvas-card-heading"><span className={`pipe-node-icon pipe-kind-${manifest?.kind ?? "transform"}`}>{manifest?.kind === "source" ? <Database /> : manifest?.kind === "sink" ? <Boxes /> : <Workflow />}</span><div><strong>{manifest?.name ?? definition.operator}</strong><small>{definition.id} · v{definition.version}</small></div></div>
    <div className="pipe-canvas-card-footer"><span>{mediaTypes[manifest?.output_type ?? ""] ?? manifest?.output_type ?? "未知类型"}</span><button type="button" className="nodrag" aria-label={`${data.inspecting ? "画布检查" : "配置"}节点 ${definition.id}`} aria-pressed={selected} onClick={data.onSelect}>{data.inspecting ? "检查" : "配置"}</button></div>
    {data.task && <div className="pipe-canvas-run-state"><strong>{taskLabels[data.task.status] ?? data.task.status}</strong><small>{data.task.input_count} → {data.task.output_count} 条</small>{data.task.error && <small className="pipe-task-error" title={data.task.error}>{data.task.error}</small>}</div>}
    <Handle type="source" position={Position.Bottom} id="output" isConnectable={isConnectable} role="img" aria-label={`${definition.id} 输出 ${manifest?.output_type ?? "未知"}`} />
  </div>;
}
const nodeTypes = { operator: OperatorCard };

export function layoutPipeline(graph: PipelineGraph, rowHeight = 240): PipelineGraph {
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const node = graph.nodes.find((item) => item.id === id);
    const inputs = Object.values(node?.inputs ?? {}).filter((input) => graph.nodes.some((item) => item.id === input));
    const level = inputs.length ? 1 + Math.max(...inputs.map(depth)) : 0;
    visiting.delete(id); levels.set(id, level); return level;
  };
  const rows = new Map<number, number>();
  return { ...graph, nodes: graph.nodes.map((node) => {
    const level = depth(node.id);
    const column = rows.get(level) ?? 0;
    rows.set(level, column + 1);
    return { ...node, position: { x: column * 290, y: level * rowHeight } };
  }) };
}

interface CanvasProps {
  graph: PipelineGraph; catalog: OperatorManifest[]; selectedNode: string;
    onSelect: (id: string) => void; onChange: (graph: PipelineGraph, recordHistory?: boolean) => void;
  onError: (message: string) => void; readOnly: boolean;
  tasks?: PipelineTask[];
}

function Canvas({ graph, catalog, selectedNode, onSelect, onChange, onError, readOnly, tasks }: CanvasProps) {
  const flow = useReactFlow<OperatorNode>();
  const { zoom } = useViewport();
  const dragging = useRef(false);
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const defaults = useMemo(() => layoutPipeline(graph, tasks ? 300 : 240), [graph, tasks]);
  const nodes: OperatorNode[] = graph.nodes.map((node, index) => ({
    id: node.id, type: "operator", position: !tasks && node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y) ? node.position : defaults.nodes[index].position!,
    selected: node.id === selectedNode, data: { definition: node, manifest: catalog.find((operator) => operator.id === node.operator && operator.version === node.version), task: tasks?.find((task) => task.node_id === node.id), inspecting: Boolean(tasks), onSelect: () => onSelect(node.id) },
  }));
  const edges: Edge[] = graph.nodes.flatMap((node) => Object.entries(node.inputs).filter(([, source]) => graph.nodes.some((item) => item.id === source)).map(([port, source]) => ({ id: `${source}:${node.id}:${port}`, source, target: node.id, sourceHandle: "output", targetHandle: port, type: "smoothstep", label: port, selected: selectedEdges.has(`${source}:${node.id}:${port}`), deletable: !readOnly, style: { stroke: "var(--primary)", strokeWidth: 1.6 }, labelStyle: { fill: "var(--muted-foreground)", fontSize: 11 }, labelBgStyle: { fill: "var(--md-sys-color-surface-container-low)" } })));

  return <div className="pipe-reactflow" role="region" aria-label="可视化流程画布">
    <ReactFlow<OperatorNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView={Boolean(tasks)} fitViewOptions={{ padding: .2 }} defaultViewport={{ x: 40, y: 50, zoom: .85 }} minZoom={.15} maxZoom={1.5} nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]} onNodeClick={(_, node) => onSelect(node.id)} onNodesChange={(changes) => {
      const selected = changes.find((change) => change.type === "select" && change.selected);
      if (selected && "id" in selected) onSelect(selected.id);
      if (readOnly) return;
      const positions = changes.filter((change) => change.type === "position");
      if (positions.length) {
        const moved = positions.some((change) => { const node = graph.nodes.find((item) => item.id === change.id); return change.position && (change.position.x !== node?.position?.x || change.position.y !== node?.position?.y); });
        if (moved) {
          onChange({ ...graph, nodes: graph.nodes.map((node) => { const change = positions.find((item) => item.id === node.id); return change?.position ? { ...node, position: change.position } : node; }) }, !dragging.current);
          dragging.current = positions.some((change) => change.dragging);
        }
        if (positions.every((change) => !change.dragging)) dragging.current = false;
      }
    }} onEdgesChange={(changes) => {
      if (changes.some((change) => change.type === "select" && change.selected)) onSelect("");
      setSelectedEdges((previous) => { const next = new Set(previous); for (const change of changes) { if (change.type === "select") { if (change.selected) next.add(change.id); else next.delete(change.id); } } return next; });
    }} onDelete={({ nodes: removedNodes, edges: removedEdges }) => {
      if (readOnly) return;
      const nodeIds = new Set(removedNodes.map((node) => node.id));
      const edgeIds = new Set(removedEdges.map((edge) => edge.id));
      onChange({ ...graph, nodes: graph.nodes.filter((node) => !nodeIds.has(node.id)).map((node) => ({ ...node, inputs: Object.fromEntries(Object.entries(node.inputs).filter(([port, source]) => !nodeIds.has(source) && !edgeIds.has(`${source}:${node.id}:${port}`))) })) });
      setSelectedEdges(new Set());
      if (nodeIds.has(selectedNode)) onSelect(graph.nodes.find((node) => !nodeIds.has(node.id))?.id ?? "");
    }} isValidConnection={(connection) => !connectionError(graph, catalog, connection)} onConnect={(connection) => {
      if (readOnly) return;
      const error = connectionError(graph, catalog, connection);
      if (error) { onError(error); return; }
      onError(""); onChange(connectPipelineInput(graph, catalog, connection));
    }} onConnectEnd={(_, state) => { if (!state.isValid && state.fromNode && state.toNode) onError(connectionError(graph, catalog, { source: state.fromNode.id, target: state.toNode.id, targetHandle: state.toHandle?.id }) ?? "无法建立连接。"); }}
      onPaneClick={() => { onError(""); onSelect(""); }} onlyRenderVisibleElements={false} ariaLabelConfig={{ "controls.zoomIn.ariaLabel": "放大画布", "controls.zoomOut.ariaLabel": "缩小画布", "controls.fitView.ariaLabel": "适配全部节点", "controls.interactive.ariaLabel": "切换画布交互", "minimap.ariaLabel": "流程缩略图" }}>
      <Background color="var(--border)" gap={18} size={1} /><Panel position="bottom-left" className="pipe-viewport-controls" role="group" aria-label="画布视图控制"><Button variant="ghost" size="icon" aria-label="放大画布" title="放大画布" disabled={zoom >= 1.5} onClick={() => void flow.zoomIn()}><Plus /></Button><Button variant="ghost" size="icon" aria-label="缩小画布" title="缩小画布" disabled={zoom <= .15} onClick={() => void flow.zoomOut()}><Minus /></Button><Button variant="ghost" size="icon" aria-label="适配全部节点" title="适配全部节点" onClick={() => void flow.fitView()}><Scan /></Button></Panel><MiniMap pannable zoomable nodeColor="var(--accent)" nodeStrokeColor="var(--primary)" maskColor="color-mix(in srgb, var(--muted) 65%, transparent)" />
      <Panel position="top-left" className="pipe-canvas-tools"><span><GitBranch />{tasks ? "运行视图 · 点击节点检查" : readOnly ? "流程视图 · 点击节点检查" : "拖拽节点 · 从端口连线"}</span>{!readOnly && <Button variant="outline" size="sm" onClick={() => { onChange(layoutPipeline(graph)); window.setTimeout(() => void flow.fitView({ padding: .15, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200 }), 40); }}><LayoutGrid />自动排布</Button>}</Panel>
    </ReactFlow>
  </div>;
}

export function PipelineCanvas(props: CanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
````

## apps/web/src/pipeline-graph.ts

````typescript
import type { OperatorManifest, PipelineGraph } from "./pipelines-api";

/** The same port fallback used by backend graph validation and execution. */
export function operatorInputPorts(operator?: OperatorManifest): Record<string, string> {
  if (!operator || operator.kind === "source") return {};
  if (operator.input_ports && Object.keys(operator.input_ports).length) return operator.input_ports;
  return operator.input_type ? { data: operator.input_type } : {};
}

export interface PipelineConnection { source: string | null; target: string | null; targetHandle?: string | null }

function targetPort(graph: PipelineGraph, catalog: OperatorManifest[], connection: PipelineConnection): string | undefined {
  if (connection.targetHandle) return connection.targetHandle;
  const node = graph.nodes.find((item) => item.id === connection.target);
  const ports = Object.keys(operatorInputPorts(catalog.find((item) => item.id === node?.operator && item.version === node?.version)));
  return ports.length === 1 ? ports[0] : undefined;
}

export function connectionError(graph: PipelineGraph, catalog: OperatorManifest[], connection: PipelineConnection): string | null {
  const source = graph.nodes.find((node) => node.id === connection.source);
  const target = graph.nodes.find((node) => node.id === connection.target);
  if (!source || !target) return "连接的节点不存在。";
  if (source.id === target.id) return "节点不能连接到自身。";
  const sourceOp = catalog.find((operator) => operator.id === source.operator && operator.version === source.version);
  const targetOp = catalog.find((operator) => operator.id === target.operator && operator.version === target.version);
  if (!sourceOp || !targetOp) return "请先注册节点使用的算子插件。";
  if (sourceOp.kind === "sink") return "数据输出算子不能连接下游节点。";
  const ports = operatorInputPorts(targetOp);
  if (!Object.keys(ports).length) return "数据源算子不接受上游输入。";
  const port = targetPort(graph, catalog, connection);
  if (!port) return "请选择要连接的输入端口。";
  if (!Object.hasOwn(ports, port)) return `输入端口不存在：${port}。`;
  if (sourceOp.output_type !== ports[port]) return `类型不匹配：${sourceOp.output_type} → ${ports[port]}。`;
  const visited = new Set<string>();
  const isUpstream = (id: string): boolean => {
    if (id === target.id) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return Object.values(graph.nodes.find((node) => node.id === id)?.inputs ?? {}).some(isUpstream);
  };
  return isUpstream(source.id) ? "这条连接会形成循环依赖。" : null;
}

/** Replace only the selected port; other inputs and node configuration survive. */
export function connectPipelineInput(graph: PipelineGraph, catalog: OperatorManifest[], connection: PipelineConnection): PipelineGraph {
  const port = targetPort(graph, catalog, connection);
  if (!port || !connection.source || connectionError(graph, catalog, connection)) return graph;
  return { ...graph, nodes: graph.nodes.map((node) => node.id === connection.target
    ? { ...node, inputs: { ...node.inputs, [port]: connection.source! } } : node) };
}
````

## apps/web/src/pipeline-schema.ts

````typescript
import type { JsonSchema } from "./pipelines-api";

/** Resolve local JSON pointers for rendering; server validation remains authoritative. */
export function resolveSchema(schema: JsonSchema, root: JsonSchema, seen = new Set<string>()): JsonSchema {
  let resolved = { ...schema };
  if (schema.$ref) {
    const reference = schema.$ref;
    if (!reference.startsWith("#/")) throw new Error("表单仅支持本地 JSON Pointer 引用，请使用 JSON 编辑参数。");
    if (seen.has(reference)) throw new Error("参数包含递归引用，请使用 JSON 编辑参数。");
    let target: unknown = root;
    for (const encoded of reference.slice(2).split("/")) {
      const key = decodeURIComponent(encoded).replace(/~1/g, "/").replace(/~0/g, "~");
      if (!target || typeof target !== "object" || !Object.prototype.hasOwnProperty.call(target, key)) {
        throw new Error(`无法解析参数引用 ${reference}，请检查插件定义。`);
      }
      target = (target as Record<string, unknown>)[key];
    }
    if (!target || typeof target !== "object" || Array.isArray(target)) throw new Error("参数引用必须指向一个 Schema 对象。");
    const next = new Set(seen); next.add(reference);
    const { $ref: _, ...siblings } = schema;
    resolved = mergeSchema(resolveSchema(target as JsonSchema, root, next), siblings);
  }
  if (resolved.allOf) {
    const { allOf, ...own } = resolved;
    resolved = allOf.reduce((result, item) => mergeSchema(result, resolveSchema(item, root, seen)), own);
  }
  return resolved;
}

function mergeSchema(base: JsonSchema, extra: JsonSchema): JsonSchema {
  return { ...base, ...extra,
    ...(base.properties || extra.properties ? { properties: { ...base.properties, ...extra.properties } } : {}),
    ...(base.required || extra.required ? { required: [...new Set([...(base.required ?? []), ...(extra.required ?? [])])] } : {}),
  };
}

export function fieldSchema(schema: JsonSchema, root: JsonSchema): { schema: JsonSchema; nullable: boolean; type?: string } {
  const resolved = resolveSchema(schema, root);
  const alternatives = (resolved.anyOf ?? resolved.oneOf ?? []).map((item) => resolveSchema(item, root));
  const types = Array.isArray(resolved.type) ? resolved.type : [resolved.type];
  const nullable = types.includes("null") || alternatives.some((item) => item.type === "null");
  const choice = alternatives.find((item) => item.type !== "null");
  const selected = choice ? mergeSchema(resolved, choice) : resolved;
  const type = Array.isArray(selected.type) ? selected.type.find((item) => item !== "null") : selected.type;
  return { schema: selected, nullable, type };
}
````

## apps/web/src/components/PipelineDebugControls.tsx

````tsx
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Play, ShieldCheck } from "lucide-react";
import { ApiError } from "../auth-api";
import { planPipelineRun, runPipeline, type PipelineExecutionPlan, type PipelineRun, type PipelineRunOptions } from "../pipelines-api";
import { Button } from "./ui/button";
type DebugIntent = { key: string; options: PipelineRunOptions; useCache: boolean; plan: PipelineExecutionPlan };

export function ExecutionPlanSummary({ plan }: { plan: PipelineExecutionPlan }) {
  return <section className="pipe-plan-summary" aria-label="不可变执行计划">
    <h3>{plan.mode === "debug" ? "小样本调试计划" : "正式执行计划"} · v{plan.version}</h3>
    <p>目标：{plan.targets.join("、") || "完整流程"} · 执行 {plan.node_ids.length} 个节点</p>
    <p>依赖顺序：{plan.node_ids.join(" → ")}</p>
    <dl className="pipe-metadata"><div><dt>流程语义指纹</dt><dd title={plan.semantic_digest}>{plan.semantic_digest.slice(0, 16)}</dd></div><div><dt>执行计划指纹</dt><dd title={plan.plan_digest}>{plan.plan_digest.slice(0, 16)}</dd></div></dl>
    {plan.sample.sources.map((source) => <details key={source.node_id}><summary>固定输入 · {source.node_id} · {source.record_count} 条</summary><p>内容指纹：{source.content_hash}</p><p>样本 ID：{source.record_ids.join("、") || "无样本"}</p></details>)}
    {plan.warnings.map((warning, index) => <p key={index} className="pipe-scope-note">{warning}</p>)}
  </section>;
}

export function PipelineDebugControls({ projectId, pipelineId, version, nodeId, csrf, disabledReason, target, useCache, onRunCreated }: {
  projectId: string; pipelineId?: string; version?: number; nodeId: string; csrf: string;
  disabledReason?: string; target: PipelineRunOptions; useCache: boolean; onRunCreated: (run: PipelineRun) => void;
}) {
  const sampleErrorId = useId();
  const [sampleLimit, setSampleLimit] = useState(20);
  const [plan, setPlan] = useState<PipelineExecutionPlan | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [intentError, setIntentError] = useState("");
  const intent = useRef<DebugIntent | null>(null);
  const locked = useRef(false);
  const storageKey = `pipeline-debug-submit:${projectId}:${pipelineId}:${version}`;
  useEffect(() => {
    intent.current = null; setUncertain(false); setIntentError("");
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as DebugIntent | null;
      if (saved) {
        if (typeof saved.key !== "string" || saved.options?.mode !== "debug" || saved.plan?.version !== version || !saved.options.plan_digest || typeof saved.useCache !== "boolean") { setIntentError("上次调试提交信息不完整，请先在运行记录中确认原运行。"); return; }
        intent.current = saved; setPlan(saved.plan); setSampleLimit(saved.plan.sample.limit ?? 20); setUncertain(true);
      }
    } catch { setIntentError("无法恢复上次调试提交，请先在运行记录中确认原运行。"); }
  }, [storageKey, version]);
  useEffect(() => { if (!intent.current) setPlan(null); }, [nodeId, sampleLimit, target.environment_id, target.worker_pool_id, useCache, disabledReason]);
  const options: PipelineRunOptions = { ...target, mode: "debug", targets: [nodeId], sample_limit: sampleLimit, use_cache: useCache };
  const contextKey = JSON.stringify({ projectId, pipelineId, version, nodeId, sampleLimit, target, useCache, disabledReason });
  const currentContext = useRef(contextKey); currentContext.current = contextKey;
  const preflight = useMutation({ mutationFn: async (context: string) => ({ context, plan: await planPipelineRun(projectId, pipelineId!, version!, options, csrf) }), onSuccess: (result) => { if (result.context === currentContext.current) setPlan(result.plan); } });
  const submit = useMutation({ retry: false, mutationFn: () => {
    const saved = intent.current!;
    return runPipeline(pipelineId!, version!, saved.useCache, csrf, projectId, saved.key, undefined, saved.options);
  }, onSuccess: (run) => {
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ } intent.current = null; setUncertain(false); onRunCreated(run);
  }, onError: (error) => {
    // Definitive validation errors create no run; transport/server failures retain the same intent.
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
      try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ } intent.current = null; setUncertain(false); setPlan(null);
    } else setUncertain(true);
  }, onSettled: () => { locked.current = false; } });
  const reason = disabledReason || intentError || (!pipelineId || !version ? "请先保存流水线版本，再调试所选节点。" : !nodeId && !uncertain ? "先在画布选择目标节点。" : "");
  const invalidSample = !Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 100;
  const busy = preflight.isPending || submit.isPending;
  function start() {
    if (locked.current || busy || reason || (!plan && !intent.current)) return;
    locked.current = true;
    intent.current ??= { key: crypto.randomUUID(), options: { ...options, plan_digest: plan!.plan_digest }, useCache, plan: plan! };
    try { sessionStorage.setItem(storageKey, JSON.stringify(intent.current)); } catch { /* The ref still protects an uncertain submission in this page. */ }
    submit.mutate();
  }
  return <section className="pipe-debug-controls" aria-label="节点小样本调试">
    <h3><ShieldCheck className="size-4" />小样本调试</h3><p>仅执行所选目标及其依赖；调试产物不能发布为数据集版本。</p>
    <label className="pipe-field"><span>每个来源的样本上限</span><input aria-label="调试样本条数" aria-invalid={invalidSample} aria-describedby={invalidSample ? sampleErrorId : undefined} type="number" min={1} max={100} value={Number.isNaN(sampleLimit) ? "" : sampleLimit} disabled={busy || uncertain} onChange={(event) => { setSampleLimit(event.target.value === "" ? NaN : Number(event.target.value)); preflight.reset(); submit.reset(); }} /></label>
    {reason && <p className="pipe-scope-note">{reason}</p>}{invalidSample && <p id={sampleErrorId} role="alert" className="text-destructive">样本条数需要为 1 到 100 的整数。</p>}
    {uncertain && <p role="status">上次调试提交结果未确认。重试将使用原目标、样本与请求标识。</p>}
    <div className="pipe-debug-actions"><Button size="sm" variant="outline" disabled={busy || uncertain || Boolean(reason) || invalidSample} onClick={() => { submit.reset(); setPlan(null); preflight.mutate(contextKey); }}>{preflight.isPending && <LoaderCircle className="animate-spin" />}预检调试计划</Button>
      <Button size="sm" disabled={busy || Boolean(reason) || (!uncertain && (invalidSample || !plan))} onClick={start}>{submit.isPending ? <LoaderCircle className="animate-spin" /> : <Play />}{uncertain ? "重试同次调试提交" : "运行到此节点"}</Button></div>
    {(preflight.error || submit.error) && <p className="pipe-task-error" role="alert">{(preflight.error ?? submit.error)?.message}</p>}
    {plan && !reason && <ExecutionPlanSummary plan={plan} />}
  </section>;
}
````

## apps/web/src/components/PipelineDeployments.tsx

````tsx
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useProjectAuth } from "../auth-context";
import { createDeployment, deploymentsQueryFor, pauseDeployment, triggerDeployment, type PipelineDeployment } from "../deployments-api";
import { projectEnvironmentsQueryFor } from "../platform-api";
import type { Pipeline } from "../pipelines-api";
import { Button } from "./ui/button";

export function PipelineDeployments(props: { projectId: string; pipeline: Pipeline; onRunCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return <section className="pipe-artifact" aria-label="生产部署"><details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>生产部署与触发</summary>{open && <DeploymentContent {...props} />}
  </details></section>;
}

function DeploymentContent({ projectId, pipeline, onRunCreated }: { projectId: string; pipeline: Pipeline; onRunCreated: (id: string) => void }) {
  const { me, can } = useProjectAuth(projectId);
  const client = useQueryClient();
  const deployments = useQuery({ ...deploymentsQueryFor(projectId, pipeline.id), refetchInterval: 10_000 });
  const environments = useQuery(projectEnvironmentsQueryFor(projectId));
  const [name, setName] = useState("");
  const [version, setVersion] = useState(pipeline.version);
  const [kind, setKind] = useState<PipelineDeployment["trigger_kind"]>("manual");
  const [interval, setInterval] = useState(3600);
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [first, setFirst] = useState("");
  const [environment, setEnvironment] = useState("");
  const [pool, setPool] = useState("");
  const configErrorId = useId();
  const [configs, setConfigs] = useState("{}");
  const eventKeys = useRef<Record<string, string>>({});
  let parsed: Record<string, Record<string, unknown>> = {}, configError = "";
  try { const value: unknown = JSON.parse(configs); if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new Error(); parsed = value as typeof parsed; } catch { configError = "配置需为节点 ID 到配置对象的 JSON。"; }
  const refresh = () => client.invalidateQueries({ queryKey: deploymentsQueryFor(projectId, pipeline.id).queryKey });
  const create = useMutation({ mutationFn: () => createDeployment(projectId, me.csrf_token, {
    name: name.trim(), pipeline_id: pipeline.id, pipeline_version: version, trigger_kind: kind, timezone,
    ...(kind === "interval" ? { interval_seconds: interval, ...(first.trim() ? { first_trigger_at: first.trim() } : {}) } : {}),
    ...(environment ? { environment_id: environment, ...(pool ? { worker_pool_id: pool } : {}) } : {}), input_configs: parsed,
  }), onSuccess: () => { setName(""); void refresh(); } });
  const state = useMutation({ mutationFn: (row: PipelineDeployment) => pauseDeployment(projectId, me.csrf_token, row.id, !row.paused), onSuccess: () => void refresh() });
  const trigger = useMutation({ mutationFn: (row: PipelineDeployment) => {
    eventKeys.current[row.id] ??= crypto.randomUUID();
    return triggerDeployment(projectId, me.csrf_token, row.id, eventKeys.current[row.id]);
  }, onSuccess: (result, row) => { delete eventKeys.current[row.id]; onRunCreated(result.run_id); void refresh(); } });
  const busy = create.isPending || state.isPending || trigger.isPending;
  const error = deployments.error ?? create.error ?? state.error ?? trigger.error;
  const selectedEnvironment = environments.data?.find((row) => row.id === environment);
  const labelTime = (value: string, zone: string) => new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`).toLocaleString("zh-CN", { timeZone: zone });
  return <div className="mt-4 space-y-4">
    <p>每次部署固定流程版本、节点配置和执行资源。暂停会停止新的触发；正在执行的运行继续完成。</p>
    {error && <p role="alert" className="text-destructive">{error.message}</p>}
    <div className="pipe-section-heading"><h3>已保存部署</h3><Button size="sm" variant="outline" disabled={deployments.isFetching} onClick={() => void deployments.refetch()}>刷新部署</Button></div>
    {deployments.isPending ? <p>正在读取部署…</p> : deployments.data?.length ? <div className="pipe-directory"><table><thead><tr><th>部署</th><th>触发方式</th><th>下一次触发</th><th>操作</th></tr></thead><tbody>{deployments.data.map((row) => <tr key={row.id}>
      <td>{row.name} · r{row.revision}<p>流程 v{row.pipeline_version} · {row.paused ? "已暂停" : "启用中"}</p>{row.last_error && <p role="alert" className="text-destructive">{row.last_error}</p>}</td>
      <td>{row.trigger_kind === "interval" ? `每 ${row.interval_seconds} 秒` : row.trigger_kind === "data" ? `数据到达${row.webhook_enabled ? " · webhook 已配置" : " · webhook 尚未配置"}` : "手动"}<p>{row.timezone}</p></td>
      <td>{row.next_trigger_at ? labelTime(row.next_trigger_at, row.timezone) : "—"}</td><td><div className="flex gap-2">{can("pipelines:write") && <Button size="sm" variant="outline" disabled={busy} onClick={() => state.mutate(row)}>{row.paused ? "启用" : "暂停"}</Button>}{can("pipelines:run") && <Button size="sm" disabled={busy || row.paused} onClick={() => trigger.mutate(row)}>手动触发</Button>}</div></td>
    </tr>)}</tbody></table></div> : <p>当前流程尚无生产部署。</p>}
    {can("pipelines:write") && can("pipelines:run") && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!configError && !busy) create.mutate(); }}>
      <h3>创建部署修订</h3><div className="grid gap-3 md:grid-cols-2">
        <label className="pipe-field"><span>部署名称</span><input disabled={busy} aria-label="部署名称" required value={name} onChange={(event) => setName(event.target.value)} maxLength={160} /></label>
        <label className="pipe-field"><span>固定流程版本</span><select disabled={busy} aria-label="部署流程版本" value={version} onChange={(event) => setVersion(Number(event.target.value))}>{(pipeline.versions ?? [{ version: pipeline.version }]).map((row) => <option key={row.version} value={row.version}>v{row.version}</option>)}</select></label>
        <label className="pipe-field"><span>触发方式</span><select disabled={busy} aria-label="部署触发方式" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="manual">手动</option><option value="interval">固定间隔</option><option value="data">数据到达</option></select></label>
        <label className="pipe-field"><span>时区</span><input disabled={busy} aria-label="部署时区" required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
        {kind === "interval" && <><label className="pipe-field"><span>间隔秒数（最少 60）</span><input disabled={busy} aria-label="部署间隔秒数" type="number" min={60} max={31536000} required value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></label><label className="pipe-field"><span>首次触发（含时区偏移，可留空）</span><input disabled={busy} aria-label="部署首次触发" value={first} placeholder="2026-10-01T09:00:00+08:00" onChange={(event) => setFirst(event.target.value)} /></label></>}
        <label className="pipe-field"><span>执行环境</span><select disabled={busy} aria-label="部署执行环境" value={environment} onChange={(event) => { setEnvironment(event.target.value); setPool(""); }}><option value="">本地执行</option>{environments.data?.map((row) => <option key={row.id} value={row.id}>{row.name} · r{row.revision}</option>)}</select></label>
        {environment && <label className="pipe-field"><span>Worker Pool</span><select disabled={busy} aria-label="部署资源池" value={pool} onChange={(event) => setPool(event.target.value)}><option value="">默认可用资源池</option>{selectedEnvironment?.worker_pools.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.resource_kind}</option>)}</select></label>}
      </div><label className="pipe-field"><span>节点配置覆写（JSON）</span><textarea disabled={busy} aria-label="部署节点配置" aria-invalid={Boolean(configError)} aria-describedby={configError ? configErrorId : undefined} rows={3} value={configs} onChange={(event) => setConfigs(event.target.value)} placeholder={'{"source":{"urls":[]}}'} /></label>{configError && <p id={configErrorId} role="alert" className="text-destructive">{configError}</p>}
      {kind === "interval" && <p>间隔从首次触发时间开始按经过秒数计算；调度停机后合并错过的触发，可通过分区补跑恢复指定批次。</p>}
      {kind === "data" && <p>数据到达 webhook 的凭据由服务端配置。此处只保存部署；可先手动触发验证流程。</p>}
      <Button type="submit" disabled={busy || Boolean(configError) || !name.trim()}>{create.isPending ? "正在保存…" : "保存不可变部署"}</Button>
    </form>}
  </div>;
}
````

## apps/web/src/components/TextPipelineTemplate.tsx

````tsx
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { registerOperatorPlugin, savePipeline, type Pipeline } from "../pipelines-api";
import { Button } from "./ui/button";

export function TextPipelineTemplate({ projectId, csrf, canRegister, onCreated }: { projectId: string; csrf: string; canRegister: boolean; onCreated: (pipeline: Pipeline) => void }) {
  const [text, setText] = useState("用于流水线调试的第一条固定文档\n第二条固定文档");
  const lock = useRef(false);
  const create = useMutation({ mutationFn: async () => {
    const plugin = await registerOperatorPlugin("documents.core", csrf, projectId);
    const source = plugin.operators.find((item) => item.id === "documents.inline");
    const filter = plugin.operators.find((item) => item.id === "documents.filter");
    if (!source || !filter) throw new Error("文本算子尚不可用，请检查服务端版本。");
    const records = text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => ({ id: `sample-${index + 1}`, text: line, metadata: {} }));
    return savePipeline({ name: "文本小样本流水线", description: "固定内联文档 → 文本过滤 → 候选数据集", graph: { nodes: [
      { id: "documents", operator: source.id, version: source.version, config: { ...source.default_config, records }, inputs: {} },
      { id: "filter", operator: filter.id, version: filter.version, config: filter.default_config, inputs: { data: "documents" } },
    ] } }, csrf, undefined, projectId);
  }, onSuccess: onCreated, onSettled: () => { lock.current = false; } });
  return <section className="pipe-template-form"><h2>固定文档 → 文本过滤</h2><p>文档随流水线版本保存。创建后可选择过滤节点进行小样本调试，确认结果后启动正式运行并导入候选数据集。</p>
    <label className="pipe-field"><span>固定输入文档（每行一条）</span><textarea aria-label="固定输入文档" rows={6} value={text} disabled={create.isPending} onChange={(event) => setText(event.target.value)} /></label>
    {create.error && <p className="pipe-task-error" role="alert">{create.error.message}</p>}
    <Button disabled={!canRegister || create.isPending || !text.trim()} onClick={() => { if (lock.current) return; lock.current = true; create.mutate(); }}>{create.isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}创建文本流程</Button>
    {!canRegister && <p className="pipe-scope-note">创建模板需要算子注册权限。</p>}
    <p className="pipe-scope-note">第一阶段仅支持固定内联文档的小样本调试；媒体流程继续使用正式运行。</p>
  </section>;
}
````

## apps/web/src/components/ExecutionSelection.tsx

````tsx
import { Popover } from "@base-ui/react/popover";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { projectEnvironmentsQueryFor } from "../platform-api";
import { Button } from "./ui/button";
export interface ExecutionTarget {environment_id?:string;worker_pool_id?:string}
export function ExecutionSelection({projectId,value,onChange,disabled}:{projectId:string;value:ExecutionTarget;onChange:(value:ExecutionTarget)=>void;disabled:boolean}){
 const [open,setOpen]=useState(false);const environments=useQuery({...projectEnvironmentsQueryFor(projectId),enabled:open});
 const environment=environments.data?.find(row=>row.id===value.environment_id);
 return <Popover.Root open={open} onOpenChange={setOpen}>
  <Popover.Trigger disabled={disabled} render={<Button size="sm" variant="outline" />}>执行环境{value.environment_id?" · 已选择":" · 本地默认"}</Popover.Trigger>
  <Popover.Portal><Popover.Positioner sideOffset={8} align="end" className="pipe-execution-positioner"><Popover.Popup aria-label="运行执行目标" className="pipe-execution-selection-panel">
   <label className="pipe-field"><span>执行环境</span><select aria-label="运行执行环境" disabled={disabled} value={value.environment_id??""} onChange={e=>onChange(e.target.value?{environment_id:e.target.value}:{})}><option value="">本地默认环境</option>{environments.data?.filter(row=>row.status!=="disabled").map(row=><option key={row.id} value={row.id}>{row.name} · r{row.revision}</option>)}</select></label>
   <label className="pipe-field"><span>Worker 资源池</span><select aria-label="运行 Worker 资源池" disabled={disabled||!environment} value={value.worker_pool_id??""} onChange={e=>onChange({...value,worker_pool_id:e.target.value||undefined})}><option value="">自动选择兼容资源池</option>{environment?.worker_pools.filter(pool=>pool.status!=="disabled"&&pool.runtime.status!=="disabled").map(pool=><option key={pool.id} value={pool.id}>{pool.name} · {pool.resource_kind} · {pool.runtime.cpu_arch}</option>)}</select></label>
   {environments.isPending&&<p role="status">正在读取执行环境…</p>}
   <p>目标与运行提交一起冻结；没有健康执行目标时保持排队。对象连接源必须选择已获授的环境。</p>
   {environments.error&&<p role="alert" className="text-destructive">{environments.error.message}</p>}
  </Popover.Popup></Popover.Positioner></Popover.Portal>
 </Popover.Root>;
}
````

## apps/web/src/components/ArtifactDatasetActions.tsx

````tsx
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useProjectAuth } from "../auth-context";
import { ApiError } from "../auth-api";
import { importArtifactDataset } from "../pipelines-api";
import { Button } from "./ui/button";

export function ArtifactDatasetActions({ projectId, artifactId, nodeId, debug, succeeded, recordCount }: { projectId: string; artifactId: string; nodeId: string; debug: boolean; succeeded: boolean; recordCount?: number }) {
  const { me, can } = useProjectAuth(projectId);
  const [name, setName] = useState(`${nodeId} 候选数据集`);
  const intent = useRef<{ name: string } | null>(null);
  const lock = useRef(false);
  const storageKey = `pipeline-artifact-dataset:${projectId}:${artifactId}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as { name?: string; pending?: boolean } | null;
      if (typeof saved?.name === "string") { setName(saved.name); if (saved.pending) intent.current = { name: saved.name }; }
    } catch { /* Storage may be disabled. */ }
  }, [storageKey]);
  const imported = useMutation({ retry: false, mutationFn: () => importArtifactDataset(projectId, artifactId, intent.current!.name, me.csrf_token), onSuccess: () => {
    // The server derives a stable identity from artifact content, mapping and name.
    // Keep the last name across reloads while allowing a distinct named candidate.
    try { sessionStorage.setItem(storageKey, JSON.stringify({ name: intent.current!.name, pending: false })); } catch { /* Storage may be disabled. */ }
    intent.current = null;
  }, onError: (error) => {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) { intent.current = null; try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ } }
  }, onSettled: () => { lock.current = false; } });
  if (debug) return <p className="pipe-scope-note">调试产物仅用于检查。请启动正式运行后导入候选数据集。</p>;
  if (!succeeded) return <p className="pipe-scope-note">正式运行成功后才能导入候选数据集。</p>;
  if (recordCount !== undefined && recordCount > 1000) return <p className="pipe-scope-note">同步导入最多支持 1,000 条记录；此产物有 {recordCount.toLocaleString("zh-CN")} 条。请先使用流水线过滤输出范围，再导入候选数据集。</p>;
  if (!can("data_platform:write")) return <p className="pipe-scope-note">导入候选数据集需要数据集编辑权限。</p>;
  const data = imported.data;
  return <section className="pipe-dataset-actions" aria-label="候选数据集交付">
    {data ? <><p role="status">{data.created ? "已导入候选数据集" : "已找到此前导入的候选数据集"}。候选仍需划分、标注审核与质量检查。</p>
      <p className="pipe-scope-note">来源运行：{data.source.run_id} · 产物：{data.source.artifact_id} · 映射：{data.source.mapping_version}</p>
      <p>{data.quality_report.passed ? "当前质量检查通过，可到数据集页面发布版本。" : "质量门禁待处理，请在数据集页面查看具体问题。"}</p>
      {data.quality_report.issues?.slice(0, 5).map((issue, index) => <p key={index} className="pipe-scope-note">{issue.message ?? issue.code}</p>)}
      <Link to="/projects/$projectId/datasets/$datasetId" params={{ projectId, datasetId: data.dataset_id }}>查看质量并发布数据集版本 →</Link>
      <Button size="sm" variant="ghost" onClick={() => imported.reset()}>导入另一个候选</Button>
    </> : <><label className="pipe-field"><span>候选数据集名称</span><input aria-label="候选数据集名称" value={name} maxLength={120} disabled={imported.isPending || Boolean(intent.current)} onChange={(event) => setName(event.target.value)} /></label>
      <p className="pipe-scope-note">同步导入最多支持 1,000 条记录，导入完整产物。</p>
      <Button size="sm" variant="outline" disabled={imported.isPending || !name.trim()} onClick={() => { if (lock.current) return; lock.current = true; intent.current ??= { name: name.trim() }; try { sessionStorage.setItem(storageKey, JSON.stringify({ name: intent.current.name, pending: true })); } catch { /* The ref preserves this page's intent. */ } imported.mutate(); }}>{imported.isPending && <LoaderCircle className="animate-spin" />}导入候选数据集</Button></>}
    {imported.error && <p className="pipe-task-error" role="alert">{imported.error.message}</p>}
  </section>;
}
````

## apps/web/src/components/TaskProgress.tsx

````tsx
import type { PipelineTask } from "../pipelines-api";
import { Progress } from "./ui/progress";
import "./task-progress.css";

const unitLabels: Record<string, string> = { frame: "帧", frames: "帧", shot: "个镜头", shots: "个镜头", video: "个视频", videos: "个视频", record: "条", records: "条" };

export function TaskProgress({ task }: { task: PipelineTask }) {
  const progress = task.progress;
  if (!progress || !Number.isFinite(progress.completed) || !Number.isFinite(progress.total) || progress.completed < 0 || progress.total < 0) return null;
  const count = `${progress.completed} / ${progress.total} ${unitLabels[progress.unit] ?? progress.unit}`.trim();
  const timestamp = progress.last_progress_at ? new Date(progress.last_progress_at) : null;
  const validTime = timestamp && Number.isFinite(timestamp.getTime());
  const value = Math.min(progress.completed, progress.total);
  return <div className="task-progress">
    <div className="task-progress-count"><span>{progress.source === "artifact_files" ? "已生成" : "已处理"}</span><strong>{count}</strong></div>
    {progress.total > 0 && <Progress className="task-progress-track" aria-label={`${task.node_id} 处理进度`} min={0} max={progress.total} value={value} aria-valuetext={count} />}
    <p className="task-progress-time">{validTime ? <>最近产物：<time dateTime={progress.last_progress_at!} title={timestamp.toLocaleString("zh-CN", { timeZoneName: "short" })}>{timestamp.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</time></> : progress.completed === 0 ? "等待首个产物" : "最近产物时间暂不可用"}</p>
  </div>;
}
````

## apps/web/src/components/TaskRecordCounts.tsx

````tsx
import type { PipelineTask } from "../pipelines-api";

export const TASK_RECORD_COUNTS_HELP = "输入/输出统计节点的记录数；未检出人物的关键帧也会保留，数量不代表人物数。节点完成后更新输出，处理进度单独显示已生成的产物。";

export function TaskRecordCounts({ task }: { task: PipelineTask }) {
  const input = Number.isFinite(task.input_count) ? task.input_count : "—";
  const output = Number.isFinite(task.output_count) ? task.output_count : "—";
  if (task.status === "succeeded" || task.status === "cached") return <span className="task-record-counts">{input} → {output} 条</span>;
  const waiting = ["pending", "queued", "running", "cancelling"].includes(task.status);
  return <span className="task-record-counts">输入 {input} 条 · {typeof output === "number" && output > 0 ? `已提交输出 ${output} 条` : waiting ? "输出待完成" : "输出未完成"}</span>;
}
````

## apps/web/src/components/PluginDevelopmentWorkspace.tsx

````tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, CircleAlert, Download, FlaskConical, LoaderCircle, Package, Play, Plus, RefreshCw, Rocket, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProjectAuth } from "../auth-context";
import { operatorPluginsQueryFor, operatorsQueryFor } from "../pipelines-api";
import { useOperatorBasePath } from "../operator-route";
import { activatePluginRelease, createPluginRelease, downloadPluginTemplate, pluginReleaseQuery, pluginReleasesKey, pluginReleasesQuery, pluginValidationsQuery, publishPluginRelease, validatePluginRelease, type PluginRelease, type PluginReleaseUpload, type PluginValidation } from "../plugin-releases-api";
import { interactionForEvent, type InteractionContext } from "../telemetry";
import { PermissionRequestButton } from "./PermissionRequestButton";
import { PluginCandidateForm } from "./PluginCandidateForm";
import { PluginValidationReport } from "./PluginValidationReport";
import { PluginReleasePagination } from "./PluginReleasePagination";
import { PluginCapabilities } from "./PluginCapabilities";
import { Badge } from "./ui/badge";
import { statusVariant } from "../lib/status-variant";
import { Button, buttonVariants } from "./ui/button";

export const releaseLabels: Record<string, string> = { candidate: "候选版本", validating: "验证中", validated: "验证通过", validation_failed: "验证未通过", published: "已发布", queued: "等待验证", running: "验证中", passed: "通过", failed: "失败", blocked: "验证受阻", ready: "执行环境就绪", not_ready: "执行环境未就绪" };
const inProgress = (value: string | null | undefined) => ["validating", "queued", "running"].includes(value ?? "");
const dateLabel = (value: string | null) => value ? new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`).toLocaleString("zh-CN") : "—";
export function ReleaseStatus({ status }: { status: string }) { return <Badge variant={statusVariant(status)}>{releaseLabels[status] ?? status}</Badge>; }
function ErrorNotice({ error }: { error: unknown }) { return error ? <div className="pipe-notice pipe-error" role="alert"><CircleAlert /><span>{error instanceof Error ? error.message : String(error)}</span></div> : null; }

export function PluginDevelopmentWorkspace({ projectId, releaseId, pluginId, searchTerm = "", offset = 0 }: { projectId: string; releaseId?: string; pluginId?: string; searchTerm?: string; offset?: number }) {
  const { me, can } = useProjectAuth(projectId); const client = useQueryClient(); const navigate = useNavigate();
  const basePath = useOperatorBasePath(projectId);
  const [query, setQuery] = useState(searchTerm); const [open, setOpen] = useState(false);
  useEffect(() => { setQuery(searchTerm); }, [searchTerm]);
  const browse = (values: { q?: string; offset?: number; pluginId?: string; releaseId?: string }) => void navigate({ to: basePath, search: { project_id: basePath === "/operators" ? projectId : undefined, view: "development", releaseId, q: searchTerm || undefined, offset, pluginId, ...values } });
  const [hasDraft, setHasDraft] = useState(false);
  const releases = useQuery({ ...pluginReleasesQuery(projectId, { q: searchTerm, offset, pluginId }), refetchInterval: (query) => query.state.data?.items.some((release) => inProgress(release.status)) ? 3000 : false });
  const create = useMutation({ mutationFn: ({ input, interaction }: { input: PluginReleaseUpload; interaction?: InteractionContext }) => createPluginRelease(projectId, input, me.csrf_token, interaction), onSuccess: (release) => { client.setQueryData(pluginReleaseQuery(projectId, release.id).queryKey, release); void client.invalidateQueries({ queryKey: pluginReleasesKey(projectId) }); setQuery(""); setOpen(false); void navigate({ to: basePath, search: { project_id: basePath === "/operators" ? projectId : undefined, view: "development", releaseId: release.id, pluginId: release.plugin_id } }); } });
  const download = useMutation({ mutationFn: (interaction?: InteractionContext) => downloadPluginTemplate(projectId, interaction) });
  const items = releases.data?.items ?? [];
  const emptyCatalog = releases.isSuccess && items.length === 0 && !searchTerm && !pluginId && offset === 0;
  const groups = new Map<string, PluginRelease[]>();
  for (const release of items) groups.set(release.plugin_id, [...groups.get(release.plugin_id) ?? [], release]);
  return <section className="plugin-development" aria-label="插件开发">
    <div className="plugin-scope-banner"><div><h2>插件版本</h2><p>构建候选版本，验证后发布并启用到项目。</p></div><div className="plugin-actions"><Button variant="outline" disabled={download.isPending} onClick={(event) => download.mutate(interactionForEvent(event.nativeEvent))} data-track-id="plugins.template.download" data-track-label="下载开发模板"><Download />下载开发模板</Button><Button disabled={!can("operators:develop")} onClick={() => { create.reset(); setOpen(true); }} data-track-id="plugins.release.create.open" data-track-label="新建插件版本"><Plus />{hasDraft ? "继续编辑草稿" : "新建插件版本"}</Button></div></div>
    {!can("operators:develop") && <div className="pipe-notice"><span>创建和验证候选需要插件开发权限。</span><PermissionRequestButton projectId={projectId} permission="operators:develop" label="申请开发权限" /></div>}
    {hasDraft && !open && <p className="plugin-draft-notice" role="status">发现未提交的插件草稿，可继续编辑。</p>}
    <ErrorNotice error={download.error} />
    <div className="plugin-dev-layout" data-empty-catalog={emptyCatalog || undefined}>
      <aside className="plugin-release-list" aria-label="插件版本列表"><div className="plugin-list-scope">{pluginId ? <><Button variant="ghost" size="sm" onClick={() => browse({ pluginId: undefined, q: undefined, offset: 0 })}>← 全部插件</Button><strong>{pluginId}</strong><small>版本历史</small></> : <><strong>全部插件 · 最近版本</strong></>}</div><form className="plugin-release-search" onSubmit={(event) => { event.preventDefault(); browse({ q: query.trim(), offset: 0 }); }}><label className="pipe-search"><Search /><input aria-label="搜索插件版本" placeholder={pluginId ? "搜索此插件的版本" : "插件 ID 或版本"} maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} /></label><Button variant="outline" size="sm" type="submit">搜索</Button></form>
        <ErrorNotice error={releases.error} />
        {releases.error && <Button variant="outline" size="sm" onClick={() => void releases.refetch()}><RefreshCw />重新读取版本</Button>}
        {releaseId && releases.data && !items.some((release) => release.id === releaseId) && <p className="plugin-muted">所选版本不在本页，详情仍保留。</p>}
        {releases.isPending ? <p className="pipe-loading"><LoaderCircle className="animate-spin" />正在读取版本…</p> : items.length ? Array.from(groups, ([groupId, versions]) => <section className="plugin-version-group" key={groupId} aria-label={`${versions[0].manifest.name}的版本`}><div className="plugin-version-group-heading"><h3>{versions[0].manifest.name}</h3><small>{groupId}</small>{!pluginId && <Button variant="ghost" size="sm" onClick={() => browse({ pluginId: groupId, q: undefined, offset: 0, releaseId: versions[0].id })}>查看全部版本</Button>}</div>{versions.map((release) => <Link key={release.id} to={basePath} search={{ project_id: projectId, view: "development", releaseId: release.id, pluginId, q: searchTerm || undefined, offset }} aria-current={releaseId === release.id ? "page" : undefined} className={`plugin-release-row ${releaseId === release.id ? "is-selected" : ""}`}><div><strong>v{release.version}</strong><small>{dateLabel(release.created_at)}</small></div><div><ReleaseStatus status={release.status} />{release.active && <span className="plugin-active-marker">项目已启用</span>}</div></Link>)}</section>) : !releases.error && <div className={emptyCatalog ? "plugin-list-empty" : "plugin-empty"}>{!emptyCatalog && <Package />}<h2>{searchTerm || pluginId || offset > 0 ? "没有匹配版本" : "尚无候选版本"}</h2><p>{searchTerm ? "修改插件 ID 或版本号重新搜索。" : "上传候选版本后将在这里显示。"}</p>{(searchTerm || pluginId || offset > 0) && <Button variant="outline" size="sm" onClick={() => { setQuery(""); browse({ q: undefined, pluginId: undefined, offset: 0 }); }}>查看全部插件版本</Button>}</div>}
        {!releases.error && (!releases.data || releases.data.total > 0 || offset > 0) && <PluginReleasePagination page={releases.data} offset={offset} pending={releases.isFetching} onChange={(offset) => browse({ offset })} label="开发版本分页" />}
      </aside>
      {releaseId ? <PluginReleaseDetail key={releaseId} projectId={projectId} releaseId={releaseId} /> : <div className="plugin-empty plugin-selection-empty"><FlaskConical /><h2>{releases.isPending ? "正在读取插件版本" : releases.error ? "版本列表暂不可用" : emptyCatalog ? "创建第一个插件版本" : items.length ? "选择一个插件版本" : "暂无可选版本"}</h2><p>{releases.isPending ? "稍候即可查看版本与发布记录。" : releases.error ? "请在版本列表中重试读取。" : emptyCatalog ? "从开发模板开始，上传 wheel、插件声明和测试样例。验证通过后即可发布。" : items.length ? "查看声明、验证记录和项目启用状态。" : "清除搜索条件或返回全部插件，查看其他版本。"}</p>{emptyCatalog && <><div className="plugin-empty-actions"><Button variant="outline" disabled={download.isPending} onClick={(event) => download.mutate(interactionForEvent(event.nativeEvent))}><Download />下载模板</Button><Button disabled={!can("operators:develop")} onClick={() => { create.reset(); setOpen(true); }} data-track-id="plugins.release.create.empty" data-track-label="上传第一个插件版本"><Plus />{hasDraft ? "继续插件草稿" : "上传第一个版本"}</Button></div><p className="plugin-muted">上传和发布不会自动启用版本或修改已有流水线。</p></>}</div>}
    </div>
    <PluginCandidateForm key={`${me.user.id}:${projectId}`} draftKey={`flywheel.plugin-candidate.v1:${encodeURIComponent(me.user.id)}:${encodeURIComponent(projectId)}`} open={open} onOpenChange={setOpen} onDraftChange={setHasDraft} pending={create.isPending} error={create.error} onSubmit={(input, interaction) => create.mutateAsync({ input, interaction })} />
  </section>;
}

function PluginReleaseDetail({ projectId, releaseId }: { projectId: string; releaseId: string }) {
  const { me, can } = useProjectAuth(projectId); const client = useQueryClient(); const lock = useRef(false);
  const release = useQuery({ ...pluginReleaseQuery(projectId, releaseId), refetchInterval: (query) => inProgress(query.state.data?.status) ? 3000 : false });
  const validations = useQuery({ ...pluginValidationsQuery(projectId, releaseId), refetchInterval: (query) => inProgress(release.data?.status) || query.state.data?.some((item) => inProgress(item.status)) ? 3000 : false });
  type Action = "validate" | "publish" | "activate";
  const action = useMutation({ mutationFn: async ({ name, interaction }: { name: Action; interaction?: InteractionContext }) => { await ({ validate: validatePluginRelease, publish: publishPluginRelease, activate: activatePluginRelease }[name])(projectId, releaseId, me.csrf_token, interaction); }, onSettled: async () => { await Promise.allSettled([client.invalidateQueries({ queryKey: pluginReleaseQuery(projectId, releaseId).queryKey }), client.invalidateQueries({ queryKey: pluginReleasesKey(projectId) }), client.invalidateQueries({ queryKey: pluginValidationsQuery(projectId, releaseId).queryKey }), client.invalidateQueries({ queryKey: operatorsQueryFor(projectId).queryKey }), client.invalidateQueries({ queryKey: operatorPluginsQueryFor(projectId).queryKey })]); lock.current = false; } });
  const runAction = (name: Action, interaction?: InteractionContext) => { if (lock.current || action.isPending) return; lock.current = true; action.mutate({ name, interaction }); };
  if (release.isPending) return <p className="pipe-loading"><LoaderCircle className="animate-spin" />正在读取版本详情…</p>;
  if (release.error) return <section className="plugin-release-detail"><ErrorNotice error={release.error} /><Button variant="outline" onClick={() => void release.refetch()}>重新读取详情</Button></section>;
  const data: PluginRelease = release.data;
  const busy = action.isPending || release.isFetching;
  const validated = ["validated", "published"].includes(data.status) && data.validation_status === "passed";
  const ready = data.deployment_state === "ready";
  const currentValidation = validations.data?.find((item) => item.id === data.validation_id) ?? validations.data?.[0];
  const history = validations.data?.filter((item) => item.id !== currentValidation?.id) ?? [];
  const nextStep = data.active ? { title: "可以开始编排", description: "该版本已进入项目算子库，可以选择下方算子创建流水线。" }
    : data.status === "published" && !ready ? { title: "下一步：准备执行环境", description: "请管理员完成此版本的执行环境部署，再刷新环境状态；环境就绪后即可启用到项目。" }
    : inProgress(data.status) ? { title: data.validation_status === "queued" ? "下一步：等待验证 Worker 接单" : "下一步：等待验证结果", description: "页面会自动更新。长时间未开始时，请联系管理员检查验证 Worker。" }
    : data.status === "validation_failed" ? { title: "下一步：查看失败项并修正", description: "环境受阻可在恢复后重新验证；修改代码、声明或测试后，需构建并上传新版本。" }
    : validated ? data.status === "published" ? { title: "下一步：启用到项目", description: "启用后项目用户才能在流水线中选择这个版本。" } : { title: "下一步：正式发布固定版本", description: "验证已通过，发布后制品内容保持不变。" }
    : { title: "下一步：运行验证", description: "检查真实插件契约与测试用例，通过后才能正式发布。" };
  const stageItems = [{ title: "候选制品", done: true }, { title: "验证通过", done: validated }, { title: "正式发布", done: data.status === "published" }, { title: "环境就绪", done: ready }, { title: "项目启用", done: data.active }];
  return <section className="plugin-release-detail" aria-label="插件版本详情">
    <div className="plugin-detail-heading"><div><h2>{data.manifest.name} <span>{data.version}</span></h2><p>{data.plugin_id}</p></div><ReleaseStatus status={data.status} /></div>
    <p className="plugin-description">{data.manifest.description}</p>
    <ol className="plugin-lifecycle">{stageItems.map((stage) => <li key={stage.title} className={stage.done ? "is-complete" : ""}>{stage.done ? <CheckCircle2 /> : <span className="plugin-stage-dot" />}{stage.title}</li>)}</ol>
    <div className="plugin-next-step"><strong>{nextStep.title}</strong><p>{nextStep.description}</p>{data.active && <Link to="/projects/$projectId/pipelines" params={{ projectId }} className={buttonVariants({ variant: "outline", size: "sm" })} data-variant="outline" data-size="sm"><span className="md-button-container md-state-layer">前往流水线<ArrowRight /></span></Link>}{data.status === "published" && !ready && <Button variant="outline" size="sm" disabled={release.isFetching} onClick={() => void release.refetch()}><RefreshCw />刷新环境状态</Button>}</div>
    <div className="plugin-detail-actions">
      {data.status !== "published" && <Button variant={validated ? "outline" : "default"} disabled={busy || inProgress(data.status) || !can("operators:develop")} onClick={(event) => runAction("validate", interactionForEvent(event.nativeEvent))} data-track-id="plugins.release.validate" data-track-label="验证候选版本">{inProgress(data.status) ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}{inProgress(data.status) ? "正在验证…" : data.validation_id ? "重新验证" : "运行验证"}</Button>}
      {data.status !== "published" && <Button variant={validated ? "default" : "outline"} disabled={busy || !validated || !can("operators:publish")} title={!validated ? "需要当前制品验证通过" : undefined} onClick={(event) => runAction("publish", interactionForEvent(event.nativeEvent))} data-track-id="plugins.release.publish" data-track-label="正式发布插件版本"><Rocket />正式发布</Button>}
      <Button variant={data.status === "published" && ready ? "default" : "outline"} disabled={busy || data.status !== "published" || !ready || data.active || !can("operators:register")} onClick={(event) => runAction("activate", interactionForEvent(event.nativeEvent))} data-track-id="plugins.release.activate" data-track-label="启用插件版本到项目"><Play />{data.active ? "项目已启用" : "启用到项目"}</Button>
    </div>
    <div className="plugin-action-context">{!ready && <p>执行环境尚未就绪，当前版本不能用于项目编排。验证报告会记录环境检查结果。</p>}{!can("operators:publish") && data.status !== "published" && <PermissionRequestButton projectId={projectId} permission="operators:publish" label="申请正式发布权限" />}{!can("operators:register") && <PermissionRequestButton projectId={projectId} permission="operators:register" label="申请项目启用权限" />}</div>
    <ErrorNotice error={action.error} />
    <details className="plugin-data-section"><summary>包含的算子 · {data.manifest.operators.length} 项</summary><PluginCapabilities operators={data.manifest.operators} projectId={projectId} active={data.active} /></details>
    <section className="plugin-validations" aria-label="验证记录"><div className="pipe-section-heading"><h3>验证记录</h3><Button size="sm" variant="ghost" disabled={validations.isFetching} onClick={() => { void validations.refetch(); void release.refetch(); }} aria-label="刷新验证记录"><RefreshCw /></Button></div><ErrorNotice error={validations.error} />
      {validations.isPending ? <p className="pipe-loading">正在读取验证记录…</p> : !currentValidation ? <p className="plugin-muted">尚未运行验证。</p> : <><article className="plugin-validation"><div className="pipe-section-heading"><div><strong>当前验证</strong><ReleaseStatus status={currentValidation.status} /><small>{dateLabel(currentValidation.created_at)}</small></div></div><ValidationBody validation={currentValidation} testCases={data.test_cases} /></article>{history.map((validation) => <details className="plugin-validation-history" key={validation.id}><summary><span>历史验证</span><ReleaseStatus status={validation.status} /><time>{dateLabel(validation.created_at)}</time></summary><ValidationBody validation={validation} testCases={data.test_cases} /></details>)}</>}
    </section>
    <dl className="plugin-artifact-metadata"><div><dt>制品文件</dt><dd>{data.wheel_filename}</dd></div><div><dt>创建时间</dt><dd>{dateLabel(data.created_at)}</dd></div><div><dt>正式发布时间</dt><dd>{dateLabel(data.published_at)}</dd></div><div><dt>执行环境</dt><dd>{releaseLabels[data.deployment_state] ?? data.deployment_state}</dd></div><div className="plugin-wide-metadata"><dt>wheel SHA-256</dt><dd><code>{data.wheel_sha256}</code></dd></div><div className="plugin-wide-metadata"><dt>运行环境摘要</dt><dd><code>{data.runtime_digest ?? "尚未生成"}</code></dd></div><div className="plugin-wide-metadata"><dt>SDK 内容摘要</dt><dd><code>{data.sdk_bundle_digest ?? "尚未生成"}</code></dd></div></dl>
    <details className="plugin-data-section"><summary>插件声明 · {data.manifest.operators.length} 个算子</summary><pre tabIndex={0}>{JSON.stringify(data.manifest, null, 2)}</pre></details>
    <details className="plugin-data-section"><summary>测试样例 · {data.test_cases.length} 项</summary><pre tabIndex={0}>{JSON.stringify(data.test_cases, null, 2)}</pre></details>
  </section>;
}

function ValidationBody({ validation, testCases }: { validation: PluginValidation; testCases: PluginRelease["test_cases"] }) {
  return <><ErrorNotice error={validation.error} />{validation.report && <PluginValidationReport report={validation.report} testCases={testCases} />}{!validation.report && inProgress(validation.status) && <p className="plugin-muted">{validation.status === "queued" ? "正在等待验证 Worker 接单。长时间未开始时，请联系管理员检查 Worker。" : "验证正在执行，报告将自动更新。"}</p>}</>;
}
````

## apps/web/src/components/PluginCandidateForm.tsx

````tsx
import { Dialog } from "@base-ui/react/dialog";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { CircleAlert, LoaderCircle, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_PLUGIN_WHEEL_BYTES, type PluginReleaseManifest, type PluginReleaseUpload, type PluginTestCase } from "../plugin-releases-api";
import { interactionForEvent, type InteractionContext } from "../telemetry";
import { Button } from "./ui/button";

function readFile(file: File, dataUrl = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    if (dataUrl) reader.readAsDataURL(file); else reader.readAsText(file);
  });
}
const jsonArray = (text: string, label: string): unknown[] => {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`${label}必须是合法的 JSON。`); }
  if (!Array.isArray(value) || !value.length) throw new Error(`${label}必须是至少包含一项的 JSON 数组。`);
  return value;
};

const emptyIdentity = () => ({ id: "", name: "", version: "", description: "", sdk_version: "1" });
type Draft = { identity: ReturnType<typeof emptyIdentity>; operators: string; cases: string; wheelName: string };
function readDraft(key: string): Draft | null {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? "null") as Draft | null;
    if (!data || !data.identity || !Object.keys(emptyIdentity()).every((key) => typeof data.identity[key as keyof Draft["identity"]] === "string") || typeof data.operators !== "string" || typeof data.cases !== "string" || typeof data.wheelName !== "string") return null;
    return data;
  } catch { return null; }
}
function ImportedSummary({ text, label }: { text: string; label: string }) {
  let rows: unknown;
  try { rows = JSON.parse(text); } catch { return <p className="plugin-muted">{label} JSON 尚未完成，请在高级编辑中检查。</p>; }
  if (!Array.isArray(rows) || !rows.length) return <p className="plugin-muted">尚未导入{label}。</p>;
  return <div className="plugin-import-summary"><strong>{rows.length} 项{label}</strong><ul>{rows.slice(0, 8).map((row: unknown, index) => <li key={index}>{row && typeof row === "object" && "name" in row && typeof row.name === "string" ? row.name : `第 ${index + 1} 项`}</li>)}</ul>{rows.length > 8 && <small>其余 {rows.length - 8} 项可在高级编辑中查看。</small>}</div>;
}

export function PluginCandidateForm({ open, onOpenChange, pending, error, onSubmit, onDraftChange, draftKey }: {
  open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; error: Error | null;
  draftKey: string;
  onSubmit: (value: PluginReleaseUpload, interaction?: InteractionContext) => Promise<unknown>;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const [restored] = useState(() => readDraft(draftKey));
  const [identity, setIdentity] = useState(restored?.identity ?? emptyIdentity());
  const [operators, setOperators] = useState(restored?.operators ?? "[]");
  const [cases, setCases] = useState(restored?.cases ?? "[]");
  const [wheelName, setWheelName] = useState(restored?.wheelName ?? "");
  const [storageError, setStorageError] = useState(false);
  const [wheel, setWheel] = useState<File | null>(null);
  const [localError, setLocalError] = useState("");
  const [reading, setReading] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const continueEditing = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const busy = pending || reading;
  const dirty = Boolean(wheelName || wheel || identity.id || identity.name || identity.version || identity.description || identity.sdk_version !== "1" || operators !== "[]" || cases !== "[]");
  useEffect(() => { onDraftChange?.(dirty); }, [dirty, onDraftChange]);
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(draftKey, JSON.stringify({ identity, operators, cases, wheelName }));
      else localStorage.removeItem(draftKey);
      setStorageError(false);
    } catch { setStorageError(true); }
  }, [draftKey, dirty, identity, operators, cases, wheelName]);
  useEffect(() => {
    if (!wheel && !busy && !(storageError && dirty)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy, wheel, storageError]);
  const clearDraft = () => { setIdentity(emptyIdentity()); setOperators("[]"); setCases("[]"); setWheel(null); setWheelName(""); setLocalError(""); try { localStorage.removeItem(draftKey); } catch { /* Persistence failure is already visible. */ } };
  const closeForm = (discard: boolean) => { if (discard) clearDraft(); setConfirmClose(false); onOpenChange(false); };
  const loadJson = async (file: File | undefined, kind: "manifest" | "tests") => {
    if (!file) return;
    setLocalError("");
    if (file.size > 1024 * 1024) { setLocalError("单个声明或测试文件不能超过 1 MiB。"); return; }
    setReading(true);
    try {
      const text = await readFile(file);
      if (kind === "tests") { jsonArray(text, "测试样例"); setCases(text); }
      else {
        const data = JSON.parse(text) as Partial<PluginReleaseManifest>;
        if (!data || typeof data !== "object" || !Array.isArray(data.operators)) throw new Error("manifest.json 需要包含插件身份和 operators 数组。");
        setIdentity({ id: String(data.id ?? ""), name: String(data.name ?? ""), version: String(data.version ?? ""), description: String(data.description ?? ""), sdk_version: String(data.sdk_version ?? "1") });
        setOperators(JSON.stringify(data.operators, null, 2));
      }
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "文件读取失败。"); }
    finally { setReading(false); }
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || busy) return;
    const interaction = interactionForEvent(event.nativeEvent);
    setLocalError(""); lock.current = true; setReading(true);
    try {
      if (!wheel || !wheel.name.endsWith(".whl")) throw new Error("请选择构建完成的 .whl 文件。");
      if (wheel.size > MAX_PLUGIN_WHEEL_BYTES) throw new Error("wheel 文件不能超过 8 MiB。");
      if (![identity.id, identity.name, identity.version].every((value) => value.trim())) throw new Error("请填写插件 ID、名称和版本。");
      const manifest = { ...identity, id: identity.id.trim(), name: identity.name.trim(), version: identity.version.trim(), operators: jsonArray(operators, "算子声明") } as PluginReleaseManifest;
      const testCases = jsonArray(cases, "测试样例") as PluginTestCase[];
      const data = await readFile(wheel, true);
      const input = { wheel_filename: wheel.name, wheel_base64: data.slice(data.indexOf(",") + 1), manifest, test_cases: testCases };
      if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 12 * 1024 * 1024) throw new Error("候选请求整体不能超过 12 MiB，请减少测试样例体积。");
      await onSubmit(input, interaction);
      clearDraft();
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "候选版本提交失败。"); }
    finally { setReading(false); lock.current = false; }
  }
  return <Dialog.Root open={open} onOpenChange={(value) => { if (busy) return; if (!value && dirty) setConfirmClose(true); else onOpenChange(value); }}><Dialog.Portal>
    <Dialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-40" />
    <Dialog.Viewport className="fixed inset-0 z-50 plugin-candidate-viewport">
      <Dialog.Popup className="pipe-dialog plugin-upload-dialog plugin-candidate-workspace">
        <div className="pipe-section-heading plugin-candidate-heading"><div><Dialog.Title>新建插件版本</Dialog.Title><Dialog.Description>依次准备文件、检查声明与测试，再上传候选版本。</Dialog.Description></div><Dialog.Close render={<Button size="icon" variant="ghost" disabled={busy} />} aria-label="关闭新建插件版本"><X /></Dialog.Close></div>
        <form className="plugin-upload-form" onSubmit={(event) => void submit(event)}>
          <div className="plugin-candidate-status" role="status">{storageError ? "无法保存浏览器草稿，请保持此页面打开并完成上传。" : "文本草稿自动保存在当前浏览器，按账号和项目隔离；重新打开后需要重选 wheel 文件。"}</div>
          {(localError || error) && <p className="pipe-notice pipe-error plugin-candidate-error" role="alert"><CircleAlert />{localError || error?.message}</p>}
          <nav className="plugin-candidate-steps" aria-label="新建版本步骤"><a href="#plugin-candidate-files">1. 准备文件</a><a href="#plugin-candidate-manifest">2. 检查声明</a><a href="#plugin-candidate-tests">3. 检查测试</a></nav>
          <section id="plugin-candidate-files" className="plugin-candidate-section"><h3>1. 准备文件</h3><p>使用开发模板构建 wheel，并导入生成的声明和测试文件。</p>
          <div className="plugin-file-input"><label htmlFor="plugin-wheel">Python wheel · 最大 8 MiB</label><input id="plugin-wheel" type="file" accept=".whl" disabled={busy} onChange={(event) => { const file = event.target.files?.[0] ?? null; setWheel(file); setWheelName(file?.name ?? ""); setLocalError(""); }} />{wheel && <small>{wheel.name} · {(wheel.size / 1024).toFixed(1)} KiB</small>}{!wheel && wheelName && <small className="plugin-file-restore" role="status">请重新选择 {wheelName}；浏览器只恢复了文件名，文件内容未保存。</small>}</div>
          <div className="plugin-file-input"><label htmlFor="plugin-manifest-file">导入 manifest.json</label><input id="plugin-manifest-file" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void loadJson(event.target.files?.[0], "manifest")} /><small>导入后可修改下面的声明；服务端会核对实际插件与声明是否一致。</small></div>
          <div className="plugin-file-input"><label htmlFor="plugin-tests-file">导入 test_cases.json</label><input id="plugin-tests-file" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void loadJson(event.target.files?.[0], "tests")} /></div>
          </section>
          <section id="plugin-candidate-manifest" className="plugin-candidate-section"><h3>2. 检查声明</h3><p>核对插件身份与版本。高级声明用于定义包含的算子。</p>
          <div className="plugin-identity-fields">{([ ["id", "插件 ID", "company.video.shot_filter"], ["name", "插件名称", "镜头时长筛选"], ["version", "版本", "1.0.0"], ["sdk_version", "SDK 版本", "1"] ] as const).map(([key, label, placeholder]) => <label key={key}>{label}<input required value={identity[key]} placeholder={placeholder} disabled={busy} onChange={(event) => setIdentity((old) => ({ ...old, [key]: event.target.value }))} /></label>)}</div>
          <label className="plugin-text-field">插件说明<textarea rows={2} value={identity.description} disabled={busy} onChange={(event) => setIdentity((old) => ({ ...old, description: event.target.value }))} /></label>
          <ImportedSummary text={operators} label="算子声明" />
          <details className="plugin-candidate-advanced"><summary>高级编辑：算子声明 JSON</summary><label className="plugin-text-field">算子声明 · operators JSON<textarea className="pipe-code-input" rows={8} spellCheck={false} value={operators} disabled={busy} onChange={(event) => setOperators(event.target.value)} /><small>声明输入输出类型、参数 Schema、默认参数及副作用，不填写 Python 代码。</small></label></details>
          </section>
          <section id="plugin-candidate-tests" className="plugin-candidate-section"><h3>3. 检查测试</h3><p>导入的样例会随版本一起上传，之后可以单独发起验证。</p>
          <ImportedSummary text={cases} label="测试样例" />
          <details className="plugin-candidate-advanced"><summary>高级编辑：测试样例 JSON</summary><label className="plugin-text-field">测试样例 · test_cases JSON<textarea className="pipe-code-input" rows={7} spellCheck={false} value={cases} disabled={busy} onChange={(event) => setCases(event.target.value)} /><small>每个算子至少一个样例，包含 name、operator_id、config、input，以及完整 expected 产物或 expected_error。</small></label></details>
          </section>
          <div className="plugin-form-footer"><span>上传完成后仍需验证和正式发布。</span><Button type="submit" disabled={busy} data-track-id="plugins.release.create" data-track-label="上传候选版本">{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}{busy ? "正在上传…" : "上传候选版本"}</Button></div>
        </form>
      </Dialog.Popup>
    </Dialog.Viewport>
  </Dialog.Portal>
    <AlertDialog.Root open={confirmClose} onOpenChange={setConfirmClose}><AlertDialog.Portal>
      <AlertDialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-[60]" />
      <AlertDialog.Viewport className="fixed inset-0 z-[70] grid place-items-center p-4"><AlertDialog.Popup className="pipe-dialog plugin-draft-dialog" initialFocus={continueEditing}>
        <AlertDialog.Title>保留未提交的插件草稿？</AlertDialog.Title>
        <AlertDialog.Description>{storageError ? "当前浏览器无法保存草稿，关闭后仅在此页面保留；请继续编辑并完成上传。" : "声明和测试已保存在当前浏览器，离开页面后可恢复。wheel 文件内容不会持久保存，返回后需要重新选择。"}</AlertDialog.Description>
        <div className="plugin-draft-actions"><Button variant="destructive-text" onClick={() => closeForm(true)}>放弃草稿</Button><AlertDialog.Close render={<Button ref={continueEditing} variant="ghost" />}>继续编辑</AlertDialog.Close><Button variant="ghost" onClick={() => closeForm(false)}>保留并关闭</Button></div>
      </AlertDialog.Popup></AlertDialog.Viewport>
    </AlertDialog.Portal></AlertDialog.Root>
  </Dialog.Root>;
}
````

## apps/web/src/components/PluginValidationReport.tsx

````tsx
import { CheckCircle2, CircleAlert, CircleHelp } from "lucide-react";
import type { PluginRelease, PluginValidation } from "../plugin-releases-api";

type Check = { name: string; passed?: boolean; operator_id?: string; message?: string; output?: unknown; output_count?: number };

export function PluginValidationReport({ report, testCases }: { report: NonNullable<PluginValidation["report"]>; testCases: PluginRelease["test_cases"] }) {
  const checks: Check[] = Array.isArray(report.checks) ? report.checks.flatMap((value: unknown) => {
    if (!value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string") return [];
    const item = value as Record<string, unknown>;
    return [{ name: value.name, passed: typeof item.passed === "boolean" ? item.passed : undefined,
      operator_id: typeof item.operator_id === "string" ? item.operator_id : undefined,
      message: typeof item.message === "string" ? item.message : undefined, output: item.output,
      output_count: typeof item.output_count === "number" && Number.isFinite(item.output_count) ? item.output_count : undefined }];
  }) : [];
  const passed = checks.filter((check) => check.passed === true).length;
  const failed = checks.filter((check) => check.passed === false).length;
  const unknown = checks.length - passed - failed;
  return <div className="plugin-validation-report">
    {checks.length ? <>
      <div className="plugin-check-summary" role="group" aria-label="验证结果统计"><strong>{checks.length} 项检查</strong><span className="plugin-check-pass">{passed} 项通过</span><span className={failed ? "plugin-check-fail" : ""}>{failed} 项失败</span>{unknown > 0 && <span>{unknown} 项结果未提供</span>}</div>
      <ol className="plugin-check-list" aria-label="逐项验证结果">{checks.map((check, index) => {
        const sample = testCases.find((item) => item.name === check.name && item.operator_id === check.operator_id);
        const label = check.passed === true ? "通过" : check.passed === false ? "失败" : "结果未提供";
        const Icon = check.passed === true ? CheckCircle2 : check.passed === false ? CircleAlert : CircleHelp;
        return <li key={`${check.operator_id ?? "contract"}:${check.name}:${index}`} className={check.passed === false ? "is-failed" : ""}>
          <div className="plugin-check-heading"><Icon aria-hidden="true" /><strong>{check.name === "wheel_contract" ? "插件契约检查" : check.name === "container_execution" ? "容器执行检查" : check.name}</strong><span>{label}</span></div>
          {check.operator_id && <small>{check.operator_id}</small>}
          {check.message && <p>{check.message === "Output matches the expected artifact" ? "实际产物与预期一致。" : check.message === "Output does not match expected result" ? "实际产物与预期不一致，请检查下方用例数据。" : check.message}</p>}
          {typeof check.output_count === "number" && <small>输出 {check.output_count} 条记录</small>}
          {check.passed === false && (sample || check.output !== undefined) && <details><summary>查看预期与实际结果</summary><div className="plugin-check-comparison"><div><h4>预期结果</h4><pre tabIndex={0}>{sample ? JSON.stringify(sample.expected ?? sample.expected_error, null, 2) : "报告没有匹配的测试样例。"}</pre></div><div><h4>实际结果</h4><pre tabIndex={0}>{check.output !== undefined ? JSON.stringify(check.output, null, 2) : check.message ?? "报告未提供实际产物。"}</pre></div></div></details>}
        </li>;
      })}</ol>
    </> : <p className="plugin-muted">此报告未提供逐项结果，可展开原始报告查看。</p>}
    <details className="plugin-report-raw"><summary>原始验证报告 · JSON</summary><pre tabIndex={0}>{JSON.stringify(Object.fromEntries(Object.entries(report).filter(([key]) => key !== "logs")), null, 2)}</pre></details>
    {report.logs !== undefined && <details><summary>验证日志</summary><pre tabIndex={0}>{typeof report.logs === "string" ? report.logs : JSON.stringify(report.logs, null, 2)}</pre></details>}
  </div>;
}
````

## apps/web/src/components/PluginCapabilities.tsx

````tsx
import { ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { PluginReleaseManifest } from "../plugin-releases-api";
import { buttonVariants } from "./ui/button";

const types: Record<string, string> = { video_assets: "视频资产", shot_assets: "镜头集", frame_assets: "关键帧集", annotated_frames: "已标注关键帧", frame_embeddings: "关键帧向量", shot_index: "镜头索引" };
export function PluginCapabilities({ operators, projectId, active = false }: { operators: PluginReleaseManifest["operators"]; projectId: string; active?: boolean }) {
  return <ul className="plugin-capability-list" aria-label="插件包含的算子">{operators.map((operator) => <li key={`${operator.id}@${operator.version}`}>
    <div><strong>{operator.name}</strong><span>v{operator.version}</span></div>
    <p>{operator.description}</p><small>{operator.input_type ? types[operator.input_type] ?? operator.input_type : "源数据"} → {types[operator.output_type] ?? operator.output_type}</small>
    <small>{operator.side_effects ? "包含外部写入" : operator.deterministic ? "支持结果缓存" : "每次重新计算"}</small>
    {active && <Link to="/projects/$projectId/pipelines" params={{ projectId }} search={{ view: "new", operator_id: operator.id, operator_version: operator.version }} className={buttonVariants({ size: "sm", variant: "outline" })} data-variant="outline" data-size="sm"><span className="md-button-container md-state-layer">用于新流水线<ArrowRight /></span></Link>}
  </li>)}</ul>;
}
````

## apps/web/src/components/PluginReleasePagination.tsx

````tsx
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PluginReleasePage } from "../plugin-releases-api";
import { Button } from "./ui/button";

export function PluginReleasePagination({ page, offset, pending, onChange, label }: { page?: PluginReleasePage; offset: number; pending: boolean; onChange: (offset: number) => void; label: string }) {
  return <nav className="plugin-release-pagination" aria-label={label}>
    <p aria-live="polite">{page ? page.total ? `第 ${page.offset + 1}–${page.offset + page.items.length} 条，共 ${page.total} 个版本` : "共 0 个版本" : "正在读取版本数量…"}</p>
    <div><Button variant="outline" size="sm" disabled={pending || offset === 0} onClick={() => onChange(Math.max(0, offset - (page?.limit ?? 20)))}><ChevronLeft />上一页</Button><Button variant="outline" size="sm" disabled={pending || !page?.has_more} onClick={() => onChange(offset + (page?.limit ?? 20))}>下一页<ChevronRight /></Button></div>
  </nav>;
}
````

## apps/web/src/pipelines-api.ts

````typescript
import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch, type InteractionContext } from "./telemetry";

export type JsonSchema = {
  type?: string | string[]; title?: string; description?: string; default?: unknown;
  $ref?: string; $defs?: Record<string, JsonSchema>; definitions?: Record<string, JsonSchema>;
  minimum?: number; maximum?: number; enum?: unknown[];
  properties?: Record<string, JsonSchema>; required?: string[];
  anyOf?: JsonSchema[]; oneOf?: JsonSchema[]; allOf?: JsonSchema[]; items?: JsonSchema;
};
export interface OperatorManifest {
  id: string; name: string; version: string; plugin_id: string; description: string;
  kind: string; input_type: string | null; output_type: string;
  input_ports?: Record<string, string>; retry_safe?: boolean | null; cacheable?: boolean | null;
  execution_protocol?: string; execution_scope?: string; batch_size?:number;
  config_schema: JsonSchema; default_config: Record<string, unknown>;
  deterministic: boolean; side_effects: boolean; implementation_digest: string;
}
export interface OperatorPlugin {
  id: string; name: string; version: string; description: string;
  registered: boolean; operators: OperatorManifest[];
}
export interface PipelineNode {
  id: string; operator: string; version: string;
  config: Record<string, unknown>; inputs: Record<string, string>;
  position?: { x: number; y: number };
}
export interface PipelineGraph { nodes: PipelineNode[] }
export interface Pipeline {
  id: string; name: string; description: string; version: number;
  graph: PipelineGraph; created_at: string; updated_at: string;
  versions?: { version: number; name: string; created_at: string }[];
  latest_version?: number;
  latest_run?: { id: string; status: string; cancellation_pending?: boolean } | null;
}
export interface PipelinePage<T> { items: T[]; total: number; offset: number; limit: number; has_more: boolean }
export interface PipelineInput { name: string; description: string; graph: PipelineGraph }
export interface GraphValidation { valid: boolean; errors: string[]; order: string[] }
export interface PipelineExecutionPlan {
  mode: "production" | "debug"; version: number; targets: string[]; node_ids: string[];
  graph: PipelineGraph; semantic_digest: string; plan_digest: string;
  sample: { limit: number | null; fixed: boolean; sources: { node_id: string; record_ids: string[]; record_count: number; content_hash: string }[] };
  warnings: string[]; blocked: { node_id: string; reason: string }[];
}
export interface PipelineRunOptions {
  mode?: "production" | "debug"; targets?: string[]; sample_limit?: number; plan_digest?: string; use_cache?: boolean;
  environment_id?: string; worker_pool_id?: string;
}
export interface ArtifactDatasetImport {
  dataset_id: string; created: boolean;
  source: { run_id: string; artifact_id: string; content_hash: string; mapping_version: string };
  quality_report: { passed?: boolean; issues?: { message?: string; code?: string }[]; [key: string]: unknown };
}
export interface PipelineTask {
  id: string; node_id: string; operator: string; status: string;
  input_count: number; output_count: number; duration_ms: number;
  error: string | null; artifact_id: string | null;
  progress?: { completed: number; total: number; unit: string; last_progress_at: string | null; source: string } | null;
}
export interface PipelineArtifact {
  id: string; run_id: string; node_id: string; type: string; record_count: number;
  content_hash: string; metadata: Record<string, unknown>;
  records: Record<string, unknown>[]; parent_artifact_ids: string[];
  cache_origin_id: string | null; created_at: string;
  has_more?: boolean;
  manifest?: { schema: string; sha256: string; record_count: number; shards: { uri: string; sha256: string; record_count: number; size?: number }[] } | null;
}
export interface PipelineRun {
  id: string; pipeline_id: string; pipeline_name: string; pipeline_version: number;
  status: string; created_at: string; finished_at: string | null; error: string | null;
  tasks: PipelineTask[]; artifacts: Omit<PipelineArtifact, "records">[];
  submission_status?: string | null;
  display_status?: string;
  waiting_reason?: string | null;
  can_retry_submission?: boolean;
  can_reconcile_submission?: boolean;
  cancellation_pending?: boolean;
  use_cache?: boolean | null;
  mode?: "production" | "debug";
  execution_plan?: PipelineExecutionPlan | null;
  operator_snapshot?: OperatorManifest[] | null;
}

async function request<T>(path: string, csrf?: string, body?: unknown, interaction?: InteractionContext): Promise<T> {
  const response = await instrumentedFetch(apiUrl(path), {
    credentials: "include",
    ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" }, body: JSON.stringify(body) } : {}),
  }, interaction);
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const data = await response.json() as { detail?: unknown };
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((item: { msg?: string; loc?: unknown[] }) => `${item.loc?.slice(1).join(".") ?? ""} ${item.msg ?? "参数无效"}`).join("；");
      else if (data.detail && typeof data.detail === "object") {
        const detail = data.detail as { message?: string; errors?: string[] };
        message = detail.errors?.join("；") ?? detail.message ?? message;
      }
    } catch { /* Preserve HTTP error when upstream returns a non-JSON response. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

const scoped = (path: string, projectId?: string) => projectId ? `${path}?project_id=${encodeURIComponent(projectId)}` : path;
async function requestPage<T>(path: string, offset: number, limit: number): Promise<PipelinePage<T>> {
  const response = await request<PipelinePage<T> | T[]>(path);
  // Permit a rolling upgrade from the legacy array response; new servers provide totals.
  return Array.isArray(response) ? { items: response, total: offset + response.length, offset, limit, has_more: false } : response;
}
export const pipelineDirectoryQueryFor = (projectId: string, filters: { page?: number; q?: string; status?: string } = {}) => {
  const page = Math.max(1, filters.page ?? 1), limit = 20, offset = (page - 1) * limit;
  const params = new URLSearchParams({ project_id: projectId, paginated: "true", offset: String(offset), limit: String(limit) });
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  return queryOptions({ queryKey: ["pipelines", projectId, "page", filters.q ?? "", filters.status ?? "", page], queryFn: () => requestPage<Pipeline>(`/api/pipelines?${params}`, offset, limit) });
};
export const pipelineRunHistoryQueryFor = (projectId: string, pipelineId: string, filters: { page?: number; version?: number; status?: string } = {}) => {
  const page = Math.max(1, filters.page ?? 1), limit = 20, offset = (page - 1) * limit;
  const params = new URLSearchParams({ project_id: projectId, pipeline_id: pipelineId, paginated: "true", offset: String(offset), limit: String(limit) });
  if (filters.version) params.set("pipeline_version", String(filters.version));
  if (filters.status) params.set("status", filters.status);
  return queryOptions({ queryKey: ["pipeline-runs", projectId, pipelineId, "page", filters.version ?? null, filters.status ?? "", page], queryFn: () => requestPage<PipelineRun>(`/api/pipeline-runs?${params}`, offset, limit) });
};
export const projectRunsQueryFor = (projectId: string, filters: { page?: number; status?: string; pipelineId?: string } = {}) => {
  const page = Math.max(1, filters.page ?? 1), limit = 20, offset = (page - 1) * limit;
  const params = new URLSearchParams({ paginated: "true", offset: String(offset), limit: String(limit) });
  if (filters.pipelineId) params.set("pipeline_id", filters.pipelineId);
  if (filters.status) params.set("status", filters.status);
  return queryOptions({ queryKey: ["project-runs", projectId, filters.pipelineId ?? "", filters.status ?? "", page], queryFn: () => requestPage<PipelineRun>(`/api/projects/${encodeURIComponent(projectId)}/runs?${params}`, offset, limit) });
};
export const loadProjectRun = (projectId: string, runId: string) => request<PipelineRun>(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`);
export const operatorsQueryFor = (projectId: string) => queryOptions({ queryKey: ["pipeline-operators", projectId], queryFn: () => request<OperatorManifest[]>(scoped("/api/operators", projectId)) });
export const operatorPluginsQueryFor = (projectId: string) => queryOptions({ queryKey: ["pipeline-plugins", projectId], queryFn: () => request<OperatorPlugin[]>(scoped("/api/operator-plugins", projectId)) });
export const pipelinesQueryFor = (projectId: string) => queryOptions({ queryKey: ["pipelines", projectId], queryFn: () => request<Pipeline[]>(scoped("/api/pipelines", projectId)) });
export const pipelineRunsQueryFor = (projectId: string, pipelineId?: string) => queryOptions({ queryKey: pipelineId ? ["pipeline-runs", projectId, pipelineId] : ["pipeline-runs", projectId], queryFn: () => request<PipelineRun[]>(`${scoped("/api/pipeline-runs", projectId)}${pipelineId ? `&pipeline_id=${encodeURIComponent(pipelineId)}` : ""}&limit=100`) });
export const pipelineQueryFor = (projectId: string, id: string) => queryOptions({ queryKey: ["pipeline", projectId, id], queryFn: () => request<Pipeline>(scoped(`/api/pipelines/${encodeURIComponent(id)}`, projectId)), enabled: Boolean(id) });
export const pipelineVersionQueryFor = (projectId: string, id: string, version?: number) => queryOptions({ queryKey: ["pipeline-version", projectId, id, version], queryFn: () => request<Pipeline>(scoped(`/api/pipelines/${encodeURIComponent(id)}/versions/${version}`, projectId)), enabled: Boolean(id && version), staleTime: Infinity });
export const operatorsQuery = operatorsQueryFor("demo");
export const operatorPluginsQuery = operatorPluginsQueryFor("demo");
export const pipelinesQuery = pipelinesQueryFor("demo");
export const pipelineRunsQuery = pipelineRunsQueryFor("demo");
export const artifactQuery = (id: string, projectId = "demo") => queryOptions({ queryKey: ["pipeline-artifact", projectId, id], queryFn: () => request<PipelineArtifact>(scoped(`/api/pipeline-artifacts/${encodeURIComponent(id)}`, projectId)), enabled: Boolean(id) });
export const validatePipeline = (graph: PipelineGraph, csrf: string, projectId?: string, interaction?: InteractionContext) => request<GraphValidation>(scoped("/api/pipelines/validate", projectId), csrf, { graph }, interaction);
export const savePipeline = (input: PipelineInput, csrf: string, existing?: { id: string; version: number }, projectId?: string, interaction?: InteractionContext) => existing
  ? request<Pipeline>(scoped(`/api/pipelines/${encodeURIComponent(existing.id)}/versions`, projectId), csrf, { ...input, expected_version: existing.version }, interaction)
  : request<Pipeline>(scoped("/api/pipelines", projectId), csrf, input, interaction);
export const planPipelineRun = (projectId: string, id: string, version: number, options: PipelineRunOptions, csrf: string) => request<PipelineExecutionPlan>(`/api/projects/${encodeURIComponent(projectId)}/pipelines/${encodeURIComponent(id)}/run-plan`, csrf, { version, ...options });
export const importArtifactDataset = (projectId: string, id: string, name: string, csrf: string) => request<ArtifactDatasetImport>(scoped(`/api/pipeline-artifacts/${encodeURIComponent(id)}/dataset`, projectId), csrf, { name });
export const runPipeline = (id: string, version: number, useCache: boolean, csrf: string, projectId?: string, idempotencyKey?: string, interaction?: InteractionContext, target?: PipelineRunOptions) => request<PipelineRun>(scoped(`/api/pipelines/${encodeURIComponent(id)}/runs`, projectId), csrf, { version, use_cache: useCache, ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}), ...target }, interaction);
export const registerOperatorPlugin = (pluginId: string, csrf: string, projectId?: string, interaction?: InteractionContext) => request<OperatorPlugin>(scoped("/api/operator-plugins/register", projectId), csrf, { plugin_id: pluginId }, interaction);
````

## apps/web/src/plugin-releases-api.ts

````typescript
import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";
import type { OperatorManifest } from "./pipelines-api";
import { instrumentedFetch, type InteractionContext } from "./telemetry";

export const MAX_PLUGIN_WHEEL_BYTES = 8 * 1024 * 1024;
export interface PluginReleaseManifest {
  id: string; name: string; description: string; version: string; sdk_version: string;
  operators: Omit<OperatorManifest, "plugin_id" | "implementation_digest">[];
}
export interface PluginTestCase {
  name: string; operator_id: string; config: Record<string, unknown>;
  input: unknown; expected?: unknown; expected_error?: { type: string; match?: string };
}
export interface PluginRelease {
  id: string; project_id: string; plugin_id: string; version: string;
  wheel_filename: string; wheel_sha256: string; manifest: PluginReleaseManifest;
  test_cases: PluginTestCase[];
  status: "candidate" | "validating" | "validated" | "validation_failed" | "published";
  validation_id: string | null; validation_status: string | null;
  runtime_digest: string | null; sdk_bundle_digest?: string | null; deployment_state: string; active: boolean;
  created_at: string; published_at: string | null;
}
export interface PluginValidation {
  id: string; release_id: string; status: "queued" | "running" | "passed" | "failed" | "blocked";
  report: Record<string, unknown> | null; error: string | null;
  wheel_sha256?: string | null; runtime_digest?: string | null; sdk_bundle_digest?: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
}
export interface PluginReleaseUpload {
  wheel_filename: string; wheel_base64: string;
  manifest: PluginReleaseManifest; test_cases: PluginTestCase[];
}
export interface PluginReleasePage {
  items: PluginRelease[]; total: number; offset: number; limit: number; has_more: boolean;
}
export interface PluginReleaseListOptions {
  q?: string; offset?: number; limit?: number; status?: PluginRelease["status"]; pluginId?: string;
}
const scoped = (path: string, projectId: string) => `${path}?project_id=${encodeURIComponent(projectId)}`;
const base = "/api/plugin-releases";
async function request<T>(path: string, options: { body?: unknown; csrf?: string; interaction?: InteractionContext } = {}): Promise<T> {
  const response = await instrumentedFetch(apiUrl(path), {
    credentials: "include",
    ...(options.body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": options.csrf ?? "" }, body: JSON.stringify(options.body) }),
  }, options.interaction);
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const { detail } = await response.json() as { detail?: unknown };
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail)) message = detail.map((item: { msg?: string; loc?: unknown[] }) => `${item.loc?.slice(1).join(".") ?? ""} ${item.msg ?? "参数无效"}`).join("；");
      else if (detail && typeof detail === "object") message = JSON.stringify(detail);
    } catch { /* Preserve a useful HTTP error for non-JSON responses. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
export const pluginReleasesKey = (projectId: string) => ["plugin-releases", projectId] as const;
export const pluginReleasesQuery = (projectId: string, options: PluginReleaseListOptions = {}) => {
  const page = { q: options.q?.trim() ?? "", offset: options.offset ?? 0, limit: options.limit ?? 20, status: options.status, pluginId: options.pluginId };
  const search = new URLSearchParams({ project_id: projectId, paginated: "true", q: page.q, offset: String(page.offset), limit: String(page.limit) });
  if (page.status) search.set("status", page.status);
  if (page.pluginId) search.set("plugin_id", page.pluginId);
  return queryOptions({ queryKey: [...pluginReleasesKey(projectId), page], queryFn: () => request<PluginReleasePage>(`${base}?${search}`) });
};
export const pluginReleaseQuery = (projectId: string, id: string) => queryOptions({ queryKey: ["plugin-release", projectId, id], queryFn: () => request<PluginRelease>(scoped(`${base}/${encodeURIComponent(id)}`, projectId)), enabled: Boolean(id) });
export const pluginValidationsQuery = (projectId: string, id: string) => queryOptions({ queryKey: ["plugin-validations", projectId, id], queryFn: () => request<PluginValidation[]>(scoped(`${base}/${encodeURIComponent(id)}/validations`, projectId)), enabled: Boolean(id) });
export const createPluginRelease = (projectId: string, input: PluginReleaseUpload, csrf: string, interaction?: InteractionContext) => request<PluginRelease>(scoped(base, projectId), { body: input, csrf, interaction });
export const validatePluginRelease = (projectId: string, id: string, csrf: string, interaction?: InteractionContext) => request<PluginValidation>(scoped(`${base}/${encodeURIComponent(id)}/validations`, projectId), { body: {}, csrf, interaction });
export const publishPluginRelease = (projectId: string, id: string, csrf: string, interaction?: InteractionContext) => request<PluginRelease>(scoped(`${base}/${encodeURIComponent(id)}/publish`, projectId), { body: {}, csrf, interaction });
export const activatePluginRelease = (projectId: string, id: string, csrf: string, interaction?: InteractionContext) => request<PluginRelease>(scoped(`${base}/${encodeURIComponent(id)}/activate`, projectId), { body: {}, csrf, interaction });
export async function downloadPluginTemplate(projectId: string, interaction?: InteractionContext) {
  const response = await instrumentedFetch(apiUrl(scoped(`${base}/template`, projectId)), { credentials: "include" }, interaction);
  if (!response.ok) throw new ApiError(`开发模板下载失败（${response.status}）`, response.status);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = "data-flywheel-plugin-template.zip"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
````

## apps/web/src/deployments-api.ts

````typescript
import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch } from "./telemetry";

export interface PipelineDeployment {
  id: string; name: string; revision: number; pipeline_id: string; pipeline_version: number;
  trigger_kind: "manual" | "interval" | "data"; interval_seconds: number | null;
  timezone: string; next_trigger_at: string | null; paused: boolean; use_cache: boolean;
  last_error: string | null; webhook_enabled: boolean;
  execution_snapshot: { profile: string; resource_kind?: string; worker_pool_id?: string };
}
export interface DeploymentInput {
  name: string; pipeline_id: string; pipeline_version: number; trigger_kind: PipelineDeployment["trigger_kind"];
  timezone: string; interval_seconds?: number; first_trigger_at?: string;
  environment_id?: string; worker_pool_id?: string; input_configs?: Record<string, Record<string, unknown>>;
}
async function request<T>(path: string, projectId: string, csrf?: string, body?: unknown): Promise<T> {
  const response = await instrumentedFetch(apiUrl(`/api/pipeline-deployments${path}${path.includes("?") ? "&" : "?"}project_id=${encodeURIComponent(projectId)}`), {
    credentials: "include", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try { const result = await response.json() as { detail?: unknown }; if (typeof result.detail === "string") message = result.detail; else if (Array.isArray(result.detail)) message = result.detail.map((item: { msg: string }) => item.msg).join("；"); } catch { /* Keep HTTP failure. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
export const deploymentsQueryFor = (projectId: string, pipelineId: string) => queryOptions({
  queryKey: ["pipeline-deployments", projectId, pipelineId],
  queryFn: () => request<PipelineDeployment[]>(`?pipeline_id=${encodeURIComponent(pipelineId)}`, projectId),
});
export const createDeployment = (projectId: string, csrf: string, input: DeploymentInput) => request<PipelineDeployment>("", projectId, csrf, input);
export const pauseDeployment = (projectId: string, csrf: string, id: string, paused: boolean) => request<PipelineDeployment>(`/${id}/state`, projectId, csrf, { paused });
export const triggerDeployment = (projectId: string, csrf: string, id: string, eventKey: string) => request<{ run_id: string }>(`/${id}/trigger`, projectId, csrf, { event_key: eventKey });
````

## apps/web/src/operator-route.ts

````typescript
import { useRouterState, useSearch } from "@tanstack/react-router";

export type OperatorRouteSearch = {
  project_id?: string;
  view?: "development";
  releaseId?: string;
  pluginId?: string;
  q?: string;
  offset?: number;
};

export function useOperatorSearch() {
  return useSearch({ strict: false }) as OperatorRouteSearch;
}

export function useOperatorBasePath(projectId: string) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname.startsWith(`/projects/${projectId}/operators`)
    ? `/projects/${projectId}/operators`
    : "/operators";
}
````

## apps/web/src/pages/pipelines.css

````css
.pipe-page { max-width: var(--console-page-max-width); font-size: 14px; }
.pipe-editor-identity { display: flex; align-items: end; gap: .75rem; padding-bottom: .8rem; }
.pipe-editor-identity label { flex: 1; max-width: 34rem; }
.pipe-editor-identity label span { display: block; font-size: 12px; color: var(--muted-foreground); margin-bottom: .3rem; }
.pipe-editor-identity input { width: 100%; min-height: var(--md-comp-outlined-text-field-container-height); padding: .5rem .7rem; border: 1px solid var(--input); border-radius: var(--console-radius-control); background: var(--card); }
.pipe-name-trigger { display: flex; align-items: center; gap: .5rem; max-width: 100%; text-align: start; }
.pipe-name-trigger svg { flex-shrink: 0; width: 1rem; color: var(--muted-foreground); }
.pipe-parameter-help { font-size: 12px; margin: .5rem 0; color: var(--muted-foreground); }
.pipe-parameter-help summary { cursor: pointer; color: var(--primary); padding: .3rem 0; }
.pipe-task-inspection { border-inline-start: 3px solid var(--primary); margin: .4rem .75rem 1rem; padding: .75rem 1rem; background: var(--md-sys-color-surface-container-low); }
.pipe-task-inspection h3 { font-size: 14px; font-weight: 500; }
.pipe-task-inspection > p { margin-top: .5rem; font-size: 14px; color: var(--muted-foreground); line-height: 20px; }
.pipe-task-inspection .pipe-artifact { margin-top: .5rem; padding-top: .75rem; }
.pipe-debug-controls { padding-bottom: 1rem; margin-bottom: 1rem; }
.pipe-debug-controls > p, .pipe-plan-summary > p { font-size: 14px; line-height: 20px; margin: .5rem 0; overflow-wrap: anywhere; }
.pipe-debug-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .75rem; }
.pipe-plan-summary { padding: .8rem; margin: 1rem 0; background: var(--md-sys-color-surface-container-low); border-radius: var(--console-radius-panel); overflow-wrap: anywhere; }
.pipe-plan-summary h3 { font-size: 14px; font-weight: 500; }
.pipe-plan-summary details { font-size: 14px; margin-top: .5rem; }
.pipe-plan-summary dd { overflow-wrap: anywhere; }
.pipe-run-canvas .pipe-reactflow { height: 24rem; min-height: 24rem; }
.pipe-run-inspection-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem); gap: .75rem; margin: 1rem 0; align-items: start; }
.pipe-run-inspection-grid > * { min-width: 0; }
.pipe-run-detail { container-type: inline-size; container-name: pipeline-run; }
@container pipeline-run (max-width: 48rem) { .pipe-run-inspection-grid { grid-template-columns: minmax(0, 1fr); } }
.pipe-run-filters { flex-wrap: wrap; }
.pipe-run-filters > h2 { margin-inline-end: auto; }
.pipe-list-filter > span { white-space: nowrap; }
@media(max-width: 600px) {
  .pipe-run-filters > h2 { flex-basis: 100%; }
  .pipe-run-filters .pipe-list-filter { flex: 1 1 9rem; }
  .pipe-run-filters .pipe-list-filter select { min-width: 0; flex: 1; }
}
.pipe-run-inspection-grid .pipe-task-inspection { margin: 0; max-height: 32rem; overflow-y: auto; }
.pipe-canvas-run-state { padding: .5rem .75rem; display: flex; flex-direction: column; gap: .25rem; font-size: 12px; }
.pipe-canvas-run-state small { max-width: 14rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pipe-canvas-card[data-status=failed], .pipe-canvas-card[data-status=interrupted] { border-color: var(--destructive); }
.pipe-document-preview { overflow-x: auto; margin: 1rem 0; }
.pipe-document-preview table { border-collapse: collapse; width: 100%; font-size: 14px; table-layout: fixed; }
.pipe-document-preview th, .pipe-document-preview td { padding: .5rem; text-align: start; vertical-align: top; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; white-space: pre-wrap; }
.pipe-document-preview th:first-child { width: 7rem; }
.pipe-document-preview p, .pipe-dataset-actions p { font-size: 14px; line-height: 20px; margin: .5rem 0; }
.pipe-input-preview > .pipe-artifact { padding: .75rem; border-radius: var(--console-radius-control); background: var(--md-sys-color-surface-container-low); }
@media(max-width: 1000px) { .pipe-run-inspection-grid { grid-template-columns: minmax(0, 1fr); } }
.pipe-back-link { display: inline-flex; align-items: center; gap: .4rem; color: var(--primary); font-size: 14px; margin-bottom: 1rem; }
.pipe-back-link svg { width: 1rem; }
.pipe-list-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin: 0 0 12px; font-size: 14px; color: var(--muted-foreground); }
.pipe-search { display: flex; align-items: center; flex: 1; min-width: 14rem; max-width: 32rem; gap: .65rem; min-height: var(--md-comp-outlined-text-field-container-height); padding: .5rem .75rem; border: 1px solid var(--input); border-radius: var(--console-radius-control); background: var(--card); }
.pipe-search svg { width: 1.1rem; height: 1.1rem; flex-shrink: 0; color: var(--muted-foreground); }
.pipe-search input { width: 100%; min-width: 0; outline: none; background: transparent; color: var(--foreground); font-size: 14px; }
.pipe-search:focus-within { outline: 2px solid var(--ring); outline-offset: 2px; }
.pipe-list-filter { display: flex; align-items: center; gap: .6rem; font-size: 14px; }
.pipe-list-filter select { min-height: var(--md-comp-outlined-text-field-container-height); max-width: 100%; border: 1px solid var(--input); border-radius: var(--console-radius-control); padding: .5rem .75rem; color: var(--foreground); background: var(--card); }
.pipe-operator-toolbar { gap: .75rem; }
.pipe-operator-toolbar .pipe-search { min-width: min(20rem, 100%); }
.pipe-operator-count { white-space: nowrap; }
.pipe-directory { border: 1px solid var(--border); border-radius: var(--console-radius-panel); overflow-x: auto; background: var(--card); }
.pipe-directory table { width: 100%; border-collapse: collapse; text-align: start; font-size: 14px; }
.pipe-directory th { font-size: 12px; font-weight: 500; color: var(--muted-foreground); background: var(--md-sys-color-surface-container-low); }
.pipe-directory th, .pipe-directory td { padding: .75rem 1rem; border-bottom: 1px solid var(--border); }
.pipe-directory tr:last-child td { border-bottom: 0; }
.pipe-directory th:first-child { width: 45%; }
.pipe-directory td:first-child a { color: var(--primary); font-weight: 500; }
.pipe-directory td p { color: var(--muted-foreground); margin-top: .3rem; font-size: 12px; max-width: 32rem; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.pipe-directory td:not(:first-child) { white-space: nowrap; }
.pipe-directory td:last-child svg { width: 1rem; }
.pipe-detail-page .pipe-page-heading { margin-bottom: 1rem; }
.pipe-detail-page .pipe-page-heading h1 { font-size: 24px; overflow-wrap: anywhere; }
.pipe-detail-page .pipe-page-heading p { max-width: 70rem; overflow-wrap: anywhere; }
.pipe-detail-page .pipe-page-heading p:first-child { font-size: 12px; }
.pipe-template-choice { display: flex; gap: .5rem; margin: 8px 0 12px; }
.pipe-template-choice a { padding: .65rem 1rem; border-radius: var(--console-radius-control); border: 1px solid var(--border); font-size: 14px; }
.pipe-template-choice a[data-active=true] { color: var(--primary); border-color: var(--primary); background: var(--accent); }
.pipe-template-form { max-width: 48rem; padding: 1.5rem; border: 1px solid var(--border); border-radius: var(--console-radius-panel); background: var(--card); }
.pipe-template-form h2 { font-size: 16px; font-weight: 500; }
.pipe-template-form > p { margin: .75rem 0 1.25rem; color: var(--muted-foreground); line-height: 20px; font-size: 14px; }
.pipe-template-form .pipe-field { margin: 1.5rem 0; }
.pipe-object-toolbar { position: sticky; top: var(--console-header-height, 4rem); z-index: 12; display: flex; justify-content: space-between; align-items: center; gap: .75rem; flex-wrap: wrap; padding: .85rem 1rem; margin-bottom: 8px; background: var(--md-sys-color-surface-container-low); border-radius: var(--console-radius-panel); }
.pipe-save-state { flex: 1; min-width: 9rem; overflow-wrap: anywhere; }
.pipe-save-state strong { display: block; font-size: 14px; font-weight: 500; }
.pipe-save-state span { display: block; font-size: 12px; color: var(--muted-foreground); margin-top: .25rem; }
.pipe-object-actions { display: flex; align-items: center; gap: .35rem; flex-wrap: wrap; }
.pipe-object-actions [data-slot=button] { min-height: 48px; height: auto; padding: 0; }
.pipe-canvas-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .5rem; padding: .4rem .75rem; background: var(--card); }
.pipe-canvas-bar > div { display: flex; }
.pipe-canvas-bar .pipe-checkbox { font-size: 12px; }
.pipe-development-grid { display: grid; gap: 8px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--console-radius-panel); overflow: hidden; align-items: stretch; background: var(--md-sys-color-surface); }
.pipe-development-grid > * { min-width: 0; }
.pipe-palette, .pipe-parameters { background: var(--md-sys-color-surface-container-low); padding: 1rem; overflow-y: auto; max-height: max(26rem, calc(100dvh - 20rem)); }
.pipe-search-small { min-width: 0; margin: 1rem 0; padding: .55rem; }
.pipe-search-small input { font-size: 12px; }
.pipe-palette-items { display: grid; gap: .35rem; }
.pipe-palette-items button { display: flex; align-items: center; justify-content: space-between; gap: .5rem; width: 100%; padding: .75rem .5rem; text-align: start; border: 1px solid transparent; border-radius: var(--console-radius-control); }
.pipe-palette-items button:hover:not(:disabled), .pipe-palette-items button:focus-visible { border-color: var(--primary); background: var(--accent); }
.pipe-palette-items button:not(.md-button):disabled { opacity: .38; }
.pipe-palette-items strong { display: block; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.pipe-palette-items small { display: block; margin-top: .25rem; font-size: 12px; color: var(--muted-foreground); }
.pipe-palette-items svg { width: 1rem; flex-shrink: 0; color: var(--primary); }
.pipe-parameters .pipe-field { margin-top: 1rem; }
.pipe-parameters h3 { font-size: 14px; font-weight: 500; margin-top: 1rem; }
.pipe-parameter-description { font-size: 12px; line-height: 16px; color: var(--muted-foreground); margin-top: .5rem; }
.pipe-editing-workspace .pipe-reactflow { height: clamp(26rem, calc(100dvh - 20rem), 45rem); min-height: 26rem; }
.pipe-more-menu { min-width: 12rem; background: var(--md-sys-color-surface-container); border: 1px solid var(--border); border-radius: var(--md-sys-shape-corner-extra-small); padding: .4rem; box-shadow: var(--md-sys-elevation-level-2); }
.pipe-more-menu [role=menuitem] { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 12px; border-radius: var(--md-sys-shape-corner-extra-small); font-size: 16px; line-height: 24px; cursor: pointer; outline: none; }
.pipe-more-menu [role=menuitem][data-highlighted] { background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent); }
.pipe-more-menu [data-disabled] { opacity: .38; }
.pipe-more-menu svg { width: 24px; height: 24px; flex-shrink: 0; }
.pipe-dialog { width: min(54rem, 100%); max-height: calc(100dvh - 2rem); overflow-y: auto; background: var(--md-sys-color-surface-container-high); border: 1px solid var(--border); border-radius: var(--md-sys-shape-corner-extra-large); padding: 1.5rem; box-shadow: var(--md-sys-elevation-level-3); }
.pipe-dialog [role=heading] { font-size: 22px; font-weight: 500; }
.pipe-dialog p { font-size: 14px; line-height: 20px; color: var(--muted-foreground); margin: .7rem 0; }
.pipe-metadata-dialog { max-width: 32rem; }
.pipe-metadata-dialog .pipe-field { margin: 1.25rem 0; }
.pipe-dialog-actions { display: flex; justify-content: flex-end; gap: .75rem; margin-top: 1.5rem; }
.pipe-drawer-viewport { position: fixed; inset: 0; z-index: 50; display: flex; justify-content: flex-end; }
.pipe-editor-drawer { width: min(25rem, 94vw); height: 100%; overflow-y: auto; background: var(--md-sys-color-surface-container-low); padding: 1rem; }
.pipe-editor-drawer > .pipe-section-heading:first-child { margin-bottom: 1.25rem; }
.pipe-editor-drawer .pipe-field { margin: 1rem 0; }
.pipe-editor-drawer [role=heading] { font-size: 16px; font-weight: 500; }
.pipe-version-workspace { display: grid; grid-template-columns: 15rem minmax(0, 1fr); gap: 1.5rem; }
.pipe-version-list h2 { font-size: 14px; font-weight: 500; margin-bottom: 1rem; }
.pipe-version-item { display: block; width: 100%; text-align: start; padding: .85rem; margin-bottom: .4rem; border: 1px solid transparent; border-radius: var(--console-radius-control); background: var(--md-sys-color-surface-container-low); }
.pipe-version-item[aria-pressed=true] { border-color: var(--primary); background: var(--accent); }
.pipe-version-item strong, .pipe-version-item span, .pipe-version-item small { display: block; font-size: 14px; margin: .2rem 0; overflow-wrap: anywhere; }
.pipe-version-item small { color: var(--muted-foreground); font-size: 12px; }
.pipe-version-detail { min-width: 0; padding: 16px; border-radius: var(--console-radius-panel); background: var(--md-sys-color-surface); }
.pipe-version-detail h2 { font-weight: 500; }
.pipe-version-detail p { font-size: 14px; color: var(--muted-foreground); }
.pipe-version-nodes { display: grid; gap: .75rem; margin: 1rem 0; list-style: none; }
.pipe-version-nodes li { padding: .85rem; border-radius: var(--console-radius-control); background: var(--md-sys-color-surface); }
.pipe-version-nodes strong, .pipe-version-nodes small { display: block; font-size: 14px; overflow-wrap: anywhere; }
.pipe-version-nodes small { color: var(--muted-foreground); margin: .3rem 0; font-size: 12px; }
.pipe-version-detail details, .pipe-operator-card details, .pipe-registration-list details, .pipe-developer-help { font-size: 14px; margin: .75rem 0; }
.pipe-version-detail summary, .pipe-operator-card summary, .pipe-registration-list summary, .pipe-developer-help summary { cursor: pointer; color: var(--primary); }
.pipe-version-detail pre, .pipe-operator-card pre { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: .6rem; font-size: 12px; }
.pipe-operator-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(19rem, 100%), 1fr)); gap: 1rem; }
.pipe-operator-card { padding: 16px; background: var(--md-sys-color-surface); border-radius: var(--console-radius-panel); min-width: 0; }
.pipe-operator-card h2 { font-size: 16px; font-weight: 500; margin: .85rem 0 .4rem; }
.pipe-operator-card p { font-size: 14px; line-height: 20px; color: var(--muted-foreground); }
.pipe-operator-card > small { display: block; margin-top: .6rem; font-size: 12px; color: var(--muted-foreground); overflow-wrap: anywhere; }
.pipe-operator-meta { display: flex; align-items: center; flex-wrap: wrap; gap: .45rem; }
.pipe-operator-meta > svg { width: 1.25rem; color: var(--primary); margin-inline-end: .15rem; }
.pipe-control-section { margin-top: 2rem; }
.pipe-admin-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: 2rem; align-items: start; }
.pipe-admin-grid .pipe-metadata-form { margin-top: 0; }
.pipe-form-panel { max-width: 52rem; }
.pipe-empty.pipe-empty-compact { min-height: 10rem; padding-block: 2rem; }
@media (max-width: 900px) { .pipe-admin-grid { grid-template-columns: 1fr; } }
.pipe-plain-list { display: grid; gap: .6rem; margin-top: 1rem; list-style: none; }
.pipe-plain-list li { padding: .7rem; border-radius: var(--console-radius-control); background: var(--md-sys-color-surface-container-low); font-size: 14px; line-height: 20px; }
.pipe-plain-list svg { display: inline; width: 1rem; vertical-align: text-bottom; color: var(--primary); }
.pipe-plain-list small { color: var(--muted-foreground); }
.pipe-operator-card .pipe-section-heading > svg { width: 1.25rem; color: var(--primary); }
.pipe-registration-list { display: grid; gap: 1rem; margin-top: 1.25rem; }
.pipe-registration-list .pipe-plugin-card { padding: 1.2rem; }
.pipe-registration-list ul { list-style: disc; padding-inline-start: 1.2rem; line-height: 1.8; }
.pipe-developer-help { margin-top: 1.5rem; padding: 1rem 0; color: var(--muted-foreground); line-height: 1.8; }
.pipe-developer-help p { margin-top: .75rem; }
.pipe-run-item[aria-current=true] { border-color: var(--primary); background: var(--card); }
@media (max-width: 760px) {
  .pipe-object-toolbar { top: var(--console-header-height, 4rem); padding: .75rem; }
  .pipe-object-actions { width: 100%; gap: .3rem; }
  .pipe-object-actions [data-slot=button] { min-height: 48px; height: auto; padding: 0; }
  .pipe-version-workspace { grid-template-columns: minmax(0, 1fr); }
  .pipe-version-list { display: flex; overflow-x: auto; gap: .5rem; flex-wrap: wrap; }
  .pipe-version-list h2 { width: 100%; margin-bottom: .3rem; }
  .pipe-version-item { width: 10rem; flex-shrink: 0; }
  .pipe-list-toolbar { align-items: stretch; gap: .75rem; }
  .pipe-search { min-width: 0; flex-basis: 100%; max-width: none; }
  .pipe-operator-toolbar .pipe-list-filter { flex: 1 1 10rem; }
  .pipe-operator-toolbar .pipe-list-filter select { flex: 1; }
  .pipe-operator-count { flex: 1 1 100%; }
  .pipe-directory th, .pipe-directory td { padding: .85rem .75rem; }
  .pipe-directory th:first-child { width: auto; }
  .pipe-directory td:first-child { min-width: 8rem; }
  .pipe-directory td:first-child a { overflow-wrap: anywhere; }
  .pipe-dialog { padding: 1rem; }
  .pipe-canvas-bar { padding: .35rem; }
}
.pipe-page-heading, .pipe-section-heading, .pipe-editor-heading, .pipe-toolbar, .pipe-project, .pipe-tabs, .pipe-add-node, .pipe-run-bar, .pipe-run-bar > div { display: flex; align-items: center; gap: .75rem; }
.pipe-page-heading, .pipe-section-heading, .pipe-editor-heading, .pipe-run-bar { justify-content: space-between; }
.pipe-page-heading { margin-bottom: 8px; flex-wrap: wrap; }
.pipe-page-heading > div:first-child { min-width: 0; }
.pipe-page-heading h1 { margin: 0; }
.pipe-heading-actions { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
.pipe-page-heading p, .pipe-section-heading p { color: var(--muted-foreground); margin-top: 4px; font-size: 14px; line-height: 20px; }
.pipe-project { padding: .5rem .875rem; border-radius: var(--console-radius-control); background: var(--muted); font-size: 14px; }
.pipe-tabs { border-bottom: 1px solid var(--border); margin-bottom: 8px; gap: 1.5rem; }
.pipe-tabs > button { display: flex; align-items: center; justify-content: center; gap: .5rem; min-height: 3rem; padding: .5rem .25rem; font-size: 14px; font-weight: 500; color: var(--muted-foreground); border-bottom: 3px solid transparent; }
.pipe-tabs > button[aria-selected="true"] { color: var(--primary); border-color: var(--primary); }
.pipe-tabs svg { width: 1.125rem; height: 1.125rem; }
.pipe-tabs > button > span { padding: 0 .45rem; border-radius: var(--console-radius-panel); background: var(--muted); font-size: 12px; }
.pipe-workspace { display: grid; grid-template-columns: 14rem minmax(0, 1fr); gap: 1.25rem; align-items: start; }
.pipe-sidebar { padding: 1rem 0; min-width: 0; }
.pipe-section-heading h2, .pipe-section-heading h3 { display: flex; align-items: center; gap: .5rem; font-weight: 500; font-size: 16px; }
.pipe-section-heading h2 > span { color: var(--muted-foreground); font-size: 14px; font-weight: 400; }
.pipe-saved-list { margin-top: .75rem; display: grid; gap: .375rem; }
.pipe-saved-item { display: flex; align-items: center; gap: .6rem; text-align: start; padding: .85rem .75rem; min-height: 3.5rem; border-radius: var(--console-radius-panel); width: 100%; }
.pipe-saved-item > svg { width: 1.1rem; height: 1.1rem; flex-shrink: 0; color: var(--muted-foreground); }
.pipe-saved-item > svg:last-child { width: 1rem; }
.pipe-saved-item > span { flex: 1; min-width: 0; }
.pipe-saved-item strong { font-size: 14px; font-weight: 500; display: block; overflow-wrap: anywhere; }
.pipe-saved-item small, .pipe-run-item small { display: block; margin-top: .3rem; font-size: 12px; color: var(--muted-foreground); }
.pipe-saved-item:hover { background: var(--muted); }
.pipe-saved-item[aria-pressed="true"] { background: var(--accent); color: var(--accent-foreground); }
.pipe-empty-copy { font-size: 14px; line-height: 20px; color: var(--muted-foreground); margin: 1rem .5rem; }
.pipe-starter { background: var(--md-sys-color-surface-container-low); border-radius: var(--console-radius-panel); padding: 1.25rem; margin-top: 1.5rem; }
.pipe-starter > svg { color: var(--primary); width: 1.5rem; margin-bottom: .75rem; }
.pipe-starter h3 { font-weight: 500; font-size: 16px; }
.pipe-starter p { font-size: 14px; color: var(--muted-foreground); line-height: 20px; margin: .5rem 0 1rem; }
.pipe-sidebar-footer { margin-top: 1.5rem; padding: 1rem .5rem; font-size: 14px; }
.pipe-sidebar-footer > span, .pipe-sidebar-footer > button { display: flex; align-items: center; gap: .5rem; }
.pipe-sidebar-footer > span { color: var(--muted-foreground); }
.pipe-sidebar-footer > button { color: var(--primary); margin-top: .75rem; min-height: 2.5rem; }
.pipe-sidebar-footer svg { width: 1rem; height: 1rem; }
.pipe-editor { border-radius: var(--console-radius-panel); border: 1px solid var(--border); background: var(--card); min-width: 0; overflow: hidden; }
.pipe-editor-heading { padding: 1.25rem 1.5rem .5rem; align-items: start; flex-wrap: wrap; }
.pipe-title-field { min-width: 0; flex: 1; }
.pipe-title-field > input { width: 100%; min-width: 9rem; font-size: 22px; font-weight: 500; padding: .25rem 0; border-bottom: 1px solid transparent; outline-offset: .25rem; background: transparent; }
.pipe-title-field > input:hover:not(:disabled) { border-color: var(--border); }
.pipe-title-field > div { display: flex; align-items: center; gap: .75rem; margin-top: .4rem; font-size: 12px; color: var(--muted-foreground); }
.pipe-toolbar { flex-wrap: wrap; gap: .25rem; }
.pipe-description { display: block; width: calc(100% - 3rem); margin: .5rem 1.5rem 1rem; padding: .25rem 0; resize: vertical; font-size: 14px; line-height: 20px; color: var(--muted-foreground); background: transparent; }
.pipe-add-node { background: var(--md-sys-color-surface-container-low); padding: .875rem 1.5rem; }
.pipe-add-node select { min-width: 0; flex: 1; min-height: var(--md-comp-outlined-text-field-container-height); border: 1px solid var(--border); border-radius: var(--console-radius-control); padding: .5rem .75rem; font-size: 14px; background: var(--card); }
.pipe-composer { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(16rem, .85fr); gap: 12px; min-height: 28rem; }
.pipe-canvas-workspace { min-width: 0; background: var(--md-sys-color-surface-container-low); }
.pipe-reactflow { height: 40rem; min-height: 30rem; width: 100%; }
.pipe-reactflow .react-flow { --xy-edge-stroke-selected: var(--primary); --xy-controls-button-background-color: var(--card); --xy-controls-button-color: var(--foreground); --xy-minimap-background-color: var(--card); }
.pipe-reactflow .react-flow__node:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; border-radius: var(--console-radius-panel); }
.pipe-reactflow .react-flow__handle { width: 12px; height: 12px; background: var(--card); border: 2px solid var(--primary); }
.pipe-reactflow .react-flow__handle.valid { background: var(--success); border-color: var(--success); }
.pipe-reactflow .react-flow__edge.selected .react-flow__edge-path { stroke-width: 3; }
.pipe-reactflow .react-flow__minimap { width: 105px; height: 75px; }
.pipe-canvas-card { width: 245px; border: 1px solid var(--border); border-radius: var(--console-radius-panel); background: var(--card); box-shadow: 0 1px 3px #0000000d; }
.pipe-canvas-card[data-selected="true"] { border-color: var(--primary); outline: 1px solid var(--primary); }
.pipe-canvas-card-heading { display: flex; align-items: center; gap: .7rem; padding: .85rem .9rem .7rem; }
.pipe-canvas-inputs { display: flex; flex-wrap: wrap; justify-content: space-around; gap: .2rem .5rem; padding: .35rem .6rem 0; color: var(--muted-foreground); font-size: 12px; }
.pipe-canvas-card-heading > div { min-width: 0; }
.pipe-canvas-card-heading strong { display: block; font-size: 14px; font-weight: 500; line-height: 20px; }
.pipe-canvas-card-heading small { display: block; color: var(--muted-foreground); font-size: 12px; margin-top: .2rem; overflow-wrap: anywhere; }
.pipe-canvas-card-footer { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .35rem .85rem; font-size: 12px; color: var(--muted-foreground); }
.pipe-canvas-card-footer > span { overflow-wrap: anywhere; }
.pipe-canvas-card-footer button { min-height: 48px; padding: .2rem .4rem; border-radius: var(--console-radius-control); color: var(--primary); font-size: 12px; }
.pipe-canvas-card-footer button:hover { background: var(--accent); }
.pipe-canvas-tools { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
.pipe-canvas-tools > span { display: flex; align-items: center; gap: .35rem; font-size: 12px; padding: .5rem; border-radius: var(--console-radius-control); color: var(--muted-foreground); background: var(--card); }
.pipe-canvas-tools > span > svg { width: .8rem; height: .8rem; }
.pipe-canvas-tools > button { height: 2rem; padding: .25rem .5rem; font-size: 12px; background: var(--card); }
.pipe-flow { padding: 1.5rem; min-width: 0; background-image: radial-gradient(var(--border) .7px, transparent .7px); background-size: 16px 16px; background-color: var(--md-sys-color-surface-container-low); }
.pipe-flow-connection { display: flex; align-items: center; gap: .5rem; padding: .375rem 0 .375rem 1.25rem; color: var(--muted-foreground); font-size: 12px; min-height: 2.25rem; overflow-wrap: anywhere; }
.pipe-flow-connection svg { width: 1rem; height: 1rem; flex-shrink: 0; }
.pipe-node { display: flex; align-items: center; text-align: start; gap: .75rem; padding: .875rem; border: 1px solid var(--border); border-radius: var(--console-radius-panel); background: var(--card); width: 100%; min-height: 5rem; box-shadow: 0 1px 2px #00000006; }
.pipe-node[aria-pressed="true"] { border-color: var(--primary); outline: 1px solid var(--primary); }
.pipe-node:hover { box-shadow: var(--md-sys-elevation-level-1); }
.pipe-node-icon { width: 2.5rem; height: 2.5rem; display: grid; place-items: center; flex-shrink: 0; border-radius: var(--console-radius-panel); color: var(--primary); background: var(--accent); }
.pipe-node-icon svg { width: 1.2rem; height: 1.2rem; }
.pipe-kind-source { color: var(--md-sys-color-tertiary); background: var(--md-sys-color-tertiary-container); }
.pipe-kind-sink { color: var(--secondary-foreground); background: var(--secondary); }
.pipe-node-text { min-width: 0; flex: 1; }
.pipe-node-text strong { display: block; font-size: 14px; font-weight: 500; }
.pipe-node-text small { display: block; font-size: 12px; margin-top: .25rem; color: var(--muted-foreground); overflow-wrap: anywhere; }
.pipe-node-type { font-size: 12px; color: var(--muted-foreground); flex-shrink: 0; }
.pipe-inspector { min-width: 0; padding: 1.25rem; background: var(--md-sys-color-surface-container-low); }
.pipe-inspector .pipe-section-heading { align-items: start; }
.pipe-inspector .pipe-section-heading > div { flex: 1; min-width: 0; }
.pipe-contract { display: flex; align-items: center; gap: .5rem; font-size: 12px; color: var(--primary); margin: 1.25rem 0; }
.pipe-contract > span { background: var(--md-sys-color-surface-container-low); border-radius: var(--console-radius-control); padding: .35rem .55rem; }
.pipe-contract > svg { width: 1rem; height: 1rem; }
.pipe-field { margin-bottom: 1.1rem; min-width: 0; }
.pipe-field label { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: .5rem; font-weight: 500; }
.pipe-field label > span { color: var(--muted-foreground); font-size: 12px; font-weight: 400; }
.pipe-field input, .pipe-field select, .pipe-field textarea { display: block; width: 100%; min-width: 0; border: 1px solid var(--input); border-radius: var(--console-radius-control); min-height: var(--md-comp-outlined-text-field-container-height); padding: .5rem .75rem; background: var(--card); color: var(--foreground); font-size: 14px; }
.pipe-field select { text-overflow: ellipsis; }
.pipe-field small { display: block; color: var(--muted-foreground); margin-top: .5rem; font-size: 12px; line-height: 16px; }
.pipe-field small.text-destructive { color: var(--destructive); }
.pipe-field textarea { resize: vertical; line-height: 1.7; }
.pipe-field .pipe-code-input { font-family: var(--font-mono); font-size: 14px; }
.pipe-checkbox { display: flex; gap: .5rem; align-items: center; min-height: var(--md-comp-outlined-text-field-container-height); font-size: 14px; }
.pipe-checkbox input { width: 1.1rem; height: 1.1rem; accent-color: var(--primary); flex-shrink: 0; }
.pipe-inspector-footer { display: flex; align-items: start; gap: .5rem; margin-top: 1.5rem; padding-top: 1rem; font-size: 12px; color: var(--muted-foreground); line-height: 16px; }
.pipe-inspector-footer svg { width: 1rem; height: 1rem; flex-shrink: 0; }
.pipe-inspector-placeholder { display: flex; flex-direction: column; align-items: center; padding: 4rem .5rem; color: var(--muted-foreground); font-size: 14px; text-align: center; gap: 1rem; }
.pipe-run-bar { flex-wrap: wrap; padding: 1rem 1.5rem; }
.pipe-run-bar small { width: 100%; color: var(--muted-foreground); font-size: 12px; }
.pipe-scope-note { font-size: 12px; color: var(--muted-foreground); padding: .75rem 1.5rem; background: var(--md-sys-color-surface-container-low); line-height: 16px; }
.pipe-empty { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: .75rem; text-align: center; padding: 3rem 1rem; min-height: 16rem; }
.pipe-empty > svg { color: var(--primary); width: 2rem; height: 2rem; }
.pipe-empty h3 { font-size: 16px; font-weight: 500; }
.pipe-empty p { font-size: 14px; color: var(--muted-foreground); line-height: 20px; max-width: 24rem; }
.pipe-notice { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; padding: .875rem 1rem; margin: .875rem 0; border-radius: var(--console-radius-panel); background: var(--md-sys-color-warning-container); color: var(--md-sys-color-on-warning-container); font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.pipe-editor > .pipe-notice { margin: .875rem 1.5rem; }
.pipe-notice > svg { width: 1.2rem; height: 1.2rem; flex-shrink: 0; }
.pipe-notice > span, .pipe-notice > div { flex: 1; min-width: 10rem; }
.pipe-notice ul { list-style: disc; margin: .5rem 0 0 1.25rem; }
.pipe-success { color: var(--md-sys-color-on-success-container); background: var(--md-sys-color-success-container); }
.pipe-error { color: var(--md-sys-color-on-error-container); background: var(--md-sys-color-error-container); }
.pipe-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; min-height: 15rem; color: var(--muted-foreground); }
.pipe-plugin-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5rem; align-items: start; }
.pipe-plugin-card { background: var(--md-sys-color-surface); border-radius: var(--console-radius-panel); padding: 16px; min-width: 0; }
.pipe-plugin-icon { display: grid; place-items: center; width: 3rem; height: 3rem; background: var(--accent); color: var(--primary); border-radius: var(--console-radius-panel); }
.pipe-plugin-card > h3 { font-weight: 500; font-size: 16px; margin-top: 1rem; }
.pipe-plugin-card > p { font-size: 14px; line-height: 20px; color: var(--muted-foreground); margin: .5rem 0; }
.pipe-plugin-card > small { display: block; font-size: 12px; color: var(--muted-foreground); overflow-wrap: anywhere; }
.pipe-plugin-operators { margin: 1.25rem 0; }
.pipe-plugin-operators > div { display: flex; align-items: center; gap: .75rem; padding: .85rem 0; }
.pipe-plugin-operators svg { width: 1.1rem; height: 1.1rem; color: var(--primary); }
.pipe-plugin-operators > div > span:first-of-type { flex: 1; min-width: 0; }
.pipe-plugin-operators strong { display: block; font-size: 14px; font-weight: 500; }
.pipe-plugin-operators small, .pipe-plugin-operators > div > span:last-child { font-size: 12px; color: var(--muted-foreground); }
.pipe-sdk-note { display: flex; align-items: start; gap: 1rem; padding: 1.5rem; background: var(--md-sys-color-surface-container-low); border-radius: var(--console-radius-panel); margin-top: 1.5rem; }
.pipe-sdk-note > svg { color: var(--primary); flex-shrink: 0; }
.pipe-sdk-note h3 { font-size: 16px; font-weight: 500; }
.pipe-sdk-note p { font-size: 14px; color: var(--muted-foreground); line-height: 20px; margin-top: .5rem; }
.pipe-sdk-note code { overflow-wrap: anywhere; }
.pipe-runs-workspace { display: grid; grid-template-columns: 19rem minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.pipe-run-list { min-width: 0; }
.pipe-run-list > .pipe-section-heading { margin-bottom: 1rem; }
.pipe-run-item { display: flex; align-items: center; justify-content: space-between; gap: .75rem; width: 100%; padding: 1rem; text-align: start; border-radius: var(--console-radius-panel); margin-bottom: .5rem; border: 1px solid transparent; }
.pipe-run-item:hover { background: var(--muted); }
.pipe-run-item[aria-pressed="true"] { border-color: var(--primary); background: var(--card); }
.pipe-run-item strong { font-weight: 500; font-size: 14px; overflow-wrap: anywhere; }
.pipe-run-content { min-width: 0; background: var(--md-sys-color-surface); border-radius: var(--console-radius-panel); padding: 16px; }
.pipe-task-table { margin-top: 1.5rem; }
.pipe-task-head, .pipe-task-row { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(5rem, .8fr) minmax(5rem, .9fr) minmax(4rem, .7fr); align-items: center; gap: .5rem; width: 100%; padding: .875rem .75rem; text-align: start; font-size: 14px; }
.pipe-task-head { color: var(--muted-foreground); font-size: 12px; border-bottom: 1px solid var(--border); }
.pipe-task-row { border-radius: var(--console-radius-panel); min-height: 3.5rem; }
.pipe-task-row:hover:not(:disabled) { background: var(--muted); }
.pipe-task-row[aria-pressed="true"] { background: var(--accent); }
.pipe-task-row strong { display: block; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.pipe-task-row small { display: block; font-size: 12px; color: var(--muted-foreground); overflow-wrap: anywhere; margin-top: .25rem; }
.pipe-task-row > [data-slot="badge"] { justify-self: start; }
.pipe-task-error { padding: .5rem .75rem; font-size: 14px; color: var(--destructive); overflow-wrap: anywhere; }
.pipe-task-block > .task-progress { margin: 0 .75rem 1rem; }
.pipe-artifact { padding-top: 12px; margin-top: 12px; }
.pipe-artifact .pipe-section-heading { flex-wrap: wrap; }
.pipe-metadata { display: flex; gap: 1.5rem; flex-wrap: wrap; font-size: 12px; padding: 1rem 0; }
.pipe-metadata dt { color: var(--muted-foreground); margin-bottom: .35rem; }
.pipe-metadata dd { font-family: var(--font-mono); }
.pipe-artifact details { font-size: 14px; color: var(--muted-foreground); }
.pipe-artifact summary { cursor: pointer; padding: .5rem 0; }
.pipe-artifact pre { background: var(--md-sys-color-surface-container-low); padding: 1rem; font-size: 12px; line-height: 16px; overflow: auto; max-height: 32rem; border-radius: var(--console-radius-panel); white-space: pre-wrap; overflow-wrap: anywhere; }
.pipe-page button:focus-visible, .pipe-page input:focus-visible, .pipe-page textarea:focus-visible, .pipe-page select:focus-visible, .pipe-page summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.pipe-page button:disabled, .pipe-page input:disabled, .pipe-page select:disabled, .pipe-page textarea:disabled { cursor: default; }
.pipe-page button:not(.md-button):disabled { opacity: .38; }
@media (max-width: 1200px) {
  .pipe-workspace { grid-template-columns: 11rem minmax(0, 1fr); gap: 1rem; }
  .pipe-composer { grid-template-columns: minmax(0, 1fr) minmax(14rem, .95fr); }
  .pipe-flow { padding: 1rem; }
  .pipe-inspector { padding: 1rem; }
  .pipe-node-type { display: none; }
  .pipe-node { padding: .75rem; gap: .5rem; }
  .pipe-runs-workspace { grid-template-columns: 15rem minmax(0, 1fr); gap: 1rem; }
}
@media (max-width: 1000px) {
  .pipe-workspace { grid-template-columns: minmax(0, 1fr); }
  .pipe-sidebar { padding: 0; }
  .pipe-starter, .pipe-sidebar-footer { display: none; }
  .pipe-saved-list { display: flex; overflow: auto; margin-bottom: 1rem; }
  .pipe-saved-item { width: 15rem; flex-shrink: 0; }
  .pipe-runs-workspace { grid-template-columns: minmax(0, 1fr); }
  .pipe-run-list { max-height: 18rem; overflow: auto; }
}
@media (max-width: 600px) {
  .pipe-tabs { gap: .25rem; justify-content: space-between; }
  .pipe-tabs > button { flex: 1; gap: .375rem; font-size: 14px; }
  .pipe-tabs > button > span { display: none; }
  .pipe-editor-heading, .pipe-add-node, .pipe-run-bar { padding: 1rem; }
  .pipe-editor-heading { display: block; }
  .pipe-toolbar { margin-top: .75rem; justify-content: flex-end; }
  .pipe-description { width: calc(100% - 2rem); margin-inline-start: 1rem; margin-inline-end: 1rem; }
  .pipe-composer { grid-template-columns: minmax(0, 1fr); }
  .pipe-flow { max-height: 29rem; overflow: auto; }
  .pipe-inspector { border: 0; }
  .pipe-node-type { display: inline; }
  .pipe-inspector-placeholder { padding: 1rem; }
  .pipe-plugin-grid { grid-template-columns: minmax(0, 1fr); }
  .pipe-plugin-card, .pipe-run-content { padding: 1rem; }
  .pipe-task-head, .pipe-task-row { grid-template-columns: minmax(0, 1.5fr) minmax(4rem, .9fr) minmax(4.5rem, .8fr) minmax(3rem, .6fr); padding-inline-start: .35rem; padding-inline-end: .35rem; }
  .pipe-sdk-note { padding: 1rem; }
  .pipe-editor > .pipe-notice { margin: .75rem 1rem; }
  .pipe-scope-note { padding: .75rem 1rem; }
}

/* The editor spends the viewport on the graph, keeping metadata in its dialog. */
.md-page.pipe-detail-page { padding-top: .75rem; padding-bottom: 1rem; }
.pipe-detail-page > .pipe-back-link { margin-bottom: .35rem; font-size: 12px; line-height: 16px; }
.pipe-detail-heading { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; min-width: 0; margin: .3rem 0 .5rem; }
.pipe-detail-heading h1 { min-width: 0; font-size: 24px; line-height: 32px; font-weight: var(--md-sys-typescale-headline-small-weight); max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.pipe-detail-heading > span:last-child { color: var(--muted-foreground); font-size: 12px; margin-inline-start: auto; white-space: nowrap; }
.pipe-detail-page .pipe-tabs { margin-bottom: 8px; gap: 1.25rem; }
.pipe-detail-page .pipe-tabs > button { min-height: 48px; padding: 12px 16px; font-size: 14px; }
.pipe-object-toolbar { padding: .45rem .6rem; min-height: 3.35rem; flex-wrap: nowrap; }
.pipe-panel-toggles { display: flex; align-items: center; gap: .1rem; min-width: 0; }
.pipe-panel-toggles > button { min-height: 48px; height: auto; padding: 0; }
.pipe-save-indicator { font-size: 12px; color: var(--muted-foreground); white-space: nowrap; margin-inline-start: .4rem; }
.pipe-pagination { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .75rem; padding: 1rem 0; color: var(--muted-foreground); font-size: 14px; }
.pipe-pagination > div { display: flex; gap: .5rem; }
.pipe-object-actions { flex-wrap: nowrap; }
.pipe-object-actions [data-slot=button] { min-height: 48px; height: auto; padding: 0; }
.pipe-development-grid > .pipe-palette, .pipe-development-grid > .pipe-parameters { max-height: max(25rem, calc(100dvh - 16rem)); }
.pipe-editing-workspace .pipe-reactflow { height: max(25rem, calc(100dvh - 16rem)); min-height: 25rem; }
.pipe-editing-workspace .pipe-canvas-workspace > .pipe-empty { min-height: max(25rem, calc(100dvh - 16rem)); }
.pipe-more-menu [role=menuitemcheckbox] { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 12px; border-radius: var(--md-sys-shape-corner-extra-small); font-size: 16px; line-height: 24px; cursor: pointer; outline: none; }
.pipe-more-menu [role=menuitemcheckbox][data-highlighted] { background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent); }
@media (max-width: 760px) {
  .pipe-detail-heading { flex-wrap: wrap; gap: .4rem; }
  .pipe-detail-heading h1 { max-width: calc(100% - 4rem); font-size: 22px; }
  .pipe-detail-heading > span:last-child { display: none; }
  .pipe-object-toolbar { flex-wrap: wrap; gap: .3rem; }
  .pipe-object-actions { width: auto; flex: 1; justify-content: flex-end; flex-wrap: wrap; }
  .pipe-save-indicator { display: none; }
  .pipe-panel-toggles > button { min-height: 48px; height: auto; padding: 0; }
  .pipe-panel-toggles svg { width: 1rem; }
  .pipe-object-actions [data-slot=button] { min-height: 48px; height: auto; padding: 0; }
  .pipe-editing-workspace .pipe-reactflow { height: max(24rem, calc(100dvh - 17rem)); min-height: 24rem; }
}

.pipe-directory-error { margin-block: 1rem; }
.pipe-empty h2 { font-size: 16px; font-weight: 500; }

.pipe-dialog [role="heading"], .pipe-dialog > h2, .pipe-dialog .pipe-section-heading > h2 { font-size: 24px; line-height: 32px; font-weight: 400; }
.pipe-dialog p { font-size: 14px; line-height: 20px; letter-spacing: .25px; }
.pipe-canvas-tools button, .pipe-canvas-card-footer button { min-width: 48px; min-height: 48px; height: auto; border-radius: var(--md-sys-shape-corner-full); }
.pipe-canvas-card-footer { min-height: 48px; }
.pipe-tabs > button { min-height: 48px; font-size: 14px; line-height: 20px; }
.pipe-search { padding: 0 16px; border: 0; min-height: 56px; background: var(--md-sys-color-surface-container-high); border-radius: var(--md-sys-shape-corner-full); }
.pipe-search input { font-size: 16px; line-height: 24px; background: transparent; }
.pipe-search svg { width: 24px; height: 24px; }
.pipe-list-filter select, .pipe-field input, .pipe-field select, .pipe-field textarea { border-color: var(--md-sys-color-outline); font-size: 16px; line-height: 24px; }
.pipe-field textarea { padding: 16px; }
.pipe-directory a, .pipe-artifact p a { text-decoration: underline; text-underline-offset: 3px; }

/* List choices are toolbar actions; editor fields keep their form dimensions. */
.pipe-list-toolbar > .md-button, .pipe-run-filters > .md-button { min-width: 0; max-width: 100%; }
.pipe-list-toolbar > .md-button .md-button-container, .pipe-run-filters > .md-button .md-button-container { max-width: 280px; min-width: 0; }

/* Inspectors use an anchored temporary surface instead of expanding the run bar. */
.pipe-execution-positioner { z-index: 40; max-width: calc(100vw - 32px); }
.pipe-execution-selection-panel { display: grid; gap: 12px; width: min(360px, calc(100vw - 32px)); max-height: min(560px, var(--available-height)); overflow-y: auto; padding: 16px; border-radius: var(--md-sys-shape-corner-medium); background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); box-shadow: var(--md-sys-elevation-level-2); font-size: 14px; line-height: 20px; }
.pipe-execution-selection-panel .pipe-field { display: grid; gap: 8px; margin: 0; }
.pipe-execution-selection-panel .pipe-field > span { font-size: 12px; line-height: 16px; color: var(--md-sys-color-on-surface-variant); }
.pipe-execution-selection-panel p { margin: 0; overflow-wrap: anywhere; }
.pipe-execution-selection-panel select:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.pipe-page details > summary { min-height: 48px; padding-block: 12px; overflow-wrap: anywhere; }

.pipe-artifact pre:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 2px; }

.pipe-task-inspection:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

.pipe-viewport-controls { display: flex; flex-direction: column; border-radius: var(--md-sys-shape-corner-medium); background: var(--md-sys-color-surface-container-low); box-shadow: var(--md-sys-elevation-level-1); }

.pipe-runtime-directory:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

/* Complete typography roles prevent body metrics from leaking into titles and controls. */
.pipe-template-form h2, .pipe-operator-card h2, .pipe-section-heading h2, .pipe-section-heading h3, .pipe-starter h3, .pipe-empty h2, .pipe-empty h3, .pipe-plugin-card > h3, .pipe-sdk-note h3, .pipe-editor-drawer [role="heading"], .pipe-version-detail h2 { font-size: var(--md-sys-typescale-title-medium-size); line-height: var(--md-sys-typescale-title-medium-line-height); font-weight: var(--md-sys-typescale-title-medium-weight); letter-spacing: var(--md-sys-typescale-title-medium-tracking); }
.pipe-task-inspection h3, .pipe-plan-summary h3, .pipe-parameters h3, .pipe-version-list h2, .pipe-save-state strong, .pipe-palette-items strong, .pipe-saved-item strong, .pipe-canvas-card-heading strong, .pipe-node-text strong, .pipe-plugin-operators strong, .pipe-run-item strong, .pipe-task-row strong { font-size: var(--md-sys-typescale-title-small-size); line-height: var(--md-sys-typescale-title-small-line-height); font-weight: var(--md-sys-typescale-title-small-weight); letter-spacing: var(--md-sys-typescale-title-small-tracking); }
.pipe-directory th, .pipe-task-head { font-size: var(--md-sys-typescale-label-medium-size); line-height: var(--md-sys-typescale-label-medium-line-height); font-weight: var(--md-sys-typescale-label-medium-weight); letter-spacing: var(--md-sys-typescale-label-medium-tracking); }
.pipe-tabs > button, .pipe-field label { font-size: var(--md-sys-typescale-label-large-size); line-height: var(--md-sys-typescale-label-large-line-height); font-weight: var(--md-sys-typescale-label-large-weight); letter-spacing: var(--md-sys-typescale-label-large-tracking); }
.pipe-directory table, .pipe-section-heading h2 > span, .pipe-version-item span, .pipe-version-nodes strong { font-size: var(--md-sys-typescale-body-medium-size); line-height: var(--md-sys-typescale-body-medium-line-height); font-weight: var(--md-sys-typescale-body-medium-weight); letter-spacing: var(--md-sys-typescale-body-medium-tracking); }
.pipe-more-menu [role="menuitem"], .pipe-more-menu [role="menuitemcheckbox"], .pipe-field input:not(.pipe-code-input), .pipe-field select, .pipe-field textarea:not(.pipe-code-input) { font-size: var(--md-sys-typescale-body-large-size); line-height: var(--md-sys-typescale-body-large-line-height); font-weight: var(--md-sys-typescale-body-large-weight); letter-spacing: var(--md-sys-typescale-body-large-tracking); }
.pipe-metadata, .pipe-directory td p, .pipe-palette-items small, .pipe-save-state span, .pipe-parameter-help, .pipe-editor-identity label span, .pipe-version-item small, .pipe-version-nodes small, .pipe-operator-card > small, .pipe-saved-item small, .pipe-run-item small, .pipe-tabs > button > span, .pipe-canvas-card-heading small, .pipe-canvas-card-footer, .pipe-node-text small, .pipe-node-type, .pipe-plugin-card > small, .pipe-task-row small, .pipe-field label > span, .pipe-field small, .pipe-execution-selection-panel .pipe-field > span, .pipe-detail-heading > span:last-child, .pipe-save-indicator { font-size: var(--md-sys-typescale-body-small-size); line-height: var(--md-sys-typescale-body-small-line-height); font-weight: var(--md-sys-typescale-body-small-weight); letter-spacing: var(--md-sys-typescale-body-small-tracking); }
.pipe-detail-heading h1, .pipe-detail-page .pipe-page-heading h1, .pipe-dialog [role="heading"], .pipe-dialog > h2, .pipe-dialog .pipe-section-heading > h2 { font-size: var(--md-sys-typescale-headline-small-size); line-height: var(--md-sys-typescale-headline-small-line-height); font-weight: var(--md-sys-typescale-headline-small-weight); letter-spacing: var(--md-sys-typescale-headline-small-tracking); }
@media (max-width: 640px) { .pipe-detail-heading h1 { font-size: var(--md-sys-typescale-title-large-size); line-height: var(--md-sys-typescale-title-large-line-height); font-weight: var(--md-sys-typescale-title-large-weight); letter-spacing: var(--md-sys-typescale-title-large-tracking); }
}

/* Supporting text uses its own metrics instead of browser small/body inheritance. */
.pipe-detail-page > .pipe-back-link, .pipe-canvas-tools > span, .pipe-plain-list small, .pipe-flow-connection, .pipe-canvas-inputs, .pipe-canvas-run-state, .pipe-run-bar small { font-size: var(--md-sys-typescale-body-small-size); line-height: var(--md-sys-typescale-body-small-line-height); font-weight: var(--md-sys-typescale-body-small-weight); letter-spacing: var(--md-sys-typescale-body-small-tracking); }
.pipe-canvas-tools > .md-button, .pipe-canvas-card-footer .md-button { font-size: var(--md-sys-typescale-label-large-size); line-height: var(--md-sys-typescale-label-large-line-height); font-weight: var(--md-sys-typescale-label-large-weight); letter-spacing: var(--md-sys-typescale-label-large-tracking); }
.pipe-plain-list strong { font-size: var(--md-sys-typescale-title-small-size); line-height: var(--md-sys-typescale-title-small-line-height); font-weight: var(--md-sys-typescale-title-small-weight); letter-spacing: var(--md-sys-typescale-title-small-tracking); }
.pipe-canvas-run-state small, .pipe-scope-note { font-size: var(--md-sys-typescale-body-small-size); line-height: var(--md-sys-typescale-body-small-line-height); font-weight: var(--md-sys-typescale-body-small-weight); letter-spacing: var(--md-sys-typescale-body-small-tracking); }
.pipe-canvas-run-state > strong { font-size: var(--md-sys-typescale-label-medium-size); line-height: var(--md-sys-typescale-label-medium-line-height); font-weight: var(--md-sys-typescale-label-medium-weight); letter-spacing: var(--md-sys-typescale-label-medium-tracking); }
.pipe-debug-controls > .pipe-scope-note { font-size: var(--md-sys-typescale-body-medium-size); line-height: var(--md-sys-typescale-body-medium-line-height); font-weight: var(--md-sys-typescale-body-medium-weight); letter-spacing: var(--md-sys-typescale-body-medium-tracking); }
````

## apps/web/src/pages/plugins.css

````css
.plugin-page .pipe-object-tabs { display: flex; align-items: stretch; gap: 1.25rem; margin-bottom: 8px; border-bottom: 1px solid var(--md-sys-color-outline-variant); overflow-x: auto; }
.plugin-page .pipe-object-tabs [role=tab] { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; gap: .5rem; min-height: 3rem; padding: .75rem .5rem; margin-bottom: -1px; border-bottom: 3px solid transparent; background: transparent; color: var(--md-sys-color-on-surface-variant); font-size: 14px; font-weight: 500; white-space: nowrap; cursor: pointer; }
.plugin-page .pipe-object-tabs [role=tab]:hover { background: var(--md-sys-color-surface-container-low); color: var(--md-sys-color-on-surface); }
.plugin-page .pipe-object-tabs [role=tab][aria-selected=true] { border-bottom-color: var(--md-sys-color-primary); color: var(--md-sys-color-primary); font-weight: 500; }
.plugin-page .pipe-object-tabs [role=tab]:focus-visible,.plugin-release-row:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: -3px; border-radius: var(--console-radius-control); }
.plugin-page .pipe-object-tabs svg { width: 1.05rem; height: 1.05rem; flex-shrink: 0; }
.plugin-scope-banner { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; margin-bottom: 12px; }
.plugin-scope-banner h2 { font-size: 16px; font-weight: 500; }
.plugin-scope-banner p,.plugin-description { margin: 4px 0 0; color: var(--md-sys-color-on-surface-variant); font-size: 14px; line-height: 20px; }
.plugin-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .6rem; }
.plugin-scope-banner .plugin-actions { flex-shrink: 0; }
.plugin-dev-layout { display: grid; grid-template-columns: minmax(15rem, 21rem) minmax(0, 1fr); min-height: 32rem; gap: 16px; border-radius: var(--console-radius-panel); background: var(--md-sys-color-surface); overflow: hidden; }
.plugin-release-list { padding: 1rem; min-width: 0; border-radius: var(--console-radius-panel); background: var(--md-sys-color-surface-container-low); }
.plugin-release-list .pipe-search { width: 100%; margin-bottom: .75rem; }
.plugin-release-search { display: flex; align-items: center; gap: .5rem; margin-bottom: .75rem; }
.plugin-release-search .pipe-search { min-width: 0; flex: 1; width: auto; margin-bottom: 0; }
.plugin-release-pagination { display: flex; flex-direction: column; align-items: center; gap: .65rem; margin-top: 1rem; padding-top: .85rem; }
.plugin-release-pagination p { font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.plugin-release-pagination > div { display: flex; gap: .5rem; }
.plugin-version-group + .plugin-version-group { margin-top: 1rem; padding-top: 1rem; }
.plugin-version-group-heading { padding: .3rem .4rem .5rem; }
.plugin-version-group-heading h3 { margin: 0; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.plugin-version-group-heading small,.plugin-version-group-heading > span { display: block; color: var(--md-sys-color-on-surface-variant); margin-top: .25rem; font-size: 12px; overflow-wrap: anywhere; }
.plugin-release-row { display: grid; gap: .5rem; text-decoration: none; padding: .75rem; margin: .35rem 0; border: 1px solid transparent; border-radius: var(--console-radius-panel); color: inherit; }
.plugin-release-row:hover { background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent); }
.plugin-release-row.is-selected { background: var(--accent); border-color: var(--primary); }
.plugin-release-row strong { display: block; font-size: 14px; }
.plugin-release-row small { display: block; margin-top: .25rem; color: var(--md-sys-color-on-surface-variant); overflow-wrap: anywhere; }
.plugin-release-row > div:last-child { display: flex; gap: .4rem; flex-wrap: wrap; align-items: center; }
.plugin-active-marker { color: var(--md-sys-color-primary); font-size: 12px; }
.plugin-empty { text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem 1rem; color: var(--md-sys-color-on-surface-variant); }
.plugin-empty > svg { width: 2rem; height: 2rem; margin-bottom: .75rem; }
.plugin-empty h2 { font-size: 16px; font-weight: 500; color: var(--md-sys-color-on-surface); margin-bottom: .5rem; }
.plugin-empty p { font-size: 14px; max-width: 26rem; line-height: 20px; }
.plugin-flow-guide { text-align: start; list-style: decimal; margin-top: 12px; padding-inline-start: 1.5rem; font-size: 14px; line-height: 2; }
.plugin-release-detail { min-width: 0; padding: 16px; }
.plugin-detail-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.plugin-detail-heading h2 { margin: 0; font-size: 16px; font-weight: 500; }
.plugin-detail-heading h2 span { font-size: 14px; color: var(--md-sys-color-on-surface-variant); font-weight: 400; }
.plugin-detail-heading p { color: var(--md-sys-color-on-surface-variant); font-size: 14px; margin-top: .3rem; overflow-wrap: anywhere; }
.plugin-lifecycle { display: flex; flex-wrap: wrap; gap: .55rem 1rem; padding: 4px 0; margin: 12px 0; }
.plugin-lifecycle li { display: flex; align-items: center; gap: .35rem; font-size: 14px; color: var(--md-sys-color-on-surface-variant); }
.plugin-lifecycle li.is-complete { color: var(--md-sys-color-primary); }
.plugin-lifecycle svg { width: 1rem; height: 1rem; }
.plugin-stage-dot { width: .9rem; height: .9rem; border: 1px solid var(--md-sys-color-outline); border-radius: 50%; }
.plugin-detail-actions { display: flex; flex-wrap: wrap; gap: .6rem; }
.plugin-next-step { margin: 0 0 1rem; padding: .6rem .85rem; background: var(--md-sys-color-surface-container-low); border-radius: var(--console-radius-panel); font-size: 14px; }
.plugin-next-step p { margin: .35rem 0 0; color: var(--md-sys-color-on-surface-variant); line-height: 1.7; }
.plugin-next-step a { margin-top: .65rem; }
.plugin-action-context { color: var(--md-sys-color-on-surface-variant); font-size: 14px; line-height: 20px; margin-top: .75rem; }
.plugin-action-context a { margin: .3rem .5rem .3rem 0; }
.plugin-artifact-metadata { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin: 12px 0; font-size: 14px; }
.plugin-artifact-metadata dt { color: var(--md-sys-color-on-surface-variant); margin-bottom: .3rem; }
.plugin-artifact-metadata dd { margin: 0; overflow-wrap: anywhere; }
.plugin-wide-metadata { grid-column: 1 / -1; }
.plugin-data-section { border-radius: var(--console-radius-control); background: var(--md-sys-color-surface-container-low); margin-top: .6rem; padding: .8rem; font-size: 14px; }
.plugin-data-section summary,.plugin-validation summary { cursor: pointer; }
.plugin-release-detail pre { background: var(--md-sys-color-surface-container-low); border-radius: var(--console-radius-control); font-size: 12px; line-height: 16px; padding: .9rem; overflow: auto; max-height: 28rem; margin-top: .7rem; }
.plugin-validations { margin-top: 16px; }
.plugin-validations h3 { font-size: 16px; font-weight: 500; }
.plugin-validation { padding: .9rem 0; }
.plugin-validation .pipe-section-heading { flex-wrap: wrap; margin-bottom: .75rem; }
.plugin-validation .pipe-section-heading > div { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
.plugin-validation small { font-size: 12px; color: var(--md-sys-color-on-surface-variant); overflow-wrap: anywhere; }
.plugin-validation details { margin-top: .7rem; font-size: 14px; }
.plugin-check-summary { display: flex; flex-wrap: wrap; gap: .55rem 1rem; font-size: 14px; padding: .75rem 0; }
.plugin-check-pass { color: var(--md-sys-color-success); }
.plugin-check-fail { color: var(--md-sys-color-error); }
.plugin-check-list { display: grid; gap: .65rem; list-style: none; padding: 0; }
.plugin-check-list > li { min-width: 0; padding: .85rem; border: 1px solid transparent; border-radius: var(--console-radius-control); background: var(--md-sys-color-surface-container-low); }
.plugin-check-list > li.is-failed { border-color: var(--md-sys-color-error); background: color-mix(in srgb, var(--md-sys-color-error-container) 35%, transparent); }
.plugin-check-heading { display: flex; align-items: flex-start; gap: .5rem; font-size: 14px; }
.plugin-check-heading svg { width: 1rem; height: 1rem; flex-shrink: 0; margin-top: .1rem; }
.plugin-check-heading strong { overflow-wrap: anywhere; }
.plugin-check-heading > span { margin-inline-start: auto; flex-shrink: 0; }
.plugin-check-list p { font-size: 14px; line-height: 20px; margin: .5rem 0; overflow-wrap: anywhere; }
.plugin-check-list small { display: block; margin-top: .35rem; }
.plugin-check-comparison { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: .75rem; margin-top: .75rem; }
.plugin-check-comparison h4 { font-weight: 500; font-size: 14px; }
.plugin-check-comparison pre { max-height: 16rem; }
.plugin-draft-notice { margin: 0 0 1rem; padding: .75rem 1rem; border-radius: var(--console-radius-control); background: var(--muted); font-size: 14px; }
.plugin-draft-dialog { width: min(100%, 30rem); padding: 1.5rem; }
.plugin-draft-dialog h2 { font-size: var(--md-sys-typescale-headline-small-size); line-height: var(--md-sys-typescale-headline-small-line-height); font-weight: var(--md-sys-typescale-headline-small-weight); }
.plugin-draft-dialog p { color: var(--md-sys-color-on-surface-variant); font-size: 14px; line-height: 20px; margin-top: .75rem; }
.plugin-draft-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .6rem; margin-top: 1.5rem; }
.plugin-muted { font-size: 14px; color: var(--md-sys-color-on-surface-variant); line-height: 20px; }
.plugin-digest { font-size: 12px; overflow-wrap: anywhere; }
.plugin-upload-dialog { width: min(100%, 49rem); max-height: calc(100dvh - 2rem); overflow-y: auto; }
.plugin-candidate-viewport { background: var(--md-sys-color-surface-container-low); padding: 0; }
.plugin-candidate-workspace { background: var(--md-sys-color-surface); border: 0; box-shadow: none; width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
.plugin-candidate-heading { flex-shrink: 0; padding: 1rem max(var(--console-page-padding), calc((100% - 68rem) / 2)); background: var(--md-sys-color-surface-container-low); }
.plugin-candidate-workspace .plugin-upload-form { min-height: 0; overflow-y: auto; padding: 0 max(var(--console-page-padding), calc((100% - 68rem) / 2)); gap: 0; scroll-padding-top: 4rem; }
.plugin-candidate-status { padding: .8rem 0; color: var(--md-sys-color-on-surface-variant); font-size: 14px; }
.plugin-candidate-steps { position: sticky; top: 0; z-index: 2; display: flex; gap: 1rem; padding: .85rem 0; background: var(--md-sys-color-surface); border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.plugin-candidate-steps a { color: var(--md-sys-color-primary); font-size: 14px; font-weight: 500; }
.plugin-candidate-section { display: grid; gap: 1rem; padding: 1.5rem 0; }
.plugin-candidate-section h3 { font-size: 16px; font-weight: 500; }
.plugin-candidate-section > p { color: var(--md-sys-color-on-surface-variant); font-size: 14px; line-height: 20px; }
.plugin-candidate-advanced { border-radius: var(--console-radius-control); padding: 1rem; background: var(--md-sys-color-surface-container-low); }
.plugin-candidate-advanced summary { cursor: pointer; font-size: 14px; font-weight: 500; }
.plugin-candidate-advanced[open] summary { margin-bottom: 1rem; }
.plugin-import-summary { padding: .85rem 1rem; border-radius: var(--console-radius-control); background: var(--md-sys-color-surface-container-low); font-size: 14px; }
.plugin-import-summary ul { padding-inline-start: 1.2rem; margin: .5rem 0; list-style: disc; line-height: 1.7; }
.plugin-candidate-workspace .plugin-form-footer { position: sticky; bottom: 0; z-index: 2; background: var(--md-sys-color-surface); padding: 1rem 0; }
.plugin-candidate-error { position: sticky; top: 0; z-index: 3; background: var(--md-sys-color-error-container); flex-shrink: 0; }
.plugin-capability-list { list-style: none; display: grid; gap: .6rem; margin: .75rem 0; padding: 0; }
.plugin-capability-list li { background: var(--md-sys-color-surface-container-low); border-radius: var(--console-radius-control); padding: .75rem; font-size: 14px; }
.plugin-capability-list li > div { display: flex; justify-content: space-between; gap: .75rem; }
.plugin-capability-list p,.plugin-capability-list small { display: block; margin: .3rem 0; color: var(--md-sys-color-on-surface-variant); line-height: 1.6; }
.plugin-list-scope { display: grid; gap: .6rem; margin-bottom: 1rem; }
.plugin-list-scope strong { overflow-wrap: anywhere; }
.plugin-validation-history { padding: .75rem 0; }
.plugin-validation-history > summary { display: flex; gap: .6rem; align-items: center; cursor: pointer; font-size: 14px; }
.plugin-activate-dialog { width: min(100%, 48rem); max-height: calc(100dvh - 2rem); overflow-y: auto; }
.plugin-activate-dialog > h3 { font-size: 16px; font-weight: 500; margin: 1.4rem 0 .5rem; }
.plugin-upload-form { display: flex; flex-direction: column; gap: 1.2rem; padding-top: 1rem; }
.plugin-upload-form label { display: flex; flex-direction: column; gap: .4rem; font-size: 14px; font-weight: 500; }
.plugin-upload-form input:not([type=file]),.plugin-upload-form textarea { width: 100%; border: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface); border-radius: var(--console-radius-control); min-height: var(--md-comp-outlined-text-field-container-height); padding: .5rem .75rem; color: var(--md-sys-color-on-surface); font: inherit; }
.plugin-upload-form .pipe-code-input { font-family: var(--font-mono); font-size: 12px; }
.plugin-file-input { display: flex; flex-direction: column; gap: .5rem; padding: .85rem; border: 1px dashed var(--md-sys-color-outline-variant); border-radius: var(--console-radius-control); }
.plugin-file-input input { max-width: 100%; font-size: 14px; }
.plugin-file-input small,.plugin-text-field small { font-size: 12px; color: var(--md-sys-color-on-surface-variant); font-weight: 400; line-height: 16px; }
.plugin-identity-fields { display: grid; grid-template-columns: 1fr 1fr; gap: .8rem 1rem; }
.plugin-form-footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-top: .8rem; }
.plugin-form-footer > span { font-size: 14px; color: var(--md-sys-color-on-surface-variant); }
@media(max-width: 1000px) { .plugin-scope-banner { align-items: flex-start; flex-direction: column; } .plugin-dev-layout { grid-template-columns: minmax(13rem, 16rem) minmax(0, 1fr); } .plugin-release-detail { padding: 1rem; } }
@media(max-width: 700px) { .plugin-dev-layout { display: block; } .plugin-release-list { margin-bottom: 16px; max-height: 22rem; overflow-y: auto; } .plugin-detail-heading { flex-wrap: wrap; } .plugin-artifact-metadata,.plugin-identity-fields,.plugin-check-comparison { grid-template-columns: 1fr; } .plugin-form-footer { flex-direction: column; align-items: stretch; } .plugin-scope-banner .plugin-actions { flex-shrink: 1; } .plugin-detail-actions > button { flex-grow: 1; } .plugin-upload-dialog { padding: 1rem; } }
@media(max-width: 700px) { .plugin-candidate-workspace { padding: 0; } .plugin-candidate-heading { padding: .9rem 1rem; } .plugin-candidate-workspace .plugin-upload-form { padding-inline: 1rem; } .plugin-candidate-steps { gap: .75rem; overflow-x: auto; white-space: nowrap; } .plugin-candidate-workspace .plugin-form-footer { align-items: stretch; gap: .5rem; } }

.plugin-empty-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; }
.plugin-dev-layout[data-empty-catalog] { min-height: 24rem; }
.plugin-empty > button { margin-top: .75rem; }

.plugin-list-empty { padding-block: 1rem; color: var(--muted-foreground); }
.plugin-list-empty h2 { font-size: 14px; font-weight: 500; }
.plugin-list-empty p { font-size: 12px; line-height: 16px; margin-top: .35rem; }

/* One spacing owner between workspace navigation and its first controls. */
.plugin-workspace-tabs, .plugin-workspace-panel { min-width: 0; }
.plugin-workspace-panel { padding: 0; }
.plugin-workspace-panel .pipe-operator-toolbar { margin: 0 0 12px; }

.plugin-page details > summary, .plugin-candidate-workspace details > summary { min-height: 48px; padding-block: 12px; overflow-wrap: anywhere; }
.plugin-candidate-workspace summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.plugin-candidate-steps a { display: inline-flex; align-items: center; min-height: 48px; }
.plugin-flow-guide, .plugin-next-step p, .plugin-import-summary ul { line-height: 20px; }
.plugin-capability-list p { line-height: 20px; }
.plugin-capability-list small { line-height: 16px; }

.plugin-release-detail pre:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 2px; }

.plugin-candidate-heading h2 { font-size: 22px; line-height: 28px; font-weight: 400; }

/* Complete typography roles prevent body metrics from leaking into titles and controls. */
.plugin-scope-banner h2, .plugin-empty h2, .plugin-detail-heading h2, .plugin-validations h3, .plugin-candidate-section h3, .plugin-activate-dialog > h3 { font-size: var(--md-sys-typescale-title-medium-size); line-height: var(--md-sys-typescale-title-medium-line-height); font-weight: var(--md-sys-typescale-title-medium-weight); letter-spacing: var(--md-sys-typescale-title-medium-tracking); }
.plugin-version-group-heading h3, .plugin-check-comparison h4, .plugin-list-empty h2, .plugin-release-row strong, .plugin-check-heading strong { font-size: var(--md-sys-typescale-title-small-size); line-height: var(--md-sys-typescale-title-small-line-height); font-weight: var(--md-sys-typescale-title-small-weight); letter-spacing: var(--md-sys-typescale-title-small-tracking); }
.plugin-page .pipe-object-tabs [role="tab"], .plugin-candidate-steps a, .plugin-upload-form label, .plugin-candidate-advanced summary { font-size: var(--md-sys-typescale-label-large-size); line-height: var(--md-sys-typescale-label-large-line-height); font-weight: var(--md-sys-typescale-label-large-weight); letter-spacing: var(--md-sys-typescale-label-large-tracking); }
.plugin-detail-heading h2 span, .plugin-artifact-metadata, .plugin-lifecycle li, .plugin-data-section, .plugin-check-heading, .plugin-check-summary, .plugin-validation details, .plugin-validation-history > summary, .plugin-next-step, .plugin-draft-notice, .plugin-candidate-status, .plugin-import-summary, .plugin-capability-list li, .plugin-form-footer > span { font-size: var(--md-sys-typescale-body-medium-size); line-height: var(--md-sys-typescale-body-medium-line-height); font-weight: var(--md-sys-typescale-body-medium-weight); letter-spacing: var(--md-sys-typescale-body-medium-tracking); }
.plugin-release-pagination p, .plugin-version-group-heading small, .plugin-version-group-heading > span, .plugin-release-row small, .plugin-active-marker, .plugin-validation small, .plugin-digest, .plugin-file-input small, .plugin-text-field small, .plugin-list-empty p { font-size: var(--md-sys-typescale-body-small-size); line-height: var(--md-sys-typescale-body-small-line-height); font-weight: var(--md-sys-typescale-body-small-weight); letter-spacing: var(--md-sys-typescale-body-small-tracking); }
.plugin-draft-dialog h2 { font-size: var(--md-sys-typescale-headline-small-size); line-height: var(--md-sys-typescale-headline-small-line-height); font-weight: var(--md-sys-typescale-headline-small-weight); letter-spacing: var(--md-sys-typescale-headline-small-tracking); }
.plugin-candidate-heading h2 { font-size: var(--md-sys-typescale-title-large-size); line-height: var(--md-sys-typescale-title-large-line-height); font-weight: var(--md-sys-typescale-title-large-weight); letter-spacing: var(--md-sys-typescale-title-large-tracking); }
.plugin-upload-form input:not([type=file]), .plugin-upload-form textarea:not(.pipe-code-input) { font-size: var(--md-sys-typescale-body-large-size); line-height: var(--md-sys-typescale-body-large-line-height); font-weight: var(--md-sys-typescale-body-large-weight); letter-spacing: var(--md-sys-typescale-body-large-tracking); }

/* Sticky steps keep their full target height; focused labels remain below their scroll boundary. */
.plugin-candidate-steps { flex-shrink: 0; }
.plugin-candidate-workspace .plugin-upload-form { scroll-padding-block-start: calc(48px + 1.7rem + 2lh); }
.plugin-candidate-section { scroll-margin-block-start: 16px; }

/* Supporting text uses its own metrics instead of browser small/body inheritance. */
.plugin-capability-list small, .plugin-list-scope small, .plugin-import-summary small { font-size: var(--md-sys-typescale-body-small-size); line-height: var(--md-sys-typescale-body-small-line-height); font-weight: var(--md-sys-typescale-body-small-weight); letter-spacing: var(--md-sys-typescale-body-small-tracking); }
.plugin-list-scope strong { font-size: var(--md-sys-typescale-title-small-size); line-height: var(--md-sys-typescale-title-small-line-height); font-weight: var(--md-sys-typescale-title-small-weight); letter-spacing: var(--md-sys-typescale-title-small-tracking); }
````
