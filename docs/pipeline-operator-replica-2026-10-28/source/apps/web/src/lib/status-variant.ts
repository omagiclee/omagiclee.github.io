export type StatusVariant = "success" | "destructive" | "warning" | "info" | "outline";

/** Shared severity roles; display labels remain specific to each workflow. */
export function statusVariant(status: string): StatusVariant {
  if (["succeeded", "success", "completed", "cached", "published", "validated", "passed", "ready", "configuration_valid", "reachable", "已完成", "已通过", "已发布", "已验证"].includes(status)) return "success";
  if (["failed", "failure", "error", "denied", "validation_failed", "configuration_invalid", "unreachable", "失败", "执行失败", "训练失败", "错误"].includes(status)) return "destructive";
  if (["interrupted", "blocked", "not_ready", "paused", "overdue", "需修订", "未通过", "逾期", "阻塞", "已暂停"].includes(status)) return "warning";
  if (["pending", "queued", "running", "validating", "pausing", "cancelling", "pending_review", "pending_acceptance", "标注中", "处理中", "执行中", "训练中", "排队中", "暂停中", "取消中"].includes(status)) return "info";
  return "outline";
}
