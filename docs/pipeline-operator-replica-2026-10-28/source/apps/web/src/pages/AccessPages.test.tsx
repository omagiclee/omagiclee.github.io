import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessDirectory, PermissionCatalog, PermissionRequest } from "../access-api";
import { server } from "../test/server";
import AccessPage from "./AccessPage";
import AccessAdminPage from "./AccessAdminPage";
import NotificationsPage from "./NotificationsPage";

const auth = vi.hoisted(() => ({ permissions: [] as string[], projectPermissions: {} as Record<string, string[]>, impersonating: false }));
vi.mock("@tanstack/react-router", () => ({ useSearch: () => Object.fromEntries(new URLSearchParams(window.location.search)) }));
vi.mock("../auth-context", () => { const scoped = () => ({
  me: { actor: { id: "me" }, user: { id: "me" }, scope: { type: "project", id: "demo" }, csrf_token: "test-csrf", permissions: auth.permissions, impersonation: { active: auth.impersonating } },
  can: (permission: string) => auth.permissions.includes(permission),
}); return { useAuth: () => scoped(), useProjectAuth: (projectId?: string) => { const value = scoped(); const permissions = auth.projectPermissions[projectId ?? "demo"] ?? auth.permissions; return { ...value, me: { ...value.me, permissions }, can: (permission: string) => permissions.includes(permission) }; } }; });

const catalog: PermissionCatalog = {
  projects: [{ id: "demo", name: "演示项目" }],
  permissions: [
    { key: "menu.data:view", name: "数据平台", kind: "menu", parent_key: null, route: null, requestable: true },
    { key: "pipelines:read", name: "流水线", kind: "page", parent_key: "menu.data:view", route: "/pipelines", requestable: true },
    { key: "pipelines:run", name: "运行流水线", kind: "button", parent_key: "pipelines:read", route: null, requestable: true },
    { key: "access:manage", name: "配置访问权限", kind: "button", parent_key: null, route: null, requestable: false },
  ],
};
const makeRequest = (): PermissionRequest => ({
  id: "request-1", requester_id: "requester", requester_name: "申请用户", permission_key: "pipelines:run", permission_name: "运行流水线", project_id: "demo", reason: "需要运行视频流程", requested_permissions: ["menu.data:view", "pipelines:read", "pipelines:run"], status: "pending", reviewer_id: null, reviewer_name: null, review_comment: null, created_at: "2026-09-10T08:00:00Z", reviewed_at: null,
});
const clients: QueryClient[] = [];
function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

describe("permission self-service and administration", () => {
  let requests: PermissionRequest[];
  let directory: AccessDirectory;
  beforeEach(() => {
    auth.permissions = [];
    auth.projectPermissions = {};
    auth.impersonating = false;
    window.history.replaceState({}, "", "/access");
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    requests = [];
    directory = {
      users: [
        { id: "me", username: "admin", display_name: "当前管理员", is_active: true, group_ids: ["own-group"], effective_permissions: [] },
        { id: "requester", username: "requester", display_name: "申请用户", is_active: true, group_ids: [], effective_permissions: [] },
      ],
      groups: [{ id: "own-group", key: "administrators", name: "管理员组", member_ids: ["me"] }], policies: [],
    };
    server.use(
      http.get("http://api.test/api/access/catalog", () => HttpResponse.json(catalog)),
      http.get("http://api.test/api/access/requests", () => HttpResponse.json(requests)),
      http.get("http://api.test/api/admin/access", () => HttpResponse.json(directory)),
      http.get("http://api.test/api/admin/access/requests", () => HttpResponse.json(requests)),
      http.get("http://api.test/api/notifications", () => HttpResponse.json({ items: [{ id: "notice-1", kind: "permission_request", title: "新的权限申请", body: "申请用户申请运行流水线", request_id: "request-1", read_at: null, created_at: "2026-09-10T08:00:00Z" }], unread_count: 1 })),
      http.post("http://api.test/api/notifications/notice-1/read", () => HttpResponse.json({ ok: true })),
    );
  });
  afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllEnvs(); });

  it("preselects a denied button, explains missing ancestors and sends a scoped request with CSRF", async () => {
    window.history.replaceState({}, "", "/access?permission=pipelines%3Arun");
    let submitted: unknown;
    server.use(http.post("http://api.test/api/access/requests", async ({ request }) => {
      expect(request.headers.get("x-csrf-token")).toBe("test-csrf");
      submitted = await request.json();
      requests = [{ ...makeRequest(), requester_id: "me" }];
      return HttpResponse.json(requests[0]);
    }));
    mount(<AccessPage />);
    await screen.findByText("通过后将一并授予以下缺失的上级权限：");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["数据平台", "流水线"]);
    expect(screen.getByRole("button", { name: "提交申请" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("申请理由"), { target: { value: "  需要运行视频流程  " } });
    fireEvent.click(screen.getByRole("button", { name: "提交申请" }));
    await screen.findByText("申请已提交，管理员已收到审批站内信。");
    expect(submitted).toEqual({ permission_key: "pipelines:run", project_id: "demo", reason: "需要运行视频流程" });
    expect(screen.getByText("此权限已有待审批申请，请等待管理员处理。")).toBeInTheDocument();
  });

  it("does not offer requests for already granted or sensitive permissions", async () => {
    auth.permissions = ["pipelines:run"];
    window.history.replaceState({}, "", "/access?permission=pipelines%3Arun");
    mount(<AccessPage />);
    await screen.findByText("你已拥有此权限，可以直接使用。");
    expect(screen.queryByLabelText("申请理由")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("其他权限", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: /配置访问权限/ }));
    expect(screen.getByText("此项属于管理权限，请联系管理员配置。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交申请" })).not.toBeInTheDocument();
  });

  it("uses the requested project's grants and dependencies instead of default-project ownership", async () => {
    auth.permissions = ["menu.data:view", "pipelines:read", "pipelines:run"];
    auth.projectPermissions.other = [];
    window.history.replaceState({}, "", "/access?permission=pipelines%3Arun&project_id=other");
    server.use(http.get("http://api.test/api/access/catalog", () => HttpResponse.json({ ...catalog, projects: [...catalog.projects, { id: "other", name: "其他项目" }] })));
    mount(<AccessPage />);
    await screen.findByText("申请项目：其他项目");
    expect(screen.queryByText("你已拥有此权限，可以直接使用。")).not.toBeInTheDocument();
    expect(screen.getByLabelText("申请理由")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["数据平台", "流水线"]);
  });

  it("approves a request directly from a notification and displays the persisted result", async () => {
    auth.permissions = ["access:approve"];
    requests = [makeRequest()];
    let decision: unknown;
    server.use(http.post("http://api.test/api/admin/access/requests/request-1/decision", async ({ request }) => {
      expect(request.headers.get("x-csrf-token")).toBe("test-csrf");
      decision = await request.json();
      requests = [{ ...requests[0], status: "approved", reviewer_name: "当前管理员", reviewed_at: "2026-09-10T09:00:00Z" }];
      return HttpResponse.json(requests[0]);
    }));
    mount(<NotificationsPage />);
    const disclosure = await screen.findByRole("button", { name: "查看申请详情" });
    const detailsId = disclosure.getAttribute("aria-controls")!;
    expect(document.getElementById(detailsId)).not.toBeVisible();
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(detailsId)).toBeVisible();
    fireEvent.change(await screen.findByLabelText("审批说明：运行流水线"), { target: { value: "同意业务需要" } });
    fireEvent.click(screen.getByRole("button", { name: "确认通过" }));
    await screen.findByText("已通过");
    expect(decision).toEqual({ decision: "approved", comment: "同意业务需要" });
    expect(screen.queryByRole("button", { name: "确认通过" })).not.toBeInTheDocument();
  });

  it("locks an approval comment during submission and preserves it after a failed decision", async () => {
    auth.permissions = ["access:approve"];
    requests = [makeRequest()];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post("http://api.test/api/admin/access/requests/request-1/decision", async () => {
      await pending;
      return HttpResponse.json({ detail: "审批服务暂不可用" }, { status: 503 });
    }));
    mount(<NotificationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "查看申请详情" }));
    const comment = await screen.findByLabelText("审批说明：运行流水线");
    fireEvent.change(comment, { target: { value: "保留这次审批依据" } });
    fireEvent.click(screen.getByRole("button", { name: "确认通过" }));
    try {
      await waitFor(() => expect(comment).toBeDisabled());
      expect(screen.getByRole("button", { name: "通过中…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "拒绝申请" })).toBeDisabled();
    } finally { release(); }
    expect(await screen.findByRole("alert")).toHaveTextContent("审批服务暂不可用");
    expect(comment).toBeEnabled();
    expect(comment).toHaveValue("保留这次审批依据");
    expect(screen.getByRole("button", { name: "确认通过" })).toBeEnabled();
  });

  it("explains an unmatched subject search without changing the selected policy editor", async () => {
    auth.permissions = ["access:read", "access:manage"];
    mount(<AccessAdminPage />);
    const search = await screen.findByRole("textbox", { name: "搜索授权对象" });
    fireEvent.click(screen.getByRole("button", { name: /申请用户.*requester/ }));
    fireEvent.change(search, { target: { value: "不存在的授权对象" } });
    expect(screen.getByText("没有匹配的用户。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "申请用户的权限策略" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作用域" })).toHaveTextContent("指定项目");
    fireEvent.click(screen.getByRole("button", { name: "清除授权对象搜索" }));
    expect(search).toHaveValue("");
    expect(screen.getByRole("button", { name: /申请用户.*requester/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps administrator request data unavailable without approval permission", async () => {
    let protectedRequests = 0;
    server.use(http.get("http://api.test/api/admin/access/requests", () => { protectedRequests++; return HttpResponse.json([makeRequest()]); }));
    mount(<NotificationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "查看申请详情" }));
    await screen.findByText("该申请已不可查看，或当前身份已没有审批权限。消息内容仍保留供参考。");
    expect(protectedRequests).toBe(0);
    expect(screen.queryByRole("button", { name: "确认通过" })).not.toBeInTheDocument();
  });

  it("blocks self policy editing and sends an explicit deny for another user", async () => {
    auth.permissions = ["access:read", "access:manage"];
    let policy: unknown;
    server.use(http.put("http://api.test/api/admin/access/policies", async ({ request }) => {
      expect(request.headers.get("x-csrf-token")).toBe("test-csrf");
      policy = await request.json();
      return HttpResponse.json({ ok: true });
    }));
    mount(<AccessAdminPage />);
    await screen.findByLabelText("运行流水线的策略");
    fireEvent.click(screen.getByText("数据平台", { selector: "summary" }));
    expect(screen.getByRole("combobox", { name: "运行流水线的策略" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /申请用户.*requester/ }));
    expect(screen.getByLabelText("运行流水线的策略")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("运行流水线的策略"), { target: { value: "deny" } });
    await screen.findByText("策略已保存，有效权限已更新。");
    expect(policy).toEqual({ subject_type: "user", subject_id: "requester", permission_key: "pipelines:run", effect: "deny", scope_type: "project", scope_id: "demo" });
    fireEvent.click(screen.getByRole("tab", { name: "用户组" }));
    expect(screen.getByLabelText("运行流水线的策略")).toBeDisabled();
    screen.getAllByRole("checkbox").forEach((checkbox) => expect(checkbox).toBeDisabled());
  });

  it("switches approval status through the toolbar menu without changing the policy scope", async () => {
    auth.permissions = ["access:read", "access:approve"];
    requests = [{ ...makeRequest(), status: "approved", reason: "已经通过的申请", reviewer_id: "me", reviewer_name: "当前管理员" }];
    mount(<AccessAdminPage />);
    await screen.findByText("暂无待审批申请。");
    fireEvent.click(screen.getByRole("button", { name: "审批状态筛选" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "全部申请" }));
    expect(await screen.findByText("已经通过的申请")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作用域" })).toHaveTextContent("作用域：指定项目");
    fireEvent.click(screen.getByRole("button", { name: "审批状态筛选" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "待审批" }));
    expect(await screen.findByText("暂无待审批申请。")).toBeInTheDocument();
    expect(screen.queryByText("已经通过的申请")).not.toBeInTheDocument();
  });

  it("does not query the protected directory when the management page is forbidden", async () => {
    let protectedRequests = 0;
    server.use(http.get("http://api.test/api/admin/access", () => { protectedRequests++; return HttpResponse.json(directory); }));
    mount(<AccessAdminPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("当前身份没有查看权限配置的授权");
    await waitFor(() => expect(protectedRequests).toBe(0));
  });

  it("edits other group members and requires the global scope for management permissions", async () => {
    auth.permissions = ["access:read", "access:manage"];
    directory.groups.push({ id: "operators", key: "operators", name: "运营组", member_ids: [] });
    let members: unknown;
    server.use(http.put("http://api.test/api/admin/access/groups/operators/members", async ({ request }) => {
      expect(request.headers.get("x-csrf-token")).toBe("test-csrf");
      members = await request.json();
      return HttpResponse.json(directory.groups[1]);
    }));
    mount(<AccessAdminPage />);
    await screen.findByLabelText("运行流水线的策略");
    fireEvent.click(screen.getByRole("tab", { name: "用户组" }));
    fireEvent.click(screen.getByRole("button", { name: /运营组/ }));
    expect(screen.getByLabelText("配置访问权限的策略")).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /申请用户/ }));
    expect(screen.getByRole("checkbox", { name: /当前管理员/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存成员" }));
    await screen.findByText("组成员已更新。");
    expect(members).toEqual({ user_ids: ["requester"] });
    fireEvent.click(screen.getByRole("button", { name: "作用域" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "全局" }));
    expect(await screen.findByLabelText("配置访问权限的策略")).toBeEnabled();
  });

  it("prevents submitting permission requests during impersonation", async () => {
    auth.impersonating = true;
    window.history.replaceState({}, "", "/access?permission=pipelines%3Arun");
    mount(<AccessPage />);
    await screen.findByText("请退出代登录后，以本人身份提交权限申请。");
    expect(screen.queryByRole("button", { name: "提交申请" })).not.toBeInTheDocument();
  });
  it("collapses permission groups and reveals matching policies by name or identifier", async () => {
    auth.permissions = ["access:read", "access:manage"];
    mount(<AccessAdminPage />);
    const search = await screen.findByRole("textbox", { name: "搜索权限策略" });
    expect(screen.getByText("数据平台", { selector: "summary" }).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText("运行流水线的策略")).not.toBeVisible();
    fireEvent.change(search, { target: { value: "pipelines:run" } });
    expect(screen.getByText("数据平台", { selector: "summary" }).closest("details")).toHaveAttribute("open");
    expect(screen.getByRole("combobox", { name: "运行流水线的策略" })).toBeDisabled();
    expect(screen.queryByLabelText("流水线的策略")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /申请用户.*requester/ }));
    expect(screen.getByRole("combobox", { name: "运行流水线的策略" })).toBeEnabled();
    fireEvent.change(search, { target: { value: "不存在的权限" } });
    expect(screen.getByText("没有匹配的权限。")).toBeInTheDocument();
  });

});
