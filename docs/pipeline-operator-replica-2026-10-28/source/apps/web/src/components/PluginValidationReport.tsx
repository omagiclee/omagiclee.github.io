import { CheckCircle2, CircleAlert, CircleHelp } from "lucide-react";
import type { PluginRelease, PluginValidation } from "../plugin-releases-api";

type Check = { name: string; passed?: boolean; operator_id?: string; message?: string; output?: unknown; output_count?: number };

export function PluginValidationReport({ report, testCases }: { report: NonNullable<PluginValidation["report"]>; testCases: PluginRelease["test_cases"] }) {
  const checks: Check[] = Array.isArray(report.checks) ? report.checks.flatMap((value: unknown) => {
    if (!value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string") return [];
    const item = value as Record<string, unknown>;
    return [{ name: value.name, passed: typeof item.passed === "boolean" ? item.passed : undefined,
      operator_id: typeof item.operator_id === "string" ? item.operator_id : undefined,
      message: typeof item.message === "string" ? item.message : undefined, output: item.output,
      output_count: typeof item.output_count === "number" && Number.isFinite(item.output_count) ? item.output_count : undefined }];
  }) : [];
  const passed = checks.filter((check) => check.passed === true).length;
  const failed = checks.filter((check) => check.passed === false).length;
  const unknown = checks.length - passed - failed;
  return <div className="plugin-validation-report">
    {checks.length ? <>
      <div className="plugin-check-summary" role="group" aria-label="验证结果统计"><strong>{checks.length} 项检查</strong><span className="plugin-check-pass">{passed} 项通过</span><span className={failed ? "plugin-check-fail" : ""}>{failed} 项失败</span>{unknown > 0 && <span>{unknown} 项结果未提供</span>}</div>
      <ol className="plugin-check-list" aria-label="逐项验证结果">{checks.map((check, index) => {
        const sample = testCases.find((item) => item.name === check.name && item.operator_id === check.operator_id);
        const label = check.passed === true ? "通过" : check.passed === false ? "失败" : "结果未提供";
        const Icon = check.passed === true ? CheckCircle2 : check.passed === false ? CircleAlert : CircleHelp;
        return <li key={`${check.operator_id ?? "contract"}:${check.name}:${index}`} className={check.passed === false ? "is-failed" : ""}>
          <div className="plugin-check-heading"><Icon aria-hidden="true" /><strong>{check.name === "wheel_contract" ? "插件契约检查" : check.name === "container_execution" ? "容器执行检查" : check.name}</strong><span>{label}</span></div>
          {check.operator_id && <small>{check.operator_id}</small>}
          {check.message && <p>{check.message === "Output matches the expected artifact" ? "实际产物与预期一致。" : check.message === "Output does not match expected result" ? "实际产物与预期不一致，请检查下方用例数据。" : check.message}</p>}
          {typeof check.output_count === "number" && <small>输出 {check.output_count} 条记录</small>}
          {check.passed === false && (sample || check.output !== undefined) && <details><summary>查看预期与实际结果</summary><div className="plugin-check-comparison"><div><h4>预期结果</h4><pre tabIndex={0}>{sample ? JSON.stringify(sample.expected ?? sample.expected_error, null, 2) : "报告没有匹配的测试样例。"}</pre></div><div><h4>实际结果</h4><pre tabIndex={0}>{check.output !== undefined ? JSON.stringify(check.output, null, 2) : check.message ?? "报告未提供实际产物。"}</pre></div></div></details>}
        </li>;
      })}</ol>
    </> : <p className="plugin-muted">此报告未提供逐项结果，可展开原始报告查看。</p>}
    <details className="plugin-report-raw"><summary>原始验证报告 · JSON</summary><pre tabIndex={0}>{JSON.stringify(Object.fromEntries(Object.entries(report).filter(([key]) => key !== "logs")), null, 2)}</pre></details>
    {report.logs !== undefined && <details><summary>验证日志</summary><pre tabIndex={0}>{typeof report.logs === "string" ? report.logs : JSON.stringify(report.logs, null, 2)}</pre></details>}
  </div>;
}
