import type { AcceptanceCheck, DataTaskType, Prioritization, Requirement, RequirementCategory, RequirementPriority, RequirementStatus } from "./types";

export const statusLabels: Record<RequirementStatus, string> = {
  draft: "草稿",
  needs_info: "待补充",
  pending_review: "待评审",
  pending_schedule: "待排期",
  in_progress: "进行中",
  pending_acceptance: "待验收",
  completed: "已完成",
  deferred: "已暂缓",
  rejected: "已拒绝",
  cancelled: "已撤回",
};

export const priorityLabels: Record<RequirementPriority, string> = {
  low: "低", medium: "中", high: "高", urgent: "紧急",
};

export const categoryLabels: Record<RequirementCategory, string> = {
  product: "产品功能", data: "数据能力", analytics: "分析报表", integration: "系统集成",
};

export function statusVariant(status: RequirementStatus): "success" | "warning" | "secondary" | "outline" | "destructive" {
  if (status === "completed") return "success";
  if (status === "rejected") return "destructive";
  if (status === "needs_info") return "warning";
  if (["deferred", "cancelled", "draft"].includes(status)) return "outline";
  return "secondary";
}

export const taskLabels: Record<DataTaskType, string> = {
  collection: "数据采集", curation: "数据筛选", annotation: "数据标注", simulation: "仿真合成", evaluation: "模型评测", platform: "平台开发",
};
export const operatorLabels = { gte: "≥", lte: "≤", eq: "=" };
export const closedStatuses: RequirementStatus[] = ["completed", "rejected", "cancelled"];
export function isPlatformRequirement(item: Pick<Requirement, "data_spec" | "category">) {
  return item.data_spec?.task_type === "platform" || (!item.data_spec && item.category !== "data");
}
export function priorityScore(value: Prioritization | null) {
  return value ? (value.impact + value.urgency) * value.confidence / value.effort : 0;
}
export function checkPasses(check: AcceptanceCheck, actual: number) {
  return Number.isFinite(actual) && (check.operator === "gte" ? actual >= check.target : check.operator === "lte" ? actual <= check.target : actual === check.target);
}
export function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function isOverdue(item: Requirement) {
  return Boolean(item.committed_due_date && item.committed_due_date < localDate() && !closedStatuses.includes(item.status));
}
export function nextStep(item: Requirement, userId: string) {
  const mine = item.requester_id === userId;
  if (item.status === "draft" || item.status === "needs_info") return mine ? "完善材料并提交" : "等待用户补充";
  if (item.status === "pending_review") return "确认范围与验收标准";
  if (item.status === "pending_schedule") return "确认负责人和承诺日期";
  if (item.status === "in_progress") return isPlatformRequirement(item) ? "准备发布版本与测试报告" : "准备交付物与质量报告";
  if (item.status === "pending_acceptance") return mine ? "核验交付并确认验收" : "等待提报人验收";
  if (item.status === "deferred") return "等待恢复评审";
  return item.status === "completed" ? "已完成验收并归档" : "需求已关闭";
}

export function formatDate(value: string | null) {
  if (!value) return "未设置";
  return new Date(`${value}T00:00:00`).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
