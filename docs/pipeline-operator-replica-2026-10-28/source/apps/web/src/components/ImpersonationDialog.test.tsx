import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImpersonationDialog } from "./ImpersonationDialog";
import { startImpersonation } from "../auth-api";

vi.mock("../auth-context", () => ({ useAuth: () => ({ me: { csrf_token: "test-token" } }) }));
vi.mock("../telemetry", () => ({ interactionForEvent: () => undefined }));
vi.mock("../auth-api", () => ({
  loadImpersonationTargets: async () => [
    { id: "alice", display_name: "张敏", username: "Alice.Zhang", roles: ["需求提交人"], groups: ["视频运营", "产品团队"] },
    { id: "bob", display_name: "李明", username: "bob.li", roles: ["开发人员"], groups: ["平台研发"] },
  ],
  startImpersonation: vi.fn(),
}));
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><ImpersonationDialog open onOpenChange={() => undefined} /></QueryClientProvider>);
}
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });
beforeEach(() => { vi.mocked(startImpersonation).mockReset(); });

describe("impersonation target search", () => {
  it("finds accounts by display name, case-insensitive username and group", async () => {
    mount();
    await screen.findByRole("radio", { name: /张敏/ });
    const search = screen.getByRole("textbox", { name: "搜索代登录用户" });
    for (const query of ["张敏", "  ALICE.ZHANG  ", "视频运营"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getByRole("radio", { name: /张敏/ })).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: /李明/ })).not.toBeInTheDocument();
    }
    expect(screen.getByText("用户组：视频运营、产品团队")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByRole("radio", { name: /李明/ })).toBeInTheDocument();
  });

  it("shows an empty result and preserves the visibly selected account, reason and duration", async () => {
    mount();
    fireEvent.click(await screen.findByRole("radio", { name: /张敏/ }));
    const reason = screen.getByRole("textbox", { name: /代登录原因/ });
    const duration = screen.getByRole("combobox", { name: /有效时长/ });
    fireEvent.change(reason, { target: { value: "协助用户排查项目数据无法查看问题" } });
    fireEvent.change(duration, { target: { value: "5" } });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索代登录用户" }), { target: { value: "不存在的账号" } });
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的用户");
    expect(screen.getByText("已选择：张敏（Alice.Zhang）")).toBeInTheDocument();
    expect(reason).toHaveValue("协助用户排查项目数据无法查看问题");
    expect(duration).toHaveValue("5");
    expect(screen.getByRole("button", { name: "确认进入" })).toBeEnabled();
  });

  it("explains the missing reason and focuses it when a selected user is submitted", async () => {
    mount();
    fireEvent.click(await screen.findByRole("radio", { name: /张敏/ }));
    const confirm = screen.getByRole("button", { name: "确认进入" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(screen.getByRole("alert")).toHaveTextContent("请填写至少 10 个字符的代登录原因");
    const reason = screen.getByRole("textbox", { name: "代登录原因" });
    expect(reason).toHaveFocus();
    expect(reason).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(reason, { target: { value: "    排查    " } });
    fireEvent.click(confirm);
    expect(startImpersonation).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeVisible();
  });

  it("asks for a target account instead of silently disabling submission", async () => {
    mount();
    await screen.findByRole("radio", { name: /张敏/ });
    fireEvent.click(screen.getByRole("button", { name: "权限排查" }));
    fireEvent.click(screen.getByRole("button", { name: "确认进入" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请选择要进入的用户账号");
    expect(screen.getAllByRole("radio")[0]).toHaveFocus();
    expect(screen.getByRole("radiogroup", { name: "选择目标用户" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "搜索代登录用户" })).not.toHaveAttribute("aria-invalid", "true");
    expect(startImpersonation).not.toHaveBeenCalled();
  });

  it("submits a chosen reason, displays progress and allows retry after an API error", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(startImpersonation).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    mount();
    fireEvent.click(await screen.findByRole("radio", { name: /张敏/ }));
    fireEvent.click(screen.getByRole("button", { name: "权限排查" }));
    fireEvent.change(screen.getByRole("combobox", { name: /有效时长/ }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "确认进入" }));
    await waitFor(() => expect(startImpersonation).toHaveBeenCalledWith({
      target_user_id: "alice", reason: "排查该用户的页面访问和按钮权限", duration_minutes: 5,
    }, "test-token", undefined));
    const pending = await screen.findByRole("button", { name: "正在切换…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(startImpersonation).toHaveBeenCalledTimes(1);
    fail(new Error("代登录授权已变更，请刷新后重试"));
    expect(await screen.findByRole("alert")).toHaveTextContent("代登录授权已变更，请刷新后重试");
    expect(screen.getByRole("button", { name: "确认进入" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "代登录原因" })).toHaveValue("排查该用户的页面访问和按钮权限");
  });
});
