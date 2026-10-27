import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { EntitySelect, FormDialog, Select, Pagination, ResourceEmptyState, Status, Table, Tabs } from "./shared";

const route = vi.hoisted(() => ({ search: "", navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { pathname: "/projects/demo/datasets", searchStr: route.search } }),
  useNavigate: () => route.navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
const catalog = vi.hoisted(() => ({ data: { items: [{ id: "one", name: "评测数据集" }], total: 1, nextCursor: null as string | null }, isPending: false, error: null as Error | null }));
vi.mock("./platform-store", () => ({ usePlatform: () => ({ projectId: "demo" }) }));
vi.mock("@tanstack/react-query", async importOriginal => ({ ...await importOriginal<typeof import("@tanstack/react-query")>(), useQuery: (options: { enabled?: boolean }) => options.enabled === false ? { data: undefined, error: null, isPending: false } : catalog }));
afterEach(cleanup);
beforeEach(() => { route.search = ""; route.navigate.mockReset(); catalog.data = { items: [{ id: "one", name: "评测数据集" }], total: 1, nextCursor: null }; catalog.isPending = false; catalog.error = null; });

it("locks the submitted dialog draft until failure restores the same editable values", async () => {
  let finish!: (value: string) => void;
  const save = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  render(<FormDialog open onOpenChange={() => {}} title="登记结果" description="保留当前草稿" onSubmit={save}><label>名称<input name="name" defaultValue="已填写的草稿" /></label></FormDialog>);
  const field = await screen.findByRole("textbox", { name: "名称" });
  const form = screen.getByRole("dialog").querySelector("form")!;
  fireEvent.submit(form);
  expect(field).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
  fireEvent.submit(form); expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finish("写入失败，请重试"));
  await waitFor(() => expect(field).toBeEnabled());
  expect(field).toHaveValue("已填写的草稿");
  expect(screen.getByRole("alert")).toHaveTextContent("写入失败，请重试");
});

describe("platform status semantics", () => {
  it.each([
    ["已完成", "success"],
    ["已验证", "success"],
    ["失败", "destructive"],
    ["执行失败", "destructive"],
    ["逾期", "warning"],
    ["需修订", "warning"],
    ["训练中", "info"],
    ["执行中", "info"],
    ["待验收", "outline"],
    ["草稿", "outline"],
  ])("shows %s with the %s semantic while preserving its label", (label, variant) => {
    render(<Status value={label} />);
    expect(screen.getByText(label)).toHaveAttribute("data-variant", variant);
  });
});

// These components preserve controlled URL state and keyboard navigation together.

describe("platform detail tabs", () => {
  function Detail() {
    const [tab, setTab] = useState("数据");
    return <Tabs tabs={["数据", "版本", "质量"]} active={tab} onChange={setTab} label="数据集详情"><p>{tab}内容</p></Tabs>;
  }
  it("associates the active panel and supports wrapping arrows, Home, and End", () => {
    render(<Detail />);
    const tabs = screen.getAllByRole("tab");
    expect(screen.getByRole("tablist", { name: "数据集详情" })).toBeInTheDocument();
    expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("数据");
    expect(tabs[0]).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(tabs[2]).toHaveFocus();
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("质量");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("质量内容");
    fireEvent.keyDown(tabs[2], { key: "ArrowRight" });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0], { key: "End" });
    expect(tabs[2]).toHaveFocus();
    fireEvent.keyDown(tabs[2], { key: "Home" });
    expect(tabs[0]).toHaveFocus();
    expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1]);
  });
  it("reflects URL-driven changes without taking keyboard focus", () => {
    const change = vi.fn();
    const { rerender } = render(<Tabs tabs={["数据", "版本"]} active="数据" onChange={change} label="详情"><p>数据内容</p></Tabs>);
    rerender(<Tabs tabs={["数据", "版本"]} active="版本" onChange={change} label="详情"><p>版本内容</p></Tabs>);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("版本");
    expect(screen.getByRole("tab", { name: "版本" })).toHaveAttribute("tabindex", "0");
    expect(change).not.toHaveBeenCalled();
  });
});

describe("resource list states", () => {
  it("uses the next task for an empty catalog and reset for an empty search", () => {
    const reset = vi.fn();
    const { rerender } = render(<ResourceEmptyState resource="数据集" description="先导入样本。" action={<button>导入数据</button>} />);
    expect(screen.getByRole("heading", { name: "还没有数据集" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入数据" })).toBeInTheDocument();
    rerender(<ResourceEmptyState resource="数据集" filtered onReset={reset} action={<button>导入数据</button>} />);
    expect(screen.getByRole("heading", { name: "没有匹配的结果" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入数据" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(reset).toHaveBeenCalledOnce();
  });
  it("does not misrepresent a loading failure as a catalog with no resources", () => {
    render(<ResourceEmptyState resource="数据集" error="服务暂时不可用" action={<button>重试</button>} />);
    expect(screen.getByRole("alert")).toHaveTextContent("数据集加载失败");
    expect(screen.getByRole("alert")).toHaveTextContent("服务暂时不可用");
    expect(screen.queryByText("还没有数据集")).not.toBeInTheDocument();
  });
  it("keeps initial loading and query failure distinct from an empty catalog", () => {
    const { rerender } = render(<Table headers={["样本"]} empty loading>{null}</Table>);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载样本");
    expect(screen.queryByText("还没有记录")).not.toBeInTheDocument();
    rerender(<Table headers={["样本"]} empty error="无法访问当前项目">{null}</Table>);
    expect(screen.getByRole("alert")).toHaveTextContent("样本加载失败");
    expect(screen.getByRole("alert")).toHaveTextContent("无法访问当前项目");
    expect(screen.queryByText("还没有记录")).not.toBeInTheDocument();
  });
  it("does not render a wide header-only table when the list is empty", () => {
    const { rerender } = render(<Table headers={["数据集", "样本数"]} empty emptyState={<ResourceEmptyState resource="数据集" />}>{null}</Table>);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    rerender(<Table headers={["数据集", "样本数"]}><tr><td>测试集</td><td>10</td></tr></Table>);
    expect(screen.getByRole("table")).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "数据集列表" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAccessibleDescription("小屏幕按记录展示全部字段");
  });
  it("keeps column labels and interactive content associated in the mobile record layout", () => {
    const select = vi.fn();
    render(<Table headers={["样本", "状态"]}><tr><td><button onClick={select}>待审核样本</button></td><td>待审核</td></tr></Table>);
    expect(screen.getByRole("cell", { name: "待审核样本" })).toHaveAttribute("data-label", "样本");
    expect(screen.getByRole("cell", { name: "待审核" })).toHaveAttribute("data-label", "状态");
    fireEvent.click(screen.getByRole("button", { name: "待审核样本" }));
    expect(select).toHaveBeenCalledOnce();
  });
  it("shows a count without disabled page controls when the catalog fits on one page", () => {
    render(<Pagination page={{ total: 3, nextCursor: null, resource: "datasets" }} />);
    expect(screen.getByText("共 3 项")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上一页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下一页" })).not.toBeInTheDocument();
  });
  it("hides zero-record first-page pagination but preserves a path back from an empty later page", () => {
    const page = { total: 0, nextCursor: null, resource: "datasets" };
    const { rerender } = render(<Pagination page={page} />);
    expect(screen.queryByRole("navigation", { name: "分页" })).not.toBeInTheDocument();
    route.search = "?cursor=second&pagingHistory=%5B%22%22%5D";
    rerender(<Pagination page={page} />);
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(route.navigate).toHaveBeenCalledWith({ to: "/projects/demo/datasets", search: {}, replace: false });
  });
});

describe("paged resource selectors", () => {
  it("keeps selection usable without irrelevant page controls and preserves navigation for paged catalogs", () => {
    const select = vi.fn();
    const { rerender } = render(<EntitySelect resource="datasets" label="输入数据集" value="" onChange={select} />);
    expect(screen.queryByRole("button", { name: "前一页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "后一页" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "输入数据集" }), { target: { value: "one" } });
    expect(select).toHaveBeenCalledWith("one");
    catalog.data.nextCursor = "second";
    rerender(<EntitySelect resource="datasets" label="输入数据集" value="" onChange={select} />);
    fireEvent.click(screen.getByRole("button", { name: "后一页" }));
    expect(screen.getByRole("button", { name: "前一页" })).toBeEnabled();
    catalog.data.nextCursor = null;
    catalog.data.items = [];
    rerender(<EntitySelect resource="datasets" label="输入数据集" value="" onChange={select} />);
    expect(screen.getByRole("button", { name: "前一页" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "前一页" }));
    expect(screen.queryByRole("button", { name: "前一页" })).not.toBeInTheDocument();
  });
  it("distinguishes loading and an empty selector search", () => {
    catalog.isPending = true;
    const { rerender } = render(<EntitySelect resource="datasets" label="输入数据集" value="" onChange={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载输入数据集");
    catalog.isPending = false;
    catalog.data.items = [];
    fireEvent.change(screen.getByRole("textbox", { name: "搜索输入数据集" }), { target: { value: "missing" } });
    rerender(<EntitySelect resource="datasets" label="输入数据集" value="" onChange={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的输入数据集");
    expect(screen.queryByRole("button", { name: "后一页" })).not.toBeInTheDocument();
  });
});

describe("toolbar and form choices", () => {
  it("keeps editing fields native and uses checked menu choices for toolbar switches", async () => {
    const change = vi.fn();
    const options = [{ value: "working", label: "工作副本" }, { value: "v1", label: "v1 · 已发布" }];
    const { rerender } = render(<Select label="数据版本" value="working" onChange={change} options={options} required />);
    expect(screen.getByRole("combobox", { name: "数据版本" })).toBeRequired();
    rerender(<Select toolbar prefix="版本" label="数据版本" value="working" onChange={change} options={options} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "数据版本" }));
    expect(await screen.findByRole("menuitemradio", { name: "工作副本" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "v1 · 已发布" }));
    expect(change).toHaveBeenCalledWith("v1");
  });
  it("retains a selected off-page entity while filtering through a searchable popup", async () => {
    const change = vi.fn();
    render(<EntitySelect compact resource="datasets" label="数据集筛选" value="older" selected={{ id: "older", name: "已有固定数据集" }} onChange={change} required={false} emptyLabel="全部数据集" />);
    fireEvent.click(screen.getByRole("button", { name: "数据集筛选" }));
    expect(await screen.findByRole("textbox", { name: "搜索数据集筛选" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择数据集筛选" }));
    expect(await screen.findByRole("menuitemradio", { name: "已有固定数据集" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "评测数据集" }));
    expect(change).toHaveBeenCalledWith("one");
  });
});
