import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineRun } from "../pipelines-api";
import { server } from "../test/server";
import { RunDetail } from "./PipelinesPage";

const access = vi.hoisted(() => ({ permissions: ["pipelines:run"] }));
vi.mock("../auth-context", () => { const auth = () => ({
  me: { user: { id: "ui-test-user" }, scope: { type: "project", id: "retry-project" }, csrf_token: "retry-csrf" },
  can: (key: string) => access.permissions.includes(key),
}); return { useAuth: auth, useProjectAuth: auth }; });

const pendingRun: PipelineRun = {
  id: "existing-run", pipeline_id: "existing-pipeline", pipeline_name: "待恢复的视频流程", pipeline_version: 2,
  status: "pending", created_at: "2026-09-10T01:00:00Z", finished_at: null,
  error: "Dagster 提交未确认", tasks: [], artifacts: [],
};
function mount(initialRun = pendingRun) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["pipeline-runs", "retry-project"], [initialRun]);
  function SelectedRun() {
    const [run, setRun] = useState(initialRun);
    return <RunDetail run={run} projectId="retry-project" onRunUpdate={setRun} />;
  }
  render(<QueryClientProvider client={client}><SelectedRun /></QueryClientProvider>);
  return client;
}

describe("submission retry UI/API contract (no Dagster execution)", () => {
  beforeEach(() => {
    access.permissions = ["pipelines:run"];
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  it("retries the existing run once and refreshes its selected view and list", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let submissions = 0;
    let reads = 0;
    const running = { ...pendingRun, status: "running", error: null };
    server.use(
      http.post("http://api.test/api/media/runs/existing-run/retry-submission", async ({ request }) => {
        submissions++;
        expect(new URL(request.url).searchParams.get("project_id")).toBe("retry-project");
        expect(request.headers.get("x-csrf-token")).toBe("retry-csrf");
        expect(await request.json()).toEqual({ use_cache: true });
        await gate;
        return HttpResponse.json(running, { status: 202 });
      }),
      http.get("http://api.test/api/pipeline-runs/existing-run", ({ request }) => {
        reads++;
        expect(new URL(request.url).searchParams.get("project_id")).toBe("retry-project");
        return HttpResponse.json(running);
      }),
    );
    const client = mount();
    const button = screen.getByRole("button", { name: "重试提交" });
    expect(button).toHaveAttribute("data-track-id", "pipelines.retry_submission");
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(submissions).toBe(1));
    expect(button).toBeDisabled();
    release();
    await screen.findByText("运行中");
    await waitFor(() => expect(reads).toBe(1));
    expect(screen.queryByRole("button", { name: "重试提交" })).not.toBeInTheDocument();
    expect(client.getQueryData(["pipeline-runs", "retry-project"])).toEqual([running]);
    expect(client.getQueryData(["media-run", "retry-project", "existing-run"])).toEqual(running);
    expect(submissions).toBe(1);
    client.clear();
  });

  it("refreshes status after an uncertain failed request without creating another run", async () => {
    let submissions = 0;
    let reads = 0;
    const running = { ...pendingRun, status: "running", error: null };
    server.use(
      http.post("http://api.test/api/media/runs/existing-run/retry-submission", () => {
        submissions++;
        return HttpResponse.json({ detail: { message: "提交响应超时", run_id: pendingRun.id } }, { status: 503 });
      }),
      http.get("http://api.test/api/pipeline-runs/existing-run", () => { reads++; return HttpResponse.json(running); }),
    );
    const client = mount();
    fireEvent.click(screen.getByRole("button", { name: "重试提交" }));
    await screen.findByText("运行中");
    await screen.findByText("提交响应超时");
    expect(submissions).toBe(1);
    expect(reads).toBe(1);
    expect(client.getQueryData(["pipeline-runs", "retry-project"])).toEqual([running]);
    client.clear();
  });

  it("only offers retry for pending errors with run permission", () => {
    access.permissions = [];
    const client = mount();
    expect(screen.queryByRole("button", { name: "重试提交" })).not.toBeInTheDocument();
    cleanup(); client.clear();
    access.permissions = ["pipelines:run"];
    const clean = mount({ ...pendingRun, error: null });
    expect(screen.queryByRole("button", { name: "重试提交" })).not.toBeInTheDocument();
    cleanup(); clean.clear();
    const failed = mount({ ...pendingRun, status: "failed" });
    expect(screen.queryByRole("button", { name: "重试提交" })).not.toBeInTheDocument();
    failed.clear();
  });

  it("lets a user inspect a running or failed node before it has an artifact", () => {
    const client = mount({ ...pendingRun, status: "running", error: null, tasks: [
      { id: "task-running", node_id: "segment", operator: "media.segment", status: "running", artifact_id: null, input_count: 12, output_count: 0, duration_ms: 1200, error: null, progress: {completed:3,total:12,unit:"frame",source:"artifact_files",last_progress_at:null} },
      { id: "task-failed", node_id: "embedding", operator: "media.embedding", status: "failed", artifact_id: null, input_count: 12, output_count: 0, duration_ms: 1200, error: "模型服务不可用" },
    ] });
    const running = screen.getByRole("button", { name: "检查节点 segment" });
    expect(running).toBeEnabled();
    expect(running).toHaveAttribute("aria-pressed", "false");
    expect(running).not.toHaveAttribute("aria-expanded");
    expect(screen.getByRole("progressbar", { name: "segment 处理进度" })).toBeVisible();
    const target = running.getAttribute("aria-controls")!;
    expect(document.getElementById(target)).toBeInTheDocument();
    fireEvent.click(running);
    expect(running).toHaveAttribute("aria-pressed", "true");
    expect(document.getElementById(target)).toHaveTextContent("节点检查 · segment");
    expect(screen.getByRole("region", { name: "segment 节点检查" })).toHaveTextContent("这里会持续更新执行状态与处理进度");
    fireEvent.click(screen.getByRole("button", { name: "检查节点 embedding" }));
    expect(screen.getByRole("region", { name: "embedding 节点检查" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("region", { name: "embedding 节点检查" })).toHaveTextContent("请根据上方错误检查算子配置与执行环境");
    expect(screen.queryByRole("region", { name: "segment 节点检查" })).not.toBeInTheDocument();
    client.clear();
  });

  it("downloads the complete authorized export instead of the bounded artifact preview", async () => {
    server.use(http.get("http://api.test/api/pipeline-artifacts/large-artifact", ({ request }) => {
      expect(new URL(request.url).searchParams.get("project_id")).toBe("retry-project");
      return HttpResponse.json({ id: "large-artifact", run_id: pendingRun.id, node_id: "source", type: "video_assets",
        record_count: 5000, has_more: true, content_hash: "a".repeat(64), metadata: {}, parent_artifact_ids: [],
        cache_origin_id: null, records: Array.from({ length: 100 }, (_, index) => ({ id: `preview-${index}` })), created_at: "" });
    }));
    const client = mount({ ...pendingRun, status: "succeeded", error: null, tasks: [
      { id: "source-task", node_id: "source", operator: "media.source", status: "succeeded", artifact_id: "large-artifact",
        input_count: 0, output_count: 5000, duration_ms: 1000, error: null },
    ] });
    fireEvent.click(screen.getByRole("button", { name: "检查节点 source" }));
    const download = await screen.findByRole("link", { name: "下载产物" });
    expect(download).toHaveAttribute("href", "http://api.test/api/pipeline-artifacts/large-artifact/export?project_id=retry-project");
    expect(download).toHaveAttribute("download");
    expect(screen.getByText("视频资产 · 5000 条记录")).toBeVisible();
    client.clear();
  });

  it("reconciles an unknown submission without calling retry or launching another run", async () => {
    access.permissions = ["pipelines:read"];
    let reconciliations = 0;
    const running = { ...pendingRun, status: "running", error: null, can_reconcile_submission: false, can_retry_submission: false };
    server.use(
      http.post("http://api.test/api/media/runs/existing-run/reconcile", ({ request }) => {
        expect(new URL(request.url).searchParams.get("project_id")).toBe("retry-project");
        expect(request.headers.get("x-csrf-token")).toBe("retry-csrf");
        reconciliations++; return HttpResponse.json(running);
      }),
      http.get("http://api.test/api/pipeline-runs/existing-run", () => HttpResponse.json(running)),
    );
    const client = mount({ ...pendingRun, submission_status: "SUBMISSION_UNKNOWN", can_retry_submission: false, can_reconcile_submission: true });
    expect(screen.queryByRole("button", { name: "重试提交" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "对账提交状态" }));
    await screen.findByText("运行中");
    expect(reconciliations).toBe(1); client.clear();
  });

  it("shows cancellation as in progress until the execution engine confirms termination", async () => {
    access.permissions = ["pipelines:read", "pipelines:cancel"];
    const cancelling = { ...pendingRun, status: "cancelled", cancellation_pending: true, can_reconcile_submission: true };
    const cancelled = { ...cancelling, cancellation_pending: false, can_reconcile_submission: false, error: null };
    server.use(
      http.post("http://api.test/api/media/runs/existing-run/cancel", () => HttpResponse.json(cancelling)),
      http.post("http://api.test/api/media/runs/existing-run/reconcile", () => HttpResponse.json(cancelled)),
      http.get("http://api.test/api/pipeline-runs/existing-run", () => HttpResponse.json(cancelled)),
    );
    const client = mount(); fireEvent.click(screen.getByRole("button", { name: "取消运行" }));
    await screen.findByText("取消中");
    await screen.findByText(/正在等待执行引擎确认终止/);
    fireEvent.click(screen.getByRole("button", { name: "对账提交状态" }));
    await screen.findByText("已取消");
    expect(screen.queryByText(/正在等待执行引擎确认终止/)).not.toBeInTheDocument(); client.clear();
  });
});
