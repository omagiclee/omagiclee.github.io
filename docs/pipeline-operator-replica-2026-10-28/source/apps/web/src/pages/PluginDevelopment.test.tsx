import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginRelease, PluginReleaseManifest, PluginValidation } from "../plugin-releases-api";
import { server } from "../test/server";
import OperatorsPage from "./OperatorsPage";

const access = vi.hoisted(() => ({ denied: [] as string[], defaultDenied: [] as string[], projects: [] as string[] }));
vi.mock("../auth-context", () => ({
  useAuth: () => ({ me: { user: { id: "plugin-developer" }, scope: { type: "project", id: "default-project" }, csrf_token: "plugin-csrf" }, can: (permission: string) => !access.defaultDenied.includes(permission) }),
  useProjectAuth: (projectId: string) => { access.projects.push(projectId); return { me: { user: { id: "plugin-developer" }, scope: { type: "project", id: projectId }, csrf_token: "plugin-csrf" }, can: (permission: string) => !access.denied.includes(permission) }; },
}));
const manifest: PluginReleaseManifest = { id: "company.video", name: "镜头筛选插件", description: "MSW 契约测试，不执行 wheel", version: "1.0.0", sdk_version: "1", operators: [{ id: "company.duration", name: "时长筛选", description: "过滤镜头", version: "1.0.0", kind: "transform", input_type: "shot_assets", output_type: "shot_assets", config_schema: { type: "object", properties: {} }, default_config: {}, deterministic: true, side_effects: false }] };
const cases = [{ name: "keeps-shot", operator_id: "company.duration", config: {}, input: { type: "shot_assets", records: [] }, expected: { type: "shot_assets", records: [] } }];
const fixture = (): PluginRelease => ({ id: "release-one", project_id: "linked-project", plugin_id: manifest.id, version: manifest.version, wheel_filename: "company_video-1.0.0-py3-none-any.whl", wheel_sha256: "a".repeat(64), manifest, test_cases: cases, status: "candidate", validation_id: null, validation_status: null, runtime_digest: null, deployment_state: "not_ready", active: false, created_at: "2026-09-10T00:00:00Z", published_at: null });
function releasePage(items: PluginRelease[], request: Request) {
  const params = new URL(request.url).searchParams;
  expect(params.get("paginated")).toBe("true");
  const q = params.get("q")?.toLowerCase() ?? "";
  const status = params.get("status");
  const pluginId = params.get("plugin_id");
  const matching = items.filter((item) => (!pluginId || item.plugin_id === pluginId) && (!status || item.status === status) && `${item.plugin_id} ${item.version}`.toLowerCase().includes(q));
  const offset = Number(params.get("offset") ?? 0); const limit = Number(params.get("limit") ?? 20);
  return { items: matching.slice(offset, offset + limit), total: matching.length, offset, limit, has_more: offset + limit < matching.length };
}
async function mount(initial = "/operators?project_id=linked-project&view=development&releaseId=release-one") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const operators = createRoute({ getParentRoute: () => root, path: "/operators", validateSearch: (search: Record<string, unknown>) => search, component: OperatorsPage });
  const pipelines = createRoute({ getParentRoute: () => root, path: "/pipelines", component: () => <h1>流水线测试页面</h1> });
  const router = createRouter({ routeTree: root.addChildren([operators, pipelines]), history: createMemoryHistory({ initialEntries: [initial] }) });
  await act(async () => { await router.load(); });
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router, unmount: () => { view.unmount(); client.clear(); } };
}

describe("plugin lifecycle UI contracts using MSW only, no uploaded code execution", () => {
  let release: PluginRelease;
  let validations: PluginValidation[];
  const requests: { path: string; project: string | null }[] = [];
  beforeEach(() => {
    const draftStorage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => draftStorage.get(key) ?? null, setItem: (key: string, value: string) => draftStorage.set(key, value), removeItem: (key: string) => draftStorage.delete(key), clear: () => draftStorage.clear() });
    release = fixture(); validations = []; requests.length = 0; access.denied = []; access.defaultDenied = []; access.projects = [];
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test"); vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const record = (request: Request) => { const url = new URL(request.url); requests.push({ path: url.pathname, project: url.searchParams.get("project_id") }); };
    server.use(
      http.get("http://api.test/api/plugin-releases", ({ request }) => { record(request); return HttpResponse.json(releasePage([release], request)); }),
      http.get("http://api.test/api/plugin-releases/:id", ({ request }) => { record(request); return HttpResponse.json(release); }),
      http.get("http://api.test/api/plugin-releases/:id/validations", ({ request }) => { record(request); return HttpResponse.json(validations); }),
      http.get("http://api.test/api/operators", () => HttpResponse.json([])),
      http.get("http://api.test/api/operator-plugins", () => HttpResponse.json([])),
    );
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("restores the selected candidate and scopes every persisted lifecycle read to its project", async () => {
    const view = await mount();
    const detail = await screen.findByRole("region", { name: "插件版本详情" });
    expect(within(detail).getByRole("button", { name: "正式发布" })).toBeDisabled();
    expect(within(detail).getByRole("button", { name: "启用到项目" })).toBeDisabled();
    fireEvent.click(within(detail).getByText("插件声明 · 1 个算子"));
    expect(within(detail).getByText(/"id": "company.duration"/)).toBeInTheDocument();
    expect(requests.length).toBeGreaterThanOrEqual(3);
    expect(requests.every((item) => item.project === "linked-project")).toBe(true);
    const href = view.router.state.location.href; view.unmount();
    const refreshed = await mount(href);
    expect(await screen.findByRole("region", { name: "插件版本详情" })).toBeInTheDocument();
    expect(refreshed.router.state.location.search).toMatchObject({ view: "development", releaseId: "release-one", project_id: "linked-project" });
    refreshed.unmount();
  });

  it("uploads a wheel, imported manifest and tests as a candidate, without validation or activation side effects", async () => {
    let uploads = 0; let payload: unknown;
    server.use(http.post("http://api.test/api/plugin-releases", async ({ request }) => { uploads++; expect(request.headers.get("x-csrf-token")).toBe("plugin-csrf"); expect(new URL(request.url).searchParams.get("project_id")).toBe("linked-project"); payload = await request.json(); return HttpResponse.json(release, { status: 201 }); }));
    const view = await mount("/operators?view=development&project_id=linked-project");
    fireEvent.click(await screen.findByRole("button", { name: "新建插件版本" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Python wheel · 最大 8 MiB"), { target: { files: [new File(["wheel fixture bytes"], release.wheel_filename)] } });
    fireEvent.change(within(dialog).getByLabelText("导入 manifest.json"), { target: { files: [new File([JSON.stringify(manifest)], "manifest.json", { type: "application/json" })] } });
    await waitFor(() => expect(within(dialog).getByLabelText("插件 ID")).toHaveValue(manifest.id));
    fireEvent.change(within(dialog).getByLabelText("导入 test_cases.json"), { target: { files: [new File([JSON.stringify(cases)], "test_cases.json", { type: "application/json" })] } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "上传候选版本" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "上传候选版本" }));
    await screen.findByRole("region", { name: "插件版本详情" });
    expect(uploads).toBe(1); expect(payload).toEqual({ wheel_filename: release.wheel_filename, wheel_base64: btoa("wheel fixture bytes"), manifest, test_cases: cases });
    expect(view.router.state.location.search).toHaveProperty("releaseId", release.id);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); view.unmount();
  });

  it("rejects invalid test JSON and oversized wheels before making an upload request", async () => {
    let uploads = 0;
    server.use(http.post("http://api.test/api/plugin-releases", () => { uploads++; return HttpResponse.json(release); }));
    const view = await mount("/operators?view=development&project_id=linked-project");
    fireEvent.click(await screen.findByRole("button", { name: "新建插件版本" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("导入 manifest.json"), { target: { files: [new File([JSON.stringify(manifest)], "manifest.json")] } });
    await waitFor(() => expect(within(dialog).getByLabelText("插件 ID")).toHaveValue(manifest.id));
    fireEvent.change(within(dialog).getByLabelText("Python wheel · 最大 8 MiB"), { target: { files: [new File(["fixture"], release.wheel_filename)] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "上传候选版本" }));
    await within(dialog).findByText("测试样例必须是至少包含一项的 JSON 数组。");
    const oversized = new File(["fixture"], release.wheel_filename); Object.defineProperty(oversized, "size", { value: 9 * 1024 * 1024 });
    fireEvent.change(within(dialog).getByLabelText("Python wheel · 最大 8 MiB"), { target: { files: [oversized] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "上传候选版本" }));
    await within(dialog).findByText("wheel 文件不能超过 8 MiB。");
    expect(uploads).toBe(0); view.unmount();
  });

  it("surfaces a failed template download rather than delivering a fabricated archive", async () => {
    let downloads = 0;
    server.use(http.get("http://api.test/api/plugin-releases/template", ({ request }) => { downloads++; expect(new URL(request.url).searchParams.get("project_id")).toBe("linked-project"); return HttpResponse.json({ detail: "template unavailable" }, { status: 503 }); }));
    const view = await mount("/operators?view=development&project_id=linked-project");
    fireEvent.click(await screen.findByRole("button", { name: "下载开发模板" }));
    await screen.findByText("开发模板下载失败（503）"); expect(downloads).toBe(1); view.unmount();
  });

  it("uses recorded validation results to unlock publishing and enables only the ready published release", async () => {
    const actions: string[] = [];
    server.use(
      http.post("http://api.test/api/plugin-releases/release-one/validations", ({ request }) => { expect(request.headers.get("x-csrf-token")).toBe("plugin-csrf"); actions.push("validate"); const validation: PluginValidation = { id: "validation-one", release_id: release.id, status: "passed", report: { tests_passed: 1, logs: "fixture validation log" }, error: null, created_at: "2026-09-10T00:01:00Z", started_at: null, finished_at: null }; validations = [validation]; release = { ...release, validation_id: validation.id, validation_status: "passed", status: "validated", runtime_digest: "sha256:fixture-runtime", deployment_state: "ready" }; return HttpResponse.json(validation, { status: 202 }); }),
      http.post("http://api.test/api/plugin-releases/release-one/publish", () => { actions.push("publish"); release = { ...release, status: "published", published_at: "2026-09-10T00:02:00Z" }; return HttpResponse.json(release); }),
      http.post("http://api.test/api/plugin-releases/release-one/activate", () => { actions.push("activate"); release = { ...release, active: true }; return HttpResponse.json(release); }),
    );
    const view = await mount();
    fireEvent.click(await screen.findByRole("button", { name: "运行验证" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "正式发布" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "启用到项目" })).toBeDisabled();
    fireEvent.click(screen.getByText("验证日志")); expect(screen.getByText("fixture validation log")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "正式发布" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "启用到项目" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "启用到项目" }));
    expect(await screen.findByRole("button", { name: "项目已启用" })).toBeDisabled();
    expect(actions).toEqual(["validate", "publish", "activate"]); view.unmount();
  });

  it("shows an execution error and blocked report after validation instead of claiming success", async () => {
    server.use(http.post("http://api.test/api/plugin-releases/release-one/validations", () => { release = { ...release, status: "validation_failed", validation_id: "blocked-one", validation_status: "blocked" }; validations = [{ id: "blocked-one", release_id: release.id, status: "blocked", error: "隔离验证环境未启动", report: { logs: "runner unavailable" }, created_at: release.created_at, started_at: null, finished_at: null }]; return HttpResponse.json(validations[0], { status: 202 }); }));
    const view = await mount(); fireEvent.click(await screen.findByRole("button", { name: "运行验证" }));
    await screen.findByText("隔离验证环境未启动");
    expect(screen.getByRole("button", { name: "正式发布" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "启用到项目" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新验证" })).toBeEnabled(); view.unmount();
  });

  it("keeps permission explanations and blocks published-but-unready activation in the project library", async () => {
    access.denied = ["operators:publish", "operators:develop"];
    release = { ...release, status: "validated", validation_status: "passed" };
    const view = await mount();
    expect(await screen.findByRole("button", { name: "正式发布" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "申请正式发布权限" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建插件版本" })).toBeDisabled();
    release = { ...release, status: "published" };
    fireEvent.click(screen.getByRole("tab", { name: "算子库" }));
    fireEvent.click(await screen.findByRole("button", { name: "启用插件" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("执行环境未就绪");
    expect(within(dialog).getByRole("button", { name: "启用到项目" })).toBeDisabled(); view.unmount();
  });

  it("reports API rejection, does not mark a release published and avoids duplicate action clicks", async () => {
    release = { ...release, status: "validated", validation_status: "passed" };
    let submissions = 0; let resolve!: () => void; const gate = new Promise<void>((done) => { resolve = done; });
    server.use(http.post("http://api.test/api/plugin-releases/release-one/publish", async () => { submissions++; await gate; return HttpResponse.json({ detail: "验证摘要与制品不一致" }, { status: 409 }); }));
    const view = await mount(); const button = await screen.findByRole("button", { name: "正式发布" });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(submissions).toBe(1)); resolve();
    await screen.findByText("验证摘要与制品不一致");
    expect(screen.getByRole("button", { name: "启用到项目" })).toBeDisabled(); expect(release.status).toBe("validated"); view.unmount();
  });

  it("checks the URL project's permissions instead of blocking on the default project", async () => {
    access.defaultDenied = ["pipelines:read", "operators:develop"];
    const view = await mount();
    expect(await screen.findByRole("region", { name: "插件版本详情" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "新建插件版本" })).toBeEnabled();
    expect(access.projects.length).toBeGreaterThan(0);
    expect(access.projects.every((project) => project === "linked-project")).toBe(true);
    view.unmount();
  });

  it("keeps the current project in permission request links", async () => {
    access.denied = ["operators:develop"];
    const view = await mount();
    const request = await screen.findByRole("link", { name: "申请开发权限" });
    expect(new URL(request.getAttribute("href")!, "http://localhost").searchParams.get("project_id")).toBe("linked-project");
    view.unmount();
  });

  it("confirms closing a dirty candidate and retains its files and edits when reopened", async () => {
    let payload: unknown;
    server.use(http.post("http://api.test/api/plugin-releases", async ({ request }) => { payload = await request.json(); return HttpResponse.json(release, { status: 201 }); }));
    const view = await mount("/operators?view=development&project_id=linked-project");
    fireEvent.click(await screen.findByRole("button", { name: "新建插件版本" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Python wheel · 最大 8 MiB"), { target: { files: [new File(["retained wheel"], release.wheel_filename)] } });
    fireEvent.change(within(dialog).getByLabelText("导入 manifest.json"), { target: { files: [new File([JSON.stringify(manifest)], "manifest.json")] } });
    await waitFor(() => expect(within(dialog).getByLabelText("插件 ID")).toHaveValue(manifest.id));
    fireEvent.change(within(dialog).getByLabelText(/^测试样例 · test_cases JSON/), { target: { value: JSON.stringify(cases) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭新建插件版本" }));
    const confirmation = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "保留并关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "继续编辑草稿" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("插件 ID")).toHaveValue(manifest.id);
    expect(within(dialog).getByLabelText(/^测试样例 · test_cases JSON/)).toHaveValue(JSON.stringify(cases));
    fireEvent.click(within(dialog).getByRole("button", { name: "上传候选版本" }));
    await screen.findByRole("region", { name: "插件版本详情" });
    expect(payload).toEqual({ wheel_filename: release.wheel_filename, wheel_base64: btoa("retained wheel"), manifest, test_cases: cases });
    expect(await screen.findByRole("button", { name: "新建插件版本" })).toBeEnabled();
    view.unmount();
  });

  it("guards Escape, keeps editing by default, and clears a draft only after explicit discard", async () => {
    const view = await mount("/operators?view=development&project_id=linked-project");
    fireEvent.click(await screen.findByRole("button", { name: "新建插件版本" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("插件名称"), { target: { value: "未提交草稿" } });
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    let confirmation = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "继续编辑" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(within(dialog).getByLabelText("插件名称")).toHaveValue("未提交草稿");
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭新建插件版本" }));
    confirmation = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "放弃草稿" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "新建插件版本" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("插件名称")).toHaveValue("");
    view.unmount();
  });

  it("groups releases by plugin and exposes the selected version without duplicating plugin names", async () => {
    const second = { ...release, id: "release-two", version: "1.1.0", manifest: { ...manifest, version: "1.1.0" }, status: "published" as const, active: true };
    server.use(http.get("http://api.test/api/plugin-releases", ({ request }) => HttpResponse.json(releasePage([second, release], request))));
    const view = await mount();
    const group = await screen.findByRole("region", { name: "镜头筛选插件的版本" });
    expect(within(group).getByRole("button", { name: "查看全部版本" })).toBeInTheDocument();
    expect(within(group).getByRole("link", { name: /v1.0.0/ })).toHaveAttribute("aria-current", "page");
    expect(within(group).getByRole("link", { name: /v1.1.0/ })).not.toHaveAttribute("aria-current");
    view.unmount();
  });

  it("shows a failed case summary and expected versus actual results before raw report details", async () => {
    release = { ...release, status: "validation_failed", validation_id: "failed-one", validation_status: "failed" };
    validations = [{ id: "failed-one", release_id: release.id, status: "failed", error: null, report: { checks: [{ name: "wheel_contract", passed: true }, { name: "keeps-shot", operator_id: "company.duration", passed: false, output: { type: "shot_assets", records: [{ id: "unexpected" }] }, message: "Output does not match expected result" }], logs: "failure details" }, created_at: release.created_at, started_at: null, finished_at: null }];
    const view = await mount();
    const summary = await screen.findByLabelText("验证结果统计");
    expect(within(summary).getByText("1 项通过")).toBeVisible();
    expect(within(summary).getByText("1 项失败")).toBeVisible();
    expect(screen.getByRole("list", { name: "逐项验证结果" })).toBeVisible();
    expect(screen.getByText("keeps-shot", { selector: "strong" })).toBeVisible();
    fireEvent.click(screen.getByText("查看预期与实际结果"));
    expect(screen.getByRole("heading", { name: "预期结果" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "实际结果" })).toBeVisible();
    expect(screen.getByText("原始验证报告 · JSON").closest("details")).not.toHaveAttribute("open");
    view.unmount();
  });

  it("keeps incomplete report entries readable without treating a string result as passed", async () => {
    validations = [{ id: "incomplete-report", release_id: release.id, status: "blocked", error: null, report: { checks: [null, { name: "incomplete check", passed: "true", message: { unexpected: "object" }, operator_id: {} }] }, created_at: release.created_at, started_at: null, finished_at: null }];
    const view = await mount();
    const summary = await screen.findByLabelText("验证结果统计");
    expect(within(summary).getByText("0 项通过")).toBeVisible();
    expect(within(summary).getByText("1 项结果未提供")).toBeVisible();
    expect(screen.getByText("incomplete check", { selector: "strong" })).toBeVisible();
    view.unmount();
  });

  it("pages through server results and searches older releases while retaining the selected detail", async () => {
    const old = { ...fixture(), id: "legacy-release", plugin_id: "company.legacy", version: "0.9.0", manifest: { ...manifest, id: "company.legacy", name: "旧插件", version: "0.9.0" } };
    const all = [release, ...Array.from({ length: 24 }, (_, index) => ({ ...fixture(), id: `release-${index}`, version: `1.0.${index + 1}` })), old];
    const observed: { q: string; offset: string }[] = [];
    server.use(http.get("http://api.test/api/plugin-releases", ({ request }) => { const params = new URL(request.url).searchParams; observed.push({ q: params.get("q") ?? "", offset: params.get("offset") ?? "" }); return HttpResponse.json(releasePage(all, request)); }));
    const view = await mount();
    await screen.findByRole("region", { name: "插件版本详情" });
    const pager = screen.getByRole("navigation", { name: "开发版本分页" });
    await within(pager).findByText("第 1–20 条，共 26 个版本");
    fireEvent.click(within(pager).getByRole("button", { name: "下一页" }));
    await within(pager).findByText("第 21–26 条，共 26 个版本");
    expect(within(pager).getByRole("button", { name: "下一页" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "插件版本详情" })).toBeVisible();
    expect(view.router.state.location.search).toHaveProperty("releaseId", "release-one");
    expect(screen.getByText("所选版本不在本页，详情仍保留。")).toBeVisible();
    const list = screen.getByRole("complementary", { name: "插件版本列表" });
    fireEvent.change(within(list).getByRole("textbox", { name: "搜索插件版本" }), { target: { value: "company.legacy" } });
    fireEvent.click(within(list).getByRole("button", { name: "搜索" }));
    await within(pager).findByText("第 1–1 条，共 1 个版本");
    expect(await screen.findByRole("region", { name: "旧插件的版本" })).toBeVisible();
    expect(observed).toContainEqual({ q: "company.legacy", offset: "0" });
    expect(screen.getByRole("region", { name: "插件版本详情" })).toBeVisible();
    expect(view.router.state.location.search).toHaveProperty("releaseId", "release-one");
    view.unmount();
  });

  it("requests published releases on each activation page and allows server-side version search", async () => {
    const published = Array.from({ length: 21 }, (_, index) => ({ ...fixture(), id: `published-${index}`, version: `2.0.${index}`, manifest: { ...manifest, version: `2.0.${index}` }, status: "published" as const }));
    const requests: URLSearchParams[] = [];
    server.use(http.get("http://api.test/api/plugin-releases", ({ request }) => { requests.push(new URL(request.url).searchParams); return HttpResponse.json(releasePage([release, ...published], request)); }));
    const view = await mount("/operators?project_id=linked-project");
    fireEvent.click(await screen.findByRole("button", { name: "启用插件" }));
    const dialog = await screen.findByRole("dialog");
    const pager = within(dialog).getByRole("navigation", { name: "发布版本分页" });
    await within(pager).findByText("第 1–20 条，共 21 个版本");
    fireEvent.click(within(pager).getByRole("button", { name: "下一页" }));
    await within(dialog).findByRole("heading", { name: "镜头筛选插件 · 2.0.20" });
    expect(within(pager).getByRole("button", { name: "下一页" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "搜索已发布插件版本" }), { target: { value: "2.0.19" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "搜索" }));
    await within(dialog).findByRole("heading", { name: "镜头筛选插件 · 2.0.19" });
    expect(requests.every((params) => params.get("status") === "published")).toBe(true);
    expect(requests.some((params) => params.get("q") === "2.0.19" && params.get("offset") === "0")).toBe(true);
    view.unmount();
  });

  it("restores text after leaving the site route and after remount, and requires choosing the wheel again", async () => {
    const view = await mount("/operators?view=development&project_id=linked-project");
    fireEvent.click(await screen.findByRole("button", { name: "新建插件版本" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("插件名称"), { target: { value: "跨页面草稿" } });
    fireEvent.change(within(dialog).getByLabelText("Python wheel · 最大 8 MiB"), { target: { files: [new File(["not persisted"], "draft.whl")] } });
    fireEvent.change(within(dialog).getByLabelText(/^测试样例 · test_cases JSON/), { target: { value: JSON.stringify(cases) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭新建插件版本" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "保留并关闭" }));
    await act(() => view.router.navigate({ to: "/pipelines" }));
    await screen.findByRole("heading", { name: "流水线测试页面" });
    await act(() => view.router.navigate({ to: "/operators", search: { project_id: "linked-project", view: "development" } }));
    fireEvent.click(await screen.findByRole("button", { name: "继续编辑草稿" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("插件名称")).toHaveValue("跨页面草稿");
    expect(within(dialog).getByLabelText(/^测试样例 · test_cases JSON/)).toHaveValue(JSON.stringify(cases));
    expect(within(dialog).getByText(/请重新选择 draft.whl/)).toBeVisible();
    expect((within(dialog).getByLabelText("Python wheel · 最大 8 MiB") as HTMLInputElement).files).toHaveLength(0);
    view.unmount();
    const refreshed = await mount("/operators?view=development&project_id=linked-project");
    fireEvent.click(await screen.findByRole("button", { name: "继续编辑草稿" }));
    expect(within(await screen.findByRole("dialog")).getByLabelText("插件名称")).toHaveValue("跨页面草稿");
    refreshed.unmount();
  });

  it("does not restore a draft into a different project", async () => {
    localStorage.setItem("flywheel.plugin-candidate.v1:plugin-developer:linked-project", JSON.stringify({ identity: { id: "private.id", name: "隔离草稿", version: "1.0.0", description: "", sdk_version: "1" }, operators: "[]", cases: "[]", wheelName: "private.whl" }));
    const view = await mount("/operators?view=development&project_id=another-project");
    fireEvent.click(await screen.findByRole("button", { name: "新建插件版本" }));
    expect(within(await screen.findByRole("dialog")).getByLabelText("插件名称")).toHaveValue("");
    expect(screen.queryByText(/private.whl/)).not.toBeInTheDocument();
    view.unmount();
  });

  it("filters a complete plugin version history by exact identity and preserves the scope in its URL", async () => {
    const other = { ...release, id: "other", plugin_id: "company.video.extra", manifest: { ...manifest, id: "company.video.extra", name: "其他插件" } };
    const observed: URLSearchParams[] = [];
    server.use(http.get("http://api.test/api/plugin-releases", ({ request }) => { observed.push(new URL(request.url).searchParams); return HttpResponse.json(releasePage([other, release], request)); }));
    const view = await mount();
    const group = await screen.findByRole("region", { name: "镜头筛选插件的版本" });
    fireEvent.click(within(group).getByRole("button", { name: "查看全部版本" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "其他插件的版本" })).not.toBeInTheDocument());
    expect(observed.some((params) => params.get("plugin_id") === "company.video")).toBe(true);
    expect(view.router.state.location.search).toHaveProperty("pluginId", "company.video");
    fireEvent.click(screen.getByRole("button", { name: "← 全部插件" }));
    expect(await screen.findByRole("region", { name: "其他插件的版本" })).toBeVisible();
    view.unmount();
  });

  it("previews published plugin capabilities before activation and links the exact enabled operator to a new pipeline", async () => {
    release = { ...release, status: "published", deployment_state: "ready", validation_status: "passed", active: true };
    const view = await mount("/operators?project_id=linked-project");
    fireEvent.click(await screen.findByRole("button", { name: "启用插件" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByText("查看包含的算子 · 1 项"));
    expect(within(dialog).getByText("时长筛选")).toBeVisible();
    expect(within(dialog).getByText("镜头集 → 镜头集")).toBeVisible();
    const link = within(dialog).getByRole("link", { name: "用于新流水线" });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    expect(url.searchParams.get("operator_id")).toBe("company.duration");
    expect(url.searchParams.get("operator_version")).toBe("1.0.0");
    expect(url.pathname).toBe("/projects/linked-project/pipelines");
    expect(url.searchParams.get("project_id")).toBeNull();
    view.unmount();
  });

  it("guides an unready published version toward environment preparation rather than activation", async () => {
    release = { ...release, status: "published", validation_status: "passed", deployment_state: "not_ready" };
    const view = await mount();
    expect(await screen.findByText("下一步：准备执行环境")).toBeVisible();
    expect(screen.queryByText("下一步：启用到项目")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新环境状态" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "启用到项目" })).toBeDisabled();
    view.unmount();
  });
  it("provides contextual first-version creation without empty pagination or a selection prompt", async () => {
    server.use(http.get("http://api.test/api/plugin-releases", ({ request }) => HttpResponse.json(releasePage([], request))));
    const view = await mount("/operators?view=development&project_id=linked-project");
    await screen.findByRole("heading", { name: "创建第一个插件版本" });
    expect(screen.queryByRole("heading", { name: "选择一个插件版本" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "开发版本分页" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上传第一个版本" }));
    await screen.findByRole("dialog", { name: "新建插件版本" });
    view.unmount();
  });

  it("clears an unmatched version query without presenting first-time creation", async () => {
    const view = await mount("/operators?view=development&project_id=linked-project&q=missing");
    await screen.findByRole("heading", { name: "没有匹配版本" });
    expect(screen.queryByRole("heading", { name: "创建第一个插件版本" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看全部插件版本" }));
    await screen.findByRole("heading", { name: "镜头筛选插件" });
    expect(view.router.state.location.search).not.toHaveProperty("q");
    view.unmount();
  });

});
