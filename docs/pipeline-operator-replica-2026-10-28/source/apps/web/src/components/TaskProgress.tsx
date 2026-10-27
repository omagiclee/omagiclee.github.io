import type { PipelineTask } from "../pipelines-api";
import { Progress } from "./ui/progress";
import "./task-progress.css";

const unitLabels: Record<string, string> = { frame: "帧", frames: "帧", shot: "个镜头", shots: "个镜头", video: "个视频", videos: "个视频", record: "条", records: "条" };

export function TaskProgress({ task }: { task: PipelineTask }) {
  const progress = task.progress;
  if (!progress || !Number.isFinite(progress.completed) || !Number.isFinite(progress.total) || progress.completed < 0 || progress.total < 0) return null;
  const count = `${progress.completed} / ${progress.total} ${unitLabels[progress.unit] ?? progress.unit}`.trim();
  const timestamp = progress.last_progress_at ? new Date(progress.last_progress_at) : null;
  const validTime = timestamp && Number.isFinite(timestamp.getTime());
  const value = Math.min(progress.completed, progress.total);
  return <div className="task-progress">
    <div className="task-progress-count"><span>{progress.source === "artifact_files" ? "已生成" : "已处理"}</span><strong>{count}</strong></div>
    {progress.total > 0 && <Progress className="task-progress-track" aria-label={`${task.node_id} 处理进度`} min={0} max={progress.total} value={value} aria-valuetext={count} />}
    <p className="task-progress-time">{validTime ? <>最近产物：<time dateTime={progress.last_progress_at!} title={timestamp.toLocaleString("zh-CN", { timeZoneName: "short" })}>{timestamp.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</time></> : progress.completed === 0 ? "等待首个产物" : "最近产物时间暂不可用"}</p>
  </div>;
}
