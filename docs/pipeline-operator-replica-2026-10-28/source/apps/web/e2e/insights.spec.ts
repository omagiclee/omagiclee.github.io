import { expect, test } from "@playwright/test";

const api = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8010}`;

test("analytics toolbar menus preserve scope, reset pagination and apply personnel drafts with the keyboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "概览", exact: true })).toBeVisible();
  const me = await (await page.request.get(`${api}/api/me`)).json();
  await page.goto(`/analytics?project_id=demo&days=30&user_id=${me.user.id}&group_by=button&offset=30`);
  const period = page.getByRole("button", { name: "统计周期", exact: true });
  await expect(period).toBeVisible();
  await period.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitemradio", { name: "最近 90 天", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(period).toBeFocused();
  await expect(page).toHaveURL(/days=90/);
  let params = new URL(page.url()).searchParams;
  expect(params.get("project_id")).toBe("demo");
  expect(params.get("user_id")).toBe(me.user.id);
  expect(params.get("group_by")).toBe("button");
  expect(params.has("offset")).toBe(false);
  const personnel = page.getByRole("button", { name: "使用人员", exact: true });
  await expect(personnel).toBeEnabled();
  await personnel.focus();
  await page.keyboard.press("Enter");
  const selectedPerson = page.getByRole("menuitemradio", { checked: true });
  await expect(selectedPerson).not.toHaveText("全部人员");
  await selectedPerson.focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("menuitemradio", { name: "全部人员", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(personnel).toBeFocused();
  await expect(personnel).toContainText("全部人员");
  expect(new URL(page.url()).searchParams.get("user_id")).toBe(me.user.id);
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("user_id")).toBe(false);
  params = new URL(page.url()).searchParams;
  expect(params.get("project_id")).toBe("demo");
  expect(params.get("days")).toBe("90");
  expect(params.get("group_by")).toBe("button");
  const pages = page.getByRole("button", { name: "页面", exact: true });
  await pages.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "页面", exact: true });
  await expect(menu).toBeVisible();
  expect((await menu.boundingBox())!.height).toBeLessThanOrEqual(400);
  await menu.getByRole("menuitemradio", { checked: true }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitemradio", { name: "我的权限", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pages).toBeFocused();
  expect(new URL(page.url()).searchParams.has("page_id")).toBe(false);
});

test("real interactions are searchable and a business action links back to its click", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "概览", exact: true })).toBeVisible();
  const me = await (await page.request.get(`${api}/api/me`)).json();
  await page.getByRole("link", { name: "数据事件", exact: true }).click();
  await page.locator(".events-entry > summary").click();
  await page.getByLabel("事件名称").fill(`运营关联验证 ${Date.now()}`);
  await page.getByLabel("数据源").fill("insights-e2e");
  await page.getByLabel("数据量").fill("12");
  const submit = page.getByRole("button", { name: "写入事件", exact: true });
  const elementId = await submit.getAttribute("data-track-id");
  expect(elementId).toBeTruthy();
  const submittedRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/events");
  await submit.click();
  const interactionId = (await submittedRequest).headers()["x-interaction-id"];
  expect(interactionId).toBeTruthy();
  await expect(page.getByRole("status")).toContainText("事件已写入");

  const eventUrl = `${api}/api/insights/events?days=7&project_id=demo&user_id=${me.user.id}&page_id=events&limit=100`;
  await expect.poll(async () => {
    const response = await page.request.get(eventUrl);
    expect(response.status()).toBe(200);
    const { items } = await response.json();
    // Earlier tests may have clicked this button without creating an event.
    // Wait for this submission's telemetry and matching audit, not any old click.
    return items.some((item: { kind: string; element_id: string; interaction_id: string }) => item.kind === "button_click" && item.element_id === elementId && item.interaction_id === interactionId)
      && items.some((item: { kind: string; interaction_id: string }) => item.kind === "audit" && item.interaction_id === interactionId);
  }).toBe(true);
  const { items } = await (await page.request.get(eventUrl)).json();
  const click = items.find((item: { kind: string; element_id: string; interaction_id: string }) => item.kind === "button_click" && item.element_id === elementId && item.interaction_id === interactionId);
  expect(click.actor_user_id).toBe(me.actor.id);
  expect(click.effective_user_id).toBe(me.user.id);
  expect(click.interaction_id).toBeTruthy();
  const matchingAudit = items.find((item: { kind: string; interaction_id: string }) => item.kind === "audit" && item.interaction_id === click.interaction_id);
  expect(matchingAudit).toBeTruthy();
  expect(matchingAudit.status).toBe("succeeded");
  expect(new Date(click.created_at).getTime()).toBeLessThanOrEqual(new Date(matchingAudit.created_at).getTime());
  expect(items.some((item: { kind: string }) => item.kind === "page_view")).toBe(true);
  const report = await (await page.request.get(`${api}/api/insights/usage?project_id=demo&group_by=button&page_id=events&user_id=${me.user.id}`)).json();
  const feature = report.rows.find((row: { id: string }) => row.id === elementId);
  expect(feature.succeeded).toBeGreaterThanOrEqual(1);
  expect(feature.business_actions).toBeGreaterThanOrEqual(feature.succeeded);

  await page.goto(`/analytics?project_id=demo&days=7&user_id=${me.user.id}&group_by=button`);
  await expect(page.getByRole("heading", { name: "使用分析", exact: true })).toBeVisible();
  const usageLink = page.getByRole("main").getByRole("link", { name: click.label, exact: true });
  expect((await usageLink.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await expect(usageLink.locator("small")).toContainText(elementId);
  expect(await usageLink.locator(".insights-record-title").evaluate((element) => getComputedStyle(element).textDecorationLine)).toContain("underline");
  await usageLink.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("element_id")).toBe(elementId);
  expect(new URL(page.url()).searchParams.get("user_id")).toBe(me.user.id);
  expect(new URL(page.url()).searchParams.get("project_id")).toBe("demo");
  await expect(page.getByRole("heading", { name: "操作审计", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(click.label);
  await page.locator(".insights-event").filter({ hasText: "业务审计" }).first().locator("summary").click();
  await page.screenshot({ path: test.info().outputPath("个人操作时间线.png"), fullPage: true });
});

test("overview backlog opens the same project and period with a matching object count", async ({ page }) => {
  await page.goto("/?days=30&project_id=demo");
  await expect(page.getByRole("heading", { name: "概览", exact: true })).toBeVisible();
  const overview = await (await page.request.get(`${api}/api/insights/overview?days=30&project_id=demo`)).json();
  const recordsResponse = page.waitForResponse((response) => response.url().includes("/api/insights/records?") && new URL(response.url()).searchParams.get("kind") === "requirement");
  await page.locator("a.insights-stat").filter({ hasText: "未完成需求" }).click();
  await expect(page.getByRole("heading", { name: "数据运营明细", exact: true })).toBeVisible();
  const params = new URL(page.url()).searchParams;
  expect(params.get("days")).toBe("30");
  expect(params.get("project_id")).toBe("demo");
  expect(params.get("status")).toBe("open");
  const response = await recordsResponse;
  expect(response.status()).toBe(200);
  const records = await response.json();
  expect(records.total).toBe(overview.requirements.open);
  await expect(page.locator("#records").getByRole("table")).toBeVisible();
});

test("usage exposes its collection window and overview failures never become fake metrics", async ({ page }) => {
  await page.goto("/analytics?group_by=page&days=30&project_id=demo");
  await expect(page.getByRole("heading", { name: "使用分析", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("页面");
  await expect(page.getByRole("main")).not.toContainText("128.4K");
  await page.route("**/api/insights/overview?**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "统计服务暂不可用" }) }));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("统计服务暂不可用");
  await expect(page.getByText("128.4K")).toHaveCount(0);
});

test("impersonated viewers cannot see other users' analytics or audit records", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "概览", exact: true })).toBeVisible();
  const me = await (await page.request.get(`${api}/api/me`)).json();
  const targets = await (await page.request.get(`${api}/api/admin/impersonation/targets`)).json();
  const viewer = targets.find((user: { username: string }) => user.username === "project-viewer");
  const response = await page.request.post(`${api}/api/admin/impersonation/start`, {
    headers: { "X-CSRF-Token": me.csrf_token },
    data: { target_user_id: viewer.id, reason: "验证分析页面服务端隔离", duration_minutes: 15 },
  });
  expect(response.status(), response.status() === 200 ? undefined : await response.text()).toBe(200);
  await page.goto("/admin/audit");
  await expect(page.getByText("当前身份没有查看此页面的权限。")).toBeVisible();
  for (const path of ["usage", "events"]) {
    expect((await page.request.get(`${api}/api/insights/${path}?user_id=${me.user.id}`)).status()).toBe(403);
  }
  const overview = await (await page.request.get(`${api}/api/insights/overview`)).json();
  expect(overview.usage.available).toBe(false);
});


test("audit advanced disclosure exposes a nonoverlapping 48px target at 390px without adding a row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/admin/audit?project_id=demo");
  await expect(page.getByRole("heading", { name: "操作审计", exact: true })).toBeVisible();
  const details = page.locator(".insights-compact-disclosure");
  const summary = details.locator("summary");
  const target = await summary.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const extension = getComputedStyle(element, "::before");
    const parent = element.parentElement!;
    return {
      x: box.left + 10,
      top: box.top + parseFloat(extension.top),
      bottom: box.bottom - parseFloat(extension.bottom),
      visualHeight: box.height,
      previousBottom: parent.previousElementSibling!.getBoundingClientRect().bottom,
      nextTop: parent.nextElementSibling!.getBoundingClientRect().top,
    };
  });
  expect(target.bottom - target.top).toBeGreaterThanOrEqual(48);
  expect(target.visualHeight).toBeLessThanOrEqual(32);
  expect(target.top).toBeGreaterThanOrEqual(target.previousBottom);
  expect(target.bottom).toBeLessThanOrEqual(target.nextTop);
  await page.mouse.click(target.x, target.top + 2);
  await expect(details).toHaveAttribute("open");
  await expect(page.getByLabel("会话 ID", { exact: true })).toBeVisible();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(details).not.toHaveAttribute("open");
  await expect(summary).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
