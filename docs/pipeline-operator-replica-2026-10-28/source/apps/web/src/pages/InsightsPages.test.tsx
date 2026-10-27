import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import DashboardPage from "./DashboardPage";
import UsageAnalyticsPage from "./UsageAnalyticsPage";
import AuditPage from "./AuditPage";
import type { Overview } from "../insights-api";
import { insightHref } from "../components/insights/shared";

const route = vi.hoisted(() => ({ search: "?days=30&project_id=demo", navigate: vi.fn(), denied: [] as string[] }));
vi.mock("../auth-context", () => ({ useAuth: () => ({ can: (permission: string) => !route.denied.includes(permission) }), useProjectAuth: () => ({ can: (permission: string) => !route.denied.includes(permission) }) }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: route.navigate }), useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: route.search } }), Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));

const overview: Overview = {
  project_id: "demo", generated_at: "2026-09-10T02:00:00Z", window: { start: "2026-08-11T02:00:00Z", end: "2026-09-10T02:00:00Z", days: 30 },
  media: { videos: 2, shots: 3, indexed_shots: 0, keyframes: 3, new_videos: 1, new_shots: 1, index_rate: 0 }, production: { total: 0, succeeded: 0, failed: 0, running: 0, success_rate: null, avg_duration_ms: null }, requirements: { total: 1, open: 1, pending_review: 1, pending_acceptance: 0, in_progress: 0, overdue: 1, completed: 0 },
  usage: { available: true, active_users: 321, page_views: 456, clicks: 789, business_actions: 2 }, trend: [], attention: [], top_features: [{ id: "private.button", label: "私人操作", page_id: "admin_users", clicks: 50, users: 5 }],
};

function mount(page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}>{page}</QueryClientProvider>);
  return client;
}

describe("insight pages", () => {
  beforeEach(() => {
    route.search = "?days=30&project_id=demo"; route.denied = []; route.navigate.mockReset();
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(
      http.get("http://api.test/api/insights/projects", () => HttpResponse.json({ projects: [{ id: "demo", name: "演示项目" }], default_project_id: "demo", can_view_all: true })),
      http.get("http://api.test/api/insights/people", () => HttpResponse.json({ people: [{ id: "u-1", name: "张三", username: "zhangsan" }, { id: "a-1", name: "李管理员", username: "admin" }] })),
      http.get("http://api.test/api/insights/overview", () => HttpResponse.json(overview)),
    );
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  it("hides usage and cross-user activity without analytics permission even if included in the response", async () => {
    route.denied = ["analytics:read"];
    const client = mount(<DashboardPage />);
    await screen.findByText("当前没有待处理提醒");
    expect(screen.queryByText("活跃人数")).not.toBeInTheDocument();
    expect(screen.queryByText("热门功能")).not.toBeInTheDocument();
    expect(screen.queryByText("私人操作")).not.toBeInTheDocument();
    expect(screen.getByText("索引完成率").nextSibling).toHaveTextContent("0.0%");
    expect(screen.getByText("已结束运行成功率").nextSibling).toHaveTextContent("—");
    client.clear();
  });

  it("prioritizes failures and overdue delivery with distinct status semantics and scoped drill-down links", async () => {
    const attention = [
      { id: "review", kind: "requirement", title: "评审需求", status: "pending_review", created_at: overview.generated_at, href: "/requirements/review" },
      { id: "late", kind: "requirement", title: "逾期需求", status: "overdue", created_at: overview.generated_at, href: "/requirements/late" },
      { id: "failed", kind: "run", title: "失败运行", status: "failed", created_at: overview.generated_at, href: "/pipelines?runId=failed&project_id=demo" },
    ];
    server.use(http.get("http://api.test/api/insights/overview", () => HttpResponse.json({ ...overview, attention })));
    const client = mount(<DashboardPage />);
    const first = await screen.findByRole("link", { name: /失败运行/ });
    const list = first.closest("ul")!;
    expect(within(list).getAllByRole("link").map((link) => link.querySelector("strong")?.textContent)).toEqual(["失败运行", "逾期需求", "评审需求"]);
    expect(within(list).getByText("失败")).toHaveAttribute("data-status", "failed");
    expect(within(list).getByText("逾期")).toHaveAttribute("data-status", "overdue");
    expect(within(list).getByText("待评审")).toHaveAttribute("data-status", "pending_review");
    const url = new URL(first.getAttribute("href")!, "http://app.test");
    expect(url.searchParams.get("project_id")).toBe("demo");
    expect(url.searchParams.get("runId")).toBe("failed");
    client.clear();
  });

  it("shows API failure instead of demo data", async () => {
    server.use(http.get("http://api.test/api/insights/overview", () => HttpResponse.json({ detail: "统计服务暂不可用" }, { status: 503 })));
    const client = mount(<DashboardPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("统计服务暂不可用");
    expect(screen.queryByLabelText("核心指标")).not.toBeInTheDocument();
    expect(screen.queryByText("演示数据")).not.toBeInTheDocument();
    client.clear();
  });

  it("does not draw a zero activity chart and preserves detailed statistics behind a disclosure", async () => {
    server.use(http.get("http://api.test/api/insights/overview", () => HttpResponse.json({ ...overview, trend: [{ date: "2026-09-10", videos: 0, shots: 0, runs: 0, succeeded: 0, active_users: 0, page_views: 0 }] })));
    const client = mount(<DashboardPage />);
    await screen.findByText("当前周期暂无新增镜头");
    expect(screen.queryByRole("img", { name: /每日趋势/ })).not.toBeInTheDocument();
    const disclosure = screen.getByText("查看资产、运行与交付详情").closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(within(disclosure).getByText("查看资产、运行与交付详情"));
    expect(within(disclosure).getByText("索引完成率")).toBeInTheDocument();
    client.clear();
  });

  it("preserves scope and user when drilling from a button row, and leaves missing exposure rate empty", async () => {
    route.search = "?days=30&project_id=demo&group_by=button&user_id=u-1&offset=30";
    server.use(http.get("http://api.test/api/insights/usage", ({ request }) => {
      expect(new URL(request.url).searchParams.get("user_id")).toBe("u-1");
      return HttpResponse.json({ generated_at: overview.generated_at, window: overview.window, summary: { active_users: 1, page_views: 1, clicks: 3, business_actions: 1 }, collection_started_at: overview.generated_at, rows: [{ id: "media.search", label: "检索镜头", page_id: "media", views: 0, clicks: 3, users: 1, exposures: 0, exposed_users: 0, click_rate: null, avg_duration_ms: null, last_seen_at: overview.generated_at }] });
    }));
    const client = mount(<UsageAnalyticsPage />);
    const link = await screen.findByRole("link", { name: "检索镜头" });
    const url = new URL(link.getAttribute("href")!, "http://app.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({ days: "30", project_id: "demo", user_id: "u-1", page_id: "media", element_id: "media.search" });
    expect(screen.getByRole("columnheader", { name: "人数点击率" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "—" }).length).toBeGreaterThan(0);
    const person = screen.getByRole("button", { name: "使用人员" });
    await waitFor(() => expect(person).toBeEnabled());
    fireEvent.click(person);
    expect(await screen.findByRole("menuitemradio", { name: "张三（zhangsan）" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(screen.getByRole("menu", { name: "使用人员" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu", { name: "使用人员" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "统计周期" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "最近 90 天" }));
    expect(route.navigate).toHaveBeenLastCalledWith({ search: { days: "90", project_id: "demo", group_by: "button", user_id: "u-1" } });
    fireEvent.click(screen.getByRole("tab", { name: "用户" }));
    expect(route.navigate).toHaveBeenLastCalledWith({ search: { days: "30", project_id: "demo", group_by: "user", user_id: "u-1" } });
    client.clear();
  });

  it("renders impersonation, before/after values and paginates the filtered timeline", async () => {
    route.search = "?days=90&project_id=demo&user_id=u-1&actor_user_id=a-1&session_id=s-1";
    server.use(http.get("http://api.test/api/insights/events", ({ request }) => {
      const params = new URL(request.url).searchParams;
      expect(params.get("actor_user_id")).toBe("a-1"); expect(params.get("session_id")).toBe("s-1");
      return HttpResponse.json({ total: 31, offset: 0, limit: 30, items: [{ id: "evt-1", kind: "audit", action: "requirement.update", label: "编辑需求", page_id: "requirements", element_id: null, actor_user_id: "a-1", actor_name: "李管理员", effective_user_id: "u-1", user_name: "张三", session_id: "s-1", created_at: overview.generated_at, status: "succeeded", object_id: "req-1", interaction_id: "int-1", details: { before: { title: "旧需求" }, after: { title: "新需求" }, result: "saved" }, href: "/requirements/req-1" }] });
    }));
    const client = mount(<AuditPage />);
    fireEvent.click(await screen.findByText("编辑需求"));
    expect(screen.getByText("代登录 · 实际操作 李管理员")).toBeInTheDocument();
    expect(screen.getByText(/旧需求/)).toBeInTheDocument(); expect(screen.getByText(/新需求/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看关联对象" })).toHaveAttribute("href", "/requirements/req-1?days=90&project_id=demo");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(route.navigate).toHaveBeenLastCalledWith({ search: { days: "90", project_id: "demo", user_id: "u-1", actor_user_id: "a-1", session_id: "s-1", offset: "30" } }));
    client.clear();
  });

  it("shows linked business outcomes separately from button clicks", async () => {
    route.search = "?days=30&project_id=demo&group_by=button";
    server.use(http.get("http://api.test/api/insights/usage", () => HttpResponse.json({
      generated_at: overview.generated_at, window: overview.window,
      summary: { active_users: 2, page_views: 3, clicks: 12, business_actions: 8 }, collection_started_at: overview.generated_at,
      rows: [{ id: "pipeline.run", label: "运行流水线", page_id: "pipelines", views: 0, clicks: 12, users: 2, exposures: 5, exposed_users: 2, click_rate: 1, avg_duration_ms: null, last_seen_at: overview.generated_at, business_actions: 8, succeeded: 4, failed: 1, running: 3 }],
    })));
    const client = mount(<UsageAnalyticsPage />);
    const row = (await screen.findByRole("link", { name: "运行流水线" })).closest("tr")!;
    expect(screen.getByRole("columnheader", { name: "成功业务记录" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "失败业务记录" })).toBeInTheDocument();
    const cells = within(row).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("12");
    expect(cells[6]).toHaveTextContent("4");
    expect(cells[7]).toHaveTextContent("1");
    expect(cells[6]).toHaveAttribute("title", "已关联业务记录 8 条 · 未结束 3 条");
    expect(screen.getByText("仅统计已关联审计，异步任务按当前结果；一条点击可关联多条业务记录。")).toBeInTheDocument();
    expect(screen.queryByText("点击成功率")).not.toBeInTheDocument();
    client.clear();
  });
});

describe("insight drill-down links", () => {
  it("keeps the concrete project on an object link from an all-platform report", () => {
    const result = new URL(insightHref("/pipelines?pipelineId=p-1&runId=r-1&project_id=actual", { days: 30, project_id: "*" }), "http://app.test");
    expect(result.searchParams.get("project_id")).toBe("actual");
    expect(result.searchParams.get("runId")).toBe("r-1");
    expect(result.searchParams.get("days")).toBe("30");
  });
  it("allows an explicit patch to replace a destination filter", () => {
    const result = new URL(insightHref("/operations?project_id=first&kind=video", { days: 7, project_id: "*" }, { project_id: "chosen", kind: "shot" }), "http://app.test");
    expect(Object.fromEntries(result.searchParams)).toEqual({ project_id: "chosen", kind: "shot", days: "7" });
  });
});
