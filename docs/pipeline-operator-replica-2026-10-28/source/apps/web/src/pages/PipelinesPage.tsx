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
