import { MediaUpload } from "../components/MediaUpload";
import { platformRequest } from "../data-platform-api";
import { Dialog } from "@base-ui/react/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState, useSearch } from "@tanstack/react-router";
import { ArrowRight, CircleAlert, Clock3, Download, Film, Image as ImageIcon, LoaderCircle, Play, RefreshCw, ScanSearch, Search, SlidersHorizontal, Tag, ThumbsDown, ThumbsUp, Upload, UserRound, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useAuth, useProjectAuth } from "../auth-context";
import { PermissionRequestButton } from "../components/PermissionRequestButton";
import { Button, buttonVariants } from "../components/ui/button";
import { ToolbarSelect } from "../components/ui/period-menu";
import { downloadMediaArchive, exportMediaCollection, loadMediaCollection, loadMediaFacets, loadMediaRun, loadMediaSearchSession, loadMediaStatus, loadMediaVideos, mediaFileUrl, queryImagePreviewUrl, readQueryImage, searchMedia, sendMediaFeedback, updateMediaShotTags, type MediaCollection, type MediaSearchInput, type MediaShot, type MediaStatus, type PersonStatus, type Relevance, type RetrievalProfile, type ScoreType } from "../media-api";
import { MediaEvaluationPanel } from "../components/MediaEvaluationPanel";
import { MediaCurationPanel } from "../components/MediaCurationPanel";
import type { PipelineRun } from "../pipelines-api";
import { TaskProgress } from "../components/TaskProgress";
import { TaskRecordCounts } from "../components/TaskRecordCounts";
import { interactionForEvent, type InteractionContext } from "../telemetry";
import "./media.css";

const personLabels: Record<PersonStatus, string> = { detected: "检出人物", not_detected: "抽样未检出", unknown: "待检测 / 未知" };
const runLabels: Record<string, string> = { pending: "等待执行", running: "正在执行", succeeded: "执行完成", failed: "执行失败", cancelled: "已取消", cancelling: "正在取消", cached: "复用缓存", skipped: "已跳过" };
const profileLabels: Record<RetrievalProfile, string> = { auto: "自动选择可用能力", baseline: "基础检索", multimodal: "增强组合检索" };
const scoreLabels: Record<ScoreType, string> = { catalog: "目录顺序", rrf: "融合排序分数", cosine: "余弦相似度", reranker: "重排分数", semantic_penalty: "排除语义调整分数" };
const routeLabels: Record<string, string> = { joint: "图文共同条件", text: "文字含义", image: "参考画面" };
const terminal = new Set(["succeeded", "failed", "cancelled"]);
const running = new Set(["pending", "running", "cancelling"]);

export function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const tail = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${tail}` : tail;
}

function Message({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <div className={`media-message${error ? " media-message-error" : ""}`} role={error ? "alert" : "status"}><CircleAlert aria-hidden="true" /><span>{children}</span></div>;
}

function PublishedStatus({ data, loading }: { data?: MediaStatus; loading: boolean }) {
  const published = data?.counts.indexed_shots;
  const timestamp = data?.latest_published_at ? new Date(data.latest_published_at) : null;
  return <div className="media-published-status" role="group" aria-label="已发布视频资产">
    <strong>{published === undefined ? (loading ? "…" : "—") : published.toLocaleString("zh-CN")}<span> 个可检索镜头</span></strong>
    {data?.counts.indexed_videos !== undefined && <span>来自 {data.counts.indexed_videos} 个视频</span>}
    {timestamp && Number.isFinite(timestamp.getTime()) && <span>更新于 <time dateTime={data!.latest_published_at!}>{timestamp.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time></span>}
  </div>;
}

function RunSummary({ run, projectId }: { run: PipelineRun; projectId: string }) {
  const task = run.tasks.find((item) => item.status === "running");
  return <section className="media-active-run" aria-label="正在处理的数据">
    <div className="media-active-run-heading"><div><LoaderCircle className="animate-spin" aria-hidden="true" /><span><strong>{runLabels[run.status] ?? run.status}</strong> · {run.pipeline_name} · v{run.pipeline_version}</span></div>
      <Link className={buttonVariants({ variant: "ghost", size: "sm" })} data-track-id="media.pipeline.view-run" data-track-label="查看数据处理运行" to="/projects/$projectId/pipelines" params={{ projectId }} search={{ pipelineId: run.pipeline_id, view: "runs", runId: run.id }} data-variant="ghost" data-size="sm"><span className="md-button-container md-state-layer">查看运行<ArrowRight /></span></Link>
    </div>
    {task && <div className="media-current-task"><span>{task.node_id}</span><TaskRecordCounts task={task} /><TaskProgress task={task} /></div>}
  </section>;
}

function SourceRunLink({ shot, projectId }: { shot: MediaShot; projectId: string }) {
  const { can } = useProjectAuth(projectId);
  if (!shot.index_run_id || !can("pipelines:read")) return null;
  return <Link className="media-source-run" data-track-id="media.shot.source-run" data-track-label="查看镜头生成运行" to="/projects/$projectId/pipelines" params={{ projectId }} search={{ ...(shot.index_pipeline_id ? { pipelineId: shot.index_pipeline_id } : {}), runId: shot.index_run_id, view: "runs" }}>查看生成运行{shot.index_pipeline_version ? ` · v${shot.index_pipeline_version}` : ""}<ArrowRight /></Link>;
}

function ShotCard({ shot, onPlay, scoreType, projectId, selected, onSelect, onReference, relevance, onFeedback, feedbackBusy, onTagsSaved }: {
  shot: MediaShot; onPlay: () => void; scoreType?: ScoreType; projectId: string;
  selected?: boolean; onSelect?: () => void; onReference?: () => void;
  relevance?: Relevance; onFeedback?: (relevance: Relevance) => void; feedbackBusy?: boolean; onTagsSaved?: () => void;
}) {
  const { can, me } = useProjectAuth(projectId);
  const [mask, setMask] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [tagText, setTagText] = useState((shot.tags ?? []).join(", "));
  const [tags, setTags] = useState(shot.tags ?? []);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState("");
  const tagErrorId = useId();
  const [tagNotice, setTagNotice] = useState("");
  const frameUrl = mediaFileUrl(shot.keyframe_url);
  const maskUrl = mediaFileUrl(shot.mask_url);
  async function saveTags(event: React.FormEvent) {
    event.preventDefault(); setTagBusy(true); setTagError("");
    try {
      const updated = await updateMediaShotTags(projectId, shot.id, parseTags(tagText), me.csrf_token);
      setTags(updated.tags); setTagText(updated.tags.join(", ")); setEditingTags(false); setTagNotice("标签已保存；重新检索后会更新选集候选快照。"); onTagsSaved?.();
    } catch (failure) { setTagError(failure instanceof Error ? failure.message : "标签保存失败"); }
    finally { setTagBusy(false); }
  }
  return <article className="media-shot" data-selected={selected || undefined}>
    <div className="media-shot-image">
      {frameUrl && !imageFailed ? <img src={frameUrl} alt={`${shot.video_title}，${formatTime(shot.matched_timestamp_ms ?? shot.start_ms)} 的关键帧`} loading="lazy" onError={() => setImageFailed(true)} /> : <span className="media-image-placeholder"><ImageIcon />{imageFailed ? "关键帧读取失败" : "暂无关键帧"}</span>}
      {mask && maskUrl && <img className="media-mask-overlay" src={maskUrl} alt="人物分割掩码" loading="lazy" />}
      <button type="button" data-track-id="media.shot.play" data-track-label="播放镜头" className="media-play-shot" onClick={onPlay} aria-label={`播放镜头 ${shot.video_title} ${formatTime(shot.start_ms)}`} disabled={!mediaFileUrl(shot.video_url)}><Play aria-hidden="true" /></button>
      <span className="media-duration">{((shot.end_ms - shot.start_ms) / 1000).toFixed(1)} 秒</span>
      {onSelect && <label className="media-shot-select"><input type="checkbox" checked={Boolean(selected)} onChange={onSelect} aria-label={`选择镜头 ${shot.video_title} ${formatTime(shot.start_ms)}`} /><span>{selected ? "已选择" : "选择"}</span></label>}
      {maskUrl && <button type="button" data-track-id="media.shot.segmentation" data-track-label="切换人物分割" className="media-mask-toggle" aria-pressed={mask} onClick={() => setMask(!mask)}><ScanSearch />{mask ? "隐藏分割" : "人物分割"}</button>}
    </div>
    <div className="media-shot-content">
      <div className="media-shot-labels"><span className="media-person-label" data-state={shot.person_status}>{shot.person_status === "detected" && <UserRound />}{personLabels[shot.person_status]}</span>{shot.index_state !== "ready" && shot.index_state !== "indexed" && <span className="media-index-label" data-state={shot.index_state}>索引{shot.index_state === "failed" ? "失败" : "待就绪"}</span>}</div>
      <h3 title={shot.video_title}>{shot.video_title}</h3>
      <p className="media-shot-time"><Clock3 aria-hidden="true" />{formatTime(shot.start_ms)} — {formatTime(shot.end_ms)}<span>{shot.frame_count} 个关键帧</span></p>
      <SourceRunLink shot={shot} projectId={projectId} />
      {!!tags.length && <div className="media-tag-chips" role="group" aria-label="已确认标签">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      {(shot.evidence || (shot.score !== null && Number.isFinite(shot.score))) && <details className="media-shot-evidence"><summary>匹配依据</summary>
        {shot.matched_timestamp_ms !== undefined && shot.matched_timestamp_ms !== null && <p>命中画面 {formatTime(shot.matched_timestamp_ms)}</p>}
        {shot.evidence && <p>{shot.evidence.coverage === "sampled_keyframes" ? "依据抽样关键帧，返回其所属镜头" : "依据镜头检索结果"}{shot.evidence.frame_ids?.length ? ` · ${shot.evidence.frame_ids.length} 帧证据` : ""}</p>}
        {!!shot.evidence?.sample_timestamps_ms?.length && <p>抽样时刻：{shot.evidence.sample_timestamps_ms.map((time) => `${(time / 1000).toFixed(2)} 秒`).join("、")}</p>}
        {shot.evidence?.routes && <p>召回依据：{Object.keys(shot.evidence.routes).map((route) => routeLabels[route] ?? route).join("、")}</p>}
        {shot.score !== null && Number.isFinite(shot.score) && <p className="media-score">{scoreType ? scoreLabels[scoreType] : "排序分数"} <span>{shot.score.toFixed(4)}</span></p>}
        {shot.evidence?.exclude_score !== undefined && <p>已纳入排除内容的语义匹配分数，不保证完全排除。</p>}
      </details>}
      {(onReference || onFeedback || (onTagsSaved && can("media:curate"))) && <div className="media-shot-actions">
        {onReference && <Button variant="ghost" size="sm" onClick={onReference} aria-label={`以镜头 ${shot.video_title} ${formatTime(shot.start_ms)} 为参考`}><ImageIcon />以此为参考</Button>}
        {onFeedback && <div className="media-feedback" role="group" aria-label={`镜头 ${shot.video_title} 的检索反馈`}><Button variant="ghost" size="icon" aria-label={`相关：${shot.video_title} ${formatTime(shot.start_ms)}`} aria-pressed={relevance === "positive"} disabled={feedbackBusy} onClick={() => onFeedback(relevance === "positive" ? "clear" : "positive")}><ThumbsUp /></Button><Button variant="ghost" size="icon" aria-label={`不相关：${shot.video_title} ${formatTime(shot.start_ms)}`} aria-pressed={relevance === "negative"} disabled={feedbackBusy} onClick={() => onFeedback(relevance === "negative" ? "clear" : "negative")}><ThumbsDown /></Button></div>}
        {onTagsSaved && can("media:curate") && <Button variant="ghost" size="icon" aria-label={`编辑标签：${shot.video_title} ${formatTime(shot.start_ms)}`} disabled={tagBusy} onClick={() => setEditingTags(!editingTags)}><Tag /></Button>}
      </div>}
      {editingTags && <form className="media-tag-editor" onSubmit={(event) => void saveTags(event)}><label className="media-field"><span>已确认标签（逗号分隔）</span><input disabled={tagBusy} aria-describedby={tagError ? tagErrorId : undefined} value={tagText} onChange={(event) => setTagText(event.target.value)} maxLength={3200} /></label><div><Button variant="ghost" size="sm" disabled={tagBusy} onClick={() => setEditingTags(false)}>取消</Button><Button size="sm" type="submit" disabled={tagBusy}>{tagBusy && <LoaderCircle className="animate-spin" />}保存标签</Button></div>{tagError && <p id={tagErrorId} role="alert">{tagError}</p>}</form>}
      {tagNotice && <p className="media-note" role="status">{tagNotice}</p>}
    </div>
  </article>;
}

export function parseTags(value: string) {
  return [...new Set(value.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean))];
}

function ShotDialog({ shot, onClose, projectId }: { shot: MediaShot | null; onClose: () => void; projectId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => { setError(false); }, [shot?.id]);
  return <Dialog.Root open={Boolean(shot)} onOpenChange={(open) => { if (!open) { videoRef.current?.pause(); onClose(); } }}>
    <Dialog.Portal><Dialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-40" /><Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
      <Dialog.Popup className="media-player-dialog">
        <div className="media-player-heading"><div><Dialog.Title className="md-title-large">{shot?.video_title}</Dialog.Title><Dialog.Description className="media-player-description">镜头 {formatTime(shot?.start_ms ?? 0)} — {formatTime(shot?.end_ms ?? 0)} · {shot ? personLabels[shot.person_status] : ""}</Dialog.Description></div><Dialog.Close render={<Button variant="ghost" size="icon" />} aria-label="关闭视频"><X /></Dialog.Close></div>
        {shot && <video key={shot.id} ref={videoRef} controls preload="metadata" playsInline src={mediaFileUrl(shot.video_url)} poster={mediaFileUrl(shot.keyframe_url)} onLoadedMetadata={(event) => { event.currentTarget.currentTime = shot.start_ms / 1000; }} onPlay={(event) => { if (event.currentTarget.currentTime < shot.start_ms / 1000 || event.currentTarget.currentTime >= shot.end_ms / 1000) event.currentTarget.currentTime = shot.start_ms / 1000; }} onSeeking={(event) => { if (event.currentTarget.currentTime < shot.start_ms / 1000) event.currentTarget.currentTime = shot.start_ms / 1000; else if (event.currentTarget.currentTime > shot.end_ms / 1000) event.currentTarget.currentTime = shot.end_ms / 1000; }} onTimeUpdate={(event) => { if (event.currentTarget.currentTime >= shot.end_ms / 1000) event.currentTarget.pause(); }} onError={() => setError(true)} />}
        {error && <Message error>视频读取失败，请关闭后重试，或检查原始视频文件是否仍然可用。</Message>}
        <div className="media-player-note"><p>从镜头起点播放，到终点暂停。播放器时间轴对应原始视频。</p>{shot && <SourceRunLink shot={shot} projectId={projectId} />}</div>
      </Dialog.Popup>
    </Dialog.Viewport></Dialog.Portal>
  </Dialog.Root>;
}

function MediaWorkspace({ projectId, initialEvaluationId, initialSearchId }: { projectId: string; initialEvaluationId?: string; initialSearchId?: string }) {
  const { me, can } = useProjectAuth(projectId);
  const client = useQueryClient();
  const completedRun = useRef("");
  const status = useQuery({ queryKey: ["media-status", projectId], queryFn: () => loadMediaStatus(projectId), refetchInterval: 10_000 });
  const videos = useQuery({ queryKey: ["media-videos", projectId], queryFn: () => loadMediaVideos(projectId) });
  const facets = useQuery({ queryKey: ["media-facets", projectId], queryFn: () => loadMediaFacets(projectId) });
  const activeRunId = status.data?.executor.active_run_id;
  const run = useQuery({ queryKey: ["media-run", projectId, activeRunId], queryFn: () => loadMediaRun(projectId, activeRunId!), enabled: Boolean(activeRunId) && can("pipelines:read"), refetchInterval: (query) => running.has(query.state.data?.status ?? "pending") ? 2_000 : false });
  const [query, setQuery] = useState("");
  const [excludeQuery, setExcludeQuery] = useState("");
  const [person, setPerson] = useState<PersonStatus | "all">("all");
  const [videoId, setVideoId] = useState("");
  const [limit, setLimit] = useState(24);
  const [durationMin, setDurationMin] = useState("");
  const [durationMax, setDurationMax] = useState("");
  const [tagsAll, setTagsAll] = useState("");
  const [tagsAny, setTagsAny] = useState("");
  const [tagsNone, setTagsNone] = useState("");
  const [profile, setProfile] = useState<RetrievalProfile>("auto");
  const [rerank, setRerank] = useState(true);
  const [queryImage, setQueryImage] = useState<{ name: string; data: string } | null>(null);
  const [imageExpanded, setImageExpanded] = useState(false);
  const [reference, setReference] = useState<{ id: string; frameId?: string; title: string; url?: string } | null>(null);
  const [imageError, setImageError] = useState("");
  const [formError, setFormError] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const imageReadId = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const [submitted, setSubmitted] = useState<{ revision: number; input: MediaSearchInput; label: string; interaction?: InteractionContext }>({ revision: 0, input: { mode: "filter", limit: 24 }, label: "全部镜头" });
  const consumedSearchInteraction = useRef<string | undefined>(undefined);
  const archivedSearch = useQuery({ queryKey: ["media-source-search", projectId, initialSearchId], queryFn: () => loadMediaSearchSession(projectId, initialSearchId!), enabled: Boolean(initialSearchId) && submitted.revision === 0 && can("media:search"), retry: false });
  const shots = useQuery({ queryKey: ["media-search", projectId, submitted.revision], queryFn: ({ signal }) => {
    const interaction = submitted.interaction?.interaction_id !== consumedSearchInteraction.current ? submitted.interaction : undefined;
    consumedSearchInteraction.current = submitted.interaction?.interaction_id;
    return searchMedia(projectId, submitted.input, me.csrf_token, signal, interaction);
  }, enabled: can("media:search") && (!initialSearchId || submitted.revision > 0), retry: false, gcTime: 0, staleTime: Infinity });
  const sourceSearch = Boolean(initialSearchId) && submitted.revision === 0;
  const searchResult = sourceSearch ? archivedSearch.data ? { ...archivedSearch.data.result, search_id: archivedSearch.data.id } : undefined : shots.data;
  const searchFetching = sourceSearch ? archivedSearch.isFetching : shots.isFetching;
  const [selectedShot, setSelectedShot] = useState<MediaShot | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Record<string, Relevance>>({});
  const [feedbackBusy, setFeedbackBusy] = useState<string[]>([]);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [activeCollection, setActiveCollection] = useState<MediaCollection | null>(null);
  const collection = useQuery({ queryKey: ["media-collection", projectId, activeCollection?.id], queryFn: () => loadMediaCollection(projectId, activeCollection!.id), enabled: Boolean(activeCollection) });
  const [exportBusy, setExportBusy] = useState(false);
  const semantic = Boolean(query.trim() || queryImage || reference);

  useEffect(() => {
    if (run.data && terminal.has(run.data.status) && completedRun.current !== run.data.id) {
      completedRun.current = run.data.id;
      void client.invalidateQueries({ queryKey: ["media-status", projectId] });
      void client.invalidateQueries({ queryKey: ["media-videos", projectId] });
      void client.invalidateQueries({ queryKey: ["media-facets", projectId] });
      setSubmitted((current) => current.input.mode === "filter" && (!initialSearchId || current.revision > 0) ? ({ ...current, revision: current.revision + 1, interaction: undefined }) : current);
    }
  }, [run.data, client, projectId]);

  function execute(input: MediaSearchInput, label: string, interaction?: InteractionContext) {
    setSelectedIds([]); setFeedback({}); setFeedbackError(""); setFeedbackNotice(""); setActiveCollection(null);
    setSubmitted((current) => ({ revision: current.revision + 1, input, label, interaction }));
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!can("media:search") || imageLoading) return;
    setFormError("");
    if (durationMin !== "" && durationMax !== "" && Number(durationMin) > Number(durationMax)) {
      setFormError("最短时长不能大于最长时长。"); return;
    }
    if (excludeQuery.trim() && !semantic) { setFormError("使用排除描述时，请同时添加要查找的画面描述或参考图片。"); return; }
    const mode = query.trim() ? (queryImage || reference ? "composed" : "text") : queryImage || reference ? "image" : "filter";
    const all = parseTags(tagsAll), any = parseTags(tagsAny), none = parseTags(tagsNone);
    const input: MediaSearchInput = {
      mode, limit, ...(query.trim() ? { query: query.trim() } : {}),
      ...(queryImage ? { image_base64: queryImage.data } : {}), ...(reference ? { reference_shot_id: reference.id, ...(reference.frameId ? { reference_frame_id: reference.frameId } : {}) } : {}),
      ...(person !== "all" ? { person_status: person } : {}), ...(videoId ? { video_id: videoId } : {}),
      ...(durationMin !== "" ? { duration_min_ms: Math.round(Number(durationMin) * 1000) } : {}),
      ...(durationMax !== "" ? { duration_max_ms: Math.round(Number(durationMax) * 1000) } : {}),
      ...(all.length ? { tags_all: all } : {}), ...(any.length ? { tags_any: any } : {}), ...(none.length ? { tags_none: none } : {}),
      ...(excludeQuery.trim() ? { exclude_query: excludeQuery.trim() } : {}),
      ...(semantic ? { retrieval_profile: profile, rerank } : {}),
    };
    const label = [query.trim() ? `“${query.trim()}”` : "", queryImage ? `参考图：${queryImage.name}` : reference ? `参考镜头：${reference.title}` : "", person !== "all" ? personLabels[person] : "", videoId ? videos.data?.find((video) => video.id === videoId)?.title : "", all.length ? `包含：${all.join("、")}` : "", any.length ? `任一：${any.join("、")}` : "", none.length ? `排除标签：${none.join("、")}` : "", durationMin || durationMax ? `${durationMin || "0"}–${durationMax || "不限"} 秒` : ""].filter(Boolean).join(" · ") || "全部镜头";
    execute(input, label, interactionForEvent(event.nativeEvent));
  }

  function clearSearch() {
    imageReadId.current++;
    setQuery(""); setExcludeQuery(""); setQueryImage(null); setReference(null);
    setImageLoading(false); setImageError(""); setFormError(""); setImageExpanded(false);
    setPerson("all"); setVideoId(""); setLimit(24);
    setDurationMin(""); setDurationMax(""); setTagsAll(""); setTagsAny(""); setTagsNone("");
    setProfile("auto"); setRerank(true);
    execute({ mode: "filter", limit: 24 }, "全部镜头");
  }

  function restoreSearchControls(input: MediaSearchInput) {
    imageReadId.current++; setImageLoading(false); setImageError(""); setFormError("");
    setQuery(input.query ?? ""); setExcludeQuery(input.exclude_query ?? "");
    setQueryImage(input.image_base64 ? { name: "已保存的参考图", data: input.image_base64 } : null);
    setReference(input.reference_shot_id ? { id: input.reference_shot_id, frameId: input.reference_frame_id, title: "已保存的参考镜头" } : null);
    setImageExpanded(Boolean(input.image_base64 || input.reference_shot_id));
    setPerson(input.person_status ?? "all"); setVideoId(input.video_id ?? ""); setLimit(input.limit);
    setDurationMin(input.duration_min_ms == null ? "" : String(input.duration_min_ms / 1000));
    setDurationMax(input.duration_max_ms == null ? "" : String(input.duration_max_ms / 1000));
    setTagsAll((input.tags_all ?? []).join(", ")); setTagsAny((input.tags_any ?? []).join(", ")); setTagsNone((input.tags_none ?? []).join(", "));
    setProfile(input.retrieval_profile ?? "auto"); setRerank(input.rerank ?? true);
  }

  function replay(input: MediaSearchInput, name: string) { restoreSearchControls(input); execute(input, `已保存查询：${name}`); }
  useEffect(() => {
    if (!archivedSearch.data || submitted.revision > 0) return;
    restoreSearchControls(archivedSearch.data.query);
    setSubmitted((current) => ({ ...current, input: archivedSearch.data!.query, label: `固定检索会话 · ${archivedSearch.data!.query.query || "条件筛选"}` }));
    setFeedback(Object.fromEntries(Object.entries(archivedSearch.data.feedback).map(([shotId, relevance]) => [`${archivedSearch.data!.id}:${shotId}`, relevance])));
  }, [archivedSearch.data]);

  async function chooseImage(file: File | undefined) {
    if (!file) return;
    setImageExpanded(true);
    const readId = ++imageReadId.current;
    setImageError(""); setQueryImage(null); setReference(null); setImageLoading(true);
    try { const data = await readQueryImage(file); if (readId === imageReadId.current) setQueryImage({ name: file.name, data }); }
    catch (failure) { if (readId === imageReadId.current) setImageError(failure instanceof Error ? failure.message : "图片读取失败"); }
    finally { if (readId === imageReadId.current) setImageLoading(false); }
  }

  function useReference(shot: MediaShot) {
    setImageExpanded(true);
    imageReadId.current++; setQueryImage(null); setImageError(""); setImageLoading(false);
    setReference({ id: shot.id, frameId: shot.matched_frame_id ?? undefined, title: `${shot.video_title} ${formatTime(shot.matched_timestamp_ms ?? shot.start_ms)}`, url: mediaFileUrl(shot.keyframe_url) });
    formRef.current?.scrollIntoView?.({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    formRef.current?.querySelector<HTMLInputElement>("input[aria-label='描述要查找的视频画面']")?.focus();
  }

  async function recordFeedback(shot: MediaShot, relevance: Relevance) {
    const searchId = searchResult?.search_id;
    if (!searchId || !can("media:curate")) return;
    setFeedbackError(""); setFeedbackNotice(""); setFeedbackBusy((current) => [...current, shot.id]);
    try {
      await sendMediaFeedback(projectId, { search_id: searchId, shot_id: shot.id, relevance }, me.csrf_token);
      setFeedback((current) => ({ ...current, [`${searchId}:${shot.id}`]: relevance }));
      setFeedbackNotice(relevance === "clear" ? "已清除该镜头的检索反馈。" : "已记录本次查询的相关性反馈，供后续评测使用。");
    } catch (failure) { setFeedbackError(failure instanceof Error ? failure.message : "反馈保存失败，请重试。"); }
    finally { setFeedbackBusy((current) => current.filter((id) => id !== shot.id)); }
  }

  async function createDatasetFromCollection() {
    if (!activeCollection) return;
    setExportBusy(true);
    try {
      const created = await platformRequest<{id:string}>(projectId,"/datasets",me.csrf_token,{name:activeCollection.name,modality:"视频",purpose:"训练",source:"媒体固定选集",collectionId:activeCollection.id});
      window.location.assign(`/projects/${encodeURIComponent(projectId)}/datasets/${created.id}`);
    } catch(error) {setFeedbackError(error instanceof Error ? error.message : "创建数据集失败");}
    finally {setExportBusy(false);}
  }
  async function downloadCollection(archive = false) {
    if (!activeCollection) return;
    setExportBusy(true); setFeedbackError("");
    try { if (archive) await downloadMediaArchive(projectId, activeCollection, me.csrf_token); else await exportMediaCollection(projectId, activeCollection); }
    catch (failure) { setFeedbackError(failure instanceof Error ? failure.message : "导出失败，请重试。"); }
    finally { setExportBusy(false); }
  }

  const visibleItems = activeCollection ? collection.data?.manifest.items ?? [] : searchResult?.items ?? [];
  const resultsLoading = activeCollection ? collection.isLoading : searchFetching;
  const resultsError = activeCollection ? collection.error : sourceSearch ? archivedSearch.error : shots.error;
  const allSelected = visibleItems.length > 0 && visibleItems.every((shot) => selectedIds.includes(shot.id));
  return <main className="md-page media-page">
    <div className="media-page-heading"><div><h1 className="md-page-title">数据探索</h1><PublishedStatus data={status.data} loading={status.isLoading} /></div><MediaUpload projectId={projectId} onImported={() => { clearSearch(); void status.refetch(); void videos.refetch(); void facets.refetch(); }} /></div>
    {status.isError && <Message error>索引状态读取失败：{status.error.message}</Message>}
    {activeRunId && run.isLoading && can("pipelines:read") && <p className="media-note" role="status">正在读取数据处理状态…</p>}
    {run.data && running.has(run.data.status) && <RunSummary run={run.data} projectId={projectId} />}
    {activeRunId && run.isError && <Message error>数据处理状态读取失败。<Button variant="ghost" size="sm" onClick={() => void run.refetch()}>重试</Button></Message>}
    {!can("media:search") && <PermissionRequestButton permission="media:search" label="申请镜头检索权限" />}
    <section className="media-search-panel" aria-label="组合镜头检索">
      <form ref={formRef} className="media-search-form" onSubmit={submitSearch}>
        <div className="media-primary-search"><label className="media-text-query"><Search aria-hidden="true" /><input aria-label="描述要查找的视频画面" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="描述要查找的画面，例如：森林中行走的人" maxLength={2000} /></label>
          <Button data-track-id="media.search.submit" data-track-label="检索镜头" type="submit" disabled={!can("media:search") || searchFetching || imageLoading || Boolean(imageError)}>{searchFetching ? <LoaderCircle className="animate-spin" /> : <Search />}检索镜头</Button>
        </div>
        <div className="media-filters">
          <ToolbarSelect<PersonStatus | "all"> label="人物标签" value={person} onChange={setPerson} options={[{ value: "all", label: "全部人物状态" }, ...Object.entries(personLabels).map(([value, label]) => ({ value: value as PersonStatus, label }))]} />
          <ToolbarSelect label="来源视频" value={videoId} onChange={setVideoId} disabled={videos.isLoading} options={[{ value: "", label: "全部视频" }, ...(videos.data ?? []).map((video) => ({ value: video.id, label: video.title }))]} />

        </div>
        <div className="media-disclosures">
          <details className="media-reference-details" open={imageExpanded} onToggle={(event) => setImageExpanded(event.currentTarget.open)}><summary><ImageIcon aria-hidden="true" />参考图片{imageError ? <span className="media-reference-error">图片不可用</span> : (queryImage || reference) && <span>已添加</span>}</summary>
            <div className="media-image-query"><label className="media-upload media-upload-compact"><input aria-label="上传检索图片" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void chooseImage(event.target.files?.[0]); event.target.value = ""; }} />{imageLoading ? <LoaderCircle className="animate-spin" /> : <Upload />}<span><strong>{queryImage || reference ? "更换参考图片" : "添加参考图片"}</strong><small>可选 · JPEG、PNG、WebP · 最大 6 MB</small></span></label>
              {(queryImage || reference) && <div className="media-query-preview">{(queryImage ? queryImagePreviewUrl(queryImage.data) : reference?.url) && <img src={queryImage ? queryImagePreviewUrl(queryImage.data) : reference?.url} alt="检索参考图片" />}<span>{queryImage?.name || reference?.title}</span><Button variant="ghost" size="icon" aria-label="移除检索图片" onClick={() => { imageReadId.current++; setQueryImage(null); setReference(null); setImageError(""); setImageLoading(false); }}><X /></Button></div>}
              {imageError && <Message error>{imageError}<Button variant="ghost" size="sm" onClick={() => setImageError("")}>忽略图片，继续筛选</Button></Message>}
            </div>
          </details>
          <details className="media-filter-details"><summary><SlidersHorizontal aria-hidden="true" />标签与时长筛选{[tagsAll, tagsAny, tagsNone, durationMin, durationMax].some(Boolean) && <span>已设置</span>}</summary>
            <div className="media-filter-grid">
          <label className="media-field media-limit"><span>结果数量</span><select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>{[24, 48, 100].map((count) => <option value={count} key={count}>{count} 个</option>)}</select></label>
              <label className="media-field"><span>必须包含标签</span><input list="media-known-tags" value={tagsAll} onChange={(event) => setTagsAll(event.target.value)} placeholder="逗号分隔，全部满足" maxLength={3200} /></label>
              <label className="media-field"><span>包含任一标签</span><input list="media-known-tags" value={tagsAny} onChange={(event) => setTagsAny(event.target.value)} placeholder="逗号分隔，满足任意一个" maxLength={3200} /></label>
              <label className="media-field"><span>排除标签</span><input list="media-known-tags" value={tagsNone} onChange={(event) => setTagsNone(event.target.value)} placeholder="排除已标注这些标签的镜头" maxLength={3200} /></label>
              <label className="media-field"><span>最短时长（秒）</span><input type="number" value={durationMin} min={0} step={0.1} onChange={(event) => setDurationMin(event.target.value)} placeholder="不限" /></label>
              <label className="media-field"><span>最长时长（秒）</span><input type="number" value={durationMax} min={0} step={0.1} onChange={(event) => setDurationMax(event.target.value)} placeholder="不限" /></label>
            </div>
            <datalist id="media-known-tags">{facets.data?.tags.map(({ tag, count }) => <option value={tag} key={tag}>{count} 个镜头</option>)}</datalist>
            <p className="media-note">标签条件作用于同一个镜头。未标注表示未知；“抽样未检出”仍可能包含人物。</p>
            {facets.isError && <p className="media-note" role="status">标签建议暂不可用，仍可手动填写标签。</p>}
          </details>
          <details className="media-advanced"><summary data-track-id="media.search.advanced" data-track-label="高级检索选项">检索设置<span>{profileLabels[profile]}</span></summary>
            <div className="media-filter-grid"><label className="media-field"><span>避免出现的内容</span><input value={excludeQuery} onChange={(event) => setExcludeQuery(event.target.value)} maxLength={2000} placeholder="可选，例如：拥挤的人群" /></label><label className="media-field"><span>检索能力</span><select value={profile} onChange={(event) => setProfile(event.target.value as RetrievalProfile)}>{Object.entries(profileLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="media-checkbox"><input type="checkbox" checked={rerank} onChange={(event) => setRerank(event.target.checked)} />使用可用的精细排序</label></div>
            <p className="media-note">排除描述用于降低相似内容的排序，不能保证完全排除；必须排除的已确认标签请使用标签筛选。</p>
            {status.data?.retrieval && <p className="media-note">{status.data.retrieval.multimodal.available ? "增强组合检索已就绪。" : "增强组合检索尚未就绪，自动模式将按实际可用能力执行。"}{status.data.retrieval.multimodal.reranker_ready ? "精细排序已就绪。" : "精细排序尚未就绪。"}</p>}
            {status.data?.retrieval?.multimodal.indexed_shots !== undefined && <p className="media-note">增强索引已覆盖 {status.data.retrieval.multimodal.indexed_shots} / {status.data.retrieval.multimodal.total_ready_shots ?? status.data.counts.indexed_shots} 个镜头{status.data.retrieval.multimodal.index_progress?.status === "sampling" ? `，正在准备抽样画面 ${status.data.retrieval.multimodal.index_progress.completed ?? 0} / ${status.data.retrieval.multimodal.index_progress.total ?? "—"}` : status.data.retrieval.multimodal.index_progress?.status === "building" ? "，正在构建索引" : ""}。</p>}
            {!!status.data?.retrieval?.multimodal.issues.length && <ul className="media-capability-issues">{status.data.retrieval.multimodal.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
          </details>
        </div>
        {formError && <Message error>{formError}</Message>}
      </form>
    </section>
    {videos.isError && <Message error>视频列表读取失败：{videos.error.message}</Message>}
    <section className="media-results" aria-label="镜头检索结果" aria-busy={resultsLoading}>
      <div className="media-results-heading"><div><h2 className="md-title-large">{activeCollection ? activeCollection.name : resultsLoading ? "正在检索镜头" : `检索结果 · ${visibleItems.length} 个镜头`}</h2><p>{activeCollection ? `固定选集 · ${activeCollection.item_count} 个镜头 · 创建于 ${new Date(activeCollection.created_at).toLocaleString("zh-CN")}` : submitted.label}</p></div>
        {activeCollection ? <div className="media-toolbar-actions"><Button variant="outline" size="sm" disabled={exportBusy || !can("data_platform:write")} onClick={() => void createDatasetFromCollection()}>创建数据集</Button><Button variant="outline" size="sm" disabled={exportBusy || !can("media:curate")} onClick={() => void downloadCollection(true)}>{exportBusy ? <LoaderCircle className="animate-spin" /> : <Download />}导出视频文件包</Button><Button variant="ghost" size="sm" disabled={exportBusy} onClick={() => void downloadCollection()}>{exportBusy ? <LoaderCircle className="animate-spin" /> : <Download />}导出清单</Button><Button variant="outline" size="sm" onClick={() => setActiveCollection(null)}>返回检索结果</Button></div> : <Button data-track-id="media.search.refresh" data-track-label="刷新检索结果" variant="ghost" size="sm" disabled={!can("media:search") || searchFetching} onClick={(event) => { execute(submitted.input, submitted.label, interactionForEvent(event.nativeEvent)); void status.refetch(); void videos.refetch(); }}><RefreshCw className={searchFetching ? "animate-spin" : ""} />刷新</Button>}
      </div>
      <div className="media-result-tools" data-empty={visibleItems.length === 0 || undefined}>
<MediaCurationPanel projectId={projectId} searchId={searchResult?.search_id} resultCount={searchResult?.items.length ?? 0} selectedIds={selectedIds} disabled={searchFetching || Boolean(activeCollection)} onReplay={replay} onOpenCollection={(item) => { setActiveCollection(item); setSelectedIds([]); setFeedbackError(""); }} />
      </div>
      <MediaEvaluationPanel projectId={projectId} initialEvaluationId={initialEvaluationId} disabled={searchFetching || Boolean(activeCollection)} currentSearch={searchResult?.search_id ? { searchId: searchResult.search_id, label: submitted.label, input: submitted.input, profile: searchResult.retrieval?.profile, reranked: searchResult.retrieval?.reranked } : undefined} />
      {!activeCollection && visibleItems.length > 0 && searchResult?.retrieval && <div className="media-retrieval-status"><span>{searchResult.retrieval.profile === "catalog" ? "条件筛选" : searchResult.retrieval.profile === "multimodal" ? "增强组合检索" : "基础检索"}{searchResult.retrieval.profile === "catalog" ? "" : searchResult.retrieval.reranked ? " · 已精细排序" : " · 未使用精细排序"}</span><span>评估 {searchResult.retrieval.candidate_count} 个候选</span><details><summary>能力与覆盖范围</summary>{searchResult.retrieval.profile === "catalog" && <p>按已发布镜头的标签与属性筛选。</p>}<p>{searchResult.retrieval.coverage === "sampled_keyframes" ? "检索基于抽样关键帧，不能证明整个镜头持续满足条件。" : searchResult.retrieval.coverage}</p>{searchResult.retrieval.models?.embedding && <p>检索模型：{searchResult.retrieval.models.embedding}</p>}{searchResult.retrieval.reranked && searchResult.retrieval.models?.reranker && <p>排序模型：{searchResult.retrieval.models.reranker}</p>}</details></div>}
      {!activeCollection && searchResult?.retrieval?.limitations?.map((limitation) => <Message key={limitation}>{limitation}</Message>)}
      {activeCollection && collection.data?.sampling && <details className="media-retrieval-status media-collection-sampling"><summary>采样与去重记录</summary><div>
        <p>从 {collection.data.sampling.candidate_count ?? "—"} 个候选选取 {collection.data.sampling.selected_count ?? activeCollection.item_count} 个镜头{collection.data.sampling.shortfall ? `，比目标少 ${collection.data.sampling.shortfall} 个` : ""}。</p>
        {collection.data.sampling.group_counts && <p>{Object.entries(collection.data.sampling.group_counts).map(([group, count]) => `${personLabels[group as PersonStatus] ?? videos.data?.find((video) => video.id === group)?.title ?? group}：${count}`).join(" · ")}</p>}
        {!!collection.data.sampling.excluded_duplicates?.length && <p>去除 {collection.data.sampling.excluded_duplicates.length} 个重复或近似镜头。</p>}
        {collection.data.sampling.deduplication?.note && <p>{collection.data.sampling.deduplication.note}</p>}
      </div></details>}
      {feedbackError && <Message error>{feedbackError}</Message>}
      {feedbackNotice && !activeCollection && <p className="media-success-note" role="status">{feedbackNotice}</p>}
      {!activeCollection && visibleItems.length > 0 && !resultsLoading && <div className="media-selection-toolbar"><label className="media-checkbox"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : visibleItems.map((shot) => shot.id))} />选择本次全部结果</label><span>{selectedIds.length} 个已选择</span>{selectedIds.length > 0 && <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>清空选择</Button>}</div>}
      {resultsError ? <Message error>{resultsError.message}</Message> : resultsLoading ? <div className="media-empty" role="status"><LoaderCircle className="animate-spin" /><h3>{activeCollection ? "正在读取固定选集" : "正在查找相关镜头"}</h3><p>请稍候，结果将保留匹配时间与来源。</p></div> : visibleItems.length ? <div className="media-shot-grid">{visibleItems.map((shot) => <ShotCard key={`${activeCollection?.id ?? searchResult?.search_id ?? submitted.revision}-${shot.id}-${shot.matched_frame_id ?? "none"}`} shot={shot} scoreType={activeCollection ? undefined : searchResult?.score_type} projectId={projectId} onPlay={() => setSelectedShot(shot)}
        selected={selectedIds.includes(shot.id)} onSelect={activeCollection ? undefined : () => setSelectedIds((current) => current.includes(shot.id) ? current.filter((id) => id !== shot.id) : [...current, shot.id])}
        onReference={can("media:search") ? () => useReference(shot) : undefined}
        relevance={feedback[`${searchResult?.search_id}:${shot.id}`]} feedbackBusy={feedbackBusy.includes(shot.id)} onFeedback={!activeCollection && searchResult?.search_id && can("media:curate") ? (relevance) => void recordFeedback(shot, relevance) : undefined}
        onTagsSaved={activeCollection ? undefined : () => void client.invalidateQueries({ queryKey: ["media-facets", projectId] })}
      />)}</div> : <div className="media-empty" data-onboarding={!activeCollection && status.data?.counts.indexed_shots === 0 || undefined}><Film /><h3>{activeCollection ? "这个固定选集没有镜头" : !can("media:search") ? "需要检索权限才能查看镜头" : status.data?.counts.indexed_shots === 0 ? "还没有可检索的镜头" : "没有找到符合条件的镜头"}</h3>
        <p>{activeCollection ? "此选集的固定快照为空，可返回检索结果选择其他镜头。" : !can("media:search") ? "申请镜头检索权限后，即可查找项目已发布的镜头。" : status.data?.counts.indexed_shots === 0 ? activeRunId ? "数据正在处理，索引发布后即可检索。" : "先导入视频并发布镜头索引，再开始探索。" : "放宽筛选条件或调整画面描述，也可以清除条件浏览全部镜头。"}</p>
        <div className="media-empty-actions">
        {!activeCollection && can("media:search") && status.data?.counts.indexed_shots === 0 && !activeRunId && <details className="media-onboarding-guide"><summary>查看处理步骤</summary><ol className="media-onboarding-steps" aria-label="开始探索的步骤">
          <li><span>1</span><div><strong>上传视频</strong><p>{status.data.counts.videos > 0 ? `项目已有 ${status.data.counts.videos} 个视频，可进入下一步。` : "从页面右上方上传要处理的视频。"}</p></div></li>
          <li><span>2</span><div><strong>处理并发布索引</strong><p>使用视频处理流程生成可检索镜头。</p></div></li>
          <li><span>3</span><div><strong>检索与整理</strong><p>用文字或参考图查找镜头，保存查询或固定选集。</p></div></li>
        </ol></details>}
        {!activeCollection && can("media:search") && status.data?.counts.indexed_shots === 0 && !activeRunId && (can("pipelines:write") ? <Link className={buttonVariants({ variant: "default" })} data-track-id="media.pipeline.configure" data-track-label="去创建处理流程" to="/projects/$projectId/pipelines" params={{ projectId }} search={{ view: "new", template: "video" }} data-variant="default" data-size="default"><span className="md-button-container md-state-layer">去创建处理流程</span></Link> : <PermissionRequestButton projectId={projectId} permission="pipelines:write" label="申请流程编辑权限" />)}
        {!activeCollection && can("media:search") && status.data?.counts.indexed_shots !== 0 && <Button variant="outline" onClick={clearSearch}><RefreshCw />清除条件，查看全部镜头</Button>}
        </div>
      </div>}
      {visibleItems.length ? <p className="media-results-note">{activeCollection ? "此处展示创建时的镜头快照。导出清单包含镜头边界、标签和处理来源；视频文件包另外包含裁剪后的镜头 MP4。文件包最多支持 100 个镜头、总时长 30 分钟。选集可用于后续标注与数据集发布，尚不代表已审核训练数据。" : `本次最多返回 ${submitted.input.limit} 个镜头。检索分数仅用于当前查询排序，不代表识别置信度。相关 / 不相关反馈用于评测，不会自动训练模型。`}</p> : null}
    </section>
    <ShotDialog shot={selectedShot} projectId={projectId} onClose={() => setSelectedShot(null)} />
  </main>;
}

export default function MediaPage() {
  const session = useAuth();
  const search = useSearch({ from: "/media" });
  const projectId = search.project_id ?? (session.me.scope.type === "project" ? session.me.scope.id : "demo");
  const { can, me } = useProjectAuth(projectId);
  if (!can("media:read")) return <main className="md-page"><h1 className="md-page-title">数据探索</h1><PermissionRequestButton projectId={projectId} permission="media:read" label="申请数据探索页面权限" /></main>;
  return <MediaWorkspace projectId={projectId} initialEvaluationId={search.evaluation_id} initialSearchId={search.search_id} key={`${me.user.id}:${projectId}:${search.evaluation_id ?? ""}:${search.search_id ?? ""}`} />;
}

export function ProjectExplorePage() {
  const session = useAuth();
  const search = useSearch({ strict: false }) as { evaluation_id?: string; search_id?: string };
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const routeProject = pathname.match(/^\/projects\/([^/]+)\/explore(?:\/|$)/)?.[1];
  const projectId = routeProject ? decodeURIComponent(routeProject) : session.me.scope.type === "project" ? session.me.scope.id : "demo";
  const { can, me } = useProjectAuth(projectId);
  if (!can("media:read")) return <main className="md-page"><h1 className="md-page-title">数据探索</h1><PermissionRequestButton projectId={projectId} permission="media:read" label="申请数据探索页面权限" /></main>;
  return <MediaWorkspace projectId={projectId} initialEvaluationId={search.evaluation_id} initialSearchId={search.search_id} key={`${me.user.id}:${projectId}:${search.evaluation_id ?? ""}:${search.search_id ?? ""}`} />;
}
