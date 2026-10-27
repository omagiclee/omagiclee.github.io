import { afterEach, describe, expect, it, vi } from "vitest";
import { BehaviorCollector, canTrackPage, instrumentedFetch, interactionForEvent, observeBehavior, pageForPath, projectForLocation, type BehaviorEvent } from "./telemetry";

function harness() {
  let time = 0;
  let visible = true;
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"accepted":1}'));
  const collector = new BehaviorCollector(transport, () => time, () => visible);
  collector.configure("actor:user:demo", "csrf-one");
  return {
    collector, transport,
    advance: (ms: number) => { time += ms; },
    visibility: (value: boolean) => { visible = value; collector.visibilityChanged(value); },
    events: () => transport.mock.calls.flatMap(([, options]) => (JSON.parse(String(options?.body)) as { events: BehaviorEvent[] }).events),
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("content-free behavior collection", () => {
  it("uses stable page names and omits query text and object identifiers", async () => {
    expect(pageForPath("/requirements/private-id?query=secret")).toEqual({ id: "requirement_detail", label: "需求详情" });
    expect(pageForPath("/projects/demo/training?job=private")).toEqual({id:"training",label:"视频训练平台"});
    expect(canTrackPage("/projects/demo/training",["data_platform:read"])).toBe(true);
    expect(canTrackPage("/projects/demo/training",["media:read"])).toBe(false);
    expect(pageForPath("/admin/audit")).toEqual({ id: "audit", label: "操作审计" });
    expect(pageForPath("/unregistered")).toBeNull();
    const h = harness();
    h.collector.navigate("/requirements/private-id?query=secret");
    await h.collector.flush();
    expect(JSON.stringify(h.events())).not.toMatch(/secret|private-id|csrf-one|actor:user/);
    expect(h.transport.mock.calls[0][1]).toMatchObject({ credentials: "include", headers: { "X-CSRF-Token": "csrf-one" } });
  });

  it("deduplicates repeated route setup and exposure per visit, counting a new visit after leaving", async () => {
    const h = harness();
    h.collector.navigate("/media"); h.collector.navigate("/media");
    h.collector.expose("media.search.submit", "检索镜头"); h.collector.expose("media.search.submit", "检索镜头");
    h.collector.navigate("/pipelines"); h.collector.navigate("/media"); h.collector.expose("media.search.submit", "检索镜头");
    await h.collector.flush();
    expect(h.events().filter((event) => event.kind === "page_view")).toHaveLength(3);
    expect(h.events().filter((event) => event.kind === "button_exposure")).toHaveLength(2);
  });

  it("preserves each event's project across queued visits without counting unrelated filter changes as page views", async () => {
    const h = harness(); h.collector.configure("same-user", "csrf-one", "demo");
    h.collector.navigate("/pipelines?days=7", projectForLocation("/pipelines", "?project_id=demo&days=7", "demo"));
    h.collector.expose("pipelines.run", "运行"); h.collector.click("pipelines.run", "运行");
    h.collector.navigate("/pipelines?days=30", projectForLocation("/pipelines", "?project_id=demo&days=30", "demo"));
    h.collector.navigate("/pipelines", projectForLocation("/pipelines", "?project_id=other&query=private", "demo"));
    h.collector.expose("pipelines.run", "运行"); h.collector.click("pipelines.run", "运行");
    h.collector.navigate("/pipelines", "other");
    // A default-scope change also preserves the previous project's queued events.
    h.collector.configure("same-user", "csrf-one", "third"); h.collector.navigate("/pipelines");
    await h.collector.flush();
    expect(h.events().filter((event) => event.kind === "page_view").map((event) => event.project_id)).toEqual(["demo", "other", "third"]);
    expect(h.events().filter((event) => event.kind === "page_leave").map((event) => event.project_id)).toEqual(["demo", "other"]);
    expect(h.events().filter((event) => event.kind === "button_click").map((event) => event.project_id)).toEqual(["demo", "other"]);
    expect(h.events().filter((event) => event.kind === "button_exposure").map((event) => event.project_id)).toEqual(["demo", "other"]);
    expect(JSON.stringify(h.events())).not.toMatch(/days|query|private/);
    expect(projectForLocation("/operations", "?project_id=*&days=30", "demo")).toBe("demo");
    expect(projectForLocation("/unregistered", "?project_id=other", "demo")).toBe("demo");
  });

  it("does not collect denied or unknown pages that would invalidate an otherwise authorized batch", () => {
    expect(pageForPath("/operators?project_id=linked")).toEqual({ id: "operators", label: "算子与插件" });
    expect(canTrackPage("/operators", [])).toBe(false);
    expect(canTrackPage("/operators", ["pipelines:read"])).toBe(true);
    expect(projectForLocation("/operators", "?project_id=linked&query=private", "demo")).toBe("linked");
    expect(canTrackPage("/media", [])).toBe(false);
    expect(canTrackPage("/media", ["media:read"])).toBe(true);
    expect(canTrackPage("/admin/audit", ["users:read"])).toBe(false);
    expect(canTrackPage("/access", [])).toBe(true);
    expect(canTrackPage("/notifications", [])).toBe(true);
    expect(canTrackPage("/unregistered", ["dashboard:view"])).toBe(false);
  });

  it("records only foreground duration and does not count a direct page entry as menu click", async () => {
    const h = harness(); h.collector.navigate("/media"); h.advance(1000);
    h.visibility(false); h.advance(10_000); h.visibility(true); h.advance(500);
    h.collector.navigate("/pipelines"); await h.collector.flush();
    expect(h.events().find((event) => event.kind === "page_leave")?.duration_ms).toBe(1500);
    expect(h.events().filter((event) => event.kind === "menu_click")).toHaveLength(0);
  });

  it("drops stale pending events when identity changes and starts a new visit", async () => {
    const h = harness(); h.collector.navigate("/media"); h.collector.click("media.pipeline.run", "运行");
    h.collector.configure("actor:other:demo", "csrf-two"); h.collector.navigate("/pipelines"); await h.collector.flush();
    expect(h.events()).toMatchObject([{ kind: "page_view", page_id: "pipelines" }]);
    expect(h.transport.mock.calls[0][1]?.headers).toMatchObject({ "X-CSRF-Token": "csrf-two" });
  });

  it("finishes old-identity delivery before changing the server session and ignores clicks until reconfigured", async () => {
    const h = harness(); h.collector.navigate("/media");
    const order: string[] = [];
    let finish!: (response: Response) => void;
    h.transport.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; order.push("send"); }));
    const transition = h.collector.changeIdentity(async () => { order.push("switch"); return "changed"; });
    expect(order).toEqual(["send"]);
    expect(h.collector.click("media.pipeline.run", "运行")).toBeUndefined();
    finish(new Response());
    await expect(transition).resolves.toBe("changed");
    expect(order).toEqual(["send", "switch"]);
    h.collector.configure("actor:other:demo", "csrf-two"); h.collector.navigate("/media"); await h.collector.flush();
    expect(h.events().filter((event) => event.kind === "page_view")).toHaveLength(2);
  });

  it("keeps a bounded queue and batch size, flushes within one second, and swallows collection failures", async () => {
    vi.useFakeTimers();
    const h = harness(); h.collector.navigate("/media");
    for (let index = 0; index < 250; index++) h.collector.click("media.search.submit", "检索镜头");
    h.transport.mockRejectedValue(new Error("offline"));
    await vi.advanceTimersByTimeAsync(750);
    expect(h.events()).toHaveLength(200);
    expect(h.transport.mock.calls).toHaveLength(4);
    expect(h.transport.mock.calls.every(([, options]) => JSON.parse(String(options?.body)).events.length <= 50)).toBe(true);
    await expect(h.collector.changeIdentity(async () => "business result")).resolves.toBe("business result");
  });

  it("timestamps a click when it occurs, before the immediate audit and later batch delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T03:00:00.000Z"));
    const h = harness(); h.collector.navigate("/media");
    h.collector.click("media.search.submit", "检索镜头");
    await vi.advanceTimersByTimeAsync(40);
    const businessAuditTime = Date.now();
    await vi.advanceTimersByTimeAsync(710);
    const click = h.events().find((event) => event.kind === "button_click")!;
    expect(click.occurred_at).toBe("2026-09-10T03:00:00.000Z");
    expect(Date.parse(click.occurred_at)).toBeLessThanOrEqual(businessAuditTime);
    expect(Date.parse(click.occurred_at)).toBeLessThan(Date.now());
  });

  it("associates only explicitly supplied interactions, preserving CSRF and leaving background requests unassociated", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response()); vi.stubGlobal("fetch", request);
    const h = harness(); h.collector.navigate("/pipelines");
    const context = h.collector.click("pipelines.run", "运行当前版本");
    await instrumentedFetch("/api/pipelines/p1/runs", { method: "POST", headers: { "X-CSRF-Token": "token" } }, context);
    await instrumentedFetch("/api/pipeline-runs");
    const headers = new Headers(request.mock.calls[0][1]?.headers);
    expect(headers.get("X-Interaction-Id")).toBe(context?.interaction_id);
    expect(headers.get("X-Page-Id")).toBe("pipelines"); expect(headers.get("X-CSRF-Token")).toBe("token");
    expect(request.mock.calls[1][1]?.headers).toBeUndefined();
    h.collector.discard();
  });

  it("observes only explicit visible controls, deduplicates submit clicks, and never reads form values", async () => {
    const h = harness(); h.collector.navigate("/media");
    const callbacks: IntersectionObserverCallback[] = [];
    const observed = new Set<Element>();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
      observe(element: Element) { observed.add(element); }
      unobserve(element: Element) { observed.delete(element); }
      disconnect() { observed.clear(); }
    });
    document.body.innerHTML = '<a data-track-kind="menu_click" data-track-id="nav.media" data-track-label="视频检索">菜单</a><form><input value="private query"><button type="submit" data-track-id="media.search.submit" data-track-label="检索镜头">private title</button><button type="button">untracked</button></form><button hidden data-track-id="media.hidden" data-track-label="隐藏">hidden</button>';
    const stop = observeBehavior(document, h.collector);
    const button = document.querySelector('button[type="submit"]')!;
    expect(observed.size).toBe(2);
    callbacks[0]([...observed].map((target) => ({ target, isIntersecting: true, intersectionRatio: 1 })) as IntersectionObserverEntry[], {} as IntersectionObserver);
    let clickedContext: unknown; let submittedContext: unknown;
    button.addEventListener("click", (event) => { clickedContext = interactionForEvent(event); });
    document.querySelector("form")!.addEventListener("submit", (event) => { event.preventDefault(); submittedContext = interactionForEvent(event); });
    (button as HTMLButtonElement).click();
    await h.collector.flush();
    expect(clickedContext).toBeDefined(); expect(submittedContext).toEqual(clickedContext);
    expect(h.events().filter((event) => event.kind === "button_click")).toHaveLength(1);
    expect(h.events().filter((event) => event.kind === "button_exposure")).toMatchObject([{ element_id: "media.search.submit" }]);
    expect(JSON.stringify(h.events())).not.toMatch(/private|untracked/);
    stop();
  });
});
