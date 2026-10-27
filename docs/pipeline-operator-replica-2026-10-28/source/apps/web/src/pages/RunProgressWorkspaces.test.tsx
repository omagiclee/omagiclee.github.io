import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineRun } from "../pipelines-api";
import { server } from "../test/server";
import MediaPage from "./MediaPage";
import { RunDetail } from "./PipelinesPage";
import { loadMediaRun } from "../media-api";

vi.mock("../auth-context", () => { const auth = () => ({
  me: { user: { id: "progress-test-user" }, scope: { type: "project", id: "progress-project" }, csrf_token: "progress-csrf" },
  can: () => true,
}); return { useAuth: auth, useProjectAuth: auth }; });
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ runId: "ui-progress-run" }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

const fixture = (): PipelineRun => ({
  id: "ui-progress-run", pipeline_id: "ui-progress-pipeline", pipeline_name: "界面进度测试", pipeline_version: 1,
  status: "running", created_at: "2026-09-10T01:00:00Z", finished_at: null, error: null, artifacts: [],
  tasks: [
    { id: "ui-person-task", node_id: "person_segment", operator: "media.person_segment@1", status: "running", input_count: 282, output_count: 0, duration_ms: 0, error: null, artifact_id: null,
      progress: { completed: 254, total: 282, unit: "frames", last_progress_at: "2026-09-10T01:04:00Z", source: "artifact_files" } },
    { id: "ui-embedding-task", node_id: "siglip2_embed", operator: "media.siglip2_embed@1", status: "pending", input_count: 0, output_count: 0, duration_ms: 0, error: null, artifact_id: null },
  ],
});

describe("run task progress API/UI contract (MSW only; no real runs)", () => {
  let run: PipelineRun;
  const scopes: (string | null)[] = [];
  beforeEach(() => {
    run = fixture(); scopes.length = 0;
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    const recordScope = (request: Request) => scopes.push(new URL(request.url).searchParams.get("project_id"));
    server.use(
      ...["operators", "operator-plugins", "pipelines"].map((path) => http.get(`http://api.test/api/${path}`, ({ request }) => { recordScope(request); return HttpResponse.json([]); })),
      http.get("http://api.test/api/pipeline-runs", ({ request }) => { recordScope(request); return HttpResponse.json([run]); }),
      http.get("http://api.test/api/pipeline-runs/ui-progress-run", ({ request }) => { recordScope(request); return HttpResponse.json(run); }),
      http.get("http://api.test/api/media/status", ({ request }) => {
        recordScope(request);
        return HttpResponse.json({ models: [], issues: [], counts: { videos: 2, shots: 94, keyframes: 282, indexed_shots: 0 }, executor: { kind: "dagster", concurrency: 1, active_run_id: run.id } });
      }),
      http.get("http://api.test/api/media/videos", ({ request }) => { recordScope(request); return HttpResponse.json([]); }),
      http.post("http://api.test/api/media/search", ({ request }) => { recordScope(request); return HttpResponse.json({ mode: "filter", items: [], total: 0 }); }),
    );
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  function RunDetailFromApi() {
    const result = useQuery({ queryKey: ["media-run", "progress-project", run.id], queryFn: () => loadMediaRun("progress-project", run.id) });
    return result.data ? <RunDetail run={result.data} projectId="progress-project" /> : null;
  }

  function mount(page: "pipelines" | "media") {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}>{page === "pipelines" ? <RunDetailFromApi /> : <MediaPage />}</QueryClientProvider>);
    return { client, refresh: () => act(async () => { await client.invalidateQueries({ queryKey: ["media-run", "progress-project", run.id] }); }) };
  }

  it.each(["pipelines", "media"] as const)("shows and refreshes real task counts in %s, separately from committed output", async (page) => {
    const { client, refresh } = mount(page);
    await screen.findByText("254 / 282 帧");
    expect(screen.getByRole("progressbar", { name: "person_segment 处理进度" })).toHaveAttribute("aria-valuenow", "254");
    expect(screen.getByRole("progressbar", { name: "person_segment 处理进度" })).toHaveAttribute("aria-valuemax", "282");
    expect(screen.getByText("输入 282 条 · 输出待完成")).toBeInTheDocument();
    expect(screen.queryByText("282 → 0 条")).not.toBeInTheDocument();
    if (page === "pipelines") expect(screen.getByText(/数量不代表人物数/)).toBeInTheDocument();
    expect(document.querySelector('time[datetime="2026-09-10T01:04:00Z"]')).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "siglip2_embed 处理进度" })).not.toBeInTheDocument();

    run.tasks[0].progress = { ...run.tasks[0].progress!, completed: 280, last_progress_at: "2026-09-10T01:05:00Z" };
    await refresh();
    await screen.findByText("280 / 282 帧");
    expect(document.querySelector('time[datetime="2026-09-10T01:05:00Z"]')).toBeInTheDocument();
    expect(screen.getByText("输入 282 条 · 输出待完成")).toBeInTheDocument();

    run.tasks[0] = { ...run.tasks[0], status: "succeeded", output_count: 282, progress: { ...run.tasks[0].progress!, completed: 282 } };
    await refresh();
    if (page === "pipelines") {
      await screen.findByText("282 → 282 条");
      expect(screen.queryByText("282 / 282 帧")).not.toBeInTheDocument();
    } else {
      expect(screen.queryByText("282 → 282 条")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "查看运行" })).toBeInTheDocument();
    }
    expect(screen.queryByText(/预计|ETA/)).not.toBeInTheDocument();
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.every((project) => project === "progress-project")).toBe(true);
    client.clear();
  });

  it.each(["pipelines", "media"] as const)("keeps legacy tasks without progress readable in %s", async (page) => {
    delete run.tasks[0].progress;
    const { client } = mount(page);
    await screen.findByText("输入 282 条 · 输出待完成");
    expect(screen.queryByRole("progressbar", { name: "person_segment 处理进度" })).not.toBeInTheDocument();
    expect(screen.queryByText(/最近产物：|0 \/ 0 帧/)).not.toBeInTheDocument();
    client.clear();
  });

  it("shows a first-artifact waiting state when the progress timestamp is absent", async () => {
    run.tasks[0].progress = { ...run.tasks[0].progress!, completed: 0, last_progress_at: null };
    const { client } = mount("media");
    await screen.findByText("等待首个产物");
    expect(screen.getByText("0 / 282 帧")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    client.clear();
  });
});
