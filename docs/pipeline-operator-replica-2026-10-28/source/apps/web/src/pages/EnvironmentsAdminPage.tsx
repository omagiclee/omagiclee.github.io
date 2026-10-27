import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Cpu, LoaderCircle, Server, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../auth-context";
import { ExecutionWorkers } from "../components/ExecutionWorkers";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  createEnvironment, createRuntimeRelease, createWorkerPool, environmentsQuery,
  grantEnvironment, runtimeReleasesQuery, type ExecutionEnvironment,
} from "../platform-api";
import { interactionForEvent, type InteractionContext } from "../telemetry";
import "./pipelines.css";
import "./console-management.css";

const stageLabels = { development: "开发", test: "测试", production: "生产" } as const;
const policyLabels = { restricted: "隔离网络", internal: "仅内网", approved_egress: "批准的外部访问" } as const;

function EnvironmentStatus({ environment }: { environment: ExecutionEnvironment }) {
  const healthyPools = environment.worker_pools.filter((pool) => pool.status === "healthy").length;
  if (environment.status === "disabled") return <Badge variant="outline">已停用</Badge>;
  if (!environment.worker_pools.length) return <Badge variant="warning">缺少资源池</Badge>;
  if (!healthyPools) return <Badge variant="outline">等待 Worker 心跳</Badge>;
  return <Badge variant="success">可运行</Badge>;
}

export default function EnvironmentsAdminPage() {
  const { me, can } = useAuth();
  const client = useQueryClient();
  const environments = useQuery({ ...environmentsQuery, enabled: can("environments:read") });
  const runtimes = useQuery({ ...runtimeReleasesQuery, enabled: can("environments:read") });
  const [runtime, setRuntime] = useState({ digest: "", name: "", image: "", sdk_abi: "flywheel-v2", cpu_arch: "arm64" as "amd64" | "arm64", gpu_required: false, capabilities: "", status: "registered" as const });
  const [environment, setEnvironment] = useState({ name: "", stage: "test" as ExecutionEnvironment["stage"], network_policy: "restricted" as ExecutionEnvironment["network_policy"] });
  const [pool, setPool] = useState({ environment_id: "", name: "", runtime_release_id: "", resource_kind: "cpu" as "cpu" | "gpu", max_concurrency: 1 });
  const [grant, setGrant] = useState({ project_id: "demo", environment_id: "", max_concurrency: 1, priority: 100 });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const invalidate = () => Promise.all([
    client.invalidateQueries({ queryKey: environmentsQuery.queryKey }),
    client.invalidateQueries({ queryKey: runtimeReleasesQuery.queryKey }),
  ]);
  const registerRuntime = useMutation({
    mutationFn: (interaction?: InteractionContext) => createRuntimeRelease({ ...runtime, name: runtime.name.trim(), digest: runtime.digest.trim(), image: runtime.image.trim(), sdk_abi: runtime.sdk_abi.trim(), capabilities: runtime.capabilities.split(",").map((item) => item.trim()).filter(Boolean) }, me.csrf_token, interaction),
    onSuccess: async () => { setNotice("运行时版本已登记。它需要绑定 Worker 资源池后才能承载任务。"); setError(""); setRuntime({ digest: "", name: "", image: "", sdk_abi: "flywheel-v2", cpu_arch: "arm64", gpu_required: false, capabilities: "", status: "registered" }); await invalidate(); },
    onError: (reason) => setError(reason.message),
  });
  const createEnv = useMutation({
    mutationFn: (interaction?: InteractionContext) => createEnvironment(environment, me.csrf_token, interaction),
    onSuccess: async (created) => { setPool((value) => ({ ...value, environment_id: created.id })); setGrant((value) => ({ ...value, environment_id: created.id })); setEnvironment({ name: "", stage: "test", network_policy: "restricted" }); setNotice("执行环境已创建。下一步添加资源池并授权给项目。"); setError(""); await invalidate(); },
    onError: (reason) => setError(reason.message),
  });
  const addPool = useMutation({
    mutationFn: (interaction?: InteractionContext) => createWorkerPool(pool.environment_id, { name: pool.name.trim(), runtime_release_id: pool.runtime_release_id, resource_kind: pool.resource_kind, max_concurrency: pool.max_concurrency }, me.csrf_token, interaction),
    onSuccess: async () => { setPool((value) => ({ ...value, name: "" })); setNotice("Worker 资源池已登记；在收到健康心跳前不会显示为可运行。"); setError(""); await invalidate(); },
    onError: (reason) => setError(reason.message),
  });
  const grantEnv = useMutation({
    mutationFn: (interaction?: InteractionContext) => grantEnvironment(grant.project_id.trim(), { environment_id: grant.environment_id, max_concurrency: grant.max_concurrency, priority: grant.priority, enabled: true }, me.csrf_token, interaction),
    onSuccess: async () => { setNotice("环境额度已授予项目。项目连接现在可以选择该环境。"); setError(""); await client.invalidateQueries({ queryKey: ["project-environments", grant.project_id.trim()] }); },
    onError: (reason) => setError(reason.message),
  });

  if (!can("environments:read")) return <main className="md-page"><section className="pipe-empty"><ShieldCheck /><h1>需要执行环境查看权限</h1><p>当前账号没有执行环境的查看权限。</p></section></main>;

  return <main className="md-page console-management" aria-labelledby="environments-title">
    <div className="pipe-page-heading"><div><h1 id="environments-title" className="md-page-title">执行环境</h1><p>管理运行时版本、网络策略、计算资源池及项目配额。</p></div></div>
    {(environments.error || runtimes.error) && <div className="pipe-notice pipe-error" role="alert"><CircleAlert />{environments.error?.message ?? runtimes.error?.message}</div>}
    {(environments.isPending || runtimes.isPending) && <p className="pipe-loading" role="status"><LoaderCircle className="animate-spin" />正在读取执行环境…</p>}

    {environments.data && <section aria-labelledby="environment-list-title"><div className="pipe-section-heading"><div><h2 id="environment-list-title">执行环境</h2><p>只有存在健康资源池的环境才可真正运行任务。</p></div></div>{environments.data.length ? <div className="pipe-operator-grid">{environments.data.map((item) => <article className="pipe-operator-card" key={item.id}><div className="pipe-section-heading"><Server /><EnvironmentStatus environment={item} /></div><h2>{item.name} · r{item.revision}</h2><p>{stageLabels[item.stage]} · {policyLabels[item.network_policy]}</p>{item.worker_pools.length ? <ul className="pipe-plain-list">{item.worker_pools.map((worker) => <li key={worker.id}><Cpu /> <strong>{worker.name}</strong> · {worker.resource_kind.toUpperCase()} · 并发 {worker.max_concurrency}<br /><small>{worker.runtime.name} · {worker.status === "healthy" ? "健康" : "等待心跳"}</small></li>)}</ul> : <p>尚未绑定资源池。</p>}</article>)}</div> : <div className="console-list-empty"><h2>还没有执行环境</h2><p>先登记运行时并创建环境，再绑定 Worker 资源池。</p></div>}</section>}

    {runtimes.data && <section className="pipe-control-section" aria-labelledby="runtime-list-title"><div className="pipe-section-heading"><div><h2 id="runtime-list-title">运行时版本</h2><p>镜像摘要、SDK ABI 与架构不可变。</p></div></div>{runtimes.data.length ? <div className="pipe-directory pipe-runtime-directory" role="region" aria-label="运行时版本表" tabIndex={0}><table><thead><tr><th>运行时</th><th>架构</th><th>SDK</th><th>状态</th></tr></thead><tbody>{runtimes.data.map((item) => <tr key={item.id}><td data-label="运行时"><strong>{item.name}</strong><p>{item.image}</p></td><td data-label="架构">{item.cpu_arch}{item.gpu_required ? " · GPU" : " · CPU"}</td><td data-label="SDK">{item.sdk_abi}</td><td data-label="状态">{item.status === "registered" ? "已登记" : "已停用"}</td></tr>)}</tbody></table></div> : <p className="pipe-empty-copy">还没有运行时版本。</p>}</section>}

    {can("environments:manage") && <ExecutionWorkers />}
    {can("environments:manage") && <section id="environment-setup" className="console-setup"><h2>配置执行环境</h2><p>依次登记运行时、创建环境、绑定资源池，再授予项目使用额度。</p><div className="console-setup-grid">
      <details className="console-form-disclosure"><summary>登记运行时版本<span>配置镜像与执行能力</span></summary><form className="pipe-metadata-form" onSubmit={(event) => { event.preventDefault(); if (registerRuntime.isPending) return; registerRuntime.mutate(interactionForEvent(event.nativeEvent)); }}><label className="pipe-field"><span>名称</span><input disabled={registerRuntime.isPending} aria-label="运行时名称" value={runtime.name} required onChange={(event) => setRuntime({ ...runtime, name: event.target.value })} /></label><label className="pipe-field"><span>镜像摘要</span><input disabled={registerRuntime.isPending} aria-label="镜像摘要" value={runtime.digest} required placeholder="sha256:64 位十六进制摘要" onChange={(event) => setRuntime({ ...runtime, digest: event.target.value })} /></label><label className="pipe-field"><span>镜像地址</span><input disabled={registerRuntime.isPending} aria-label="镜像地址" value={runtime.image} required onChange={(event) => setRuntime({ ...runtime, image: event.target.value })} /></label><label className="pipe-field"><span>SDK ABI</span><input disabled={registerRuntime.isPending} aria-label="SDK ABI" value={runtime.sdk_abi} required onChange={(event) => setRuntime({ ...runtime, sdk_abi: event.target.value })} /></label><label className="pipe-field"><span>架构</span><select disabled={registerRuntime.isPending} aria-label="运行时架构" value={runtime.cpu_arch} onChange={(event) => setRuntime({ ...runtime, cpu_arch: event.target.value as "amd64" | "arm64" })}><option value="arm64">arm64</option><option value="amd64">amd64</option></select></label><label className="pipe-checkbox"><input disabled={registerRuntime.isPending} type="checkbox" checked={runtime.gpu_required} onChange={(event) => setRuntime({ ...runtime, gpu_required: event.target.checked })} />GPU 运行时</label><label className="pipe-field"><span>能力（逗号分隔）</span><input disabled={registerRuntime.isPending} aria-label="运行时能力" value={runtime.capabilities} onChange={(event) => setRuntime({ ...runtime, capabilities: event.target.value })} /></label><Button type="submit" disabled={registerRuntime.isPending}>登记运行时</Button></form></details>
      <details className="console-form-disclosure"><summary>创建执行环境<span>设置用途与网络策略</span></summary><form className="pipe-metadata-form" onSubmit={(event) => { event.preventDefault(); if (createEnv.isPending) return; createEnv.mutate(interactionForEvent(event.nativeEvent)); }}><label className="pipe-field"><span>环境名称</span><input disabled={createEnv.isPending} aria-label="环境名称" value={environment.name} required onChange={(event) => setEnvironment({ ...environment, name: event.target.value })} /></label><label className="pipe-field"><span>用途</span><select disabled={createEnv.isPending} aria-label="环境用途" value={environment.stage} onChange={(event) => setEnvironment({ ...environment, stage: event.target.value as ExecutionEnvironment["stage"] })}>{Object.entries(stageLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="pipe-field"><span>网络策略</span><select disabled={createEnv.isPending} aria-label="网络策略" value={environment.network_policy} onChange={(event) => setEnvironment({ ...environment, network_policy: event.target.value as ExecutionEnvironment["network_policy"] })}>{Object.entries(policyLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><Button type="submit" disabled={createEnv.isPending}>创建环境</Button></form></details>
      <details className="console-form-disclosure"><summary>添加 Worker 资源池<span>绑定运行时与计算资源</span></summary><form className="pipe-metadata-form" onSubmit={(event) => { event.preventDefault(); if (addPool.isPending) return; addPool.mutate(interactionForEvent(event.nativeEvent)); }}><label className="pipe-field"><span>执行环境</span><select disabled={addPool.isPending} aria-label="资源池环境" value={pool.environment_id} required onChange={(event) => setPool({ ...pool, environment_id: event.target.value })}><option value="">请选择</option>{environments.data?.map((item) => <option key={item.id} value={item.id}>{item.name} · r{item.revision}</option>)}</select></label><label className="pipe-field"><span>资源池名称</span><input disabled={addPool.isPending} aria-label="资源池名称" value={pool.name} required onChange={(event) => setPool({ ...pool, name: event.target.value })} /></label><label className="pipe-field"><span>运行时版本</span><select disabled={addPool.isPending} aria-label="资源池运行时" value={pool.runtime_release_id} required onChange={(event) => { const runtimeItem = runtimes.data?.find((item) => item.id === event.target.value); setPool({ ...pool, runtime_release_id: event.target.value, resource_kind: runtimeItem?.gpu_required ? "gpu" : "cpu" }); }}><option value="">请选择</option>{runtimes.data?.filter((item) => item.status === "registered").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="pipe-field"><span>资源类型</span><select disabled={addPool.isPending} aria-label="资源类型" value={pool.resource_kind} onChange={(event) => setPool({ ...pool, resource_kind: event.target.value as "cpu" | "gpu" })}><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label><label className="pipe-field"><span>最大并发</span><input disabled={addPool.isPending} aria-label="资源池最大并发" type="number" min={1} max={1000} value={pool.max_concurrency} onChange={(event) => setPool({ ...pool, max_concurrency: Number(event.target.value) })} /></label><Button type="submit" disabled={addPool.isPending || !pool.environment_id || !pool.runtime_release_id || !pool.name.trim()}>添加资源池</Button></form></details>
      <details className="console-form-disclosure"><summary>授权给项目<span>分配项目并发额度</span></summary><form className="pipe-metadata-form" onSubmit={(event) => { event.preventDefault(); if (grantEnv.isPending) return; grantEnv.mutate(interactionForEvent(event.nativeEvent)); }}><label className="pipe-field"><span>项目 ID</span><input disabled={grantEnv.isPending} aria-label="授权项目 ID" value={grant.project_id} required onChange={(event) => setGrant({ ...grant, project_id: event.target.value })} /></label><label className="pipe-field"><span>执行环境</span><select disabled={grantEnv.isPending} aria-label="授权执行环境" value={grant.environment_id} required onChange={(event) => setGrant({ ...grant, environment_id: event.target.value })}><option value="">请选择</option>{environments.data?.map((item) => <option key={item.id} value={item.id}>{item.name} · r{item.revision}</option>)}</select></label><label className="pipe-field"><span>项目最大并发</span><input disabled={grantEnv.isPending} aria-label="项目最大并发" type="number" min={1} max={1000} value={grant.max_concurrency} onChange={(event) => setGrant({ ...grant, max_concurrency: Number(event.target.value) })} /></label><label className="pipe-field"><span>调度优先级</span><input disabled={grantEnv.isPending} aria-label="调度优先级" type="number" min={1} max={1000} value={grant.priority} onChange={(event) => setGrant({ ...grant, priority: Number(event.target.value) })} /></label><Button type="submit" disabled={grantEnv.isPending || !grant.project_id.trim() || !grant.environment_id}>授权环境</Button></form></details>
    </div></section>}
    {!can("environments:manage") && <div className="pipe-notice"><ShieldCheck /><span>当前账号只能查看执行环境。</span></div>}
    {error && <div className="pipe-notice pipe-error" role="alert"><CircleAlert />{error}</div>}
    {notice && <p className="pipe-scope-note" role="status">{notice}</p>}
  </main>;
}
