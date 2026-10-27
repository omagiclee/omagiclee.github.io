import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useProjectAuth } from "../auth-context";
import { ToolbarSelect } from "../components/ui/period-menu";
import { Button } from "../components/ui/button";
import { loadProjectRun, projectRunsQueryFor, type PipelinePage, type PipelineRun } from "../pipelines-api";
import { dateLabel, durationLabel, RunDetail, RunStatus, statusLabels } from "./PipelinesPage";
import "./pipelines.css";
import "./console-management.css";

const runStatuses = ["pending", "queued", "running", "succeeded", "failed", "interrupted", "cancelling", "cancelled"] as const;
const activeRunStatuses = new Set(["pending", "queued", "running", "cancelling"]);

function durationBetween(startedAt: string, finishedAt: string | null, active: boolean) {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : active ? Date.now() : NaN;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? durationLabel(end - start) : "—";
}

export function ProjectRunsPage() {
  const { projectId } = useParams({ from: "/projects/$projectId/runs" });
  const search = useSearch({ from: "/projects/$projectId/runs" });
  const navigate = useNavigate();
  const { can } = useProjectAuth(projectId);
  const page = Math.max(1, search.page ?? 1);
  const runs = useQuery({
    ...projectRunsQueryFor(projectId, { page, status: search.status, pipelineId: search.pipelineId }),
    refetchInterval: (query) => query.state.data?.items.some((run) => activeRunStatuses.has(run.display_status ?? run.status)) ? 2_000 : false,
  });

  if (!can("pipelines:read")) {
    return <main className="md-page"><section className="pipe-empty"><CircleAlert /><h1>需要运行查看权限</h1><p>请联系项目管理员授予当前项目的流水线读取权限。</p></section></main>;
  }

  return <main className="md-page console-management" aria-labelledby="runs-title">
    <div className="pipe-page-heading">
      <div>
        <p>{projectId} 项目</p>
        <h1 id="runs-title" className="md-page-title">运行中心</h1>
        <p>查看全项目运行、失败原因、排队状态和执行产物。</p>
      </div>
      <Button variant="outline" onClick={() => void runs.refetch()} disabled={runs.isFetching}>
        {runs.isFetching ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}刷新
      </Button>
    </div>

    <div className="pipe-list-toolbar">
      <label className="pipe-search">
        <input
          aria-label="按流水线 ID 筛选"
          placeholder="流水线 ID"
          defaultValue={search.pipelineId ?? ""}
          onBlur={(event) => void navigate({ to: "/projects/$projectId/runs", params: { projectId }, search: { ...search, pipelineId: event.target.value.trim() || undefined, page: undefined } })}
        />
      </label>
      <ToolbarSelect label="筛选运行状态" prefix="运行状态" value={search.status ?? ""} onChange={(status) => void navigate({ to: "/projects/$projectId/runs", params: { projectId }, search: { ...search, status: (status || undefined) as typeof search.status, page: undefined } })} options={[{value:"",label:"全部状态"},...runStatuses.map(value=>({value,label:statusLabels[value]}))]} />
    </div>

    {runs.isPending && <p className="pipe-loading" role="status"><LoaderCircle className="animate-spin" />正在读取运行…</p>}
    {runs.error && <div className="pipe-notice pipe-error" role="alert"><CircleAlert />{runs.error.message}</div>}
    {runs.data && (runs.data.items.length ? <div className="pipe-directory">
      <table>
        <thead><tr><th>运行</th><th>流水线</th><th>状态</th><th>提交时间</th><th>耗时</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>
          {runs.data.items.map((run) => {
            const displayStatus = run.cancellation_pending ? "cancelling" : run.display_status ?? run.status;
            return <tr key={run.id}>
            <td data-label="运行"><code title={run.id}>{run.id.slice(0, 12)}</code></td>
            <td data-label="流水线"><Link to="/projects/$projectId/pipelines" params={{ projectId }} search={{ pipelineId: run.pipeline_id, view: "builder" }}>{run.pipeline_name}</Link><p>v{run.pipeline_version}</p></td>
            <td data-label="状态"><RunStatus status={displayStatus} />{(run.waiting_reason || run.error) && <p>{run.waiting_reason ?? run.error}</p>}</td>
            <td data-label="提交时间">{dateLabel(run.created_at)}</td>
            <td data-label="耗时">{durationBetween(run.created_at, run.finished_at, activeRunStatuses.has(displayStatus))}</td>
            <td data-label="操作">
              <Link
                to="/projects/$projectId/runs/$runId"
                params={{ projectId, runId: run.id }}
                search={{ pipelineId: search.pipelineId, status: search.status, page: search.page }}
                aria-label={`打开运行 ${run.id}`}
                data-track-id="runs.open"
                data-track-label="打开运行详情"
              >详情<ChevronRight /></Link>
            </td>
          </tr>;})}
        </tbody>
      </table>
    </div> : <div className="pipe-empty"><h2>{search.pipelineId || search.status ? "没有符合条件的运行" : "还没有运行记录"}</h2><p>{search.pipelineId || search.status ? "调整流水线或状态筛选。" : "从流程详情提交试运行或生产触发后，运行会集中显示在这里。"}</p></div>)}

    {runs.data && <RunPagination
      page={page}
      data={runs.data}
      busy={runs.isFetching}
      onPage={(next) => void navigate({ to: "/projects/$projectId/runs", params: { projectId }, search: { ...search, page: next === 1 ? undefined : next } })}
    />}
  </main>;
}

function RunPagination({ page, data, busy, onPage }: { page: number; data: PipelinePage<PipelineRun>; busy: boolean; onPage: (page: number) => void }) {
  if (data.total <= data.limit && page === 1) return null;
  const totalPages = Math.max(page, Math.ceil(data.total / data.limit));
  return <nav className="pipe-pagination" aria-label="运行分页">
    <Button variant="outline" size="sm" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>上一页</Button>
    <span>第 {page} / {totalPages} 页 · {data.total} 条</span>
    <Button variant="outline" size="sm" disabled={!data.has_more || busy} onClick={() => onPage(page + 1)}>下一页</Button>
  </nav>;
}

export function ProjectRunDetailPage() {
  const { projectId, runId } = useParams({ from: "/projects/$projectId/runs/$runId" });
  const search = useSearch({ from: "/projects/$projectId/runs/$runId" });
  const client = useQueryClient();
  const run = useQuery({
    queryKey: ["project-run", projectId, runId],
    queryFn: () => loadProjectRun(projectId, runId),
    refetchInterval: (query) => activeRunStatuses.has(query.state.data?.status ?? "pending") ? 2_000 : false,
  });

  return <main className="md-page" aria-labelledby="run-detail-title">
    <div className="pipe-page-heading">
      <div>
        <p>{projectId} 项目 · 运行中心</p>
        <h1 id="run-detail-title" className="md-page-title">运行详情</h1>
      </div>
      <Link to="/projects/$projectId/runs" params={{ projectId }} search={{ pipelineId: search.pipelineId, status: search.status, page: search.page }} className="pipe-back-link">
        <ArrowLeft />返回运行中心
      </Link>
    </div>
    {run.isPending && <p className="pipe-loading" role="status"><LoaderCircle className="animate-spin" />正在读取运行详情…</p>}
    {run.error && <div className="pipe-notice pipe-error" role="alert"><CircleAlert />{run.error.message}</div>}
    {run.data && <RunDetail
      run={run.data}
      projectId={projectId}
      onRunUpdate={(updated) => {
        client.setQueryData(["project-run", projectId, updated.id], updated);
        void client.invalidateQueries({ queryKey: ["project-runs", projectId] });
      }}
    />}
  </main>;
}
