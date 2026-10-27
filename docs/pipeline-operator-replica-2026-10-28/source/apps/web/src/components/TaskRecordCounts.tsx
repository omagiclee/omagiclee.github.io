import type { PipelineTask } from "../pipelines-api";

export const TASK_RECORD_COUNTS_HELP = "输入/输出统计节点的记录数；未检出人物的关键帧也会保留，数量不代表人物数。节点完成后更新输出，处理进度单独显示已生成的产物。";

export function TaskRecordCounts({ task }: { task: PipelineTask }) {
  const input = Number.isFinite(task.input_count) ? task.input_count : "—";
  const output = Number.isFinite(task.output_count) ? task.output_count : "—";
  if (task.status === "succeeded" || task.status === "cached") return <span className="task-record-counts">{input} → {output} 条</span>;
  const waiting = ["pending", "queued", "running", "cancelling"].includes(task.status);
  return <span className="task-record-counts">输入 {input} 条 · {typeof output === "number" && output > 0 ? `已提交输出 ${output} 条` : waiting ? "输出待完成" : "输出未完成"}</span>;
}
