import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import ConnectionsPage from "./ConnectionsPage";

vi.mock("../auth-context", () => ({
  useProjectAuth: () => ({ me: { user: { id: "connection-user" }, csrf_token: "connection-csrf" }, can: () => true }),
}));

const connection = {
  id: "connection-1",
  project_id: "linked",
  name: "Milvus 生产",
  connection_type: "vector_database",
  endpoint: "https://milvus.internal:19530",
  credential_configured: true,
  allowed_environment_ids: ["environment-1"],
  status: "configured",
  last_check: null,
  created_at: "2026-09-16T01:00:00Z",
  updated_at: "2026-09-16T01:00:00Z",
};

describe("project connections", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(
      http.get("http://api.test/api/projects/:projectId/connections", () => HttpResponse.json([connection])),
      http.get("http://api.test/api/projects/:projectId/environments", () => HttpResponse.json([{
        id: "environment-1", name: "生产环境", revision: 1, stage: "production",
        network_policy: "approved_egress", status: "configured", health_message: null,
        worker_pools: [], created_at: "2026-09-16T01:00:00Z", updated_at: "2026-09-16T01:00:00Z",
      }])),
      http.post("http://api.test/api/projects/:projectId/connections", async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(request.headers.get("x-csrf-token")).toBe("connection-csrf");
        expect(body).toEqual({
          name: "对象存储",
          connection_type: "object_storage",
          endpoint: "s3://flywheel",
          credential_ref: "kv://s3/prod",
          allowed_environment_ids: ["environment-1"],
        });
        return HttpResponse.json({ ...connection, id: "connection-2", name: "对象存储", connection_type: "object_storage", endpoint: "s3://flywheel" }, { status: 201 });
      }),
      http.post("http://api.test/api/projects/:projectId/connections/:connectionId/checks", () =>
        HttpResponse.json({ connection_id: "connection-1", check_type: "configuration", passed: true, errors: [], side_effects: false })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const root = createRootRoute({ component: Outlet });
    const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId/settings/connections", component: ConnectionsPage });
    const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ["/projects/linked/settings/connections"] }) });
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  }

  it("lists connections without exposing credential references", async () => {
    mount();
    expect(await screen.findByText("Milvus 生产")).toBeInTheDocument();
    expect(screen.getByText("已绑定引用")).toBeInTheDocument();
    expect(screen.queryByText("kv://milvus/prod")).not.toBeInTheDocument();
  });

  it("creates a connection and runs an explicit no-side-effect configuration check", async () => {
    mount();
    fireEvent.click(await screen.findByText("新增连接", { selector: "summary" }));
    fireEvent.change(await screen.findByLabelText("连接名称"), { target: { value: "对象存储" } });
    fireEvent.change(screen.getByLabelText("连接类型"), { target: { value: "object_storage" } });
    fireEvent.change(screen.getByLabelText("Endpoint"), { target: { value: "s3://flywheel" } });
    fireEvent.change(screen.getByLabelText("凭据引用"), { target: { value: "kv://s3/prod" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /生产环境/ }));
    fireEvent.click(screen.getByRole("button", { name: /创建连接/ }));
    await screen.findByText(/连接已创建/);
    fireEvent.click(screen.getAllByRole("button", { name: /校验配置/ })[0]);
    await screen.findByText(/配置格式校验通过/);
  });

  it("keeps the submitted connection draft immutable until a failed request restores editing", async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    let submitted: unknown;
    server.use(http.post("http://api.test/api/projects/:projectId/connections", async ({ request }) => {
      submitted = await request.json(); await gate;
      return HttpResponse.json({ detail: "连接创建服务暂时不可用" }, { status: 503 });
    }));
    mount();
    fireEvent.click(await screen.findByText("新增连接", { selector: "summary" }));
    const field = await screen.findByLabelText("连接名称");
    fireEvent.change(field, { target: { value: "保留的对象存储草稿" } });
    fireEvent.change(screen.getByLabelText("Endpoint"), { target: { value: "s3://draft" } });
    const allowed = await screen.findByRole("checkbox", { name: /生产环境/ });
    fireEvent.click(allowed); fireEvent.click(screen.getByRole("button", { name: "创建连接" }));
    await waitFor(() => expect(field).toBeDisabled());
    expect(allowed).toBeDisabled(); expect(screen.getByLabelText("连接类型")).toBeDisabled();
    await waitFor(() => expect(submitted).toMatchObject({ name: "保留的对象存储草稿", allowed_environment_ids: ["environment-1"] }));
    await act(async () => finish());
    expect(await screen.findByRole("alert")).toHaveTextContent("连接创建服务暂时不可用");
    expect(field).toBeEnabled(); expect(field).toHaveValue("保留的对象存储草稿"); expect(allowed).toBeChecked();
  });

  it("announces a rejected configuration as an error and clears it after a successful retry", async () => {
    let attempt = 0;
    server.use(http.post("http://api.test/api/projects/:projectId/connections/:connectionId/checks", () =>
      HttpResponse.json({ connection_id: "connection-1", passed: ++attempt > 1, errors: attempt === 1 ? ["Endpoint 格式无效"] : [] })));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /校验配置/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Endpoint 格式无效");
    await waitFor(() => expect(screen.getByRole("button", { name: /校验配置/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /校验配置/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("配置格式校验通过");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a connection-check request failure visible instead of silently dropping it", async () => {
    server.use(http.post("http://api.test/api/projects/:projectId/connections/:connectionId/checks", () =>
      HttpResponse.json({ detail: "检查服务暂不可用" }, { status: 503 })));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /校验配置/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("检查服务暂不可用");
  });

  it("shows existing environment names while submitting their IDs for object probe and sync", async () => {
    const requests: { path: string; body: unknown }[] = [];
    server.use(
      http.get("http://api.test/api/projects/:projectId/connections", () => HttpResponse.json([{ ...connection, connection_type: "object_storage" }])),
      http.get("http://api.test/api/projects/:projectId/connections/:connectionId/inventory", () => HttpResponse.json({ items: [], generation: 0, cursor: null, has_more: false })),
      http.post("http://api.test/api/projects/:projectId/connections/:connectionId/probe", async ({ request }) => {
        requests.push({ path: "probe", body: await request.json() });
        return HttpResponse.json({ passed: true, backend: "local", sample_count: 0 });
      }),
      http.post("http://api.test/api/projects/:projectId/connections/:connectionId/inventory-sync", async ({ request }) => {
        requests.push({ path: "sync", body: await request.json() });
        return HttpResponse.json({ processed: 0, scan_complete: true });
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "对象目录与探测" }));
    const selector = await screen.findByRole("combobox", { name: "Milvus 生产 探测环境" });
    expect(await screen.findByRole("option", { name: "生产环境" })).toHaveValue("environment-1");
    expect(selector).toHaveValue("environment-1");
    fireEvent.click(screen.getByRole("button", { name: "只读探测" }));
    await screen.findByText(/只读探测通过/);
    fireEvent.click(screen.getByRole("button", { name: "同步下一页对象" }));
    await screen.findByText(/本轮扫描完成/);
    expect(requests).toEqual([
      { path: "probe", body: { environment_id: "environment-1" } },
      { path: "sync", body: { environment_id: "environment-1", page_size: 100 } },
    ]);
  });

  it("retains an authorized environment ID with a short fallback if its name is unavailable", async () => {
    server.use(
      http.get("http://api.test/api/projects/:projectId/connections", () => HttpResponse.json([{ ...connection, connection_type: "object_storage", allowed_environment_ids: ["abcdefgh-1234-5678-9012-345678901234"] }])),
      http.get("http://api.test/api/projects/:projectId/connections/:connectionId/inventory", () => HttpResponse.json({ items: [], generation: 0, cursor: null, has_more: false })),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "对象目录与探测" }));
    expect(await screen.findByRole("option", { name: "环境 · abcdefgh" })).toHaveValue("abcdefgh-1234-5678-9012-345678901234");
    expect(screen.getByRole("combobox", { name: "Milvus 生产 探测环境" })).toHaveValue("abcdefgh-1234-5678-9012-345678901234");
  });
});
