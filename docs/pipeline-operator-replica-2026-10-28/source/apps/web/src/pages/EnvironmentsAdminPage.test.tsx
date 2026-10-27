import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import EnvironmentsAdminPage from "./EnvironmentsAdminPage";

const state = vi.hoisted(() => ({ permissions: ["environments:read", "environments:manage"] }));
vi.mock("../auth-context", () => ({
  useAuth: () => ({ me: { user: { id: "environment-user" }, csrf_token: "environment-csrf" }, can: (permission: string) => state.permissions.includes(permission) }),
}));

const runtime = { id: "runtime-1", digest: "sha256:" + "a".repeat(64), name: "CPU runtime", image: "registry.internal/runtime@sha256:" + "a".repeat(64), sdk_abi: "flywheel-v2", cpu_arch: "arm64", gpu_required: false, capabilities: [], status: "registered", health_message: null, created_at: "2026-09-16T01:00:00Z" };
const environment = { id: "environment-1", name: "生产环境", revision: 1, stage: "production", network_policy: "restricted", status: "configured", health_message: null, worker_pools: [], created_at: "2026-09-16T01:00:00Z", updated_at: "2026-09-16T01:00:00Z" };

describe("environments control plane", () => {
  beforeEach(() => {
    state.permissions = ["environments:read", "environments:manage"];
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(
      http.get("http://api.test/api/admin/runtime-releases", () => HttpResponse.json([runtime])),
      http.get("http://api.test/api/admin/environments", () => HttpResponse.json([environment])),
      http.post("http://api.test/api/admin/runtime-releases", async ({ request }) => {
        expect(request.headers.get("x-csrf-token")).toBe("environment-csrf");
        return HttpResponse.json({ ...runtime, id: "runtime-2", name: "GPU runtime", gpu_required: true }, { status: 201 });
      }),
      http.post("http://api.test/api/admin/environments", () => HttpResponse.json({ ...environment, id: "environment-2", name: "测试环境", stage: "test" }, { status: 201 })),
    );
  });

  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
  function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); render(<QueryClientProvider client={client}><EnvironmentsAdminPage /></QueryClientProvider>); }

  it("separates runtime releases from execution environments", async () => {
    mount();
    expect((await screen.findAllByText("CPU runtime")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "生产环境 · r1" })).toBeInTheDocument();
    expect(screen.getByText("缺少资源池")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "运行时版本表" })).toHaveAttribute("tabindex", "0");
  });

  it("registers an immutable runtime without claiming it is healthy", async () => {
    mount();
    fireEvent.click(await screen.findByText("登记运行时版本", { selector: "summary" }));
    fireEvent.change(await screen.findByLabelText("运行时名称"), { target: { value: "GPU runtime" } });
    fireEvent.change(screen.getByLabelText("镜像摘要"), { target: { value: runtime.digest } });
    fireEvent.change(screen.getByLabelText("镜像地址"), { target: { value: runtime.image } });
    fireEvent.click(screen.getByLabelText("GPU 运行时"));
    fireEvent.click(screen.getByRole("button", { name: "登记运行时" }));
    expect(await screen.findByText(/需要绑定 Worker 资源池/)).toBeInTheDocument();
  });

  it("hides control-plane forms without management permission", async () => {
    state.permissions = [];
    mount();
    expect(await screen.findByRole("heading", { name: "需要执行环境查看权限" })).toBeInTheDocument();
    expect(screen.queryByLabelText("运行时名称")).not.toBeInTheDocument();
  });
});
