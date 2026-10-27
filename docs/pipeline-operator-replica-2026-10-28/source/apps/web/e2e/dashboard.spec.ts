import { expect, test } from "@playwright/test";

for (const width of [1440, 390, 320]) {
  test(`overview keeps filters compact and supports keyboard period selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const summary = page.getByRole("region", { name: "核心指标" });
    await expect(summary).toBeVisible();
    const initialScope = new URL(page.url()).searchParams.get("project_id");
    const period = page.getByRole("button", { name: "统计周期", exact: true });
    await period.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "统计周期" })).toBeVisible();
    await page.getByRole("menuitemradio", { name: "最近 30 天" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/days=30/);
    await expect(period).toBeFocused();
    await expect(period).toHaveText("最近 30 天");
    if (initialScope) expect(new URL(page.url()).searchParams.get("project_id")).toBe(initialScope);
    await expect(summary).toBeVisible();
    const before = await summary.boundingBox();
    expect(before!.y).toBeLessThanOrEqual(width === 1440 ? 170 : 220);
    const notes = page.locator(".dashboard-statistics-notes summary");
    const notesTarget = await notes.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const extension = getComputedStyle(element, "::before");
      const top = box.top + parseFloat(extension.top);
      const bottom = box.bottom - parseFloat(extension.bottom);
      return { x: box.left + 10, top, bottom, height: bottom - top };
    });
    expect(notesTarget.height).toBeGreaterThanOrEqual(48);
    const refreshBox = await page.getByRole("button", { name: "刷新统计" }).boundingBox();
    expect(notesTarget.top).toBeGreaterThanOrEqual(refreshBox!.y + refreshBox!.height);
    await page.mouse.click(notesTarget.x, notesTarget.top + 2);
    await expect(page.getByText(/日趋势按 UTC 统计/)).toBeVisible();
    expect((await summary.boundingBox())!.y).toBe(before!.y);
    await page.locator(".dashboard-statistics-notes summary").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(".dashboard-statistics-notes")).not.toHaveAttribute("open");
    await expect(page.getByRole("button", { name: "刷新统计" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
    for (const link of await page.locator(".dashboard-detail-links a").all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      expect(await link.evaluate((element) => getComputedStyle(element).textDecorationLine)).toContain("underline");
    }
    const details = page.locator(".dashboard-details > summary");
    expect((await details.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await details.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".dashboard-details")).toHaveAttribute("open");
    for (const link of await page.locator(".dashboard-details .insights-action-link").all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
  });
}

test("dashboard loads API data and routes to the event grid", async ({ page }) => {
  const eventName = `端到端反馈样本入湖 ${Date.now()}`;

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "概览", exact: true })).toBeVisible();
  await expect(page.getByText("128.4K")).toHaveCount(0);

  await page.getByRole("main").getByRole("link", { name: "数据事件", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole("heading", { name: "数据事件" })).toBeVisible();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.locator(".events-entry > summary").click();

  await page.getByRole("button", { name: "写入事件" }).click();
  await expect(page.getByText("事件名称至少 2 个字符")).toBeVisible();

  await page.getByLabel("事件名称").fill(eventName);
  await page.getByLabel("数据源").fill("playwright-stream");
  await page.getByRole("combobox", { name: "飞轮阶段", exact: true }).selectOption("observe");
  await page.getByLabel("数据量").fill("320");
  await page.getByRole("button", { name: "写入事件" }).click();

  await expect(page.getByRole("status")).toHaveText("事件已写入并刷新网格。");
  await expect(page.getByRole("grid").getByText(eventName)).toBeVisible();
});

test("admin can enter and leave the viewer identity without retaining write access", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: /以用户身份进入/ }).click();
  await expect(page.getByRole("heading", { name: "以此用户身份进入" })).toBeVisible();
  await page.getByRole("radio", { name: /项目观察员/ }).check();
  await page.getByRole("button", { name: "确认进入" }).click();
  await expect(page.getByRole("alert")).toContainText("请填写至少 10 个字符的代登录原因");
  await expect(page.getByLabel("代登录原因", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "权限排查", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "确认进入" }).click();

  await expect(page.getByLabel("代登录状态")).toContainText("当前以 项目观察员 身份操作");
  await page.getByRole("main").getByRole("link", { name: "数据事件", exact: true }).click();
  await expect(page.getByRole("button", { name: "写入事件" })).toHaveCount(0);

  await page.getByRole("button", { name: "退出代登录" }).click();
  await expect(page.getByLabel("代登录状态")).toHaveCount(0);
  await page.locator(".events-entry > summary").click();
  await expect(page.getByRole("button", { name: "写入事件" })).toBeVisible();
});

test("platform developer only sees requirements assigned to them", async ({ page }) => {
  await page.goto("/requirements");
  await expect(page.getByText("支持高价值反馈自动进入标注队列")).toBeVisible();

  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: /以用户身份进入/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: /平台开发工程师/ }).click();
  await page.getByLabel("代登录原因").fill("验证开发角色的需求数据隔离");
  await page.getByRole("button", { name: "确认进入" }).click();

  await expect(page.getByLabel("代登录状态")).toContainText("当前以 平台开发工程师 身份操作");
  await expect(page.getByRole("link", { name: "用户权限", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "数据事件", exact: true })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "需求管理" })).toBeVisible();
  await expect(page.getByText("评估报告增加分人群效果对比")).toBeVisible();
  await expect(page.getByText("数据事件支持按筛选结果导出")).toBeVisible();
  await expect(page.getByText("支持高价值反馈自动进入标注队列")).toHaveCount(0);
});

test("event-only access loads the grid without requesting the dashboard", async ({ page }) => {
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const me = await response.json();
    await route.fulfill({ response, json: { ...me, permissions: ["menu.workspace:view", "events:read"] } });
  });
  let dashboardRequests = 0;
  await page.route("**/api/flywheel", async (route) => {
    dashboardRequests += 1;
    await route.fulfill({ status: 403, json: { detail: "Missing permission dashboard:view" } });
  });

  await page.goto("/events");
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(page.getByRole("button", { name: "写入事件" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "申请录入事件权限" })).toBeVisible();
  await expect(page.getByRole("link", { name: "申请导出权限" })).toBeVisible();
  expect(dashboardRequests).toBe(0);
});

test("dashboard-only access hides analytics controls even when the response contains usage data", async ({ page }) => {
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const me = await response.json();
    await route.fulfill({ response, json: { ...me, permissions: ["menu.workspace:view", "dashboard:view"] } });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "概览", exact: true })).toBeVisible();
  await expect(page.getByText("最新事件", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "数据事件", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "平台使用", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "使用分析", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "操作审计", exact: true })).toHaveCount(0);
});
