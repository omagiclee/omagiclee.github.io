import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const state = vi.hoisted(() => ({ pathname: "/operators", searchStr: "?project_id=linked-project", heading: "受保护的页面内容", permissions: ["pipelines:read"], projectPermissions: null as string[] | null }));
vi.mock("./auth-context", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ can: (permission: string) => state.permissions.includes(permission), me: {
    user: { id: "reader", display_name: "测试用户", username: "reader" }, actor: { display_name: "测试用户" },
    scope: { type: "project", id: "session-project" }, permissions: state.permissions, csrf_token: "test", impersonation: { active: false },
  } }),
  useProjectAuth: (projectId?: string) => {
    const permissions = projectId ? state.projectPermissions ?? state.permissions : state.permissions;
    return { can: (permission: string) => permissions.includes(permission), me: { user: { id: "reader" }, permissions } };
  },
}));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) => select({ location: state }),
  useNavigate: () => vi.fn(),
  Link: ({ to, search, children, activeOptions: _activeOptions, ...props }: { to: string; search?: Record<string, string>; children: React.ReactNode; activeOptions?: unknown }) =>
    <a href={`${to}${search && Object.keys(search).length ? `?${new URLSearchParams(search)}` : ""}`} {...props}>{children}</a>,
  Outlet: () => <main><h1>{state.heading}</h1></main>,
}));
vi.mock("./components/NotificationBell", () => ({ NotificationBell: () => <a href="/notifications">站内信</a> }));
vi.mock("./components/BehaviorTracker", () => ({ BehaviorTracker: () => <span data-testid="behavior-tracker" /> }));

const clients: QueryClient[] = [];
beforeEach(() => {
  state.pathname = "/operators";
  state.searchStr = "?project_id=linked-project";
  state.heading = "受保护的页面内容";
  state.permissions = ["pipelines:read"];
  state.projectPermissions = null;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); });
function mount(multipleProjects = false) {
  const client = new QueryClient(); clients.push(client);
  const permissions = state.projectPermissions ?? state.permissions;
  client.setQueryData(["accessible-projects"], { projects: permissions.length ? [{ id: "linked-project", name: "关联项目", permissions }, ...(multipleProjects ? [{ id: "other-project", name: "另一项目", permissions }] : [])] : [], default_project_id: null });
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
}

describe("authenticated global shell", () => {
  it("exposes skip navigation and account actions without redundant single-project chrome", () => {
    mount();
    expect(screen.queryByRole("combobox", { name: "切换项目" })).not.toBeInTheDocument();
    expect(document.querySelector(".app-header .app-project-context")).toBeNull();
    const location = screen.getByRole("navigation", { name: "当前位置" });
    expect(location).toHaveTextContent("数据开发");
    expect(location).toHaveTextContent("算子与插件");
    expect(location.querySelector('[aria-current="page"]')).toHaveTextContent("算子与插件");
    expect(screen.getByRole("link", { name: "站内信" })).toHaveAttribute("href", "/notifications");
    expect(screen.getByRole("button", { name: "账号菜单，测试用户" })).toBeInTheDocument();
    expect(screen.getByTestId("behavior-tracker")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "跳到主要内容" }));
    expect(document.getElementById("main-content")).toHaveFocus();
    expect(screen.getByRole("heading", { name: "受保护的页面内容" })).toBeInTheDocument();
  });

  it("keeps meaningful workspace context and a scoped return action in the compact header", () => {
    state.searchStr = "?project_id=linked-project&view=development";
    mount();
    const location = screen.getByRole("navigation", { name: "当前位置" });
    expect(location).toHaveTextContent("数据开发");
    expect(location).toHaveTextContent("插件开发");
    expect(within(location).getByRole("link", { name: "返回算子与插件" })).toHaveAttribute("href", "/operators?project_id=linked-project");
    expect(within(location).getByRole("link", { name: "数据开发" })).toHaveAttribute("href", "/projects/linked-project/pipelines");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("keeps multi-project switching inside navigation and out of the utility header", () => {
    mount(true);
    const switcher = screen.getByRole("combobox", { name: "切换项目" });
    expect(switcher.closest(".app-sidebar")).not.toBeNull();
    expect(switcher.closest(".app-header")).toBeNull();
    expect(screen.getByRole("link", { name: "算子与插件" })).toHaveAttribute("href", "/projects/linked-project/operators");
  });

  it.each([
    ["datasets", "data_platform:read", "数据集"],
    ["pipelines", "pipelines:read", "数据流水线"],
  ])("keeps the list return action when a %s object shares its page name", (route, permission, heading) => {
    state.pathname = `/projects/linked-project/${route}/same-name-object`;
    state.searchStr = "";
    state.permissions = [permission];
    state.heading = heading;
    mount();
    const location = screen.getByRole("navigation", { name: "当前位置" });
    expect(within(location).getByRole("link", { name: `返回${heading}` })).toHaveAttribute("href", `/projects/linked-project/${route}`);
    expect(location.querySelector('[aria-current="page"]')).toHaveTextContent(heading);
  });

  it.each([
    ["/pipelines", "?project_id=linked-project&view=new", "/pipelines?project_id=linked-project"],
    ["/projects/linked-project/pipelines", "?view=new", "/projects/linked-project/pipelines"],
  ])("identifies pipeline creation and keeps its scoped list return on %s", (pathname, search, listUrl) => {
    state.pathname = pathname;
    state.searchStr = search;
    state.heading = "新建流水线";
    mount();
    const location = screen.getByRole("navigation", { name: "当前位置" });
    expect(within(location).getByRole("link", { name: "返回数据流水线" })).toHaveAttribute("href", listUrl);
    expect(location.querySelector('[aria-current="page"]')).toHaveTextContent("新建流水线");
  });

  it("does not interpret another page's new view as pipeline creation", () => {
    state.searchStr = "?project_id=linked-project&view=new";
    mount();
    const location = screen.getByRole("navigation", { name: "当前位置" });
    expect(location).not.toHaveTextContent("新建流水线");
    expect(location.querySelector('[aria-current="page"]')).toHaveTextContent("算子与插件");
    expect(within(location).queryByRole("link", { name: "返回算子与插件" })).not.toBeInTheDocument();
  });

  it("protects direct operator URLs and retains access request navigation for a restricted account", () => {
    state.permissions = [];
    mount();
    expect(screen.getByRole("heading", { name: "需要访问权限" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "受保护的页面内容" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "算子与插件" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "申请算子与插件权限" })).toHaveAttribute("href", "/access?permission=pipelines%3Aread&project_id=linked-project");
    expect(screen.getByRole("link", { name: "查看我的权限与申请记录" })).toHaveAttribute("href", "/access?project_id=linked-project");
  });

  it("allows a project deep link when the default project denies it", () => {
    state.permissions = [];
    state.projectPermissions = ["pipelines:read"];
    mount();
    expect(screen.getByRole("heading", { name: "受保护的页面内容" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "算子与插件" })).toBeInTheDocument();
    expect(document.title).toContain("linked-project");
  });

  it("denies the target project even when the default project permits it", () => {
    state.projectPermissions = [];
    mount();
    expect(screen.getByRole("heading", { name: "需要访问权限" })).toBeInTheDocument();
    expect(screen.getByText(/项目「linked-project」/)).toBeInTheDocument();
  });
});
