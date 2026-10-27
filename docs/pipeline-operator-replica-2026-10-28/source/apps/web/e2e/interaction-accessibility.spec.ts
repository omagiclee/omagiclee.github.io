import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`requirement errors identify the first incomplete field and preserve draft editing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/requirements");
    const create = page.getByRole("button", { name: "提交需求", exact: true });
    await create.click();
    const title = page.getByLabel("需求标题", { exact: true });
    await expect(title).toBeFocused();
    await page.getByRole("button", { name: "提交评审", exact: true }).click();
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(title).toHaveAccessibleDescription("标题至少 4 个字符");
    await title.fill("无障碍审核需求表单");
    await page.getByRole("button", { name: "提交评审", exact: true }).click();
    const description = page.getByLabel("背景与问题", { exact: true });
    await expect(description).toBeFocused();
    await expect(description).toHaveAttribute("aria-invalid", "true");
    await expect(description).toHaveAccessibleDescription("请填写至少 10 个字符的背景与问题。");
    await description.fill("模型在复杂的城市道路交通场景中存在失效问题。");
    await expect(description).toHaveAttribute("aria-invalid", "false");
    await page.getByLabel("期望结果", { exact: true }).fill("补齐场景数据。");
    await page.getByRole("button", { name: "提交评审", exact: true }).click();
    await expect(page.getByLabel("目标模型 / 基线版本", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "关闭提交表单", exact: true }).click();
    await expect(create).toBeFocused();
  });

  test(`identity dialog supports native radio arrows, Escape and return focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const account = page.getByRole("button", { name: /账号菜单/ });
    await account.click();
    await page.getByRole("menuitem", { name: /以用户身份进入/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(page.getByLabel("搜索代登录用户", { exact: true })).toBeFocused();
    await expect(dialog.getByRole("radio").first()).toBeVisible();
    await dialog.getByRole("button", { name: "确认进入", exact: true }).click();
    await expect(dialog.getByRole("radiogroup", { name: "选择目标用户" })).toHaveAccessibleDescription("请选择要进入的用户账号。");
    await expect(dialog.getByRole("radio").first()).toBeFocused();
    await expect(page.getByLabel("搜索代登录用户", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
    const radios = dialog.getByRole("radio");
    await radios.first().focus();
    await page.keyboard.press("Space");
    await expect(radios.first()).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(radios.nth(1)).toBeChecked();
    await expect(radios.nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(account).toBeFocused();
  });

  test(`upload reports errors next to its picker and keeps pending work open at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/projects/demo/explore");
    const trigger = page.getByRole("button", { name: "上传源视频", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    const picker = page.getByLabel("源视频文件", { exact: true });
    await expect(picker).toBeFocused();
    await expect(picker).toHaveAccessibleDescription("选择后立即上传 · 最大 650 MiB");
    let release!: () => void;
    await page.route("**/api/media/uploads?**", async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "项目存储暂不可用，请重试。" }) });
    });
    await picker.setInputFiles({ name: "audit.mp4", mimeType: "video/mp4", buffer: Buffer.from("isolated upload test") });
    await expect(picker).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect.poll(() => typeof release).toBe("function");
    release();
    await expect(dialog.getByRole("alert")).toContainText("项目存储暂不可用");
    await expect(picker).toBeEnabled();
    await expect(picker).toBeFocused();
    await expect(picker).toHaveAccessibleDescription(/最大 650 MiB.*项目存储暂不可用/);
    await expect(picker).toHaveAttribute("aria-invalid", "false");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test("identity validation keeps search focus while target users load and focuses a choice once available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/admin/impersonation/targets", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: /账号菜单/ }).click();
    await page.getByRole("menuitem", { name: /以用户身份进入/ }).click();
    const dialog = page.getByRole("dialog");
    const search = page.getByLabel("搜索代登录用户", { exact: true });
    await expect(dialog.getByRole("status")).toContainText("正在读取用户");
    await dialog.getByRole("button", { name: "确认进入", exact: true }).click();
    await expect(dialog.getByRole("radiogroup", { name: "选择目标用户" })).toHaveAccessibleDescription("请选择要进入的用户账号。");
    await expect(search).toBeFocused();
    release();
    await expect(dialog.getByRole("radio").first()).toBeVisible();
    await expect(search).toBeFocused();
    await dialog.getByRole("button", { name: "确认进入", exact: true }).click();
    await expect(dialog.getByRole("radio").first()).toBeFocused();
  } finally {
    release();
  }
});

for (const width of [1440, 390]) {
  test(`200% text remains readable with an open requirement form at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/requirements");
    await page.getByRole("button", { name: "提交需求", exact: true }).click();
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("body,body *")].filter((node): node is HTMLElement => node instanceof HTMLElement)
        .map((node) => ({ node, font: getComputedStyle(node).fontSize, line: getComputedStyle(node).lineHeight }));
      for (const { node, font, line } of nodes) {
        node.style.fontSize = `${parseFloat(font) * 2}px`;
        if (line !== "normal") node.style.lineHeight = `${parseFloat(line) * 2}px`;
      }
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const account = page.getByRole("button", { name: /账号菜单/ });
    await expect.poll(() => account.locator(".md-button-container").evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(2);
    await expect(page.getByLabel("需求标题", { exact: true })).toBeEditable();
  });
}

test("mobile navigation opens at the current route and restores focus after Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/requirements");
  const trigger = page.getByRole("button", { name: "打开主导航", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog");
  const current = drawer.locator('[aria-current="page"]');
  await expect(current).toBeFocused();
  await page.keyboard.press("Tab");
  await expect.poll(() => drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const interaction of ["none", "keyboard", "pointer"] as const) {
  test(`delayed project permissions complete drawer focus without stealing ${interaction} interaction`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let requested = false;
    await page.route("**/api/me?project_id=demo", async (route) => {
      requested = true;
      await gate;
      await route.continue();
    });
    await page.goto("/requirements");
    await expect(page.getByRole("heading", { name: "需求管理", exact: true })).toBeVisible();
    await expect.poll(() => requested).toBe(true);
    const trigger = page.getByRole("button", { name: "打开主导航", exact: true });
    await trigger.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("正在读取导航权限…", { exact: true })).toBeVisible();
    await expect(drawer.locator(".app-nav-link")).toHaveCount(0);
    const close = drawer.getByRole("button", { name: "关闭主导航", exact: true });
    await expect(close).toBeFocused();
    if (interaction === "keyboard") await page.keyboard.press("ArrowDown");
    if (interaction === "pointer") await drawer.getByText("按工作职责浏览平台功能", { exact: true }).click();
    release();
    const current = drawer.locator('[aria-current="page"]');
    await expect(current).toHaveText("需求管理");
    if (interaction === "none") await expect(current).toBeFocused();
    else await expect(current).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test("drawer restores initial focus when session navigation is replaced by delayed project navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  let releaseProjects!: () => void;
  let releasePermissions!: () => void;
  const projectsGate = new Promise<void>((resolve) => { releaseProjects = resolve; });
  const permissionsGate = new Promise<void>((resolve) => { releasePermissions = resolve; });
  let permissionRequested = false;
  await page.route("**/api/projects", async (route) => { await projectsGate; await route.continue(); });
  await page.route("**/api/me?project_id=demo", async (route) => {
    permissionRequested = true;
    await permissionsGate;
    await route.continue();
  });
  await page.goto("/requirements");
  const trigger = page.getByRole("button", { name: "打开主导航", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog");
  const current = drawer.locator('.app-nav-link[aria-current="page"]:visible');
  await expect(current).toHaveText("需求管理");
  await expect(current).toBeFocused();
  expect(permissionRequested).toBe(false);
  releaseProjects();
  await expect.poll(() => permissionRequested).toBe(true);
  await expect(drawer.getByText("正在读取导航权限…", { exact: true })).toBeVisible();
  releasePermissions();
  await expect(current).toHaveText("需求管理");
  await expect(current).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
