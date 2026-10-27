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
