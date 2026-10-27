import type { InsightPeople } from "../../insights-api";
import { ToolbarSelect } from "../ui/period-menu";

export const pageLabels: Record<string, string> = {
  dashboard: "概览", requirements: "需求管理", requirement_detail: "需求详情",
  datasets: "数据集", dataset_detail: "数据集详情", media: "数据探索",
  pipelines: "数据流水线", operators: "算子与插件",
  annotation_tasks: "标注任务", annotation_task_detail: "标注任务详情",
  annotation_specs: "标注规范", annotation_spec_detail: "标注规范详情",
  evaluations: "评测实验", evaluation_detail: "评测实验详情",
  benchmarks: "评测基准", benchmark_detail: "评测基准详情",
  feedback: "问题反馈", feedback_detail: "问题反馈详情",
  project_runs: "运行中心", project_run_detail: "运行详情", project_connections: "连接管理",
  admin_users: "用户与角色", admin_access: "权限管理", admin_environments: "执行环境",
  usage: "使用分析", audit: "操作审计", data_operations: "数据运营明细", events: "数据事件",
  notifications: "通知中心", access: "我的权限",
};
export function PersonField({ label, value, onChange, people, loading, error }: { label: string; value?: string; onChange: (value: string | undefined) => void; people?: InsightPeople; loading?: boolean; error?: boolean }) {
  const options = [{ value: "", label: loading ? "正在读取人员…" : error ? "人员列表暂不可用" : "全部人员" },
    ...(value && !people?.people.some((person) => person.id === value) ? [{ value, label: `用户 ${value}` }] : []),
    ...(people?.people.map((person) => ({ value: person.id, label: `${person.name || person.username}${person.username && person.username !== person.name ? `（${person.username}）` : ""}` })) ?? [])];
  return <ToolbarSelect value={value ?? ""} onChange={(next) => onChange(next || undefined)} options={options} label={label} prefix={label} disabled={loading} />;
}
export function PageField({ label = "页面", value, onChange }: { label?: string; value?: string; onChange: (value: string | undefined) => void }) {
  const options = [{ value: "", label: "全部页面" }, ...(value && !pageLabels[value] ? [{ value, label: value }] : []), ...Object.entries(pageLabels).map(([id, name]) => ({ value: id, label: name }))];
  return <ToolbarSelect value={value ?? ""} onChange={(next) => onChange(next || undefined)} options={options} label={label} prefix={label} />;
}
