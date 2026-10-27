const labels: Record<string, string> = {
  "auth.login": "登录平台", "auth.logout": "退出登录",
  "impersonation.started": "开始代登录", "impersonation.stopped": "结束代登录",
  "impersonation.expired": "代登录到期", "impersonation.revoked": "代登录授权失效",
  "events.created": "录入数据事件", "events.exported": "导出数据事件",
  "users.role_bindings.updated": "修改用户角色与权限",
  "pipelines.created": "创建流水线", "pipelines.version_created": "保存流水线版本",
  "operators.registered": "注册算子",
  "framework.run_started": "提交处理任务", "framework.submission_retried": "重试提交处理任务",
  "media.run_cancelled": "取消处理任务", "media.search.succeeded": "检索镜头", "media.search.failed": "检索镜头失败",
  "access.policy.updated": "修改权限策略", "access.group.created": "创建用户组",
  "access.group.members.updated": "修改用户组成员", "access.request.created": "提交权限申请",
  "access.request.approve": "批准权限申请", "access.request.approved": "批准权限申请",
  "access.request.reject": "驳回权限申请", "access.request.rejected": "驳回权限申请",
};
const requirementActions: Record<string, string> = {
  created: "创建需求", create: "创建需求", draft: "保存需求草稿", edit: "编辑需求", edited: "编辑需求",
  comment: "发表需求讨论", submit: "提交需求评审", approve: "通过需求评审",
  request_changes: "要求补充需求", defer: "暂缓需求", reject: "拒绝需求", cancel: "撤回需求",
  schedule: "安排需求排期", deliver: "提交需求交付", accept: "确认需求验收",
  reject_acceptance: "退回需求验收", resume: "恢复需求处理",
};

export function actionLabel(action?: string | null) {
  if (!action) return "操作记录";
  if (action.startsWith("requirement.")) return requirementActions[action.slice("requirement.".length)] ?? action;
  return labels[action] ?? action;
}
