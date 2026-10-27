import { expect, test } from "@playwright/test";

test("late navigation permission loading preserves the active form and mobile drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let waiting = false;
  await page.route("**/api/me?project_id=demo", async (route) => {
    waiting = true;
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/events");
    await expect.poll(() => waiting).toBe(true);
    await page.locator(".events-entry > summary").click();
    const title = `权限加载期间填写 ${Date.now()}`;
    await page.getByLabel("事件名称").fill(title);
    await page.getByRole("button", { name: "打开主导航" }).click();
    const drawer = page.getByRole("dialog", { name: "Data Flywheel" });
    await expect(drawer).toBeVisible();
    release();
    await expect(drawer.getByRole("link", { name: "概览", exact: true })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "需求管理", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(page.getByLabel("事件名称")).toHaveValue(title);
    await page.getByLabel("数据源").fill("delayed-permissions-e2e");
    await page.getByRole("button", { name: "写入事件", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("事件已写入");
  } finally {
    release();
  }
});

for (const width of [390, 768, 1280]) {
  test(`console navigation and page layouts fit a ${width}px viewport`, async ({ page }) => {
    test.setTimeout(60_000); // Seven routes with full-page screenshots in one case.
    await page.setViewportSize({ width, height: 900 });
    for (const [path, heading] of [
      ["/", "概览"],
      ["/operations", "数据运营明细"],
      ["/analytics", "使用分析"],
      ["/admin/audit", "操作审计"],
      ["/events", "数据事件"],
      ["/requirements", "需求管理"],
      ["/admin/users", "用户与权限"],
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      const menu=page.getByRole("button",{name:"打开主导航"});
      if(width < 1024) { await expect(menu).toBeVisible(); await menu.click(); }
      const navigation = page.getByRole("navigation", { name: "主导航" }).filter({ visible: true });
      await expect(navigation).toBeVisible();
      await expect(navigation.getByRole("link", { name: "概览", exact: true })).toBeVisible();
      await expect(navigation.getByRole("link", { name: "需求管理", exact: true })).toBeVisible();
      await expect(navigation.getByRole("button", { name: "工作台", exact: true })).toHaveCount(0);
      // Each navigation set has its own current item; breadcrumbs and the sidebar coexist.
      for (const landmark of await page.getByRole("navigation").all()) {
        expect(await landmark.locator('[aria-current="page"]').count()).toBeLessThanOrEqual(1);
      }
      if (path === "/" || path === "/requirements") {
        await expect(navigation.locator('a[aria-current="page"]')).toHaveCount(1);
      }
      if(width < 1024) { await page.getByRole("button", {name:"关闭主导航"}).click(); await expect(navigation).toHaveCount(0); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${heading}-${width}.png`), fullPage: true });
    }
    await page.goto("/requirements");
    await page.getByRole("link", { name: /支持高价值反馈自动进入标注队列/ }).click();
    await expect(page.getByRole("heading", { name: "支持高价值反馈自动进入标注队列", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`需求详情-${width}.png`), fullPage: true });
  });
}

test("account dialog retains keyboard dismissal and mobile form layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: /账号菜单/ });
  await trigger.click();
  await page.getByRole("menuitem", { name: /以用户身份进入/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByLabel("代登录原因").fill("检查移动端弹窗和键盘操作体验");
  await dialog.getByRole("button", { name: "确认进入" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("请选择要进入的用户账号。");
  await expect(dialog.getByRole("radio").first()).toBeFocused();
  await expect(dialog.getByRole("radiogroup", { name: "选择目标用户" })).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("textbox", { name: "搜索代登录用户" })).not.toHaveAttribute("aria-invalid", "true");
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.waitForTimeout(250);
  await page.screenshot({ path: test.info().outputPath("代登录弹窗-390.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
