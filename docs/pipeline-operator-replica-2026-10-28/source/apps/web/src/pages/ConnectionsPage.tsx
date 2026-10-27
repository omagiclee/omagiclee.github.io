import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { CircleAlert, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useProjectAuth } from "../auth-context";
import { PermissionRequestButton } from "../components/PermissionRequestButton";
import { ConnectionRuntimeControls } from "../components/ConnectionRuntimeControls";
import { Badge } from "../components/ui/badge";
import { statusVariant } from "../lib/status-variant";
import { Button } from "../components/ui/button";
import { checkConnection, connectionsQueryFor, createConnection, projectEnvironmentsQueryFor, type ConnectionType } from "../platform-api";
import { interactionForEvent, type InteractionContext } from "../telemetry";
import "./pipelines.css";
import "./console-management.css";

const connectionTypeLabels: Record<ConnectionType, string> = {
  object_storage: "对象存储",
  database: "数据库",
  vector_database: "向量数据库",
  model_service: "模型服务",
};

function ConnectionStatus({ status }: { status: string }) {
  return <Badge variant={statusVariant(status)}>
    {status === "unreachable" ? "读取失败" : status === "reachable" ? "读取可达" : status === "configuration_valid" ? "格式有效" : status === "configuration_invalid" ? "格式无效" : "待校验"}
  </Badge>;
}

export default function ConnectionsPage() {
  const { projectId } = useParams({ from: "/projects/$projectId/settings/connections" });
  const { me, can } = useProjectAuth(projectId);
  const client = useQueryClient();
  const connections = useQuery(connectionsQueryFor(projectId));
  const environments = useQuery({ ...projectEnvironmentsQueryFor(projectId), enabled: can("connections:read") });
  const [form, setForm] = useState({
    name: "",
    connection_type: "vector_database" as ConnectionType,
    endpoint: "",
    credential_ref: "",
    environment_ids: [] as string[],
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [checkError, setCheckError] = useState("");

  const create = useMutation({
    mutationFn: (interaction: InteractionContext | undefined) => createConnection(projectId, {
      name: form.name.trim(),
      connection_type: form.connection_type,
      endpoint: form.endpoint.trim(),
      credential_ref: form.credential_ref.trim() || undefined,
      allowed_environment_ids: form.environment_ids,
    }, me.csrf_token, interaction),
    onSuccess: () => {
      setForm({ name: "", connection_type: "vector_database", endpoint: "", credential_ref: "", environment_ids: [] });
      setFormError("");
      setCreateOpen(false);
      setNotice("连接已创建。凭据引用不会在列表或接口响应中回显。");
      void client.invalidateQueries({ queryKey: connectionsQueryFor(projectId).queryKey });
    },
    onError: (error) => setFormError(error.message),
  });

  const check = useMutation({
    onMutate: () => { setNotice(""); setCheckError(""); },
    mutationFn: ({ id, interaction }: { id: string; interaction: InteractionContext | undefined }) =>
      checkConnection(projectId, id, me.csrf_token, interaction),
    onSuccess: (result) => {
      if (result.passed) setNotice("配置格式校验通过。本次校验不访问外部服务，也不验证连接可用性。");
      else setCheckError(`配置格式校验未通过：${result.errors.join("；")}`);
      void client.invalidateQueries({ queryKey: connectionsQueryFor(projectId).queryKey });
    },
    onError: (error) => setCheckError(error.message),
  });

  return <main className="md-page console-management" aria-labelledby="connections-title">
    <div className="pipe-page-heading">
      <div>
        <h1 id="connections-title" className="md-page-title">连接管理</h1>
        <p>管理项目的数据源、对象存储和模型服务连接。</p>
      </div>
      {can("connections:manage") && <Button onClick={() => setCreateOpen(true)}>新增连接</Button>}
    </div>

    {!can("connections:read") ? <section className="pipe-empty"><ShieldCheck /><h2>需要项目连接权限</h2><PermissionRequestButton projectId={projectId} permission="connections:read" label="申请连接查看权限" /></section> : <>
      {connections.isPending && <p className="pipe-loading" role="status"><LoaderCircle className="animate-spin" />正在读取连接…</p>}
      {connections.error && <div className="pipe-notice pipe-error" role="alert"><CircleAlert />{connections.error.message}</div>}
      {connections.data && (connections.data.length ? <div className="pipe-directory">
        <table>
          <thead><tr><th>连接</th><th>类型</th><th>环境</th><th>凭据</th><th>最近检查</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>
            {connections.data.map((connection) => <tr key={connection.id}>
              <td data-label="连接"><strong>{connection.name}</strong><p title={connection.endpoint}>{connection.endpoint}</p></td>
              <td data-label="类型">{connectionTypeLabels[connection.connection_type]}</td>
              <td data-label="环境">{connection.allowed_environment_ids.map((id) => environments.data?.find((item) => item.id === id)?.name ?? id).join("、")}</td>
              <td data-label="凭据">{connection.credential_configured ? "已绑定引用" : "未配置"}</td>
              <td data-label="最近检查"><ConnectionStatus status={connection.status} />{connection.last_check && <p>{connection.last_check.passed ? (connection.last_check.kind === "read_only_list" ? "只读探测通过" : "格式校验通过") : connection.last_check.errors?.join("；")}</p>}</td>
              <td data-label="操作">
                <Button variant="outline" size="sm" disabled={!can("connections:manage") || check.isPending}
                  onClick={(event) => check.mutate({ id: connection.id, interaction: interactionForEvent(event.nativeEvent) })}>
                  {check.isPending && check.variables?.id === connection.id ? <LoaderCircle className="animate-spin" /> : <KeyRound />}校验配置
                </Button>
                {connection.connection_type === "object_storage" && <ConnectionRuntimeControls connection={connection} environments={environments.data ?? []} projectId={projectId} csrf={me.csrf_token} canManage={can("connections:manage")} />}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div> : <section className="console-list-empty"><h2>还没有项目连接</h2><p>先登记对象存储、数据库、向量库或模型服务连接。</p></section>)}

      {can("connections:manage") ? <details className="console-form-disclosure" open={createOpen} onToggle={(event) => setCreateOpen(event.currentTarget.open)}><summary>新增连接<span>设置地址、凭据引用与可用环境</span></summary><form className="pipe-metadata-form pipe-form-panel" onSubmit={(event) => {
        event.preventDefault();
        if (create.isPending) return;
        create.mutate(interactionForEvent(event.nativeEvent));
      }}>
        <p className="console-form-note">凭据仅保存密钥系统引用。对象存储支持只读探测，其他类型可校验配置格式。</p>
        <label className="pipe-field"><span>连接名称</span><input disabled={create.isPending} value={form.name} maxLength={120} required onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="pipe-field"><span>连接类型</span><select disabled={create.isPending} value={form.connection_type} onChange={(event) => setForm({ ...form, connection_type: event.target.value as ConnectionType })}>
          {Object.entries(connectionTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="pipe-field"><span>Endpoint</span><input disabled={create.isPending} value={form.endpoint} maxLength={500} required placeholder={form.connection_type === "object_storage" ? "local://objects/uploads 或 s3://bucket/prefix" : "https://service.internal"} onChange={(event) => setForm({ ...form, endpoint: event.target.value })} /></label>
        <label className="pipe-field"><span>凭据引用</span><input disabled={create.isPending} value={form.credential_ref} maxLength={255} placeholder="env:FLYWHEEL_SECRET_SOURCE" autoComplete="off" onChange={(event) => setForm({ ...form, credential_ref: event.target.value })} /></label>
        <fieldset className="pipe-field" disabled={create.isPending || environments.isPending}>
          <legend>允许使用的执行环境</legend>
          {environments.error && <small className="text-destructive">无法读取项目环境：{environments.error.message}</small>}
          {environments.data?.map((environment) => <label className="pipe-checkbox" key={environment.id}>
            <input disabled={create.isPending} type="checkbox" checked={form.environment_ids.includes(environment.id)} onChange={(event) => setForm({ ...form, environment_ids: event.target.checked ? [...form.environment_ids, environment.id] : form.environment_ids.filter((id) => id !== environment.id) })} />
            {environment.name} · {environment.stage} · r{environment.revision}
          </label>)}
          {environments.data?.length === 0 && <small>项目尚未获授执行环境，请由平台管理员先完成环境授权。{can("environments:read") && <> <Link className="text-primary underline" to="/admin/environments">前往执行环境</Link></>}</small>}
        </fieldset>
        <Button type="submit" disabled={create.isPending || form.environment_ids.length === 0}>{create.isPending && <LoaderCircle className="animate-spin" />}创建连接</Button>
        {formError && <p className="text-destructive" role="alert">{formError}</p>}
      </form></details> : <div className="pipe-notice"><ShieldCheck /><span>当前账号可查看连接，但不能创建或检查。 </span><PermissionRequestButton projectId={projectId} permission="connections:manage" label="申请连接管理权限" /></div>}
    </>}
    {checkError && <div className="pipe-notice pipe-error" role="alert"><CircleAlert />{checkError}</div>}
    {notice && <p className="pipe-scope-note" role="status">{notice}</p>}
  </main>;
}
