import { defineConfig, devices } from "@playwright/test";

// Local web-server readiness checks must not go through a machine-wide proxy.
const localNoProxy = [...new Set([...(process.env.NO_PROXY ?? process.env.no_proxy ?? "").split(",").filter(Boolean), "localhost", "127.0.0.1", "::1"])].join(",");
process.env.NO_PROXY = localNoProxy;
process.env.no_proxy = localNoProxy;

// Allow independent task checks to run without sharing a test server or database.
const apiPort = Number(process.env.E2E_API_PORT ?? 8010);
const webPort = Number(process.env.E2E_WEB_PORT ?? 5174);
if (![apiPort, webPort].every((port) => Number.isInteger(port) && port > 0 && port < 65536)) throw new Error("Invalid E2E port");
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
process.env.E2E_OBJECT_ROOT ??= `/tmp/flywheel-e2e-objects-${process.pid}`;
process.env.E2E_MEDIA_ROOT ??= `/tmp/flywheel-e2e-media-${process.pid}`;
process.env.E2E_DATABASE_URL ??= `sqlite:////tmp/data-flywheel-e2e-${process.pid}.db`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: webBase,
    channel: "chromium",
    headless: true,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: `../../.venv/bin/python -m uvicorn app.main:app --app-dir ../api --host 127.0.0.1 --port ${apiPort}`,
      url: `${apiBase}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        AUTH_MODE: "dev",
        FLYWHEEL_OBJECT_BACKEND: "local",
        FLYWHEEL_OBJECT_ROOT: process.env.E2E_OBJECT_ROOT,
        FLYWHEEL_MEDIA_ROOT: process.env.E2E_MEDIA_ROOT,
        COOKIE_SECURE: "false",
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? `sqlite:////tmp/data-flywheel-e2e-${process.pid}.db`,
        FRONTEND_URL: webBase,
      },
    },
    {
      command: `npm run dev -- --port ${webPort}`,
      url: webBase,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_API_BASE_URL: apiBase,
      },
    },
  ],
});
