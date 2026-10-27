import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportEvents, loadDashboard, loadEvents } from "./api";
import { dashboardFixture } from "./mocks/handlers";
import { server } from "./test/server";

describe("loadDashboard", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns API data through MSW", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(http.get("http://api.test/api/flywheel", () => HttpResponse.json(dashboardFixture)));

    const result = await loadDashboard();

    expect(result.isFallback).toBe(false);
    expect(result.data.events[0]?.source).toBe("msw");
  });

  it("surfaces unavailable API instead of returning demo metrics", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(http.get("http://api.test/api/flywheel", () => new HttpResponse(null, { status: 503 })));

    await expect(loadDashboard()).rejects.toBeDefined();
  });

  it.each([401, 403])("does not hide HTTP %s with demo data", async (status) => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(http.get("http://api.test/api/flywheel", () => new HttpResponse(null, { status })));

    await expect(loadDashboard()).rejects.toMatchObject({ status });
  });
});

describe("event requests", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("loads events without requesting dashboard access", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    const dashboardRequest = vi.fn(() => new HttpResponse(null, { status: 403 }));
    server.use(
      http.get("http://api.test/api/flywheel", dashboardRequest),
      http.get("http://api.test/api/events", ({ request }) => {
        expect(request.credentials).toBe("include");
        return HttpResponse.json(dashboardFixture.events);
      }),
    );

    await expect(loadEvents()).resolves.toEqual(dashboardFixture.events);
    expect(dashboardRequest).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])("surfaces event API HTTP %s without fallback", async (status) => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(http.get("http://api.test/api/events", () => HttpResponse.json({ detail: "事件读取失败" }, { status })));

    await expect(loadEvents()).rejects.toMatchObject({ status, message: "事件读取失败" });
  });

  it("checks the export endpoint even when event data is already readable", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(
      http.get("http://api.test/api/events", () => HttpResponse.json(dashboardFixture.events)),
      http.get("http://api.test/api/events/export", () => HttpResponse.json({ detail: "Missing permission events:export" }, { status: 403 })),
    );

    await expect(loadEvents()).resolves.toEqual(dashboardFixture.events);
    await expect(exportEvents()).rejects.toMatchObject({ status: 403 });
  });
});
