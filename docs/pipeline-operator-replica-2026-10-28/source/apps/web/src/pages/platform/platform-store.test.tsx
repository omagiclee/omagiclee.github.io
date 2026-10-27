import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformProvider, usePlatform } from "./platform-store";
import { Tabs, useView } from "./shared";

const route = vi.hoisted(() => ({ search: "", listeners: new Set<() => void>() }));
const network = vi.hoisted(() => ({ resolve: undefined as undefined | ((value: unknown) => void), mutationRace: false, saved: false, routeReads: 0 }));
vi.mock("@tanstack/react-router", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useRouterState: ({ select }: { select: (state: unknown) => unknown }) => useSyncExternalStore(listener => {
      route.listeners.add(listener); return () => { route.listeners.delete(listener); };
    }, () => select({ location: { pathname: "/projects/demo/datasets/dataset-1", searchStr: route.search } })),
    useNavigate: () => ({ search }: { search: Record<string, string> }) => {
      route.search = `?${new URLSearchParams(search)}`;
      for (const listener of route.listeners) listener();
    },
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  };
});
vi.mock("../../auth-context", () => ({ useProjectAuth: () => ({ me: { user: { id: "admin" }, csrf_token: "test" }, can: () => true }) }));
vi.mock("../../data-platform-api", () => ({
  platformRequest: vi.fn(async () => { network.saved = true; return { id: "training-run" }; }), platformPageQuery: vi.fn(),
  platformStateQuery: (project: string, user: string, path: string, search: string) => ({
    queryKey: ["data-platform", project, user, path, search], staleTime: Infinity,
    queryFn: () => {
      const snapshot = { users: [], datasets: [{ id: "initial" }], trainingRuns: network.saved ? [{ id: "training-run", externalRef: "external-training-123" }] : [] };
      if (search.includes("tab=")) {
        network.routeReads++;
        if (!network.mutationRace || network.routeReads === 1) return new Promise(resolve => { network.resolve = resolve; });
      }
      return Promise.resolve(snapshot);
    },
  }),
}));
afterEach(() => { cleanup(); route.search = ""; route.listeners.clear(); network.resolve = undefined; network.mutationRace = false; network.saved = false; network.routeReads = 0; });

function NewlyMountedPanel() {
  const { state } = usePlatform();
  return <p>关联数据集 {state.datasets.length} 项</p>;
}
function DetailWorkspace() {
  usePlatform();
  const view = useView("数据");
  return <Tabs tabs={["数据", "版本", "血缘与使用"]} active={view.tab} onChange={view.setTab} label="数据集详情">
    {view.tab === "血缘与使用" ? <NewlyMountedPanel /> : <p>样本列表</p>}
  </Tabs>;
}

function TrainingWorkspace() {
  const { state, write } = usePlatform();
  const view = useView("数据");
  const [saved, setSaved] = useState(false);
  return <Tabs tabs={["数据", "血缘与使用"]} active={view.tab} onChange={view.setTab} label="数据集详情">
    {view.tab === "血缘与使用" && <>
      <button onClick={() => void write("/training-runs", {}).then(() => setSaved(true))}>登记训练结果</button>
      {saved && <p>登记已完成</p>}
      {state.trainingRuns?.length ? state.trainingRuns.map(row => <p key={row.id}>{row.externalRef}</p>) : <p>还没有外部训练结果</p>}
    </>}
  </Tabs>;
}

describe("platform query ownership", () => {
  it("refreshes a newly loading URL snapshot after a concurrent successful write", async () => {
    network.mutationRace = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Suspense fallback={<p>工作区加载中</p>}><PlatformProvider><TrainingWorkspace /></PlatformProvider></Suspense></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("tab", { name: "血缘与使用" }));
    await waitFor(() => expect(network.resolve).toBeTypeOf("function"));
    const staleResponse = network.resolve!;
    fireEvent.click(screen.getByRole("button", { name: "登记训练结果" }));
    await waitFor(() => expect(network.saved).toBe(true));
    await act(async () => { staleResponse({ users: [], datasets: [{ id: "initial" }], trainingRuns: [] }); });
    await screen.findByText("登记已完成");
    await waitFor(() => expect(client.getQueryState(["data-platform", "demo", "admin", "/projects/demo/datasets/dataset-1", route.search])?.status).toBe("success"));
    expect(screen.getByText("external-training-123")).toBeInTheDocument();
    expect(screen.queryByText("还没有外部训练结果")).not.toBeInTheDocument();
    expect(network.routeReads).toBeGreaterThanOrEqual(2);
    client.clear();
  });
  it("keeps tab identity and focus while a newly mounted panel awaits URL data", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Suspense fallback={<p>整个页面正在加载</p>}><PlatformProvider><DetailWorkspace /></PlatformProvider></Suspense></QueryClientProvider>);
    const dataTab = await screen.findByRole("tab", { name: "数据" });
    const detailsTab = screen.getByRole("tab", { name: "血缘与使用" });
    const initialId = detailsTab.id;
    dataTab.focus();
    fireEvent.keyDown(dataTab, { key: "End" });
    await waitFor(() => expect(detailsTab).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tabpanel", { name: "血缘与使用" })).toHaveTextContent("关联数据集 1 项");
    expect(detailsTab).toHaveFocus();
    expect(screen.queryByText("整个页面正在加载")).not.toBeInTheDocument();
    await waitFor(() => expect(network.resolve).toBeTypeOf("function"));
    await act(async () => { network.resolve!({ users: [], datasets: [{ id: "initial" }, { id: "latest" }] }); });
    await screen.findByText("关联数据集 2 项");
    expect(screen.getByRole("tab", { name: "血缘与使用" }).id).toBe(initialId);
    expect(detailsTab).toHaveFocus();
    expect(screen.queryByText("整个页面正在加载")).not.toBeInTheDocument();
    client.clear();
  });
});
