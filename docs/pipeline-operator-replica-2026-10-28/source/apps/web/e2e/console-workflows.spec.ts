import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

function emptyProject() {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl?.startsWith("sqlite:////tmp/data-flywheel-e2e-")) throw new Error("Empty-catalog tests require an isolated temporary database");
  const projectId = `e2e-empty-${randomUUID()}`;
  execFileSync(resolve("../../.venv/bin/python"), ["-c", `
import sys
from app.database import SessionLocal
from app.models import Project
with SessionLocal() as db:
    db.add(Project(id=sys.argv[1], name="空目录验收项目"))
    db.commit()
`, projectId], { env: { ...process.env, DATABASE_URL: databaseUrl, PYTHONPATH: resolve("../api"), AUTH_MODE: "dev" } });
  return projectId;
}

test("mobile project recovery stays in navigation without enlarging the utility header", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  let projectsFail = true;
  await page.route("**/api/projects", (route) => projectsFail
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "项目暂时不可用" }) })
    : route.continue());
  await page.goto("/projects/demo/pipelines");
  await page.getByRole("button", { name: "打开主导航" }).click();
  const drawer = page.getByRole("dialog", { name: "Data Flywheel" });
  const retry = drawer.getByRole("button", { name: "重试项目列表", exact: true });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  const measuredHeader = async () => page.locator(".app-shell").evaluate((shell) => ({
    height: shell.querySelector(".app-header")!.getBoundingClientRect().height,
    reserved: parseFloat(getComputedStyle(shell).getPropertyValue("--console-header-height")),
  }));
  await expect.poll(async () => { const header = await measuredHeader(); return Math.abs(header.height - header.reserved); }).toBeLessThan(1);
  const failedHeight = (await measuredHeader()).height;
  projectsFail = false;
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(drawer.getByRole("combobox", { name: "切换项目", exact: true })).toHaveCount(0);
  expect(failedHeight).toBeLessThanOrEqual(49);
  await expect.poll(async () => (await measuredHeader()).height).toBe(failedHeight);
  await expect.poll(async () => { const header = await measuredHeader(); return Math.abs(header.height - header.reserved); }).toBeLessThan(1);
});

for (const width of [1440, 390]) {
  test(`resource content stays near the top at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/requirements");
    const firstRecord = page.locator(".req-table-row").first();
    await expect(firstRecord).toBeVisible();
    expect((await firstRecord.boundingBox())!.y).toBeLessThan(width === 390 ? 360 : 290);
    await expect(page.getByRole("button", { name: "筛选全部状态" })).toHaveCount(1);
    if (width === 390) {
      const extra = page.locator(".req-extra-filters");
      await expect(extra.getByRole("button", { name: "筛选需求方向" })).toBeHidden();
      await extra.locator("summary").click();
      await extra.getByRole("button", { name: "筛选需求方向" }).click();
      await page.getByRole("menuitemradio", { name: "平台开发", exact: true }).click();
      await expect(extra.getByRole("button", { name: "筛选需求方向" })).toContainText("平台开发");
      await extra.getByRole("button", { name: "清除筛选", exact: true }).click();
      await expect(extra.getByRole("button", { name: "筛选需求方向" })).toContainText("全部方向");
      await extra.locator("summary").click();
    }
    await page.goto("/projects/demo/explore");
    const results = page.locator(".media-results-heading");
    await expect(results).toBeVisible();
    expect((await results.boundingBox())!.y).toBeLessThan(width === 390 ? 650 : 500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("first dataset import is available from the empty state and detail tabs support keyboard navigation", async ({ page }) => {
  await page.goto(`/projects/${emptyProject()}/datasets`);
  const empty = page.locator(".platform-resource-empty");
  await expect(empty.getByRole("heading", { name: "还没有数据集" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "分页", exact: true })).toHaveCount(0);
  await empty.getByRole("button", { name: "导入数据" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const name = `控制台交互检查 ${Date.now()}`;
  await dialog.getByLabel("数据集名称").fill(name);
  await dialog.getByLabel("样本内容").fill("真实浏览器导入样本");
  await dialog.getByRole("button", { name: "创建数据集" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const dataTab = page.getByRole("tab", { name: "数据", exact: true });
  await dataTab.focus();
  await page.keyboard.press("ArrowRight");
  const versionTab = page.getByRole("tab", { name: "版本", exact: true });
  await expect(versionTab).toBeFocused();
  await expect(versionTab).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: "版本", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("id", (await versionTab.getAttribute("aria-controls"))!);
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "血缘与使用", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "血缘与使用", exact: true })).toBeVisible();
});

test("an empty training catalog offers a task action without meaningless pagination", async ({ page }) => {
  await page.goto(`/projects/${emptyProject()}/training`);
  const empty = page.locator(".platform-resource-empty");
  await expect(empty.getByRole("heading", { name: "还没有训练任务" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "训练任务分页" })).toHaveCount(0);
  await empty.getByRole("button", { name: "新建训练" }).click();
  await expect(page.getByRole("dialog", { name: "新建视频训练" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
