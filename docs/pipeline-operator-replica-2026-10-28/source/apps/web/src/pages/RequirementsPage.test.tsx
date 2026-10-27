import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Requirement } from "../types";
import RequirementsPage from "./RequirementsPage";

const state = vi.hoisted(() => ({ manage: true, requirements: [] as Requirement[] }));
vi.mock("@tanstack/react-query", () => ({ useSuspenseQuery: () => ({ data: state.requirements }) }));
vi.mock("../auth-context", () => ({ useAuth: () => ({ me: { user: { id: "me" } }, can: (permission: string) => permission === "requirements:create" || state.manage }) }));
vi.mock("../api", () => ({ requirementsQueryOptions: {} }));
vi.mock("../components/RequirementForm", () => ({ RequirementForm: () => <div>需求提报表单</div> }));
vi.mock("../components/PermissionRequestButton", () => ({ PermissionRequestButton: () => <button>申请权限</button> }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children, params, to: _to, ...props }: { children: ReactNode; params: { requirementId: string }; to: string }) => <a href={`/requirements/${params.requirementId}`} {...props}>{children}</a> }));

function requirement(id: string, overrides: Partial<Requirement> = {}): Requirement {
  return { id, requirement_no: `REQ-${id}`, title: `需求 ${id}`, description: "", expected_result: "", acceptance_criteria: "", category: "data", priority: "medium", status: "pending_review", requester_id: "me", requester_name: "本人", owner_id: null, owner_name: null, desired_due_date: null, committed_due_date: null, planned_version: null, delivery_notes: null, acceptance_notes: null, created_at: "2026-01-01", updated_at: "2026-01-01", activities: [], data_spec: null, platform_spec: null, checks: [], delivery: null, prioritization: null, revision: 1, allowed_actions: [], ...overrides };
}

async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: option }));
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
}

describe("requirements workspace", () => {
  beforeEach(() => {
    state.manage = true;
    state.requirements = [requirement("review"), requirement("assigned", { status: "in_progress", requester_id: "other", owner_id: "me", owner_name: "本人" }), requirement("other", { requester_id: "other", status: "completed" })];
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("uses one status filter and retains every lifecycle state and action scope", async () => {
    render(<RequirementsPage />);
    fireEvent.click(screen.getByRole("button", { name: "筛选全部状态" }));
    expect(await screen.findAllByRole("menuitemradio")).toHaveLength(13);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "全部状态" }));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.queryByLabelText("需求状态筛选")).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("需求概览")).queryByRole("button")).not.toBeInTheDocument();
    await choose("筛选全部状态", "待我决策");
    expect(screen.getByRole("link", { name: /需求 review/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /需求 assigned/ })).not.toBeInTheDocument();
    await choose("筛选全部状态", "已完成");
    expect(screen.getByRole("link", { name: /需求 other/ })).toBeInTheDocument();
  });

  it("keeps user scope and clears advanced relation filters with the search", async () => {
    state.manage = false;
    render(<RequirementsPage />);
    expect(screen.queryByRole("button", { name: "管理员视角" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /需求 other/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("更多筛选"));
    await choose("需求与我的关系", "我负责的");
    expect(screen.queryByRole("link", { name: /需求 review/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索需求" }), { target: { value: "不存在" } });
    expect(screen.getByRole("heading", { name: "没有符合条件的需求" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("button", { name: "需求与我的关系" })).toHaveTextContent("与我相关");
    expect(screen.getByRole("link", { name: /需求 review/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /需求 assigned/ })).toBeInTheDocument();
  });

  it("preserves selection across board view and keeps creation available", async () => {
    render(<RequirementsPage />);
    await choose("筛选全部状态", "进行中");
    fireEvent.click(screen.getByRole("button", { name: "看板" }));
    expect(screen.getByRole("button", { name: "看板" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: /执行交付/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /需求 assigned/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /需求 review/ })).not.toBeInTheDocument();
    const create = screen.getByRole("button", { name: "提交需求" });
    const panelId = create.getAttribute("aria-controls")!;
    expect(document.getElementById(panelId)).not.toBeVisible();
    fireEvent.click(create);
    expect(create).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(panelId)).toBeVisible();
    expect(screen.getByText("需求提报表单")).toBeInTheDocument();
    fireEvent.click(create);
    expect(create).toHaveAttribute("aria-expanded", "false");
    expect(create).toHaveAttribute("aria-controls", panelId);
    expect(document.getElementById(panelId)).not.toBeVisible();
  });
  it("offers only compatible task types for each direction and ignores incompatible selections", async () => {
    state.requirements = [requirement("platform", { category: "product" }), requirement("collection", { data_spec: { task_type: "collection", scenario: "街景", modalities: [], quantity: 10, unit: "段", source: "", target_model: "" } })];
    render(<RequirementsPage />);
    fireEvent.click(screen.getByText("更多筛选"));
    await choose("筛选需求模板", "数据采集");
    expect(screen.getByRole("link", { name: /需求 collection/ })).toBeInTheDocument();
    await choose("筛选需求方向", "平台开发");
    const type = screen.getByRole("button", { name: "筛选需求模板" });
    expect(type).toHaveTextContent("全部类型");
    fireEvent.click(type);
    expect(screen.queryByRole("menuitemradio", { name: "数据采集" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "全部类型" }));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: /需求 platform/ })).toBeInTheDocument();
    await choose("筛选需求方向", "数据需求");
    fireEvent.click(type);
    expect(screen.queryByRole("menuitemradio", { name: "平台开发" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "全部类型" }));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: /需求 collection/ })).toBeInTheDocument();
  });

  it("keeps direction filtering discoverable in the compact toolbar and clears it safely", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<RequirementsPage />);
    expect(screen.getByRole("button", { name: "筛选需求方向" }).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText("需求概览")).toHaveAttribute("tabindex", "0");
    fireEvent.click(screen.getByText("更多筛选"));
    await choose("筛选需求方向", "平台开发");
    expect(screen.getByRole("heading", { name: "没有符合条件的需求" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("button", { name: "筛选需求方向" })).toHaveTextContent("全部方向");
    expect(screen.getByRole("link", { name: /需求 review/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "看板" }));
    expect(screen.getByRole("heading", { name: /需求评审/ })).toBeInTheDocument();
  });

});
