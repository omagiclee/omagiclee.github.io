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
