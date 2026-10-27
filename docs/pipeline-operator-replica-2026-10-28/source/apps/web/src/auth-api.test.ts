import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMe, startImpersonation, type MeResponse } from "./auth-api";
import { server } from "./test/server";

const meFixture: MeResponse = {
  actor: { id: "admin", username: "platform-admin", display_name: "平台管理员", email: null },
  user: { id: "viewer", username: "project-viewer", display_name: "项目观察员", email: null },
  scope: { type: "project", id: "demo" },
  roles: ["project_viewer"],
  groups: ["demo-observers"],
  permissions: ["dashboard:view", "events:read"],
  can_impersonate: true,
  csrf_token: "rotated-token",
  auth_mode: "dev",
  impersonation: {
    active: true,
    started_at: "2026-09-05T10:00:00Z",
    expires_at: "2026-09-05T10:15:00Z",
    reason: "Investigate visibility issue",
  },
};

describe("authentication API", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("represents an unauthenticated session as null", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(http.get("http://api.test/api/me", () => new HttpResponse(null, { status: 401 })));

    await expect(loadMe()).resolves.toBeNull();
  });

  it("requests permissions for the project displayed by the page", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(http.get("http://api.test/api/me", ({ request }) => {
      expect(new URL(request.url).searchParams.get("project_id")).toBe("research-team");
      return HttpResponse.json({ ...meFixture, scope: { type: "project", id: "research-team" } });
    }));

    const result = await loadMe("research-team");
    expect(result?.scope.id).toBe("research-team");
  });

  it("sends CSRF and the controlled impersonation payload", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    server.use(http.post("http://api.test/api/admin/impersonation/start", async ({ request }) => {
      expect(request.headers.get("x-csrf-token")).toBe("csrf-token");
      expect(await request.json()).toEqual({
        target_user_id: "viewer",
        reason: "Investigate visibility issue",
        duration_minutes: 15,
      });
      return HttpResponse.json(meFixture);
    }));

    const result = await startImpersonation({
      target_user_id: "viewer",
      reason: "Investigate visibility issue",
      duration_minutes: 15,
    }, "csrf-token");

    expect(result.user.username).toBe("project-viewer");
    expect(result.impersonation.active).toBe(true);
  });
});
