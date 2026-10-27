import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachMediaEvaluationScheme, createMediaEvaluation, createMediaReflow, judgeMediaEvaluation, loadMediaReflows, reviewMediaEvaluation } from "./media-evaluation-api";
import { server } from "./test/server";

describe("persistent media evaluation API contracts", () => {
  beforeEach(() => vi.stubEnv("VITE_API_BASE_URL", "http://api.test"));
  afterEach(() => vi.unstubAllEnvs());
  it("freezes actual search sessions with project scope and CSRF", async () => {
    server.use(http.post("http://api.test/api/media/evaluations", async ({ request }) => {
      expect(new URL(request.url).searchParams.get("project_id")).toBe("project/one");
      expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
      expect(request.credentials).toBe("include");
      expect(await request.json()).toEqual({ name: "对比基准", search_ids: ["real-a", "real-b"], k: 5 });
      return HttpResponse.json({ id: "benchmark" }, { status: 201 });
    }));
    await expect(createMediaEvaluation("project/one", { name: "对比基准", search_ids: ["real-a", "real-b"], k: 5 }, "csrf")).resolves.toMatchObject({ id: "benchmark" });
  });
  it("clears grades explicitly and sends the exact revision for judgments, review and scheme attachment", async () => {
    const bodies: unknown[] = [];
    server.use(http.post("http://api.test/api/media/evaluations/eval/:action", async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ id: "eval" }); }));
    await judgeMediaEvaluation("demo", "eval", "shot", null, "csrf", 3);
    await reviewMediaEvaluation("demo", "eval", true, "csrf", 4);
    await attachMediaEvaluationScheme("demo", "eval", "actual-search", "  baseline  ", "csrf", 5);
    expect(bodies).toEqual([{ shot_id: "shot", grade: "clear", expected_revision: 3 }, { reviewed: true, review_source: "human", expected_revision: 4 }, { search_id: "actual-search", label: "baseline", expected_revision: 5 }]);
  });
  it("preserves backend conflict messages without inventing quality results", async () => {
    server.use(http.post("http://api.test/api/media/evaluations/eval/schemes", () => HttpResponse.json({ detail: "新候选不属于冻结候选池，请重建并集基准" }, { status: 409 })));
    await expect(attachMediaEvaluationScheme("demo", "eval", "new-session", "", "csrf", 2)).rejects.toThrow("新候选不属于冻结候选池");
  });
  it("sends explicit reflow source, issue and stable idempotency key and scopes persisted records", async () => {
    const input = { evaluation_id: "eval", idempotency_key: "stable-key", shot_ids: ["bad-shot"], name: "返工", issue: "人工确认误召回", action: "selection" as const };
    server.use(
      http.post("http://api.test/api/media/reflows", async ({ request }) => { expect(await request.json()).toEqual(input); return HttpResponse.json({ created: true, feedback_ids: ["feedback"], dataset_id: "dataset", selection_id: "selection", url: "/projects/demo/datasets/dataset" }); }),
      http.get("http://api.test/api/media/reflows", ({ request }) => { expect(new URL(request.url).searchParams.get("evaluation_id")).toBe("eval/one"); expect(new URL(request.url).searchParams.get("project_id")).toBe("demo"); return HttpResponse.json({ items: [] }); }),
    );
    await expect(createMediaReflow("demo", input, "csrf")).resolves.toMatchObject({ created: true });
    await expect(loadMediaReflows("demo", "eval/one")).resolves.toEqual({ items: [] });
  });
});
