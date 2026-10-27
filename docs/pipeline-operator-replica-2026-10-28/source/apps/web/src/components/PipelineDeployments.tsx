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
