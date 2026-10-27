import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { MediaUpload } from "./MediaUpload";

const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("../auth-context", () => ({ useProjectAuth: () => ({ me: { csrf_token: "upload-csrf" }, can: (key: string) => access.allowed && ["pipelines:write", "pipelines:run", "pipelines:read", "operators:register"].includes(key) }) }));

vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

function mount(onImported?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MediaUpload projectId="linked-project" onImported={onImported} /></QueryClientProvider>);
  return client;
}
function openUpload(onImported?: () => void) {
  mount(onImported);
  fireEvent.click(screen.getByRole("button", { name: "上传源视频" }));
  return screen.getByLabelText("源视频文件");
}

const video = () => new File(["video"], "森林片段.mp4", { type: "video/mp4" });

describe("project source upload", () => {
  beforeEach(() => { access.allowed = true; vi.stubEnv("VITE_API_BASE_URL", "http://api.test"); });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  it("requires pipeline write access", () => {
    access.allowed = false;
    mount();
    expect(screen.queryByRole("button", { name: "上传源视频" })).not.toBeInTheDocument();
  });

  it("uploads with the selected project, filename and CSRF and exposes the returned address", async () => {
    server.use(http.post("http://api.test/api/media/uploads", ({ request }) => {
      const params = new URL(request.url).searchParams;
      expect(params.get("project_id")).toBe("linked-project");
      expect(params.get("filename")).toBe("森林片段.mp4");
      expect(request.headers.get("X-CSRF-Token")).toBe("upload-csrf");
      expect(request.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(request.credentials).toBe("include");
      return HttpResponse.json({ object_uri: "fdf://linked-project/sources/forest.mp4" });
    }));
    fireEvent.change(openUpload(), { target: { files: [video()] } });
    await screen.findByText("视频已上传");
    expect(screen.getByLabelText("项目文件地址")).toHaveValue("fdf://linked-project/sources/forest.mp4");
    expect(screen.getByRole("button", { name: "完成" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("clears a previous success when an oversized file is chosen and sends no second request", async () => {
    let requests = 0;
    server.use(http.post("http://api.test/api/media/uploads", () => { requests++; return HttpResponse.json({ object_uri: "fdf://linked-project/source.mp4" }); }));
    const input = openUpload();
    fireEvent.change(input, { target: { files: [video()] } });
    await screen.findByText("视频已上传");
    const oversized = video(); Object.defineProperty(oversized, "size", { value: 650 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(screen.getByRole("alert")).toHaveTextContent("不能超过 650 MiB");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/最大 650 MiB.*源文件不能超过 650 MiB/);
    expect(screen.queryByLabelText("项目文件地址")).not.toBeInTheDocument();
    expect(requests).toBe(1);
  });

  it("keeps the dialog open and controls disabled until a pending upload resolves", async () => {
    let release!: () => void;
    server.use(http.post("http://api.test/api/media/uploads", async () => { await new Promise<void>((resolve) => { release = resolve; }); return HttpResponse.json({ object_uri: "fdf://linked-project/source.mp4" }); }));
    const input = openUpload();
    fireEvent.change(input, { target: { files: [video()] } });
    await screen.findByText("正在上传，请保持此窗口打开。");
    await waitFor(() => expect(release).toBeTypeOf("function"));
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭上传窗口" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^关闭$/ })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => release());
    await screen.findByText("视频已上传");
    expect(input).toBeEnabled();
  });

  it("shows rejected upload feedback without claiming success", async () => {
    server.use(http.post("http://api.test/api/media/uploads", () => HttpResponse.json({ detail: "当前项目存储不可用，请稍后重试。" }, { status: 503 })));
    fireEvent.change(openUpload(), { target: { files: [video()] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("当前项目存储不可用");
    expect(screen.queryByText("视频已上传")).not.toBeInTheDocument();
    expect(screen.getByLabelText("源视频文件")).toBeEnabled();
    expect(screen.getByLabelText("源视频文件")).toHaveAccessibleDescription(/最大 650 MiB.*当前项目存储不可用/);
    expect(screen.getByLabelText("源视频文件")).toHaveAttribute("aria-invalid", "false");
  });

  it("submits the uploaded object once and announces publication only after a successful run", async () => {
    const onImported = vi.fn();
    let submissions = 0;
    const run = { id: "import-run", pipeline_id: "import-pipeline", status: "pending", tasks: [], error: null };
    server.use(
      http.post("http://api.test/api/media/uploads", () => HttpResponse.json({ object_uri: "fdf://linked-project/source.mp4" })),
      http.post("http://api.test/api/media/imports", async ({ request }) => {
        submissions++;
        expect(new URL(request.url).searchParams.get("project_id")).toBe("linked-project");
        expect(request.headers.get("X-CSRF-Token")).toBe("upload-csrf");
        expect(await request.json()).toEqual({ object_uri: "fdf://linked-project/source.mp4", title: "森林片段.mp4", idempotency_key: expect.any(String) });
        return HttpResponse.json(run, { status: 202 });
      }),
      http.get("http://api.test/api/pipeline-runs/import-run", () => HttpResponse.json({ ...run, status: "succeeded" })),
    );
    fireEvent.change(openUpload(onImported), { target: { files: [video()] } });
    await screen.findByText("视频已上传");
    expect(onImported).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "处理并发布镜头" }));
    await screen.findByText("镜头索引已发布，可以关闭窗口开始检索。");
    expect(submissions).toBe(1);
    expect(onImported).toHaveBeenCalledOnce();
    expect(screen.getByText("查看处理运行")).toBeInTheDocument();
  });

  it("retries failed execution with the same source and a fresh import key without uploading again", async () => {
    let uploads = 0;
    const keys: string[] = [];
    const onImported = vi.fn();
    server.use(
      http.post("http://api.test/api/media/uploads", () => { uploads++; return HttpResponse.json({ object_uri: "fdf://linked-project/source.mp4" }); }),
      http.post("http://api.test/api/media/imports", async ({ request }) => {
        keys.push((await request.json() as { idempotency_key: string }).idempotency_key);
        return HttpResponse.json({ id: `run-${keys.length}`, pipeline_id: "pipeline", status: "pending", tasks: [], error: null }, { status: 202 });
      }),
      http.get("http://api.test/api/pipeline-runs/:id", ({ params }) => HttpResponse.json({ id: params.id, pipeline_id: "pipeline", status: "failed", tasks: [], error: "模型不可用" })),
    );
    fireEvent.change(openUpload(onImported), { target: { files: [video()] } });
    await screen.findByText("视频已上传");
    fireEvent.click(screen.getByRole("button", { name: "处理并发布镜头" }));
    await screen.findByText("模型不可用");
    expect(onImported).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新处理视频" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).not.toBe(keys[1]);
    expect(uploads).toBe(1);
  });
});
