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
