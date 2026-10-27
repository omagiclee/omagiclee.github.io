import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser, UserDirectory } from "../admin-api";
import { userDirectoryQueryOptions } from "../admin-api";
import { catalogQueryOptions, type PermissionDefinition } from "../access-api";
import { server } from "../test/server";
import UsersAdminPage from "./UsersAdminPage";

const state = vi.hoisted(() => ({ impersonating: false, permissions: ["users:read", "users:manage", "audit:read"], grid: {} as Record<string, unknown> }));
vi.mock("../auth-context", () => ({ useAuth: () => ({ me: { actor: { id: "self", display_name: "操作者" }, csrf_token: "users-csrf", impersonation: { active: state.impersonating } }, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock("ag-grid-react", () => ({ AgGridReact: (props: { rowData: AdminUser[]; columnDefs: { field: string; valueFormatter?: (event: { value: string[] }) => string }[]; onRowClicked: (event: { data: AdminUser }) => void }) => {
  state.grid = props as unknown as Record<string, unknown>;
  const roles = props.columnDefs.find((column) => column.field === "effective_roles");
  return <div data-testid="user-grid">{props.rowData.map((user) => <div key={user.id}><button onClick={() => props.onRowClicked({ data: user })}>选择 {user.display_name}</button><span>{roles?.valueFormatter?.({ value: user.effective_roles })}</span></div>)}</div>;
} }));

function user(id: string, overrides: Partial<AdminUser> = {}): AdminUser {
  return { id, username: id, display_name: id === "self" ? "操作者" : "项目成员", email: null, is_active: true, is_impersonatable: true, created_at: "2026-01-01", groups: [], effective_roles: ["project_viewer"], effective_permissions: ["menu.workspace:view", "users:read", "users:manage", "custom:future"], bindings: [{ id: `binding-${id}`, role_key: "project_viewer", role_name: "项目观察员", scope_type: "project", scope_id: "demo", inherited: false, source_name: null }], ...overrides };
}
const role = { key: "project_viewer", name: "项目观察员", description: "查看项目数据", permissions: ["users:read"] };
const definitions: PermissionDefinition[] = [{ key: "menu.workspace:view", name: "工作台", kind: "menu", parent_key: null, route: null, requestable: true }, { key: "users:read", name: "用户与角色", kind: "page", parent_key: "menu.workspace:view", route: null, requestable: true }, { key: "users:manage", name: "配置用户角色", kind: "button", parent_key: "users:read", route: null, requestable: true }];

describe("user directory and permissions", () => {
  beforeEach(() => {
    state.impersonating = false; state.permissions = ["users:read", "users:manage", "audit:read"];
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
  function mount(users = [user("self"), user("member")]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData<UserDirectory>(userDirectoryQueryOptions.queryKey, { users, roles: [role], projects: [{ id: "demo", name: "演示项目" }] });
    client.setQueryData(catalogQueryOptions.queryKey, { permissions: definitions, projects: [] });
    render(<QueryClientProvider client={client}><UsersAdminPage /></QueryClientProvider>);
    return client;
  }

  it("finds users by translated role names and preserves unknown role identifiers", () => {
    mount([user("self", { effective_roles: ["platform_admin"] }), user("member")]);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索用户" }), { target: { value: "项目观察员" } });
    expect(screen.getByRole("button", { name: "选择 项目成员" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择 操作者" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "操作者" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择 项目成员" }));
    expect(screen.getByRole("heading", { name: "项目成员" })).toBeInTheDocument();
    expect(state.grid.pagination).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索用户" }), { target: { value: "platform_admin" } });
    expect(screen.getByText("platform_admin")).toBeInTheDocument();
  });

  it("groups named permissions and keeps every permission identifier in expandable details", () => {
    mount();
    const names = screen.getByText("查看全部权限标识").closest("details")!;
    expect(names).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("查看全部权限标识"));
    expect(names).toHaveAttribute("open");
    for (const key of ["menu.workspace:view", "users:read", "users:manage", "custom:future"]) expect(within(names).getByText(key)).toBeInTheDocument();
    expect(screen.getByText("菜单访问")).toBeInTheDocument();
    expect(screen.getByText("页面查看")).toBeInTheDocument();
    expect(screen.getByText("业务操作")).toBeInTheDocument();
    expect(screen.getByText("其他权限")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看此用户的操作记录" })).toHaveAttribute("href", "/admin/audit?days=30&project_id=*&user_id=self");
  });

  it("prevents editing self or users during impersonation", () => {
    mount();
    expect(screen.queryByRole("button", { name: "保存权限" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "角色" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择 项目成员" }));
    expect(screen.getByRole("button", { name: "保存权限" })).toBeInTheDocument();
    cleanup(); state.impersonating = true;
    mount([user("member")]);
    expect(screen.queryByRole("button", { name: "保存权限" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "角色" })).not.toBeInTheDocument();
    expect(screen.getByText(/代登录期间不能修改用户角色/)).toBeInTheDocument();
  });

  it("saves direct role bindings with CSRF protection and paginates larger directories", async () => {
    const users = Array.from({ length: 11 }, (_, index) => user(`member-${index}`));
    const client = mount(users);
    expect(state.grid.pagination).toBe(true);
    expect((state.grid.localeText as Record<string, string>).nextPage).toBe("下一页");
    const save = vi.fn();
    server.use(http.put("http://api.test/api/admin/users/member-0/role-bindings", async ({ request }) => {
      expect(request.headers.get("x-csrf-token")).toBe("users-csrf");
      save(await request.json());
      return HttpResponse.json(users[0]);
    }));
    fireEvent.click(screen.getByRole("button", { name: "保存权限" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ bindings: [{ role_key: "project_viewer", scope_type: "project", scope_id: "demo" }] }));
    expect(await screen.findByRole("status")).toHaveTextContent("权限已保存并写入审计记录");
    client.clear();
  });
  it("retains per-user drafts through search and selection, then saves and resets the correct user", async () => {
    const alpha = user("alpha", { display_name: "成员甲" });
    const beta = user("beta", { display_name: "成员乙" });
    mount([alpha, beta]);
    fireEvent.change(screen.getByRole("combobox", { name: "作用域类型" }), { target: { value: "global" } });
    expect(screen.getByText(/有未保存的角色变更/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索用户" }), { target: { value: "成员乙" } });
    expect(screen.getByRole("heading", { name: "成员甲" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "作用域类型" })).toHaveValue("global");
    fireEvent.click(screen.getByRole("button", { name: "选择 成员乙" }));
    expect(screen.queryByText(/有未保存的角色变更/)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "作用域类型" })).toHaveValue("project");
    fireEvent.change(screen.getByRole("textbox", { name: "搜索用户" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "选择 成员甲" }));
    expect(screen.getByRole("combobox", { name: "作用域类型" })).toHaveValue("global");
    const save = vi.fn();
    server.use(http.put("http://api.test/api/admin/users/alpha/role-bindings", async ({ request }) => {
      expect(request.headers.get("x-csrf-token")).toBe("users-csrf");
      save(await request.json());
      return HttpResponse.json({ ...alpha, bindings: alpha.bindings.map((binding) => ({ ...binding, scope_type: "global", scope_id: "*" })) });
    }));
    fireEvent.click(screen.getByRole("button", { name: "保存权限" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ bindings: [{ role_key: "project_viewer", scope_type: "global", scope_id: "*" }] }));
    expect(await screen.findByText("权限已保存并写入审计记录。")).toBeInTheDocument();
    expect(screen.queryByText(/有未保存的角色变更/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择 成员乙" }));
    expect(screen.queryByText("权限已保存并写入审计记录。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择 成员甲" }));
    expect(screen.getByRole("combobox", { name: "作用域类型" })).toHaveValue("global");
    fireEvent.change(screen.getByRole("combobox", { name: "作用域类型" }), { target: { value: "project" } });
    fireEvent.click(screen.getByRole("button", { name: "重置变更" }));
    expect(screen.getByRole("combobox", { name: "作用域类型" })).toHaveValue("global");
    expect(screen.queryByText(/有未保存的角色变更/)).not.toBeInTheDocument();
  });

});
