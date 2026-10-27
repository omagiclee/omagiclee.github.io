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
