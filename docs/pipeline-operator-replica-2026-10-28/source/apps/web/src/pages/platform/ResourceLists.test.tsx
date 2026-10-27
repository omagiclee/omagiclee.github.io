import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatasetsPage } from "./DatasetPages";
import { AnnotationTasksPage, AnnotationSpecsPage } from "./AnnotationPages";
import { EvaluationExperimentsPage, EvaluationBenchmarksPage } from "./EvaluationPages";
import { FeedbackPage } from "./FeedbackPages";

const context = vi.hoisted(() => ({ search: "", allowed: true, navigate: vi.fn(), write: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { pathname: "/projects/demo/datasets", searchStr: context.search } }),
  useNavigate: () => context.navigate,
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => <a href={to} {...props}>{children}</a>,
}));
vi.mock("@tanstack/react-query", async importOriginal => ({ ...await importOriginal<typeof import("@tanstack/react-query")>(), useQuery: () => ({ data: undefined, error: null, isPending: false }) }));
vi.mock("./platform-store", async importOriginal => ({
  ...await importOriginal<typeof import("./platform-store")>(),
  usePlatform: () => ({
    state: { datasets: [], tasks: [], specs: [], experiments: [], benchmarks: [], feedback: [], users: [], models: [], selections: [], trainingRuns: [], catalogs: {}, page: { total: 0, nextCursor: null, resource: "datasets" } },
    path: (suffix: string) => `/projects/demo/${suffix}`, can: () => context.allowed,
    projectId: "demo", userId: "admin", userName: (id: string) => id, write: context.write,
  }),
}));
afterEach(cleanup);
beforeEach(() => { context.search = ""; context.allowed = true; context.navigate.mockReset(); context.write.mockReset(); });

describe("resource catalog workflows", () => {
  it.each([
    [DatasetsPage, "数据集", "导入数据"],
    [AnnotationTasksPage, "标注任务", "新建任务"],
    [AnnotationSpecsPage, "标注规范", "新建规范"],
    [EvaluationExperimentsPage, "评测实验", "新建实验"],
    [EvaluationBenchmarksPage, "评测基准", "新建基准"],
    [FeedbackPage, "问题反馈", "查看评测实验"],
  ])("gives the %s empty catalog its appropriate next step", (Component, resource, action) => {
    render(<Component />);
    expect(screen.getByRole("heading", { name: `还没有${resource}` })).toBeInTheDocument();
    expect(screen.getAllByRole(resource === "问题反馈" ? "link" : "button", { name: action }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "分页" })).not.toBeInTheDocument();
  });
  it("resets a dataset search without offering to import for a missing search result", () => {
    context.search = "?q=missing&modality=视频&cursor=second&pagingHistory=%5B%22%22%5D&project_id=demo";
    render(<DatasetsPage />);
    expect(screen.getByRole("heading", { name: "没有匹配的结果" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "导入数据" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(context.navigate).toHaveBeenCalledWith({ to: "/projects/demo/datasets", search: { project_id: "demo" }, replace: false });
  });
  it("preserves write permissions for the dataset empty-state action", () => {
    context.allowed = false;
    render(<DatasetsPage />);
    expect(screen.getAllByRole("button", { name: "导入数据" }).every(button => button.hasAttribute("disabled"))).toBe(true);
    expect(context.write).not.toHaveBeenCalled();
  });
  it("opens the existing dataset import workflow from the empty state", () => {
    render(<DatasetsPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "导入数据" })[1]);
    expect(screen.getByRole("dialog", { name: "导入数据" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建数据集" })).toBeInTheDocument();
  });
});

  it.each([
    [DatasetsPage, "按模态筛选", "视频", { modality: "视频" }],
    [AnnotationTasksPage, "任务状态", "待审核", { tab: "待审核", status: "待审核" }],
    [FeedbackPage, "反馈状态", "处理中", { status: "处理中" }],
  ])("preserves URL search and resets pagination through the %s toolbar menu", async (Component, label, choice, changed) => {
    context.search = "?q=keep&cursor=second&pagingHistory=%5B%22%22%5D&project_id=demo";
    render(<Component />);
    expect(screen.queryByRole("combobox", { name: label })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: choice }));
    expect(context.navigate).toHaveBeenCalledWith({ to: "/projects/demo/datasets", search: { q: "keep", project_id: "demo", ...changed }, replace: false });
  });
