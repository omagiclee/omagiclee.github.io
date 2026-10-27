import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";

function restrictedSession(notificationCount = 0) {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl?.startsWith("sqlite:////tmp/data-flywheel-e2e-")) throw new Error("Shell fixtures require an isolated test database");
  const script = `
import json,sys
from app.database import SessionLocal
from app.auth import _create_session
from app.models import AppUser
from app.access_models import InAppNotification
with SessionLocal() as db:
    user=AppUser(username=sys.argv[1],display_name="隔离边界验收用户")
    db.add(user);db.flush()
    for index in range(int(sys.argv[2])):
        db.add(InAppNotification(recipient_id=user.id,kind="audit_fixture",title=f"隔离通知 {index}",body="只用于真实未读计数与标记布局验收。"))
    db.commit()
    _,token=_create_session(db,user)
    print(json.dumps({"token":token}))
`;
  return JSON.parse(execFileSync(path.resolve("../../.venv/bin/python"), ["-c", script, `shell-${randomUUID()}`, String(notificationCount)], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PYTHONPATH: path.resolve("../api"), AUTH_MODE: "dev" }, encoding: "utf8",
  })) as { token: string };
}

for (const width of [1440, 390, 320]) {
  test(`unknown URLs retain the console hierarchy and a working recovery action at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const url of ["/unknown-console-page", "/projects/demo/datasets/unknown/extra"]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { name: "页面不存在", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "返回概览", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.getByRole("link", { name: "返回概览", exact: true }).click();
      await expect(page.getByRole("heading", { name: "概览", exact: true })).toBeVisible();
    }
  });

  test(`logout failure preserves the menu and exposes associated feedback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/requirements");
    await expect(page.getByRole("heading", { name: "需求管理", exact: true })).toBeVisible();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/auth/logout", async (route) => {
      await gate;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "验收：退出服务暂不可用，请重试。" }) });
    });
    try {
      const trigger = page.getByRole("button", { name: /^账号菜单/ });
      await trigger.click();
      await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "正在退出", exact: true })).toBeDisabled();
      release();
      const error = page.getByRole("alert").filter({ hasText: "退出服务暂不可用" });
      await expect(error).toBeVisible();
      await expect(page.getByRole("menu")).toHaveAttribute("aria-describedby", (await error.getAttribute("id"))!);
      await expect(page.getByRole("menu").getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: "退出登录", exact: true })).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(error).toHaveCount(0);
      await expect(trigger).toBeFocused();
    } finally { release(); }
  });
}

test("root service recovery preserves the new-pipeline deep link", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "隔离根服务故障" }) }));
  await page.goto("/projects/demo/pipelines?view=new");
  await expect(page.getByRole("heading", { name: "暂时无法打开页面", exact: true })).toBeVisible();
  await page.unroute("**/api/me");
  await page.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新建流水线", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/demo\/pipelines\?view=new$/);
});

test("RTL mirrors permanent navigation and the modal drawer without covering the workspace", async ({ page }) => {
  await page.addInitScript(() => {
    const applyDirection = () => { document.documentElement.dir = "rtl"; };
    if (document.documentElement) applyDirection();
    else document.addEventListener("DOMContentLoaded", applyDirection, { once: true });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/requirements");
  await expect(page.getByRole("heading", { name: "需求管理", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const shell = await page.locator(".app-sidebar").evaluate((element) => {
    const sidebar = element.getBoundingClientRect();
    const main = document.querySelector(".app-main-content")!.getBoundingClientRect();
    return { sidebarRight: sidebar.right, mainRight: main.right, sidebarLeft: sidebar.left, width: innerWidth };
  });
  expect(shell.sidebarRight).toBe(shell.width);
  expect(shell.mainRight).toBeLessThanOrEqual(shell.sidebarLeft);
  await page.setViewportSize({ width: 390, height: 900 });
  const trigger = page.getByRole("button", { name: "打开主导航", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Data Flywheel", exact: true });
  await expect(drawer).toBeVisible();
  await expect.poll(() => drawer.evaluate((element) => element.getBoundingClientRect().right)).toBe(390);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("restricted recovery keeps a full target and unknown URLs offer an authorized destination", async ({ page }) => {
  const fixture = restrictedSession();
  await page.context().addCookies([{ name: "flywheel_session", value: fixture.token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/projects/demo/pipelines");
  await expect(page.getByRole("heading", { name: "需要访问权限", exact: true })).toBeVisible();
  const recovery = page.getByRole("link", { name: "查看我的权限与申请记录", exact: true });
  expect((await recovery.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await expect(recovery).toHaveAttribute("href", "/access?project_id=demo");
  await page.goto("/unknown-console-page");
  await expect(page.getByRole("link", { name: "查看我的权限", exact: true })).toHaveAttribute("href", "/access");
  await expect(page.getByRole("link", { name: "返回概览", exact: true })).toHaveCount(0);
});

test("a real 100-message inbox shows an unclipped readable 99+ badge on a narrow screen", async ({ browser }) => {
  const fixture = restrictedSession(100);
  const context = await browser.newContext({ viewport: { width: 320, height: 900 } });
  try {
    await context.addCookies([{ name: "flywheel_session", value: fixture.token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    await page.goto("/access");
    await expect(page.getByRole("link", { name: "站内信，100 条未读", exact: true })).toBeVisible();
    const badge = page.locator(".app-notification-badge");
    await expect(badge).toHaveText("99+");
    const layout = await badge.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const parent = element.parentElement!.getBoundingClientRect();
      return { within: rect.left >= parent.left && rect.right <= parent.right && rect.top >= parent.top && rect.bottom <= parent.bottom, font: getComputedStyle(element).fontSize, height: rect.height };
    });
    expect(layout).toEqual({ within: true, font: "11px", height: 16 });
    await page.screenshot({ path: test.info().outputPath("real-inbox-badge-320.png"), fullPage: true });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await badge.evaluate(element => { element.style.fontSize = "22px"; element.style.lineHeight = "32px"; });
      const enlarged = await badge.evaluate(element => {
        const bounds = element.getBoundingClientRect(), parent = element.parentElement!.getBoundingClientRect();
        return { height: element.clientHeight, scroll: element.scrollHeight, within: bounds.left >= parent.left && bounds.right <= parent.right && bounds.top >= parent.top && bounds.bottom <= parent.bottom };
      });
      expect(enlarged.height).toBeGreaterThanOrEqual(32);
      expect(enlarged.scroll).toBeLessThanOrEqual(enlarged.height);
      expect(enlarged.within).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`real-inbox-badge-text200-${width}.png`), fullPage: true });
    }
  } finally { await context.close(); }
});
