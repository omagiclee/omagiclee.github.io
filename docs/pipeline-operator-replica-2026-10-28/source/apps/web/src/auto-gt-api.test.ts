import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoGtImageUrl, createAutoGtJob, downloadAutoGtArchive, reviewAutoGtPair, uploadAutoGtSource, type AutoGtJob, type AutoGtPair } from "./auto-gt-api";
import * as telemetry from "./telemetry";
import { server } from "./test/server";
describe("AutoGT actual API contracts", () => {
  beforeEach(() => vi.stubEnv("VITE_API_BASE_URL", "http://api.test"));
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("uploads source bytes with the selected role, project and CSRF", async () => {
    const file = new File(["bytes"], "mask.png", { type: "image/png" });
    const fetch = vi.spyOn(telemetry, "instrumentedFetch").mockResolvedValue(Response.json({ id: "source", review_status: "pending" }));
    await expect(uploadAutoGtSource("project/one", file, "mask", "csrf")).resolves.toMatchObject({ review_status: "pending" });
    const [url, options] = fetch.mock.calls[0];
    const query = new URL(String(url)).searchParams;
    expect(query.get("project_id")).toBe("project/one"); expect(query.get("filename")).toBe("mask.png"); expect(query.get("role")).toBe("mask");
    expect(options).toMatchObject({ method: "POST", credentials: "include", headers: { "X-CSRF-Token": "csrf", "Content-Type": "application/octet-stream" } }); expect(options?.body).toBe(file);
  });
  it("keeps blocked external jobs blocked and sends review revision without changing reference type", async () => {
    server.use(
      http.post("http://api.test/api/auto-gt/jobs", async ({ request }) => { expect(await request.json()).toMatchObject({ recipe: "generative_relight", idempotency_key: "key" }); return HttpResponse.json({ id: "job", status: "blocked", blocked_reason: "外部引擎未配置", pairs: [] }, { status: 202 }); }),
      http.post("http://api.test/api/auto-gt/pairs/pair/review", async ({ request }) => { expect(await request.json()).toEqual({ decision: "accepted", expected_revision: 2 }); return HttpResponse.json({ id: "pair", reference_kind: "generated_pseudo", review_status: "accepted" }); }),
    );
    await expect(createAutoGtJob("demo", { name: "blocked", recipe: "generative_relight", source_ids: ["source"], seed: 42, variants: 1, idempotency_key: "key" }, "csrf")).resolves.toMatchObject({ status: "blocked", pairs: [] });
    await expect(reviewAutoGtPair("demo", { id: "pair", revision: 2 } as AutoGtPair, "accepted", "csrf")).resolves.toMatchObject({ reference_kind: "generated_pseudo" });
  });
  it("uses approved-only archives and surfaces export failures before browser download", async () => {
    server.use(http.get("http://api.test/api/auto-gt/jobs/job/archive", ({ request }) => { expect(new URL(request.url).searchParams.get("approved_only")).toBe("true"); return HttpResponse.json({ detail: "没有已接受配对" }, { status: 409 }); }));
    await expect(downloadAutoGtArchive("demo", { id: "job" } as AutoGtJob)).rejects.toThrow("没有已接受配对");
  });
  it("only resolves authenticated source and pair image endpoints", () => {
    expect(autoGtImageUrl("/api/auto-gt/sources/source/content?project_id=demo")).toBe("http://api.test/api/auto-gt/sources/source/content?project_id=demo");
    expect(autoGtImageUrl("https://untrusted.example/image.png")).toBeUndefined();
    expect(autoGtImageUrl("/api/auto-gt/jobs/job/archive")).toBeUndefined();
  });
  it("downloads an approved-only archive with a safe ZIP filename after the HTTP response succeeds", async () => {
    const createObjectURL = vi.fn(() => "blob:approved-pairs");
    const OriginalURL = URL;
    vi.stubGlobal("URL", class extends OriginalURL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn(); });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    server.use(http.get("http://api.test/api/auto-gt/jobs/job/archive", () => new HttpResponse(new Uint8Array([80, 75, 3, 4]), { headers: { "Content-Type": "application/zip" } })));
    await downloadAutoGtArchive("demo", { id: "job", name: "接受/配对" } as AutoGtJob);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe("接受_配对.zip");
  });
});
