import { useQuery } from "@tanstack/react-query";
import { platformRequest } from "../data-platform-api";
import { Button } from "./ui/button";

export interface DatasetQualityReport {
  passed: boolean; sampleCount: number; issueCount: number; issuesComplete?: boolean;
  issues: { rule?: string; message?: string; sampleIds?: string[] }[]; checkedAt?: string;
}
export function DatasetQualityPanel({ projectId, datasetId, revision }: { projectId: string; datasetId: string; revision: number }) {
  const quality = useQuery({ queryKey: ["data-platform", projectId, "quality", datasetId, revision], queryFn: () => platformRequest<DatasetQualityReport>(projectId, `/datasets/${encodeURIComponent(datasetId)}/quality`), staleTime: 10_000, retry: false });
  return <section aria-label="工作副本质量报告"><div className="platform-section-heading"><h3>当前工作副本检查</h3><Button size="sm" variant="outline" disabled={quality.isFetching} onClick={() => void quality.refetch()}>重新检查质量</Button></div>
    {quality.isPending && <p role="status">正在检查整个工作副本…</p>}
    {quality.error && <p role="alert">{quality.error.message}</p>}
    {quality.data && <><p role="status">{quality.data.passed ? "质量检查通过" : "质量检查待处理"} · {quality.data.sampleCount} 个样本 · {quality.data.issueCount} 个问题</p>
      <ul>{quality.data.issues.map((issue, index) => <li key={index}>{issue.message ?? issue.rule}{issue.sampleIds?.length ? ` · ${issue.sampleIds.join("、")}` : ""}</li>)}</ul>
      {quality.data.issuesComplete === false && <p className="platform-help">这里只展示部分问题；所有样本均参与门禁。</p>}
      <p className="platform-help">此报告对应当前工作副本。发布时会重新检查并冻结质量报告。</p></>}
  </section>;
}
