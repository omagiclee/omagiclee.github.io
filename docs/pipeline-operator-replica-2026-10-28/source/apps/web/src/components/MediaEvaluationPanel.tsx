import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, FlaskConical, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { ApiError } from "../auth-api";
import { useProjectAuth } from "../auth-context";
import { platformRequest, type PageResult } from "../data-platform-api";
import { mediaFileUrl, type MediaSearchInput } from "../media-api";
import { attachMediaEvaluationScheme, createMediaEvaluation, createMediaReflow, judgeMediaEvaluation, loadMediaEvaluation, loadMediaEvaluations, loadMediaReflows, reviewMediaEvaluation, type EvaluationGrade, type MediaEvaluation, type MediaReflowResult } from "../media-evaluation-api";
import { Button } from "./ui/button";
import "./media-evaluation.css";

interface SearchSession { searchId: string; label: string; input: MediaSearchInput; profile?: string; reranked?: boolean }
interface Props { projectId: string; currentSearch?: SearchSession; disabled: boolean; initialEvaluationId?: string }
const gradeLabels = { unknown: "未知 / 未标注", "0": "0 · 不相关", "1": "1 · 相关", "2": "2 · 高度相关" };
const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
const profileLabels: Record<string, string> = { baseline: "基础检索", multimodal: "增强组合检索", auto: "自动检索", catalog: "条件筛选" };
const sessionLabel = (session: SearchSession) => `${session.label} · ${profileLabels[session.profile ?? session.input.retrieval_profile ?? "catalog"] ?? session.profile}${session.reranked ? " · 已精细排序" : ""}`;
const time = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;
function retrievalLabel(retrieval: Record<string, unknown>) {
  const profile = typeof retrieval.profile === "string" ? profileLabels[retrieval.profile] ?? retrieval.profile : "未记录能力";
  const models = retrieval.models && typeof retrieval.models === "object" ? retrieval.models as Record<string, unknown> : {};
  return [profile, typeof models.embedding === "string" ? models.embedding : "", retrieval.reranked ? "已精细排序" : ""].filter(Boolean).join(" · ");
}
function queryIdentity(input: Omit<MediaSearchInput, "limit"> & { limit?: number }) {
  return JSON.stringify(Object.fromEntries(Object.entries(input).filter(([key]) => !["retrieval_profile", "rerank", "limit", "embedding_space"].includes(key)).sort(([left], [right]) => left.localeCompare(right))));
}

export function MediaEvaluationPanel({ projectId, currentSearch, disabled, initialEvaluationId }: Props) {
  const { me, can } = useProjectAuth(projectId);
  const client = useQueryClient();
  const [open, setOpen] = useState(Boolean(initialEvaluationId));
  const [recent, setRecent] = useState<SearchSession[]>([]);
  const [searchIds, setSearchIds] = useState<string[]>([]);
  const [searchIdsTouched, setSearchIdsTouched] = useState(false);
  const [evaluationId, setEvaluationId] = useState(initialEvaluationId ?? "");
  const [name, setName] = useState("");
  const [k, setK] = useState(20);
  const [schemeName, setSchemeName] = useState("");
  const [reviewDeclaration, setReviewDeclaration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reflowIds, setReflowIds] = useState<string[]>([]);
  const [reflowName, setReflowName] = useState("");
  const [issue, setIssue] = useState("");
  const [action, setAction] = useState<"selection" | "annotation">("selection");
  const [specId, setSpecId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [specQuery, setSpecQuery] = useState("");
  const [specCursor, setSpecCursor] = useState("");
  const reflowKey = useRef({ signature: "", key: "" });
  const [reflowResult, setReflowResult] = useState<MediaReflowResult | null>(null);
  const permitted = can("media:curate") && can("media:search");
  const evaluations = useQuery({ queryKey: ["media-evaluations", projectId], queryFn: () => loadMediaEvaluations(projectId), enabled: open && can("media:search"), retry: false });
  const detail = useQuery({ queryKey: ["media-evaluation", projectId, evaluationId], queryFn: () => loadMediaEvaluation(projectId, evaluationId), enabled: open && Boolean(evaluationId) && can("media:search"), retry: false });
  const evaluation = detail.data;
  const reflows = useQuery({ queryKey: ["media-evaluation-reflows", projectId, evaluationId], queryFn: () => loadMediaReflows(projectId, evaluationId), enabled: open && Boolean(evaluationId) && can("media:search") && can("data_platform:read"), retry: false });
  const participants = useQuery({ queryKey: ["media-reflow-participants", projectId], queryFn: () => platformRequest<{ items: { id: string; name: string; canAnnotate: boolean; canReview: boolean }[] }>(projectId, "/participants"), enabled: open && action === "annotation" && can("data_platform:read"), retry: false });
  const specs = useQuery({ queryKey: ["media-reflow-specs", projectId, specQuery, specCursor], queryFn: () => platformRequest<PageResult<{ id: string; name: string; version: string }>>(projectId, `/specs?limit=50&q=${encodeURIComponent(specQuery)}${specCursor ? `&cursor=${encodeURIComponent(specCursor)}` : ""}`), enabled: open && action === "annotation" && can("data_platform:read"), retry: false });

  useEffect(() => {
    if (!currentSearch?.searchId) return;
    setRecent((items) => items.some((item) => item.searchId === currentSearch.searchId) ? items : [...items.slice(-11), currentSearch]);
    if (!searchIdsTouched) setSearchIds([currentSearch.searchId]);
  }, [currentSearch, searchIdsTouched]);
  useEffect(() => { setReviewDeclaration(false); }, [evaluationId, evaluation?.reviewed]);

  function chooseEvaluation(id: string) {
    setEvaluationId(id); setError(""); setNotice(""); setReviewDeclaration(false); setReflowIds([]); setReflowResult(null);
  }
  function accept(updated: MediaEvaluation) {
    client.setQueryData(["media-evaluation", projectId, updated.id], updated);
    setEvaluationId(updated.id);
    void client.invalidateQueries({ queryKey: ["media-evaluations", projectId] });
  }
  function rebuildPool() {
    if (!evaluation) return;
    const savedSessions = evaluation.schemes.map((scheme): SearchSession => ({ searchId: scheme.search_id, label: evaluation.query.query || "评测原查询", input: { ...evaluation.query, limit: scheme.items.length || 24 }, profile: typeof scheme.retrieval.profile === "string" ? scheme.retrieval.profile : undefined, reranked: Boolean(scheme.retrieval.reranked) }));
    setRecent((items) => [...items.filter((item) => !savedSessions.some((saved) => saved.searchId === item.searchId)), ...savedSessions]);
    setSearchIdsTouched(true);
    setSearchIds([...new Set([...savedSessions.map((item) => item.searchId), ...(currentSearch && queryIdentity(currentSearch.input) === queryIdentity(evaluation.query) ? [currentSearch.searchId] : [])])]);
    chooseEvaluation("");
  }
  async function mutate(work: () => Promise<MediaEvaluation>, message: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await client.cancelQueries({ queryKey: ["media-evaluation", projectId, evaluationId] }); accept(await work()); setNotice(message); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "评测保存失败，请重试。"); if (failure instanceof ApiError && failure.status === 409) void detail.refetch(); }
    finally { setBusy(false); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!permitted || !name.trim() || !searchIds.length) return;
    await mutate(() => createMediaEvaluation(projectId, { name: name.trim(), search_ids: searchIds, k }, me.csrf_token), "已冻结候选池与真实检索方案，请逐一标注相关性。");
    setReflowIds([]); setReflowResult(null);
  }
  async function reflow(event: React.FormEvent) {
    event.preventDefault();
    if (!evaluation || busy || !can("data_platform:write") || !reflowIds.length || !reflowName.trim() || !issue.trim()) return;
    setBusy(true); setError(""); setReflowResult(null);
    try {
      const input = { evaluation_id: evaluation.id, shot_ids: reflowIds, name: reflowName.trim(), issue: issue.trim(), action, ...(action === "annotation" ? { spec_id: specId, assignee_id: assigneeId, reviewer_id: reviewerId } : {}) };
      const signature = JSON.stringify(input);
      if (reflowKey.current.signature !== signature) reflowKey.current = { signature, key: crypto.randomUUID() };
      setReflowResult(await createMediaReflow(projectId, { ...input, idempotency_key: reflowKey.current.key }, me.csrf_token));
      reflowKey.current = { signature: "", key: "" };
      void reflows.refetch();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "回流创建失败，请重试。"); }
    finally { setBusy(false); }
  }
  const attached = evaluation?.schemes.some((scheme) => scheme.search_id === currentSearch?.searchId);
  const failureIds = evaluation ? [...new Set(evaluation.failures.flatMap((item) => [...item.false_positive_ids, ...item.missed_relevant_ids]))] : [];
  const validReflowUrl = reflowResult?.url.startsWith(`/projects/${encodeURIComponent(projectId)}/`) ? reflowResult.url : undefined;
  return <section className="media-evaluation" aria-label="检索质量评测">
    <div className="media-evaluation-heading"><Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}><FlaskConical />检索质量评测</Button><span className="media-note">固定候选池 · 人工分级 · 真实方案对比</span></div>
    {open && <div className="media-evaluation-workspace">
      <p className="media-note">先用相同查询运行不同检索设置，再选择实际会话创建并集候选池。评测只覆盖冻结候选池，不能代表整个视频库的召回率。</p>
      {evaluations.isLoading && <p role="status">正在读取评测基准…</p>}
      {evaluations.isError && <p role="alert">基准读取失败：{evaluations.error.message} <Button size="sm" variant="ghost" onClick={() => void evaluations.refetch()}>重试</Button></p>}
      {!!evaluations.data?.items.length && <label className="media-field"><span>已有评测基准</span><select value={evaluationId} disabled={busy} onChange={(event) => chooseEvaluation(event.target.value)}><option value="">创建新的评测基准</option>{evaluations.data.items.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.candidate_count} 个候选 · {item.reviewed ? "已复核" : "未复核"}</option>)}</select></label>}
      {!evaluationId && <form onSubmit={(event) => void create(event)} className="media-evaluation-create">
        <h3>1. 冻结评测候选池</h3>
        <div className="media-filter-grid"><label className="media-field"><span>评测基准名称</span><input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="例如：森林镜头检索基准" /></label><label className="media-field"><span>评测排名 K</span><input type="number" min={1} max={100} value={k} onChange={(event) => setK(Number(event.target.value))} required /></label></div>
        <fieldset disabled={busy || disabled || !permitted}><legend>选择本页已完成的真实检索会话</legend>{recent.length ? recent.map((session) => <label className="media-checkbox" key={session.searchId}><input type="checkbox" checked={searchIds.includes(session.searchId)} onChange={() => { setSearchIdsTouched(true); setSearchIds((ids) => ids.includes(session.searchId) ? ids.filter((id) => id !== session.searchId) : [...ids, session.searchId]); }} />{sessionLabel(session)}</label>) : <p className="media-note">完成一次镜头检索后，可创建基准。比较方案请先完成两次相同查询。</p>}</fieldset>
        <Button type="submit" disabled={busy || disabled || !permitted || !name.trim() || !searchIds.length}><Plus />创建固定评测候选池</Button>
      </form>}
      {detail.isLoading && evaluationId && <p role="status">正在读取固定评测候选池…</p>}
      {detail.isError && <p role="alert">评测读取失败：{detail.error.message} <Button size="sm" variant="ghost" onClick={() => void detail.refetch()}>重试读取</Button></p>}
      {evaluation && <>
        <div className="media-evaluation-heading"><div><h3>{evaluation.name}</h3><p className="media-note">{evaluation.candidates.length} 个固定候选 · {evaluation.candidates.filter((item) => item.grade !== null).length} 个已标注 · K={evaluation.k}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={rebuildPool}>新建并集基准</Button><Button size="sm" variant="ghost" disabled={busy || detail.isFetching} onClick={() => void detail.refetch()}><RefreshCw />刷新评测</Button></div>
        {!!evaluation.drift.length && <p role="alert">候选来源已变化，质量比较被阻断：{evaluation.drift.map((item) => item.reason).join("；")}。请重新检索并创建新的并集基准。</p>}
        <h3>2. 人工标注与复核</h3>
        <p className="media-note">0 为不相关，1 为相关，2 为高度相关；未知表示未判定。任何等级修改都会撤销复核并隐藏质量指标。</p>
        <div className="media-evaluation-candidates">{evaluation.candidates.map((shot, index) => <article key={shot.id}>
          {mediaFileUrl(shot.keyframe_url) && <img src={mediaFileUrl(shot.keyframe_url)} alt={`${shot.video_title} 评测关键帧`} loading="lazy" />}
          <div><h4>{index + 1}. {shot.video_title}</h4><p className="media-note">{time(shot.start_ms)} — {time(shot.end_ms)}</p>
            {mediaFileUrl(shot.video_url) && <details><summary>查看视频依据</summary><video controls preload="none" src={`${mediaFileUrl(shot.video_url)}#t=${shot.start_ms / 1000},${shot.end_ms / 1000}`} /></details>}
            <label className="media-field"><span>相关性等级 · 镜头 {index + 1}</span><select value={shot.grade === null ? "unknown" : String(shot.grade)} disabled={busy || !permitted} onChange={(event) => { const grade = event.target.value === "unknown" ? null : Number(event.target.value) as EvaluationGrade; void mutate(() => judgeMediaEvaluation(projectId, evaluation.id, shot.id, grade, me.csrf_token, evaluation.revision), "相关性等级已保存；请重新人工复核。"); }}>{Object.entries(gradeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label className="media-checkbox"><input type="checkbox" checked={reflowIds.includes(shot.id)} onChange={() => setReflowIds((ids) => ids.includes(shot.id) ? ids.filter((id) => id !== shot.id) : [...ids, shot.id])} />回流镜头 {index + 1}</label>
          </div>
        </article>)}</div>
        {evaluation.review_source === "test_fixture" && <p role="status" className="media-evaluation-fixture">验收标注 / 非人工质量结论：以下数值仅验证评测流程，不能用于宣称检索质量提升。</p>}
        {evaluation.reviewed ? <div className="media-toolbar-actions"><p role="status">{evaluation.review_source === "human" ? "已声明人工复核" : "已完成验收复核"}</p><Button variant="ghost" size="sm" disabled={busy || !permitted} onClick={() => void mutate(() => reviewMediaEvaluation(projectId, evaluation.id, false, me.csrf_token, evaluation.revision), "复核声明已撤销，质量指标已隐藏。")}>撤销复核声明</Button></div> : <div><p role="status">尚未人工复核，不提供质量结论。</p><label className="media-checkbox"><input type="checkbox" checked={reviewDeclaration} onChange={(event) => setReviewDeclaration(event.target.checked)} />我已查看候选镜头，并人工复核已填写的相关性等级；未知候选仍保持未知</label><Button variant="outline" disabled={busy || !permitted || !reviewDeclaration || !evaluation.candidates.some((item) => item.grade !== null)} onClick={() => void mutate(() => reviewMediaEvaluation(projectId, evaluation.id, true, me.csrf_token, evaluation.revision), "人工复核声明已保存。")}><ClipboardCheck />确认人工复核</Button></div>}
        <h3>3. 对比真实检索方案</h3>
        <p className="media-note">保持查询与来源索引一致，在上方切换检索设置并再次检索，再附加当前方案。若新结果超出固定候选池，请勾选两次检索会话重建并集基准。</p>
        <div className="media-filter-grid"><label className="media-field"><span>当前检索方案名称（可选）</span><input value={schemeName} maxLength={120} onChange={(event) => setSchemeName(event.target.value)} placeholder={currentSearch ? sessionLabel(currentSearch) : "先完成真实检索"} /></label><Button variant="outline" disabled={busy || disabled || !permitted || !currentSearch || attached} onClick={() => { if (currentSearch) void mutate(() => attachMediaEvaluationScheme(projectId, evaluation.id, currentSearch.searchId, schemeName, me.csrf_token, evaluation.revision), "当前真实检索方案已附加。"); }}><Plus />{attached ? "当前检索方案已附加" : "附加当前检索方案"}</Button></div>
        <ul className="media-evaluation-schemes">{evaluation.schemes.map((scheme) => <li key={scheme.search_id}>{scheme.label} · {retrievalLabel(scheme.retrieval)} · {scheme.items.length} 个结果</li>)}</ul>
        {evaluation.reviewed && !evaluation.drift.length && evaluation.status !== "blocked" && evaluation.metrics?.length ? <div className="media-evaluation-table"><table><caption>{evaluation.review_source === "test_fixture" ? "验收流程指标（非人工质量结论）" : "人工复核候选池上的检索指标"}</caption><thead><tr><th>方案</th><th>P@{evaluation.k}</th><th>池内 Recall@{evaluation.k}</th><th>nDCG@{evaluation.k}</th><th>已判定覆盖率</th><th>真实耗时</th></tr></thead><tbody>{evaluation.metrics.map((metric) => { const values = metric.report.queries[0]; return <tr key={metric.search_id}><th scope="row">{metric.label}<small>{retrievalLabel(evaluation.schemes.find((scheme) => scheme.search_id === metric.search_id)?.retrieval ?? {})}</small></th><td>{percent(values?.precision_at_k)}</td><td>{percent(values?.recall_at_k)}</td><td>{percent(values?.ndcg_at_k)}</td><td>{percent(values?.judged_fraction)}</td><td>{values?.elapsed_ms == null ? "未记录" : `${values.elapsed_ms.toFixed(0)} ms`}</td></tr>; })}</tbody></table><p className="media-note">P@K 分母为 K；未知镜头贡献为 0 并单独计入覆盖率。池内召回仅以已标注正例为分母；无已知正例时 Recall / nDCG 未定义，显示 —。</p></div> : <p className="media-note">完成相关性标注与显式复核后，才显示指标。候选漂移会阻断比较。</p>}
        <h3>4. 将问题镜头回流</h3>
        <p className="media-note">手动选择需要处理的候选，并填写原因。回流创建真实反馈、筛选或标注任务，不会自动把模型分数当作错误标签。</p>
        {!!failureIds.length && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReflowIds(failureIds)}>选择评测中的误召回与漏召回镜头</Button>}
        <form className="media-evaluation-reflow" onSubmit={(event) => void reflow(event)}><p>{reflowIds.length} 个镜头已选择</p><div className="media-filter-grid"><label className="media-field"><span>回流名称</span><input value={reflowName} onChange={(event) => setReflowName(event.target.value)} required maxLength={120} /></label><label className="media-field"><span>回流目的</span><select value={action} onChange={(event) => setAction(event.target.value as typeof action)}><option value="selection">创建筛选工作集</option><option value="annotation">创建标注任务</option></select></label></div><label className="media-field"><span>问题原因与处理要求</span><textarea value={issue} onChange={(event) => setIssue(event.target.value)} required maxLength={4000} rows={3} /></label>
          {action === "annotation" && <div className="media-filter-grid"><label className="media-field"><span>搜索标注规范</span><input value={specQuery} onChange={(event) => { setSpecQuery(event.target.value); setSpecCursor(""); setSpecId(""); }} /></label><label className="media-field"><span>标注规范</span><select value={specId} required onChange={(event) => setSpecId(event.target.value)}><option value="">选择规范</option>{specs.data?.items.map((spec) => <option value={spec.id} key={spec.id}>{spec.name} · {spec.version}</option>)}</select></label>{(specCursor || specs.data?.nextCursor) && <div className="media-toolbar-actions"><Button type="button" size="sm" variant="ghost" disabled={!specCursor} onClick={() => { setSpecCursor(""); setSpecId(""); }}>返回首页</Button><Button type="button" size="sm" variant="ghost" disabled={!specs.data?.nextCursor} onClick={() => { setSpecCursor(specs.data!.nextCursor!); setSpecId(""); }}>更多规范</Button></div>}<label className="media-field"><span>标注负责人</span><select value={assigneeId} required onChange={(event) => setAssigneeId(event.target.value)}><option value="">选择标注员</option>{participants.data?.items.filter((user) => user.canAnnotate).map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label><label className="media-field"><span>审核负责人</span><select value={reviewerId} required onChange={(event) => setReviewerId(event.target.value)}><option value="">选择审核员</option>{participants.data?.items.filter((user) => user.canReview && user.id !== assigneeId).map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label>{(participants.isLoading || specs.isLoading) && <p role="status">正在读取标注配置…</p>}{(participants.isError || specs.isError) && <p role="alert">标注配置读取失败：{participants.error?.message ?? specs.error?.message}</p>}</div>}
          <Button type="submit" disabled={busy || !can("data_platform:write") || !permitted || !reflowIds.length || !reflowName.trim() || !issue.trim() || (action === "annotation" && (!specId || !assigneeId || !reviewerId || reviewerId === assigneeId))}>{busy && <LoaderCircle className="animate-spin" />}创建真实{action === "selection" ? "筛选工作集" : "标注任务"}</Button>
          {!can("data_platform:write") && <p className="media-note">需要数据平台写入权限才能创建回流。</p>}
          {reflowResult && <p role="status">{reflowResult.created ? "回流已创建" : "已找到同一回流记录"} · {reflowResult.feedback_ids.length} 条反馈{validReflowUrl && <> · <a className="media-source-run" href={validReflowUrl}>打开{reflowResult.task_id ? "标注任务" : "筛选工作集"}</a></>}</p>}
        </form>
        {!!reflows.data?.items.length && <div><h4>已创建的回流记录</h4><ul>{reflows.data.items.map((item) => <li key={item.task_id ?? item.selection_id ?? item.dataset_id}>{item.name} · {item.issue}{item.url.startsWith(`/projects/${encodeURIComponent(projectId)}/`) && <> · <a href={item.url}>打开{item.task_id ? "标注任务" : "筛选工作集"}</a></>}</li>)}</ul></div>}
        {reflows.isError && <p role="alert">回流记录读取失败：{reflows.error.message} <Button size="sm" variant="ghost" onClick={() => void reflows.refetch()}>重试读取回流</Button></p>}
      </>}
      {!permitted && <p className="media-note">需要镜头检索与整理权限才能创建基准、标注或复核。</p>}
      {notice && <p role="status" className="media-success-note">{notice}</p>}
      {error && <p role="alert" className="media-message media-message-error">{error}</p>}
    </div>}
  </section>;
}
