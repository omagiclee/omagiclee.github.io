import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AutoGtPage from "./AutoGtPage";
import type { AutoGtJob, AutoGtPair, AutoGtSource } from "../auto-gt-api";
import { server } from "../test/server";
const access = vi.hoisted(() => ({ denied: [] as string[], jobId: undefined as string | undefined }));
vi.mock("../auth-context", () => ({ useProjectAuth: () => ({ me: { csrf_token: "csrf", user: { id: "user" } }, can: (permission: string) => !access.denied.includes(permission) }) }));
vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({ job_id: access.jobId }), useRouterState: ({ select }: { select: (state: any) => unknown }) => select({ location: { pathname: "/projects/linked/auto-gt" } }), Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
const source = (id: string, status: AutoGtSource["review_status"] = "accepted"): AutoGtSource => ({ id, title: `${id}.png`, uri: `fdf://linked/auto-gt/${id}.png`, object_uri: `fdf://linked/auto-gt/${id}.png`, sha256: id.repeat(64).slice(0, 64), width: 64, height: 64, format: "PNG", role: "image", review_status: status, revision: 1, content_url: `/api/auto-gt/sources/${id}/content?project_id=linked`, quality: { width: 64, height: 64, format: "PNG", checks: { decoded: true }, warnings: [] } });
const pair = (): AutoGtPair => ({ id: "pair", input_url: "/api/auto-gt/pairs/pair/content?role=input&project_id=linked", target_url: "/api/auto-gt/pairs/pair/content?role=target&project_id=linked", input_sha256: "a".repeat(64), target_sha256: "b".repeat(64), reference_kind: "generated_pseudo", source_group: "scene", quality: { same_dimensions: true, warnings: ["生成结果不是人工真值"] }, provenance: { recipe: "engine-v1", seed: 42 }, review_status: "pending", revision: 1 });
const job = (): AutoGtJob => ({ id: "job", name: "测试批次", recipe: "paired_import", status: "succeeded", revision: 1, pair_count: 1, pairs: [pair()], recipe_snapshot: { version: "v1" }, seed: 42 });
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); render(<QueryClientProvider client={client}><AutoGtPage /></QueryClientProvider>); return client; }
describe("AutoGT workspace using isolated HTTP fixtures", () => {
  let images: AutoGtSource[]; let current: AutoGtJob;
  beforeEach(() => { access.denied = []; access.jobId = undefined; images = [source("input"), source("target")]; current = job(); vi.stubEnv("VITE_API_BASE_URL", "http://api.test"); server.use(
    http.get("http://api.test/api/auto-gt/recipes", () => HttpResponse.json({ items: [{ id: "degradation_v1", name: "曝光光影退化", available: true, reference_kind: "degraded_from_reference" }, { id: "portrait_bokeh_v1", name: "二维背景虚化", available: true, reference_kind: "approximate_2d" }, { id: "paired_import", name: "导入现有配对", available: true, reference_kind: "generated_pseudo" }, { id: "generative_relight", name: "外部生成引擎", available: false, reference_kind: "generated_pseudo", blocked_reason: "外部引擎未配置" }] })),
    http.get("http://api.test/api/auto-gt/sources", ({ request }) => { expect(new URL(request.url).searchParams.get("project_id")).toBe("linked"); return HttpResponse.json({ items: images }); }),
    http.get("http://api.test/api/auto-gt/jobs", () => HttpResponse.json({ items: [current] })),
    http.get("http://api.test/api/auto-gt/jobs/job", () => HttpResponse.json(current)),
  ); });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
  it("requires read permission before issuing AutoGT requests", () => { access.denied = ["data_platform:read"]; const client = mount(); expect(screen.getByRole("link", { name: "申请 AutoGT 读取权限" })).toBeInTheDocument(); expect(screen.queryByLabelText("批次名称")).not.toBeInTheDocument(); client.clear(); });
  it("uploads a pending image and requires source acceptance before local generation", async () => {
    images = [];
    server.use(
      http.post("http://api.test/api/auto-gt/sources", () => { images = [source("fresh", "pending")]; return HttpResponse.json(images[0], { status: 201 }); }),
      http.post("http://api.test/api/auto-gt/sources/fresh/review", async ({ request }) => { expect(await request.json()).toEqual({ decision: "accepted", expected_revision: 1 }); images = [{ ...images[0], review_status: "accepted", revision: 2 }]; return HttpResponse.json(images[0]); }),
      http.post("http://api.test/api/auto-gt/jobs", async ({ request }) => { expect(await request.json()).toMatchObject({ recipe: "degradation_v1", source_ids: ["fresh"], seed: 42, variants: 1, idempotency_key: expect.any(String) }); current = { ...current, recipe: "degradation_v1", pairs: [], pair_count: 0, status: "queued" }; return HttpResponse.json(current, { status: 202 }); }),
    );
    const client = mount(); await screen.findByRole("option", { name: "曝光光影退化" });
    fireEvent.change(screen.getByLabelText("上传 AutoGT 图像"), { target: { files: [new File(["pixels"], "fresh.png", { type: "image/png" })] } });
    await screen.findByText("fresh.png"); expect(screen.queryByRole("checkbox", { name: "fresh.png" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("批次名称"), { target: { value: "源图退化" } }); expect(screen.getByRole("button", { name: "提交真实配对任务" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "确认可用" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "fresh.png" })); fireEvent.click(screen.getByRole("button", { name: "提交真实配对任务" }));
    await screen.findByText(/任务已提交/); expect(screen.getByText(/等待执行 · 0 个配对/)).toBeInTheDocument(); client.clear();
  });
  it("uploads two selected images sequentially with the same declared origin and leaves both pending", async () => {
    images = [];
    const requests: string[] = [];
    let release!: () => void;
    server.use(http.post("http://api.test/api/auto-gt/sources", async ({ request }) => {
      const params = new URL(request.url).searchParams;
      expect(params.get("role")).toBe("image"); expect(params.get("origin_kind")).toBe("generated_pseudo"); expect(params.get("source_note")).toBe("合成测试图");
      requests.push(params.get("filename")!);
      if (requests.length === 1) await new Promise<void>((resolve) => { release = resolve; });
      const uploaded = source(requests.length === 1 ? "first" : "second", "pending"); images.push(uploaded);
      return HttpResponse.json(uploaded, { status: 201 });
    }));
    const client = mount(); await screen.findByRole("option", { name: "曝光光影退化" });
    fireEvent.change(screen.getByLabelText("源图来源类型"), { target: { value: "generated_pseudo" } });
    fireEvent.change(screen.getByLabelText("源图来源说明"), { target: { value: "合成测试图" } });
    const picker = screen.getByLabelText("上传 AutoGT 图像"); expect(picker).toHaveAttribute("multiple");
    fireEvent.change(picker, { target: { files: [new File(["first"], "first.png", { type: "image/png" }), new File(["second"], "second.png", { type: "image/png" })] } });
    await waitFor(() => expect(release).toBeTypeOf("function")); expect(requests).toEqual(["first.png"]); expect(picker).toBeDisabled();
    release();
    await screen.findByText("上传处理完成：2 张成功，0 张失败。成功图像仍需确认源图或配对来源。");
    expect(requests).toEqual(["first.png", "second.png"]); expect(images.every((image) => image.review_status === "pending")).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "first.png" })).not.toBeInTheDocument(); expect(picker).toBeEnabled(); client.clear();
  });
  it("reports a failed file separately and continues uploading the remaining selected image", async () => {
    images = []; const requests: string[] = [];
    server.use(http.post("http://api.test/api/auto-gt/sources", ({ request }) => { const name = new URL(request.url).searchParams.get("filename")!; requests.push(name); if (name === "bad.png") return HttpResponse.json({ detail: "图像解码失败" }, { status: 422 }); images.push(source("good", "pending")); return HttpResponse.json(images[0], { status: 201 }); }));
    const client = mount(); await screen.findByRole("option", { name: "曝光光影退化" });
    fireEvent.change(screen.getByLabelText("上传 AutoGT 图像"), { target: { files: [new File(["invalid"], "bad.png", { type: "image/png" }), new File(["good"], "good.png", { type: "image/png" })] } });
    await screen.findByText("上传处理完成：1 张成功，1 张失败。成功图像仍需确认源图或配对来源。");
    expect(requests).toEqual(["bad.png", "good.png"]); expect(screen.getByText("bad.png：图像解码失败")).toBeInTheDocument(); expect(screen.getByText("good.png：已上传，待确认源图或配对来源")).toBeInTheDocument();
    expect(images).toHaveLength(1); expect(screen.getByLabelText("上传 AutoGT 图像")).toBeEnabled(); client.clear();
  });
  it("rejects a selection over twenty images before uploading any file", async () => {
    const upload = vi.fn(); server.use(http.post("http://api.test/api/auto-gt/sources", upload));
    const client = mount();
    fireEvent.change(screen.getByLabelText("上传 AutoGT 图像"), { target: { files: Array.from({ length: 21 }, (_, index) => new File(["image"], `${index}.png`, { type: "image/png" })) } });
    expect(await screen.findByRole("alert")).toHaveTextContent("一次最多选择 20 张图像"); expect(upload).not.toHaveBeenCalled(); client.clear();
  });
  it("imports real uploaded URI pairs with explicit pseudo-reference provenance", async () => {
    let posted: any;
    server.use(http.post("http://api.test/api/auto-gt/jobs", async ({ request }) => { posted = await request.json(); return HttpResponse.json(current, { status: 202 }); }));
    const client = mount(); await screen.findByRole("option", { name: "导入现有配对" });
    fireEvent.change(screen.getByLabelText("处理配方"), { target: { value: "paired_import" } });
    fireEvent.change(screen.getByLabelText("批次名称"), { target: { value: "外部配对" } }); fireEvent.change(screen.getByLabelText("导入输入图"), { target: { value: "input" } }); fireEvent.change(screen.getByLabelText("导入目标图"), { target: { value: "target" } });
    fireEvent.change(screen.getByLabelText("原配方或编辑流程版本"), { target: { value: "engine-v1" } }); fireEvent.change(screen.getByLabelText("来源分组"), { target: { value: "scene" } }); fireEvent.change(screen.getByLabelText("来源说明与编辑要求"), { target: { value: "本地已有生成配对，尚待人工审核" } });
    fireEvent.click(screen.getByRole("button", { name: "提交真实配对任务" })); await screen.findByRole("heading", { name: "配对 1" });
    expect(posted.imported_pairs[0]).toMatchObject({ input_uri: images[0].uri, target_uri: images[1].uri, input_sha256: images[0].sha256, target_sha256: images[1].sha256, reference_kind: "generated_pseudo", recipe: "engine-v1", source_group: "scene" });
    expect(screen.getByRole("img", { name: "配对 1 输入" })).toHaveAttribute("src", "http://api.test/api/auto-gt/pairs/pair/content?role=input&project_id=linked"); expect(screen.getByRole("button", { name: "导出接受配对 ZIP" })).toBeDisabled(); client.clear();
  });
  it("accepts individual pairs without promoting their reference kind and publishes only accepted IDs", async () => {
    access.jobId = "job"; let dataset: unknown;
    server.use(
      http.post("http://api.test/api/auto-gt/pairs/pair/review", async ({ request }) => { expect(await request.json()).toEqual({ decision: "accepted", expected_revision: 1, reason_codes: [], note: "", rois: [] }); current = { ...current, pairs: [{ ...current.pairs[0], review_status: "accepted", revision: 2 }] }; return HttpResponse.json(current.pairs[0]); }),
      http.post("http://api.test/api/auto-gt/jobs/job/dataset", async ({ request }) => { dataset = await request.json(); return HttpResponse.json({ dataset_id: "dataset", link: "/projects/linked/datasets/dataset" }); }),
    );
    const client = mount(); await screen.findByRole("button", { name: "接受配对 1" }); fireEvent.click(screen.getByRole("button", { name: "接受配对 1" })); await screen.findByText(/配对审核已保存/);
    expect(screen.getByText(/参考类型：生成式伪参考 · 已接受/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "导出接受配对 ZIP" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("候选数据集名称"), { target: { value: "候选配对集" } }); fireEvent.click(screen.getByRole("button", { name: "创建候选数据集" }));
    expect(await screen.findByRole("link", { name: "打开候选数据集" })).toHaveAttribute("href", "/projects/linked/datasets/dataset"); expect(dataset).toEqual({ name: "候选配对集", pair_ids: ["pair"], idempotency_key: expect.any(String) }); client.clear();
  });
  it("records unavailable external engines as blocked without showing generated pairs", async () => {
    server.use(http.post("http://api.test/api/auto-gt/jobs", () => { current = { ...current, recipe: "generative_relight", status: "blocked", pairs: [], pair_count: 0, blocked_reason: "外部引擎未配置" }; return HttpResponse.json(current, { status: 202 }); }));
    const client = mount(); await screen.findByRole("option", { name: "外部生成引擎 · 未配置" }); fireEvent.change(screen.getByLabelText("处理配方"), { target: { value: "generative_relight" } }); fireEvent.change(screen.getByLabelText("批次名称"), { target: { value: "外部引擎任务" } }); fireEvent.click(screen.getByRole("checkbox", { name: "input.png" })); fireEvent.click(screen.getByRole("button", { name: "记录阻塞任务" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("外部引擎未配置"); expect(screen.queryByRole("img", { name: "配对 1 输入" })).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "导出接受配对 ZIP" })).toBeDisabled(); client.clear();
  });
  it("requires a matching mask for approximate bokeh and states the optical limitation", async () => {
    const client = mount(); await screen.findByRole("option", { name: "二维背景虚化" }); fireEvent.change(screen.getByLabelText("处理配方"), { target: { value: "portrait_bokeh_v1" } }); fireEvent.change(screen.getByLabelText("批次名称"), { target: { value: "虚化近似" } }); fireEvent.click(screen.getByRole("checkbox", { name: "input.png" }));
    expect(screen.getByText(/不是光学散焦或真实景深/)).toBeInTheDocument(); expect(screen.getByLabelText("input.png 的前景掩码")).toHaveValue(""); expect(screen.getByRole("button", { name: "提交真实配对任务" })).toBeDisabled(); client.clear();
  });
  it("only offers accepted masks and blocks a previously selected mask whose approval was revoked", async () => {
    images.push({ ...source("mask", "accepted"), role: "mask" }, { ...source("pending-mask", "pending"), role: "mask" });
    const client = mount(); await screen.findByRole("option", { name: "二维背景虚化" });
    fireEvent.change(screen.getByLabelText("处理配方"), { target: { value: "portrait_bokeh_v1" } });
    fireEvent.change(screen.getByLabelText("批次名称"), { target: { value: "审核掩码" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "input.png" }));
    expect(screen.queryByRole("option", { name: "pending-mask.png" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("input.png 的前景掩码"), { target: { value: "mask" } });
    expect(screen.getByRole("button", { name: "提交真实配对任务" })).toBeEnabled();
    images = images.map((image) => image.id === "mask" ? { ...image, review_status: "rejected", revision: 2 } : image);
    fireEvent.click(screen.getByRole("button", { name: "刷新源图" }));
    await waitFor(() => expect(screen.queryByRole("option", { name: "mask.png" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "提交真实配对任务" })).toBeDisabled();
    client.clear();
  });
});
