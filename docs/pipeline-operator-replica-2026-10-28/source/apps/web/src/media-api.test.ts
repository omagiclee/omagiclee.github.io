import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoPipeline, MAX_QUERY_IMAGE_BYTES, mediaFileUrl, queryImagePreviewUrl, readQueryImage, searchMedia } from "./media-api";
import { server } from "./test/server";

describe("media API contract", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("preserves project scope, person filters and requested embedding space", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(http.post("http://api.test/api/media/search", async ({ request }) => {
      expect(new URL(request.url).searchParams.get("project_id")).toBe("demo/project");
      expect(request.headers.get("x-csrf-token")).toBe("test-csrf");
      expect(await request.json()).toEqual({ mode: "text", query: "在森林中行走的人", person_status: "detected", embedding_space: "hybrid", limit: 24 });
      return HttpResponse.json({ items: [], total: 0, mode: "text" });
    }));
    await expect(searchMedia("demo/project", { mode: "text", query: "在森林中行走的人", person_status: "detected", embedding_space: "hybrid", limit: 24 }, "test-csrf")).resolves.toEqual({ items: [], total: 0, mode: "text" });
  });

  it("surfaces model preparation failures without presenting empty successful search", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(http.post("http://api.test/api/media/search", () => HttpResponse.json({ detail: { issues: ["SigLIP2 权重尚未准备", "Milvus 无法连接"] } }, { status: 503 })));
    await expect(searchMedia("demo", { mode: "text", query: "森林", limit: 24 }, "token")).rejects.toThrow("SigLIP2 权重尚未准备；Milvus 无法连接");
  });

  it("omits custom source URLs to let the backend select its documented examples", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(http.post("http://api.test/api/media/demo-pipeline", async ({ request }) => {
      expect(await request.json()).toEqual({});
      return HttpResponse.json({ pipeline_id: "p1", name: "视频流程", version: 1 });
    }));
    await expect(createDemoPipeline("demo", "token")).resolves.toMatchObject({ pipeline_id: "p1" });
  });

  it("rejects empty, unsupported and oversized uploads before sending image content", async () => {
    await expect(readQueryImage(new File([], "empty.png", { type: "image/png" }))).rejects.toThrow("图片为空");
    await expect(readQueryImage(new File(["<svg />"], "vector.svg", { type: "image/svg+xml" }))).rejects.toThrow("JPEG、PNG 或 WebP");
    const file = new File([new Uint8Array(MAX_QUERY_IMAGE_BYTES + 1)], "large.jpg", { type: "image/jpeg" });
    await expect(readQueryImage(file)).rejects.toThrow("不能超过 6 MB");
  });

  it("reads valid query images and resolves only authenticated media file URLs", async () => {
    const encoded = await readQueryImage(new File([new Uint8Array([1, 2, 3])], "frame.png", { type: "image/png" }));
    expect(encoded).toBe("data:image/png;base64,AQID");
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    expect(mediaFileUrl("/api/media/files/f1?kind=frame&project_id=demo")).toBe("http://api.test/api/media/files/f1?kind=frame&project_id=demo");
    expect(mediaFileUrl("https://untrusted.example/image.png")).toBeUndefined();
    expect(mediaFileUrl(null)).toBeUndefined();
  });

  it("previews materialized saved reference images without treating raw base64 as a URL", () => {
    expect(queryImagePreviewUrl("/9j/4AAQSkZJRg==")).toBe("data:image/jpeg;base64,/9j/4AAQSkZJRg==");
    expect(queryImagePreviewUrl("iVBORw0KGgoAAA==")).toBe("data:image/png;base64,iVBORw0KGgoAAA==");
    expect(queryImagePreviewUrl("UklGRgAAAAA=")).toBe("data:image/webp;base64,UklGRgAAAAA=");
    expect(queryImagePreviewUrl("data:image/png;base64,AQID")).toBe("data:image/png;base64,AQID");
    expect(queryImagePreviewUrl("https://untrusted.example/picture.png")).toBeUndefined();
    expect(queryImagePreviewUrl("data:text/html;base64,AQID")).toBeUndefined();
  });
});
