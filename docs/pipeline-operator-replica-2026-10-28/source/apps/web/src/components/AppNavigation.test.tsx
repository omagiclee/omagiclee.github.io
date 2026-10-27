import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileNavigation, NavigationItems, isNavigationActive, navigationContext, navigationSearch } from "./AppNavigation";

const state = vi.hoisted(() => ({ permissions: ["pipelines:read", "media:read", "requirements:read", "data_platform:read"], projectPermissions: null as string[] | null }));
vi.mock("../auth-context", () => ({
  useAuth: () => ({ can: (permission: string) => state.permissions.includes(permission) }),
  useProjectAuth: () => ({ can: (permission: string) => (state.projectPermissions ?? state.permissions).includes(permission) }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, search, children, ...props }: { to: string; search?: Record<string, string>; children: React.ReactNode }) =>
    <a href={`${to}${search && Object.keys(search).length ? `?${new URLSearchParams(search)}` : ""}`} {...props}>{children}</a>,
}));

let resize: (() => void) | undefined;
let desktop = false;
beforeEach(() => {
  desktop = false;
  state.permissions = ["pipelines:read", "media:read", "requirements:read", "data_platform:read"];
  state.projectPermissions = null;
  vi.stubGlobal("matchMedia", () => ({ get matches() { return desktop; }, addEventListener: (_: string, callback: () => void) => { resize = callback; }, removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("grouped navigation and project scope", () => {
  it("keeps deep-link project scope across pipeline, operator, exploration and access navigation without carrying object IDs", () => {
    const context = navigationContext("/pipelines", "?project_id=linked&pipelineId=secret&runId=run", { type: "project", id: "default" });
    expect(context).toEqual({ label: "当前项目", value: "linked", projectId: "linked" });
    expect(navigationContext("/operators", "?project_id=linked", { type: "project", id: "changed-default" })).toEqual(context);
    expect(navigationSearch("/operators", context.projectId)).toEqual({ project_id: "linked" });
    expect(navigationSearch("/media", context.projectId)).toEqual({ project_id: "linked" });
    expect(navigationSearch("/access", context.projectId)).toEqual({ project_id: "linked" });
    expect(navigationContext("/media", "?project_id=linked", { type: "project", id: "default" }).value).toBe("linked");
    expect(navigationContext("/pipelines", "?project_id=*", { type: "project", id: "default" }).projectId).toBe("default");
    expect(navigationContext("/analytics", "?project_id=*", { type: "global", id: "*" }).projectId).toBeUndefined();
  });

  it("shows permitted task groups, a standalone operator link, exact active state and existing telemetry IDs", () => {
    render(<nav aria-label="测试导航"><NavigationItems pathname="/operators" projectId="linked" /></nav>);
    const development = screen.getByRole("region", { name: "数据开发" });
    const link = within(development).getByRole("link", { name: "算子与插件" });
    expect(link).toHaveAttribute("href", "/projects/linked/operators");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveAttribute("data-track-id", "nav.operators");
    expect(screen.getByRole("link", { name: "数据流水线" })).toHaveAttribute("data-track-id", "nav.pipelines");
    expect(screen.getByRole("link", { name: "视频训练平台" })).toHaveAttribute("href", "/projects/linked/training");
    fireEvent.click(screen.getByRole("button", { name: "数据管理" }));
    expect(screen.getByRole("link", { name: "数据探索" })).toHaveAttribute("href", "/projects/linked/explore");
    expect(screen.getByRole("link", { name: "数据集" })).toHaveAttribute("href", "/projects/linked/datasets");
    expect(screen.getByRole("link", { name: "影像 AutoGT" })).toHaveAttribute("href", "/projects/linked/auto-gt");
    expect(screen.queryByRole("link", { name: "用户与角色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "系统管理" })).not.toBeInTheDocument();
    expect(isNavigationActive("/requirements/id", "/requirements")).toBe(true);
    expect(isNavigationActive("/requirements-other", "/requirements")).toBe(false);
  });

  it("removes both development links when pipeline permission is absent", () => {
    state.permissions = ["media:read"];
    render(<NavigationItems pathname="/operators" projectId="linked" />);
    expect(screen.queryByRole("region", { name: "数据开发" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "算子与插件" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "数据管理" }));
    expect(screen.getByRole("link", { name: "数据探索" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "影像 AutoGT" })).not.toBeInTheDocument();
  });

  it("uses target project permissions for project links while keeping session-only pages scoped to the session", () => {
    state.permissions = ["requirements:read"];
    state.projectPermissions = ["pipelines:read", "media:read"];
    render(<NavigationItems pathname="/operators" projectId="other" />);
    expect(screen.getByRole("link", { name: "算子与插件" })).toHaveAttribute("href", "/projects/other/operators");
    expect(screen.queryByRole("button", { name: "工作台" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "需求管理" })).toHaveAttribute("href", "/requirements");
  });
});

describe("mobile drawer keyboard and focus behavior", () => {
  it("exposes the optional project switcher within the mobile navigation", async () => {
    render(<MobileNavigation pathname="/pipelines" search="" projectId="linked" projectSwitcher={<select aria-label="切换项目"><option>研发项目</option></select>} />);
    expect(screen.queryByRole("combobox", { name: "切换项目" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开主导航" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "切换项目" })).toBeInTheDocument();
  });
  it("keeps the drawer open when initial project discovery or filter normalization completes", async () => {
    const view = render(<MobileNavigation pathname="/" search="" />);
    fireEvent.click(screen.getByRole("button", { name: "打开主导航" }));
    await screen.findByRole("dialog");
    view.rerender(<MobileNavigation pathname="/" search="?project_id=linked&days=7" projectId="linked" insightProjectId="linked" />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("opens a labelled modal, focuses inside and returns focus to the trigger on Escape", async () => {
    render(<MobileNavigation pathname="/pipelines" search="?project_id=linked" projectId="linked" />);
    const trigger = screen.getByRole("button", { name: "打开主导航" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Data Flywheel" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(within(dialog).getByRole("link", { name: "数据流水线" })).toHaveAttribute("aria-current", "page");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes after selecting a destination and focuses the page content", async () => {
    render(<><MobileNavigation pathname="/pipelines" search="" projectId="linked" /><div id="main-content" tabIndex={-1}>内容</div></>);
    fireEvent.click(screen.getByRole("button", { name: "打开主导航" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("link", { name: "算子与插件" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(document.getElementById("main-content")).toHaveFocus());
  });

  it("releases the modal when moving to desktop or changing the route", async () => {
    const view = render(<MobileNavigation pathname="/pipelines" search="" />);
    fireEvent.click(screen.getByRole("button", { name: "打开主导航" }));
    await screen.findByRole("dialog");
    desktop = true;
    fireEvent(window, new Event("resize"));
    resize?.();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    desktop = false;
    fireEvent.click(screen.getByRole("button", { name: "打开主导航" }));
    await screen.findByRole("dialog");
    view.rerender(<MobileNavigation pathname="/operators" search="?project_id=other" />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
