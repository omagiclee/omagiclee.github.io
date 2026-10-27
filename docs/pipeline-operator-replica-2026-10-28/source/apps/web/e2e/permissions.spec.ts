import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8010}`;

async function newUser(browser: Browser) {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl?.startsWith("sqlite:////tmp/data-flywheel-e2e-")) throw new Error("Permission tests require an isolated /tmp/data-flywheel-e2e- database");
  const name = `权限验收-${randomUUID().slice(0, 8)}`;
  const script = `
import json, sys
from app.database import SessionLocal
from app.auth import _create_session
from app.models import AppUser
with SessionLocal() as db:
    user = AppUser(username=sys.argv[1], display_name=sys.argv[1])
    db.add(user)
    db.commit()
    session, token = _create_session(db, user)
    print(json.dumps({"id": user.id, "token": token}))
`;
  const fixture = JSON.parse(execFileSync(path.resolve("../../.venv/bin/python"), ["-c", script, name], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PYTHONPATH: path.resolve("../api"), AUTH_MODE: "dev" }, encoding: "utf8",
  }));
  const context = await browser.newContext();
  await context.addCookies([{ name: "flywheel_session", value: fixture.token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
  return { context, page: await context.newPage(), name, id: fixture.id };
}

async function approve(page: Page, reason: string) {
  await page.goto("/notifications");
  const message = page.locator("section").filter({ hasText: reason });
  await expect(message).toHaveCount(1);
  await message.getByRole("button", { name: "查看申请详情", exact: true }).click();
  const decision = page.waitForResponse((response) => response.url().includes("/decision") && response.request().method() === "POST");
  await message.getByRole("button", { name: "确认通过", exact: true }).click();
  expect((await decision).status()).toBe(200);
  // Reopen the persisted result to verify approval survives a fresh page load.
  await page.reload();
  await message.getByRole("button", { name: "查看申请详情", exact: true }).click();
  await expect(message.getByText("已通过", { exact: true })).toBeVisible();
}

async function policy(page: Page, label: string, effect: string) {
  const select = page.getByLabel(`${label}的策略`, { exact: true });
  const group = select.locator("xpath=ancestor::details[1]");
  if (!(await group.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await group.locator("summary").click();
  }
  await expect(select).toBeEnabled();
  await select.selectOption(effect);
  await expect(select).toHaveValue(effect);
  await expect(select).toBeEnabled();
}

test("a user applies from a locked page and button, admin approves in inbox, revocation blocks the API", async ({ page: admin, browser }) => {
  test.setTimeout(90_000);
  const user = await newUser(browser);
  try {
    await user.page.goto("/events");
    await expect(user.page.getByRole("heading", { name: "需要访问权限" })).toBeVisible();
    await user.page.getByRole("link", { name: "申请数据事件权限", exact: true }).click();
    await user.page.getByLabel("申请理由").fill(`${user.name}需要查看事件记录`);
    await user.page.getByRole("button", { name: "提交申请", exact: true }).click();
    await expect(user.page.getByText("申请已提交，管理员已收到审批站内信。")).toBeVisible();
    await approve(admin, `${user.name}需要查看事件记录`);
    await user.page.goto("/events");
    await expect(user.page.getByRole("heading", { name: "数据事件", exact: true })).toBeVisible();
    await expect(user.page.getByRole("button", { name: "写入事件", exact: true })).toHaveCount(0);
    await user.page.getByRole("link", { name: "申请录入事件权限", exact: true }).click();
    await user.page.getByLabel("申请理由").fill(`${user.name}需要录入验收数据`);
    await user.page.getByRole("button", { name: "提交申请", exact: true }).click();
    await expect(user.page.getByText("申请已提交，管理员已收到审批站内信。")).toBeVisible();
    await approve(admin, `${user.name}需要录入验收数据`);
    await admin.screenshot({ path: test.info().outputPath("inbox-approved.png"), fullPage: true });
    await user.page.goto("/events");
    await user.page.locator(".events-entry > summary").click();
    await expect(user.page.getByRole("button", { name: "写入事件", exact: true })).toBeVisible();
    await admin.goto("/admin/access");
    await admin.getByRole("button", { name: `${user.name} ${user.name}`, exact: true }).click();
    await policy(admin, "创建事件", "deny");
    await user.page.reload();
    await expect(user.page.getByRole("button", { name: "写入事件", exact: true })).toHaveCount(0);
    const me = await (await user.page.request.get(`${apiBase}/api/me`)).json();
    const response = await user.page.request.post(`${apiBase}/api/events`, { headers: { "X-CSRF-Token": me.csrf_token }, data: { stage: "ingest", title: "不可越过按钮拒绝", source: "e2e", volume: 1 } });
    expect(response.status()).toBe(403);
    await user.page.goto("/notifications");
    await expect(user.page.getByRole("heading", { name: "通知中心", exact: true })).toBeVisible();
    await expect(user.page.getByText(/权限申请已通过/).first()).toBeVisible();
  } finally { await user.context.close(); }
});

test("group membership grants a separate media menu and individual denial overrides it", async ({ page: admin, browser }) => {
  test.setTimeout(90_000);
  const user = await newUser(browser);
  const groupName = `视频验收组-${Date.now()}`;
  try {
    await admin.goto("/admin/access");
    await admin.getByText("创建用户组", { exact: true }).click();
    await admin.getByLabel("组名称", { exact: true }).fill(groupName);
    await admin.getByPlaceholder("例如：video-operations").fill(`e2e-${Date.now()}`);
    await admin.getByRole("button", { name: "创建组", exact: true }).click();
    await expect(admin.getByText("用户组已创建，可在上方选择并配置成员与权限。")).toBeVisible();
    await admin.getByRole("tab", { name: "用户组", exact: true }).click();
    await admin.getByRole("button", { name: `${groupName} 0 位成员`, exact: true }).click();
    await admin.getByRole("checkbox", { name: `${user.name}${user.name}`, exact: true }).check();
    await admin.getByRole("button", { name: "保存成员", exact: true }).click();
    await expect(admin.getByRole("button", { name: `${groupName} 1 位成员`, exact: true })).toBeVisible();
    await policy(admin, "数据平台", "allow");
    await policy(admin, "数据探索", "allow");
    await policy(admin, "检索视频", "allow");
    await user.page.goto("/media");
    await expect(user.page.getByRole("heading", { name: "数据探索", exact: true })).toBeVisible();
    expect((await user.page.request.get(`${apiBase}/api/pipelines`)).status()).toBe(403);
    expect((await user.page.request.get(`${apiBase}/api/media/videos`)).status()).toBe(200);
    await admin.getByRole("tab", { name: "用户", exact: true }).click();
    await admin.getByRole("button", { name: `${user.name} ${user.name}`, exact: true }).click();
    await policy(admin, "数据探索", "deny");
    await user.page.reload();
    await expect(user.page.getByRole("heading", { name: "需要访问权限" })).toBeVisible();
    expect((await user.page.request.get(`${apiBase}/api/media/videos`)).status()).toBe(403);
    await admin.screenshot({ path: test.info().outputPath("user-policies.png"), fullPage: true });
    await user.page.goto("/access");
    await user.page.setViewportSize({ width: 390, height: 844 });
    await expect(user.page.getByRole("heading", { name: "我的权限", exact: true })).toBeVisible();
    expect(await user.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await user.page.screenshot({ path: test.info().outputPath("access-mobile.png"), fullPage: true });
  } finally { await user.context.close(); }
});
