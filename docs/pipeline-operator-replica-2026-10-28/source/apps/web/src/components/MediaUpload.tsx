import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { importMediaVideo, loadMediaRun, retryMediaSubmission } from "../media-api";
import type { PipelineRun } from "../pipelines-api";
import { Dialog } from "@base-ui/react/dialog";
import { CheckCircle2, Copy, FileVideo, LoaderCircle, Upload, X } from "lucide-react";
import { useProjectAuth } from "../auth-context";
import { apiUrl } from "../auth-api";
import { instrumentedFetch } from "../telemetry";
import { Button } from "./ui/button";
import "./media-upload.css";

const MAX_SOURCE_BYTES = 650 * 1024 * 1024;

export function MediaUpload({ projectId, onImported }: { projectId: string; onImported?: () => void }) {
  const { me, can } = useProjectAuth(projectId);
  const picker = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLTextAreaElement>(null);
  const helperId = useId();
  const [fileInvalid, setFileInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [uri, setUri] = useState("");
  const [fileName, setFileName] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [processing, setProcessing] = useState(false);
  const [importRun, setImportRun] = useState<PipelineRun | null>(null);
  const importKey = useRef("");
  const notified = useRef("");
  const trackedRun = useQuery({ queryKey: ["media-import-run", projectId, importRun?.id], queryFn: () => loadMediaRun(projectId, importRun!.id), enabled: Boolean(importRun), refetchInterval: (query) => ["succeeded", "failed", "cancelled"].includes(query.state.data?.status ?? "") ? false : 2000 });
  const currentRun = trackedRun.data ?? importRun;
  const importActive = Boolean(currentRun && !["succeeded", "failed", "cancelled"].includes(currentRun.status));
  const locked = pending || processing || importActive;
  useEffect(() => {
    if (currentRun?.status === "succeeded" && notified.current !== currentRun.id) { notified.current = currentRun.id; onImported?.(); }
  }, [currentRun, onImported]);

  async function processVideo(retry = false) {
    if (!uri || processing) return;
    setProcessing(true); setError("");
    if (retry || !importKey.current) importKey.current = crypto.randomUUID();
    try {
      const run = currentRun?.can_retry_submission
        ? await retryMediaSubmission(projectId, currentRun.id, me.csrf_token)
        : await importMediaVideo(projectId, { object_uri: uri, title: fileName.slice(0, 160), idempotency_key: importKey.current }, me.csrf_token);
      setImportRun(run);
      if (run.id === currentRun?.id) await trackedRun.refetch();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "视频处理提交失败，请重试。"); }
    finally { setProcessing(false); }
  }

  useEffect(() => { if (open && !pending) { if (error) picker.current?.focus(); else if (uri) result.current?.focus(); } }, [open, pending, error, uri]);

  async function upload(file?: File) {
    if (!file || locked) return;
    setImportRun(null); importKey.current = ""; setFileInvalid(false); setFileName(file.name); setError(""); setUri(""); setCopyNotice("");
    if (file.size === 0) { setFileInvalid(true); setError("视频文件为空，请重新选择。"); return; }
    if (file.size > MAX_SOURCE_BYTES) {
      setFileInvalid(true);
      setError("源文件不能超过 650 MiB，请选择较小的视频文件。");
      return;
    }
    setPending(true);
    try {
      const response = await instrumentedFetch(apiUrl(`/api/media/uploads?project_id=${encodeURIComponent(projectId)}&filename=${encodeURIComponent(file.name)}`), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/octet-stream", "X-CSRF-Token": me.csrf_token }, body: file,
      });
      const body = await response.json() as { detail?: unknown; object_uri?: string };
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "上传失败，请重试。");
      if (!body.object_uri) throw new Error("上传结果缺少项目文件地址，请重试。");
      setUri(body.object_uri);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "上传失败，请重试。"); }
    finally { setPending(false); }
  }

  async function copyUri() {
    try { await navigator.clipboard.writeText(uri); setCopyNotice("项目文件地址已复制。"); }
    catch { setCopyNotice("无法自动复制，请选择地址手动复制。"); }
  }

  if (!can("pipelines:write")) return null;
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!pending && !processing) setOpen(value); }}>
    <Dialog.Trigger render={<Button variant="outline" size="sm" />}><Upload />上传源视频</Dialog.Trigger>
    <Dialog.Portal><Dialog.Backdrop className="md-dialog-backdrop fixed inset-0 z-40" />
      <Dialog.Viewport className="media-upload-viewport"><Dialog.Popup className="media-upload-dialog" initialFocus={picker}>
        <header className="media-upload-header"><div>
          <Dialog.Title className="md-headline-small">上传源视频</Dialog.Title>
          <Dialog.Description className="md-body-medium">将视频保存到当前项目的对象存储，上传后可直接处理并发布镜头索引，完成后在当前页面检索。</Dialog.Description>
        </div><Dialog.Close render={<Button variant="ghost" size="icon" disabled={pending || processing} />} aria-label="关闭上传窗口"><X /></Dialog.Close></header>
        <div className="media-upload-content" aria-busy={locked}>
          <label className="media-source-picker md-state-layer" data-disabled={locked || undefined}>
            <input ref={picker} className="sr-only" aria-label="源视频文件" aria-invalid={fileInvalid} aria-describedby={`${helperId}-help${error ? ` ${helperId}-error` : ""}`} type="file" accept="video/*" disabled={locked} onChange={(event) => {
              const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void upload(file);
            }} />
            <Upload aria-hidden="true" /><span><strong>选择视频文件</strong><small id={`${helperId}-help`}>选择后立即上传 · 最大 650 MiB</small></span>
          </label>
          {fileName && <p className="media-upload-file"><FileVideo aria-hidden="true" /><span>{fileName}</span></p>}
          {pending && <p className="media-upload-status md-body-medium" role="status"><LoaderCircle className="animate-spin" aria-hidden="true" />正在上传，请保持此窗口打开。</p>}
          {error && <p id={`${helperId}-error`} className="media-upload-error md-body-medium" role="alert">{error}</p>}
          {uri && <section className="media-upload-result" aria-label="上传结果">
            <p className="media-upload-status md-body-medium" role="status"><CheckCircle2 aria-hidden="true" />视频已上传</p>
            <label className="md-field"><span className="md-field-label">项目文件地址</span><textarea ref={result} className="md-textarea" aria-label="项目文件地址" value={uri} readOnly rows={3} /></label>
            <p className="md-body-small">直接处理将运行镜头切分、关键帧、人物检测和本地向量索引；需服务端模型与执行器已就绪。</p>
            {currentRun?.status === "succeeded" ? <p className="media-upload-status" role="status"><CheckCircle2 />镜头索引已发布，可以关闭窗口开始检索。</p> : <Button disabled={processing || (importActive && !currentRun?.can_retry_submission) || !can("pipelines:run") || !can("pipelines:read") || !can("operators:register")} onClick={() => void processVideo(currentRun?.status === "failed" || currentRun?.status === "cancelled")}>{processing || importActive ? <LoaderCircle className="animate-spin" /> : <FileVideo />}{currentRun?.can_retry_submission ? "重试提交" : importActive ? "正在处理视频" : currentRun ? "重新处理视频" : "处理并发布镜头"}</Button>}
            {currentRun && <div className="md-body-small"><p role="status">{currentRun.status === "failed" ? "视频处理失败" : currentRun.status === "cancelled" ? "视频处理已取消" : currentRun.status === "succeeded" ? "处理完成" : currentRun.waiting_reason ?? "正在等待镜头索引发布"}{currentRun.tasks.find((task) => task.status === "running") ? ` · ${currentRun.tasks.find((task) => task.status === "running")!.node_id}` : ""}</p>{(currentRun.error || currentRun.tasks.find((task) => task.error)?.error) && <p role="alert">{currentRun.error || currentRun.tasks.find((task) => task.error)?.error}</p>}<Link to="/projects/$projectId/pipelines" params={{ projectId }} search={{ pipelineId: currentRun.pipeline_id, view: "runs", runId: currentRun.id }}>查看处理运行</Link></div>}
            {trackedRun.isError && <p role="alert">处理状态读取失败：{trackedRun.error.message} <Button variant="ghost" size="sm" onClick={() => void trackedRun.refetch()}>重试读取状态</Button></p>}
            {(!can("pipelines:run") || !can("pipelines:read") || !can("operators:register")) && <p className="md-body-small">需要流程运行、读取和算子注册权限才能直接处理视频。</p>}
            <Button variant="ghost" size="sm" onClick={() => void copyUri()}><Copy />复制地址</Button>
            {copyNotice && <p className="md-body-small" role="status">{copyNotice}</p>}
          </section>}
        </div>
        <footer className="media-upload-footer"><Dialog.Close render={<Button variant="ghost" disabled={pending || processing} />}>{uri ? "完成" : "关闭"}</Dialog.Close></footer>
      </Dialog.Popup></Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>;
}
