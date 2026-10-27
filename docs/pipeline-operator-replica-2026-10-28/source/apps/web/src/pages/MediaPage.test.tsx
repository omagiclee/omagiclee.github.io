import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import MediaPage from "./MediaPage";
import type { MediaSearchInput, MediaShot, SavedMediaSearch } from "../media-api";

const access = vi.hoisted(() => ({ allowed: true, denied: [] as string[], project: undefined as string | undefined, sourceSearch: undefined as string | undefined, defaultDenied: false }));
vi.mock("../auth-context", () => { const auth = (projectId = "test-project") => ({ me: { user: { id: "ui-test-user" }, scope: { type: "project", id: projectId }, csrf_token: "test-csrf" }, can: (key: string) => access.allowed && !access.denied.includes(key) }); return { useAuth: () => ({ ...auth(), can: (key: string) => !access.defaultDenied && auth().can(key) }), useProjectAuth: auth }; });
vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({ project_id: access.project, search_id: access.sourceSearch }), Link: ({ to, params, children, search, ...props }: { to: string; params?: Record<string, string>; children: React.ReactNode; search?: Record<string, string> }) => {
  const path = params ? Object.entries(params).reduce((value, [key, item]) => value.replace(`$${key}`, encodeURIComponent(item)), to) : to;
  return <a href={path + (search ? `?${new URLSearchParams(search)}` : "")} {...props}>{children}</a>;
} }));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MediaPage /></QueryClientProvider>);
  return client;
}

async function chooseFilter(label: string, option: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: option }));
}

const shotFixture: MediaShot = {
  id: "shot-a", video_id: "video-a", video_title: "森林镜头", start_ms: 1000, end_ms: 4000, duration_ms: 3000,
  person_status: "detected", index_state: "ready", frame_count: 2, keyframe_url: null, video_url: null,
  mask_url: null, matched_frame_id: "frame-a", matched_timestamp_ms: 2000, score: 0.8123, tags: ["户外"],
  evidence: { unit: "shot", coverage: "sampled_keyframes", frame_ids: ["frame-a"] },
};

describe("media workspace UI contracts (model execution is not simulated)", () => {
  const requests: MediaSearchInput[] = [];
  beforeEach(() => {
    access.allowed = true;
    access.denied = [];
    access.project = undefined;
    access.sourceSearch = undefined;
    access.defaultDenied = false;
    requests.length = 0;
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    server.use(
      http.get("http://api.test/api/media/status", () => HttpResponse.json({ models: [], issues: [], counts: { videos: 0, shots: 0, keyframes: 0, indexed_shots: 0 }, executor: { kind: "local-thread", concurrency: 1, active_run_id: null } })),
      http.get("http://api.test/api/media/videos", () => HttpResponse.json([])),
      http.get("http://api.test/api/media/facets", () => HttpResponse.json({ tags: [], person_status: [], videos: [], tag_semantics: "manual" })),
      http.post("http://api.test/api/media/search", async ({ request }) => {
        expect(new URL(request.url).searchParams.get("project_id")).toBe("test-project");
        const body = await request.json() as MediaSearchInput;
        requests.push(body);
        return HttpResponse.json({ items: [], total: 0, mode: body.mode });
      }),
    );
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("loads the linked project's assets and uses its permissions even when default access is denied", async () => {
    access.project = "linked-project";
    access.defaultDenied = true;
    const projects: string[] = [];
    server.use(
      http.get("http://api.test/api/media/status", ({ request }) => { projects.push(new URL(request.url).searchParams.get("project_id")!); return HttpResponse.json({ models: [], issues: [], counts: { videos: 0, shots: 0, keyframes: 0, indexed_shots: 0 }, executor: { active_run_id: null } }); }),
      http.post("http://api.test/api/media/search", ({ request }) => { projects.push(new URL(request.url).searchParams.get("project_id")!); return HttpResponse.json({ items: [], total: 0, mode: "filter" }); }),
    );
    const client = mount();
    await screen.findByText("还没有可检索的镜头");
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.every((project) => project === "linked-project")).toBe(true);
    expect(screen.getByRole("link", { name: "去创建处理流程" })).toHaveAttribute("href", "/projects/linked-project/pipelines?view=new&template=video");
    client.clear();
  });

  it("opens the frozen source search session without rerunning retrieval and restores its query controls", async () => {
    access.sourceSearch = "source-session";
    server.use(http.get("http://api.test/api/media/search-sessions/source-session", ({ request }) => {
      expect(new URL(request.url).searchParams.get("project_id")).toBe("test-project");
      return HttpResponse.json({ id: "source-session", query: { mode: "text", query: "森林", limit: 24, retrieval_profile: "baseline" }, result: { items: [shotFixture], total: 1, mode: "text" }, feedback: {} });
    }));
    const client = mount();
    await screen.findByRole("heading", { name: "森林镜头" });
    expect(screen.getByLabelText("描述要查找的视频画面")).toHaveValue("森林");
    expect(screen.getByText("固定检索会话 · 森林")).toBeInTheDocument();
    expect(requests).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ mode: "text", query: "森林", retrieval_profile: "baseline" });
    client.clear();
  });

  it("combines person filters with text and keeps provider choices in advanced settings", async () => {
    const client = mount();
    await screen.findByText("还没有可检索的镜头");
    await chooseFilter("人物标签", "抽样未检出");
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await waitFor(() => expect(requests.at(-1)).toEqual({ mode: "filter", person_status: "not_detected", limit: 24 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "检索镜头" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("描述要查找的视频画面"), { target: { value: " 森林中散步的人 " } });
    fireEvent.click(screen.getByText("检索设置"));
    fireEvent.change(screen.getByLabelText("检索能力"), { target: { value: "baseline" } });
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await waitFor(() => expect(requests.at(-1)).toEqual({ mode: "text", query: "森林中散步的人", person_status: "not_detected", retrieval_profile: "baseline", rerank: true, limit: 24 }));
    expect(screen.getAllByText(/抽样未检出/).length).toBeGreaterThan(0);
    client.clear();
  });

  it("blocks unsupported uploads and removes image fields when the reference is cleared", async () => {
    const client = mount();
    await screen.findByText("还没有可检索的镜头");
    const upload = screen.getByLabelText("上传检索图片");
    fireEvent.change(upload, { target: { files: [new File(["svg"], "bad.svg", { type: "image/svg+xml" })] } });
    await screen.findByText("请选择 JPEG、PNG 或 WebP 图片。");
    expect(screen.getByRole("button", { name: "检索镜头" })).toBeDisabled();
    fireEvent.change(upload, { target: { files: [new File([new Uint8Array([1, 2, 3])], "frame.png", { type: "image/png" })] } });
    await screen.findByAltText("检索参考图片");
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await waitFor(() => expect(requests.at(-1)).toEqual({ mode: "image", image_base64: "data:image/png;base64,AQID", retrieval_profile: "auto", rerank: true, limit: 24 }));
    fireEvent.click(screen.getByRole("button", { name: "移除检索图片" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "检索镜头" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await waitFor(() => expect(requests.at(-1)).toEqual({ mode: "filter", limit: 24 }));
    client.clear();
  });

  it("keeps the media page readable while the search button is denied", async () => {
    access.denied = ["media:search", "pipelines:read"];
    const client = mount();
    await screen.findByRole("link", { name: "申请镜头检索权限" });
    expect(screen.getByRole("button", { name: "检索镜头" })).toBeDisabled();
    expect(requests).toEqual([]);
    client.clear();
  });

  it("does not issue media requests when read access is absent", async () => {
    access.allowed = false;
    const client = mount();
    expect(screen.getByRole("link", { name: "申请数据探索页面权限" })).toHaveAttribute("href", "/access?permission=media%3Aread&project_id=test-project");
    expect(requests).toEqual([]);
    expect(screen.queryByLabelText("描述要查找的视频画面")).not.toBeInTheDocument();
    client.clear();
  });

  it("distinguishes fusion ranking from cosine scores without presenting probabilities", async () => {
    server.use(http.post("http://api.test/api/media/search", async ({ request }) => {
      const input = await request.json() as MediaSearchInput;
      if (input.mode === "filter") return HttpResponse.json({ items: [], total: 0, mode: "filter" });
      const fusion = input.retrieval_profile === "auto";
      return HttpResponse.json({ mode: input.mode, total: 1, score_type: fusion ? "rrf" : "cosine", items: [{
        id: "ui-fixture-shot", video_id: "ui-fixture-video", video_title: "界面测试镜头", start_ms: 1000, end_ms: 3000,
        person_status: "unknown", index_state: "ready", frame_count: 1, keyframe_url: null, video_url: null,
        mask_url: null, matched_frame_id: null, score: fusion ? 0.0325 : 0.8123,
      }] });
    }));
    const client = mount();
    await screen.findByText("还没有可检索的镜头");
    fireEvent.change(screen.getByLabelText("描述要查找的视频画面"), { target: { value: "森林" } });
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await screen.findByText("融合排序分数");
    expect(screen.getByText("0.0325")).toBeInTheDocument();
    fireEvent.click(screen.getByText("检索设置"));
    fireEvent.change(screen.getByLabelText("检索能力"), { target: { value: "baseline" } });
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await screen.findByText("余弦相似度");
    expect(screen.getByText("0.8123")).toBeInTheDocument();
    expect(screen.queryByText(/81.23%/)).not.toBeInTheDocument();
    client.clear();
  });

  it("shows published counts rather than historical generations and keeps lifecycle actions elsewhere", async () => {
    server.use(http.get("http://api.test/api/media/status", () => HttpResponse.json({
      models: [{ id: "fixture-model", name: "完整模型运行面板", available: true }], issues: [],
      counts: { videos: 2, shots: 564, keyframes: 846, indexed_shots: 282, indexed_videos: 2 },
      latest_published_at: "2026-09-10T01:00:00Z", executor: { kind: "dagster", concurrency: 1, active_run_id: null },
    })));
    const client = mount();
    await waitFor(() => expect(screen.getByLabelText("已发布视频资产")).toHaveTextContent("282 个可检索镜头"));
    expect(screen.getByLabelText("已发布视频资产")).not.toHaveTextContent("564");
    expect(screen.queryByText("完整模型运行面板")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /创建示例流程|开始运行|取消运行|视频处理流程/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /示例视频链接/ })).not.toBeInTheDocument();
    client.clear();
  });

  it("links an empty published catalog to the one shared creation flow even when historical media exists", async () => {
    server.use(http.get("http://api.test/api/media/status", () => HttpResponse.json({ models: [], issues: [],
      counts: { videos: 2, shots: 282, keyframes: 282, indexed_shots: 0 },
      executor: { kind: "dagster", concurrency: 1, active_run_id: null },
    })));
    const client = mount();
    const link = await screen.findByRole("link", { name: "去创建处理流程" });
    expect(link).toHaveAttribute("href", "/projects/test-project/pipelines?view=new&template=video");
    expect(requests).toEqual([{ mode: "filter", limit: 24 }]);
    client.clear();
  });

  it("exposes only the active node and links to its exact project, pipeline and run", async () => {
    server.use(
      http.get("http://api.test/api/media/status", () => HttpResponse.json({ models: [], issues: [],
        counts: { videos: 2, shots: 282, keyframes: 282, indexed_shots: 0 },
        executor: { kind: "dagster", concurrency: 1, active_run_id: "active-run" },
      })),
      http.get("http://api.test/api/pipeline-runs/active-run", () => HttpResponse.json({ id: "active-run",
        pipeline_id: "active-pipeline", pipeline_name: "正在处理的流程", pipeline_version: 3, status: "running",
        tasks: [
          { id: "done", node_id: "already_finished_node", status: "succeeded", input_count: 2, output_count: 282 },
          { id: "active", node_id: "person_segment", status: "running", input_count: 282, output_count: 0,
            progress: { completed: 254, total: 282, unit: "frames", source: "artifact_files", last_progress_at: null } },
          { id: "next", node_id: "future_node", status: "pending", input_count: 0, output_count: 0 },
        ],
      })),
    );
    const client = mount();
    await screen.findByText("254 / 282 帧");
    expect(screen.getByRole("link", { name: "查看运行" })).toHaveAttribute("href", "/projects/test-project/pipelines?pipelineId=active-pipeline&view=runs&runId=active-run");
    expect(screen.queryByText("already_finished_node")).not.toBeInTheDocument();
    expect(screen.queryByText("future_node")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消运行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "去创建处理流程" })).not.toBeInTheDocument();
    client.clear();
  });

  it("keeps common search controls visible and opens optional reference and model settings on demand", async () => {
    const client = mount();
    await screen.findByText("还没有可检索的镜头");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByLabelText("描述要查找的视频画面")).toBeVisible();
    expect(screen.getByLabelText("上传检索图片")).toBeInTheDocument();
    expect(screen.getByLabelText("上传检索图片")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "人物标签" })).toBeVisible();
    expect(document.querySelector(".media-reference-details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("参考图片", { exact: true }));
    expect(screen.getByLabelText("上传检索图片")).toBeVisible();
    expect(document.querySelector(".media-advanced")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("检索设置"));
    expect(document.querySelector(".media-advanced")).toHaveAttribute("open");
    expect(screen.getByRole("combobox", { name: "检索能力" })).toBeVisible();
    client.clear();
  });

  it("lets a shot trace back to its generating version without entering an editor", async () => {
    server.use(http.post("http://api.test/api/media/search", () => HttpResponse.json({ items: [{
      id: "trace-shot", video_id: "trace-video", video_title: "来源追溯测试", start_ms: 1000, end_ms: 3000,
      person_status: "detected", index_state: "ready", frame_count: 1, keyframe_url: null, video_url: null,
      mask_url: null, matched_frame_id: null, score: null, index_run_id: "published-run", index_pipeline_id: "source-pipeline", index_pipeline_version: 3,
    }], total: 1, mode: "filter" })));
    const client = mount();
    const link = await screen.findByRole("link", { name: "查看生成运行 · v3" });
    expect(link).toHaveAttribute("href", "/projects/test-project/pipelines?pipelineId=source-pipeline&runId=published-run&view=runs");
    client.clear();
  });

  it("refreshes publication status without automatically repeating a semantic provider request", async () => {
    let published = 0;
    server.use(http.get("http://api.test/api/media/status", () => HttpResponse.json({ models: [], issues: [],
      counts: { videos: 2, shots: 564, keyframes: 564, indexed_shots: published },
      executor: { kind: "dagster", concurrency: 1, active_run_id: null },
    })));
    const client = mount();
    await screen.findByText("还没有可检索的镜头");
    fireEvent.change(screen.getByLabelText("描述要查找的视频画面"), { target: { value: "森林" } });
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    published = 282;
    await act(async () => { await client.invalidateQueries({ queryKey: ["media-status", "test-project"] }); });
    await waitFor(() => expect(screen.getByLabelText("已发布视频资产")).toHaveTextContent("282 个可检索镜头"));
    expect(requests).toHaveLength(2);
    client.clear();
  });

  it("sends text, image, duration and tag conditions together and removes the image cleanly", async () => {
    const client = mount();
    await screen.findByText("还没有可检索的镜头");
    fireEvent.change(screen.getByLabelText("描述要查找的视频画面"), { target: { value: " 夜间散步 " } });
    fireEvent.change(screen.getByLabelText("上传检索图片"), { target: { files: [new File([new Uint8Array([1, 2, 3])], "scene.png", { type: "image/png" })] } });
    await screen.findByAltText("检索参考图片");
    fireEvent.click(screen.getByText("标签与时长筛选"));
    fireEvent.change(screen.getByLabelText("必须包含标签"), { target: { value: "户外， 人物,户外" } });
    fireEvent.change(screen.getByLabelText("包含任一标签"), { target: { value: "森林,草地" } });
    fireEvent.change(screen.getByLabelText("排除标签"), { target: { value: "模糊" } });
    fireEvent.change(screen.getByLabelText("最短时长（秒）"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("最长时长（秒）"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await waitFor(() => expect(requests.at(-1)).toEqual({ mode: "composed", query: "夜间散步", image_base64: "data:image/png;base64,AQID", limit: 24, tags_all: ["户外", "人物"], tags_any: ["森林", "草地"], tags_none: ["模糊"], duration_min_ms: 1500, duration_max_ms: 8000, retrieval_profile: "auto", rerank: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: "检索镜头" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "移除检索图片" }));
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await waitFor(() => expect(requests.at(-1)?.mode).toBe("text"));
    expect(requests.at(-1)).not.toHaveProperty("image_base64");
    expect(requests.at(-1)?.tags_all).toEqual(["户外", "人物"]);
    client.clear();
  });

  it("rejects inverted durations without issuing an unintended search", async () => {
    const client = mount();
    await screen.findByText("还没有可检索的镜头");
    fireEvent.click(screen.getByText("标签与时长筛选"));
    fireEvent.change(screen.getByLabelText("最短时长（秒）"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("最长时长（秒）"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await screen.findByRole("alert");
    expect(screen.getByText("最短时长不能大于最长时长。")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    client.clear();
  });

  it("reuses a result as a reference, records session feedback, and exposes actual retrieval limitations", async () => {
    const feedbackRequests: unknown[] = [];
    server.use(
      http.post("http://api.test/api/media/search", async ({ request }) => {
        const body = await request.json() as MediaSearchInput; requests.push(body);
        return HttpResponse.json({ search_id: "session-a", items: [shotFixture], total: 1, mode: body.mode, score_type: "cosine", retrieval: { profile: "baseline", route: "baseline", models: {}, reranked: false, candidate_count: 1, coverage: "sampled_keyframes", limitations: ["增强模型未就绪，使用基础能力。"] } });
      }),
      http.post("http://api.test/api/media/feedback", async ({ request }) => {
        expect(request.headers.get("x-csrf-token")).toBe("test-csrf");
        const body = await request.json(); feedbackRequests.push(body); return HttpResponse.json(body);
      }),
    );
    const client = mount();
    await screen.findByRole("heading", { name: "森林镜头" });
    expect(screen.getByText("增强模型未就绪，使用基础能力。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "相关：森林镜头 00:01" }));
    await waitFor(() => expect(feedbackRequests).toEqual([{ search_id: "session-a", shot_id: "shot-a", relevance: "positive" }]));
    await waitFor(() => expect(screen.getByRole("button", { name: "相关：森林镜头 00:01" })).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", { name: "相关：森林镜头 00:01" }));
    await waitFor(() => expect(feedbackRequests.at(-1)).toMatchObject({ relevance: "clear" }));
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const form = document.querySelector<HTMLFormElement>(".media-search-form")!;
    const scroll = vi.fn(); form.scrollIntoView = scroll;
    fireEvent.click(screen.getByRole("button", { name: "以镜头 森林镜头 00:01 为参考" }));
    expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    expect(screen.getByLabelText("描述要查找的视频画面")).toHaveFocus();
    expect(document.querySelector(".media-reference-details")).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "移除检索图片" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("描述要查找的视频画面"), { target: { value: "夜间" } });
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await waitFor(() => expect(requests.at(-1)).toEqual({ mode: "composed", query: "夜间", reference_shot_id: "shot-a", reference_frame_id: "frame-a", limit: 24, retrieval_profile: "auto", rerank: true }));
    expect(requests.at(-1)).not.toHaveProperty("image_base64");
    client.clear();
  });

  it("saves the executed query rather than an unsent draft, then restores all conditions on replay", async () => {
    const persisted: SavedMediaSearch[] = [];
    const savedInput: MediaSearchInput = { mode: "composed", query: "森林", image_base64: "data:image/png;base64,AQID", tags_all: ["户外"], duration_max_ms: 8000, limit: 48, retrieval_profile: "auto", rerank: true };
    server.use(
      http.post("http://api.test/api/media/search", async ({ request }) => { const body = await request.json() as MediaSearchInput; requests.push(body); return HttpResponse.json({ search_id: "saved-session", items: [shotFixture], total: 1, mode: body.mode }); }),
      http.get("http://api.test/api/media/saved-searches", () => HttpResponse.json({ items: persisted })),
      http.get("http://api.test/api/media/collections", () => HttpResponse.json({ items: [] })),
      http.post("http://api.test/api/media/saved-searches", async ({ request }) => {
        expect(await request.json()).toEqual({ name: "常用场景", search_id: "saved-session" });
        const item = { id: "saved-1", name: "常用场景", search_id: "saved-session", created_at: "2026-09-10T00:00:00Z", result_count: 1, query: savedInput };
        persisted.push(item); return HttpResponse.json(item);
      }),
    );
    const client = mount();
    await screen.findByRole("heading", { name: "森林镜头" });
    fireEvent.change(screen.getByLabelText("描述要查找的视频画面"), { target: { value: "尚未提交的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存查询" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "常用场景" } });
    fireEvent.click(screen.getByRole("button", { name: "确认保存查询" }));
    const replay = await screen.findByRole("button", { name: "运行查询 常用场景" });
    fireEvent.click(replay);
    await waitFor(() => expect(requests.at(-1)).toEqual(savedInput));
    expect(screen.getByLabelText("描述要查找的视频画面")).toHaveValue("森林");
    expect(screen.getByLabelText("最长时长（秒）")).toHaveValue(8);
    expect(screen.getByLabelText("必须包含标签")).toHaveValue("户外");
    expect(screen.getByAltText("检索参考图片")).toHaveAttribute("src", savedInput.image_base64);
    client.clear();
  });

  it("creates a fixed collection from the manual selection and can browse its snapshot", async () => {
    const otherShot = { ...shotFixture, id: "shot-b", video_title: "河流镜头" };
    const collection = { id: "collection-a", name: "人工精选", search_id: "session-a", created_at: "2026-09-10T00:00:00Z", item_count: 1, manifest_sha256: "sha-fixture", manifest: { items: [shotFixture] } };
    server.use(
      http.post("http://api.test/api/media/search", () => HttpResponse.json({ search_id: "session-a", items: [shotFixture, otherShot], total: 2, mode: "filter" })),
      http.get("http://api.test/api/media/saved-searches", () => HttpResponse.json({ items: [] })),
      http.get("http://api.test/api/media/collections", () => HttpResponse.json({ items: [collection] })),
      http.get("http://api.test/api/media/collections/collection-a", () => HttpResponse.json(collection)),
      http.post("http://api.test/api/media/collections", async ({ request }) => { expect(await request.json()).toEqual({ name: "人工精选", search_id: "session-a", shot_ids: ["shot-a"] }); return HttpResponse.json(collection); }),
    );
    const client = mount();
    await screen.findByRole("heading", { name: "河流镜头" });
    fireEvent.click(screen.getByRole("checkbox", { name: "选择镜头 森林镜头 00:01" }));
    fireEvent.click(screen.getByRole("button", { name: /创建固定选集/ }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "人工精选" } });
    expect(screen.getByLabelText("镜头来源")).toHaveValue("selected");
    fireEvent.click(screen.getByRole("button", { name: "确认创建选集" }));
    await screen.findByRole("heading", { name: "人工精选" });
    await screen.findByRole("heading", { name: "森林镜头" });
    expect(screen.queryByRole("heading", { name: "河流镜头" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出清单" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "返回检索结果" }));
    await screen.findByRole("heading", { name: "河流镜头" });
    client.clear();
  });

  it.each(["清单", "视频文件包"])("keeps the fixed selection after a rejected %s export and downloads only after a successful retry", async (format) => {
    const collection = { id: "export-collection", name: "人工/精选", search_id: "session-a", created_at: "2026-09-10T00:00:00Z", item_count: 1, manifest_sha256: "sha-fixture", manifest: { items: [shotFixture] } };
    let rejected = true;
    let release!: () => void;
    const createObjectURL = vi.fn(() => "blob:collection-manifest");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    server.use(
      http.post("http://api.test/api/media/search", () => HttpResponse.json({ search_id: "session-a", items: [shotFixture], total: 1, mode: "filter" })),
      http.get("http://api.test/api/media/saved-searches", () => HttpResponse.json({ items: [] })),
      http.get("http://api.test/api/media/collections", () => HttpResponse.json({ items: [collection] })),
      http.get("http://api.test/api/media/collections/export-collection", () => HttpResponse.json(collection)),
      http.all(`http://api.test/api/media/collections/export-collection/${format === "清单" ? "export" : "archive"}`, async ({ request }) => {
        expect(request.method).toBe(format === "清单" ? "GET" : "POST");
        if (format === "视频文件包") expect(request.headers.get("X-CSRF-Token")).toBe("test-csrf");
        expect(new URL(request.url).searchParams.get("project_id")).toBe("test-project");
        await new Promise<void>((resolve) => { release = resolve; });
        return rejected ? HttpResponse.json({ detail: "导出存储暂不可用" }, { status: 503 }) : format === "清单" ? HttpResponse.json(collection.manifest) : new HttpResponse(new Uint8Array([80, 75, 3, 4]), { headers: { "Content-Type": "application/zip" } });
      }),
    );
    const client = mount();
    await screen.findByRole("heading", { name: "森林镜头" });
    fireEvent.click(screen.getByRole("button", { name: "我的查询与选集" }));
    fireEvent.click(await screen.findByRole("button", { name: /人工\/精选.*1 个镜头/ }));
    await screen.findByRole("heading", { name: "人工/精选" });
    fireEvent.click(screen.getByRole("button", { name: `导出${format}` }));
    await waitFor(() => expect(release).toBeTypeOf("function"));
    expect(screen.getByRole("button", { name: `导出${format}` })).toBeDisabled();
    await act(async () => release());
    expect(await screen.findByRole("alert")).toHaveTextContent("导出存储暂不可用");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "人工/精选" })).toBeInTheDocument();
    rejected = false;
    fireEvent.click(screen.getByRole("button", { name: `导出${format}` }));
    await waitFor(() => expect(screen.getByRole("button", { name: `导出${format}` })).toBeDisabled());
    await act(async () => release());
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(`人工_精选.${format === "清单" ? "json" : "zip"}`);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `导出${format}` })).toBeEnabled();
    client.clear();
  });

  it("submits quota sampling and dedup settings against the current search session", async () => {
    let creation: unknown;
    const collection = { id: "collection-sample", name: "均衡样本", search_id: "session-a", created_at: "2026-09-10T00:00:00Z", item_count: 1, manifest_sha256: "sha-fixture", manifest: { items: [shotFixture] } };
    server.use(
      http.post("http://api.test/api/media/search", () => HttpResponse.json({ search_id: "session-a", items: [shotFixture, { ...shotFixture, id: "shot-b", video_title: "河流镜头" }], total: 2, mode: "filter" })),
      http.get("http://api.test/api/media/saved-searches", () => HttpResponse.json({ items: [] })),
      http.get("http://api.test/api/media/collections", () => HttpResponse.json({ items: [collection] })),
      http.get("http://api.test/api/media/collections/collection-sample", () => HttpResponse.json(collection)),
      http.post("http://api.test/api/media/collections", async ({ request }) => { creation = await request.json(); return HttpResponse.json(collection); }),
    );
    const client = mount();
    await screen.findByRole("heading", { name: "森林镜头" });
    fireEvent.click(screen.getByRole("button", { name: /创建固定选集/ }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "均衡样本" } });
    fireEvent.change(screen.getByLabelText("镜头来源"), { target: { value: "sample" } });
    fireEvent.change(screen.getByLabelText("目标镜头数"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("均衡维度"), { target: { value: "person" } });
    fireEvent.change(screen.getByLabelText("每组最多（可选）"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "确认创建选集" }));
    await waitFor(() => expect(creation).toEqual({ name: "均衡样本", search_id: "session-a", sample: { size: 2, group_by: "person", per_group: 1, deduplicate: true } }));
    await screen.findByText("已创建「均衡样本」，固定保存 1 个镜头。");
    client.clear();
  });

  it("locks the captured tag draft during save and restores it with associated failure feedback", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    server.use(
      http.post("http://api.test/api/media/search", () => HttpResponse.json({ search_id: "session-a", items: [shotFixture], total: 1, mode: "filter" })),
      http.post("http://api.test/api/media/shots/shot-a/tags", async ({ request }) => {
        expect(request.headers.get("x-csrf-token")).toBe("test-csrf");
        expect(await request.json()).toEqual({ tags: ["已核验", "户外"] });
        await gate; return HttpResponse.json({ detail: "标签服务暂时不可用" }, { status: 503 });
      }),
    );
    const client = mount();
    fireEvent.click(await screen.findByRole("button", { name: "编辑标签：森林镜头 00:01" }));
    const field = screen.getByLabelText("已确认标签（逗号分隔）");
    fireEvent.change(field, { target: { value: "已核验, 户外" } });
    fireEvent.click(screen.getByRole("button", { name: "保存标签" }));
    await waitFor(() => expect(field).toBeDisabled());
    expect(screen.getByRole("button", { name: "编辑标签：森林镜头 00:01" })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(field).toBeEnabled());
    expect(field).toHaveValue("已核验, 户外");
    expect(field).toHaveAccessibleDescription("标签服务暂时不可用");
    expect(field).not.toHaveAttribute("aria-invalid", "true");
    client.clear();
  });

  it("keeps search readable but gates feedback, tag edits and collection mutations by curate permission", async () => {
    access.denied = ["media:curate"];
    server.use(http.post("http://api.test/api/media/search", () => HttpResponse.json({ search_id: "session-a", items: [shotFixture], total: 1, mode: "filter" })));
    const client = mount();
    await screen.findByRole("heading", { name: "森林镜头" });
    expect(screen.getByRole("button", { name: "保存查询" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /创建固定选集/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "相关：森林镜头 00:01" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑标签：森林镜头 00:01" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "申请反馈与选集整理权限" })).toHaveAttribute("href", "/access?permission=media%3Acurate&project_id=test-project");
    client.clear();
  });

  it("does not show unsaved feedback as accepted when the server rejects it", async () => {
    server.use(
      http.post("http://api.test/api/media/search", () => HttpResponse.json({ search_id: "session-a", items: [shotFixture], total: 1, mode: "filter" })),
      http.post("http://api.test/api/media/feedback", () => HttpResponse.json({ detail: "反馈未保存，请重新登录后重试。" }, { status: 403 })),
    );
    const client = mount();
    await screen.findByRole("heading", { name: "森林镜头" });
    fireEvent.click(screen.getByRole("button", { name: "不相关：森林镜头 00:01" }));
    await screen.findByText("反馈未保存，请重新登录后重试。");
    expect(screen.getByRole("button", { name: "不相关：森林镜头 00:01" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("已记录本次查询的相关性反馈，供后续评测使用。")).not.toBeInTheDocument();
    client.clear();
  });

  it("keeps null duration fields from a persisted server query unrestricted after editing", async () => {
    server.use(
      http.get("http://api.test/api/media/saved-searches", () => HttpResponse.json({ items: [{ id: "nullable-query", name: "不限时长", search_id: "old-session", created_at: "2026-09-10T00:00:00Z", result_count: 0, query: { mode: "text", query: "森林", image_base64: null, duration_min_ms: null, duration_max_ms: null, limit: 24 } }] })),
      http.get("http://api.test/api/media/collections", () => HttpResponse.json({ items: [] })),
    );
    const client = mount();
    await screen.findByText("还没有可检索的镜头");
    fireEvent.click(screen.getByRole("button", { name: "我的查询与选集" }));
    fireEvent.click(await screen.findByRole("button", { name: "运行查询 不限时长" }));
    await waitFor(() => expect(requests.at(-1)?.query).toBe("森林"));
    expect(screen.getByLabelText("最短时长（秒）")).toHaveValue(null);
    expect(screen.getByLabelText("最长时长（秒）")).toHaveValue(null);
    await waitFor(() => expect(screen.getByRole("button", { name: "检索镜头" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("描述要查找的视频画面"), { target: { value: "河流" } });
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await waitFor(() => expect(requests.at(-1)?.query).toBe("河流"));
    expect(requests.at(-1)).not.toHaveProperty("duration_min_ms");
    expect(requests.at(-1)).not.toHaveProperty("duration_max_ms");
    client.clear();
  });
  it("provides setup steps for an empty index without treating it as a failed search", async () => {
    const client = mount();
    await screen.findByText("还没有可检索的镜头");
    expect(screen.getByRole("list", { name: "开始探索的步骤" })).not.toBeVisible();
    fireEvent.click(screen.getByText("查看处理步骤"));
    expect(screen.getByRole("list", { name: "开始探索的步骤" })).toBeVisible();
    expect(screen.getByText("处理并发布索引", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "清除条件，查看全部镜头" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /创建固定选集/ })).toBeDisabled();
    client.clear();
  });

  it("clears semantic and attribute conditions after no matches, while retaining zero-result query saving", async () => {
    server.use(
      http.get("http://api.test/api/media/status", () => HttpResponse.json({ models: [], issues: [], counts: { videos: 1, shots: 10, keyframes: 10, indexed_shots: 10 }, executor: { active_run_id: null } })),
      http.post("http://api.test/api/media/search", async ({ request }) => {
        const input = await request.json() as MediaSearchInput;
        requests.push(input);
        return HttpResponse.json({ search_id: "empty-search", items: [], total: 0, mode: input.mode });
      }),
    );
    const client = mount();
    await screen.findByText("没有找到符合条件的镜头");
    fireEvent.change(screen.getByLabelText("描述要查找的视频画面"), { target: { value: "森林" } });
    await chooseFilter("人物标签", "检出人物");
    fireEvent.change(screen.getByLabelText("必须包含标签"), { target: { value: "户外" } });
    fireEvent.change(screen.getByLabelText("最长时长（秒）"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("避免出现的内容"), { target: { value: "雨天" } });
    fireEvent.change(screen.getByLabelText("结果数量"), { target: { value: "48" } });
    fireEvent.click(screen.getByRole("button", { name: "检索镜头" }));
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ mode: "text", query: "森林", person_status: "detected", tags_all: ["户外"], duration_max_ms: 8000, exclude_query: "雨天", limit: 48 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存查询" })).toBeEnabled());
    expect(screen.getByRole("button", { name: /创建固定选集/ })).toBeDisabled();
    expect(screen.queryByRole("list", { name: "开始探索的步骤" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除条件，查看全部镜头" }));
    await waitFor(() => expect(requests.at(-1)).toEqual({ mode: "filter", limit: 24 }));
    expect(screen.getByLabelText("描述要查找的视频画面")).toHaveValue("");
    expect(screen.getByRole("button", { name: "人物标签" })).toHaveTextContent("全部人物状态");
    expect(screen.getByLabelText("必须包含标签")).toHaveValue("");
    expect(screen.getByLabelText("最长时长（秒）")).toHaveValue(null);
    expect(screen.getByLabelText("避免出现的内容")).toHaveValue("");
    client.clear();
  });

  it("describes an empty fixed snapshot independently from the current index", async () => {
    const collection = { id: "empty-collection", name: "空选集", search_id: "old-search", created_at: "2026-09-10T00:00:00Z", item_count: 0, manifest_sha256: "empty-sha", manifest: { items: [] } };
    server.use(
      http.get("http://api.test/api/media/saved-searches", () => HttpResponse.json({ items: [] })),
      http.get("http://api.test/api/media/collections", () => HttpResponse.json({ items: [collection] })),
      http.get("http://api.test/api/media/collections/empty-collection", () => HttpResponse.json(collection)),
    );
    const client = mount();
    await screen.findByText("还没有可检索的镜头");
    fireEvent.click(screen.getByRole("button", { name: "我的查询与选集" }));
    fireEvent.click(await screen.findByRole("button", { name: /空选集.*0 个镜头/ }));
    await screen.findByText("这个固定选集没有镜头");
    expect(screen.getByText("此选集的固定快照为空，可返回检索结果选择其他镜头。")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "开始探索的步骤" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "去创建处理流程" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回检索结果" }));
    await screen.findByText("还没有可检索的镜头");
    client.clear();
  });

});
