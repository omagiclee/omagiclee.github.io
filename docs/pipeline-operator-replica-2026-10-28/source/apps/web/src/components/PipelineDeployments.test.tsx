import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { PipelineDeployments } from "./PipelineDeployments";
import type { PipelineDeployment } from "../deployments-api";

vi.mock("../auth-context", () => ({ useProjectAuth: () => ({ me: { csrf_token: "deployment-csrf" }, can: () => true }) }));
let rows: PipelineDeployment[], requests: { body: unknown; csrf: string | null; project: string | null }[];
beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", "http://api.test"); rows = []; requests = [];
  server.use(
    http.get("http://api.test/api/pipeline-deployments", ({ request }) => {
      expect(new URL(request.url).searchParams.get("pipeline_id")).toBe("pipeline-1");
      expect(new URL(request.url).searchParams.get("project_id")).toBe("demo");
      return HttpResponse.json(rows);
    }),
    http.get("http://api.test/api/projects/demo/environments", () => HttpResponse.json([])),
    http.post("http://api.test/api/pipeline-deployments", async ({ request }) => {
      const body = await request.json(); requests.push({ body, csrf: request.headers.get("X-CSRF-Token"), project: new URL(request.url).searchParams.get("project_id") });
      rows.push({ id: "deployment-1", name: "Daily", revision: 1, pipeline_id: "pipeline-1", pipeline_version: 2,
        trigger_kind: "interval", interval_seconds: 3600, timezone: "Asia/Shanghai", next_trigger_at: "2026-10-01T01:00:00Z",
        paused: false, use_cache: true, last_error: null, webhook_enabled: false, execution_snapshot: { profile: "local" } });
      return HttpResponse.json(rows[0], { status: 201 });
    }),
    http.post("http://api.test/api/pipeline-deployments/deployment-1/state", async ({ request }) => {
      const body = await request.json() as { paused: boolean }; rows[0] = { ...rows[0], paused: body.paused };
      return HttpResponse.json(rows[0]);
    }),
    http.post("http://api.test/api/pipeline-deployments/deployment-1/trigger", async ({ request }) => {
      requests.push({ body: await request.json(), csrf: request.headers.get("X-CSRF-Token"), project: new URL(request.url).searchParams.get("project_id") });
      return HttpResponse.json({ run_id: "run-1" }, { status: 202 });
    }),
  );
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

function mount() {
  const onRun = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><PipelineDeployments projectId="demo" pipeline={{ id: "pipeline-1", name: "Test", description: "", version: 2,
    graph: { nodes: [] }, created_at: "", updated_at: "", versions: [{ version: 2, name: "Test", created_at: "" }] }} onRunCreated={onRun} /></QueryClientProvider>);
  const details = screen.getByText("生产部署与触发").closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  return onRun;
}

it("creates an immutable interval deployment with project and CSRF, pauses it, then triggers one run", async () => {
  const onRun = mount(); await screen.findByText("当前流程尚无生产部署。");
  fireEvent.change(screen.getByLabelText("部署名称"), { target: { value: "Daily" } });
  fireEvent.change(screen.getByLabelText("部署触发方式"), { target: { value: "interval" } });
  fireEvent.click(screen.getByRole("button", { name: "保存不可变部署" }));
  await screen.findByText("Daily · r1");
  expect(requests[0]).toMatchObject({ csrf: "deployment-csrf", project: "demo", body: {
    name: "Daily", pipeline_id: "pipeline-1", pipeline_version: 2, trigger_kind: "interval", interval_seconds: 3600, timezone: "Asia/Shanghai",
  } });
  fireEvent.click(screen.getByRole("button", { name: "暂停" }));
  await screen.findByRole("button", { name: "启用" });
  expect(screen.getByRole("button", { name: "手动触发" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "启用" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "手动触发" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "手动触发" }));
  await waitFor(() => expect(onRun).toHaveBeenCalledWith("run-1"));
  expect(requests[1]).toMatchObject({ csrf: "deployment-csrf", project: "demo" });
  expect((requests[1].body as { event_key: string }).event_key).toMatch(/^[a-f0-9-]{36}$/);
});

it("blocks malformed node overrides before saving", async () => {
  mount(); await screen.findByText("当前流程尚无生产部署。");
  fireEvent.change(screen.getByLabelText("部署名称"), { target: { value: "Invalid" } });
  fireEvent.change(screen.getByLabelText("部署节点配置"), { target: { value: "[]" } });
  expect(screen.getByRole("button", { name: "保存不可变部署" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("配置需为节点 ID 到配置对象的 JSON。");
  expect(screen.getByLabelText("部署节点配置")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("部署节点配置")).toHaveAccessibleDescription("配置需为节点 ID 到配置对象的 JSON。");
  expect(requests).toHaveLength(0);
});
