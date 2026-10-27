import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { MeResponse, ImpersonationTarget } from "../src/auth-api";
import type { Requirement, RequirementCreateInput, RequirementStatus, RequirementTransitionInput } from "../src/types";

const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8010}`;
const uniqueTitle = (purpose: string) => `E2E ${purpose} ${randomUUID().slice(0, 8)}`;
const dueDate = () => new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function me(page: Page): Promise<MeResponse> {
  // Let AuthProvider establish the development session before the test issues
  // API requests; parallel cookieless /api/me requests create different sessions.
  await expect(page.getByRole("button", { name: /^账号菜单，/ })).toBeVisible();
  const response = await page.request.get(`${apiBase}/api/me`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const session = await me(page);
  const response = await page.request.post(`${apiBase}${path}`, {
    headers: { "X-CSRF-Token": session.csrf_token }, data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

function completeRequest(title: string): RequirementCreateInput {
  return {
    title, description: "补齐雨夜路口长尾遮挡样本，当前模型在行人被车辆遮挡后的轨迹预测上存在持续误差。",
    expected_result: "交付可追溯的视频片段及质量报告，支持世界模型下一轮训练和固定场景切片评估。",
    acceptance_criteria: "按道路和光照条件分层抽样，至少交付 1200 个有效片段，每个片段均可追溯来源。",
    category: "data", priority: "high", save_as_draft: false,
    data_spec: {
      task_type: "collection", scenario: "雨夜路口行人遮挡，排除损坏视频和未授权来源。",
      modalities: ["视频", "点云"], quantity: 1200, unit: "段", source: "已授权的测试采集库",
      target_model: "world-model-e2e-v3",
    },
    checks: [{ id: "valid-clips", label: "有效视频片段数", operator: "gte", target: 1200, unit: "段" }],
  };
}

async function apiTransition(page: Page, requirement: Requirement, fields: RequirementTransitionInput): Promise<Requirement> {
  return post(page, `/api/requirements/${requirement.id}/transitions`, { ...fields, expected_revision: requirement.revision });
}

async function prepareInProgress(page: Page, title: string): Promise<Requirement> {
  const session = await me(page);
  let requirement = await post<Requirement>(page, "/api/requirements", completeRequest(title));
  requirement = await apiTransition(page, requirement, { action: "approve" });
  return apiTransition(page, requirement, {
    action: "schedule", owner_id: session.user.id, committed_due_date: dueDate(), planned_version: "wm-data-e2e-v1",
  });
}

async function prepareAcceptance(page: Page, requirement: Requirement): Promise<Requirement> {
  return apiTransition(page, requirement, {
    action: "deliver", delivery_notes: "测试数据集和质量报告已完成复核。",
    delivery: {
      dataset_uri: "s3://world-model-e2e/rainy-night", dataset_version: "wm-data-e2e-v1",
      report_uri: "https://quality.example.test/e2e/rainy-night", model_version: "world-model-e2e-v3",
      results: requirement.checks.map((check) => ({ check_id: check.id, actual: check.target, evidence: "逐项复核的测试报告记录。" })),
    },
  });
}

async function uiTransition(page: Page, button: string, action: string, status: RequirementStatus): Promise<Requirement> {
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/transitions") && response.request().method() === "POST"
      && response.request().postDataJSON()?.action === action,
  );
  await page.getByRole("button", { name: button, exact: true }).click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  const requirement: Requirement = await response.json();
  expect(requirement.status).toBe(status);
  return requirement;
}

test("a requester completes draft, review, delivery, signed acceptance and exports the record", async ({ page }) => {
  const title = uniqueTitle("世界模型雨夜场景完整闭环");
  await page.goto("/requirements");
  await expect(page.getByRole("heading", { name: "需求管理", exact: true })).toBeVisible();
  const session = await me(page);
  await page.getByRole("button", { name: "提交需求", exact: true }).click();
  await page.getByLabel("需求标题", { exact: true }).fill(title);
  const createdPromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/requirements" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const createdResponse = await createdPromise;
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const draft: Requirement = await createdResponse.json();
  expect(draft.status).toBe("draft");
  expect(draft.requester_id).toBe(session.user.id);
  await expect(page).toHaveURL(new RegExp(`/requirements/${draft.id}$`));
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();

  await page.getByRole("button", { name: "编辑需求材料", exact: true }).click();
  const editor = page.locator(".req-form");
  await expect(editor.getByRole("heading", { name: "完善需求材料", exact: true })).toBeVisible();
  await editor.getByLabel("背景与问题", { exact: true }).fill(completeRequest(title).description);
  await editor.getByLabel("期望结果", { exact: true }).fill(completeRequest(title).expected_result);
  await editor.getByLabel("目标模型 / 基线版本", { exact: true }).fill("world-model-e2e-v3");
  await editor.getByLabel("数据来源", { exact: true }).fill("已授权的测试采集库");
  await editor.getByLabel("场景范围与排除条件", { exact: true }).fill("雨夜路口行人遮挡，排除损坏视频和未授权来源。");
  await editor.getByRole("checkbox", { name: "视频", exact: true }).check();
  await editor.getByRole("checkbox", { name: "点云", exact: true }).check();
  await editor.getByLabel("需求数量", { exact: true }).fill("1200");
  await editor.getByLabel("目标值", { exact: true }).fill("1200");
  await editor.getByLabel("验收方法与补充条件", { exact: true }).fill(completeRequest(title).acceptance_criteria);
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await uiTransition(page, "提交评审", "submit", "pending_review");
  await expect(page.getByRole("combobox", { name: /^业务影响/ })).toBeVisible();
  await page.getByRole("combobox", { name: /^业务影响/ }).selectOption("5");
  await page.getByRole("combobox", { name: /^证据置信度/ }).selectOption("4");
  await uiTransition(page, "通过评审并锁定标准", "approve", "pending_schedule");
  await expect(page.getByText("评审基线已锁定", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: /^负责人/ }).selectOption(session.user.id);
  await page.getByLabel("承诺交付日期", { exact: true }).fill(dueDate());
  await page.getByLabel("目标版本", { exact: true }).fill("wm-data-e2e-v1");
  await uiTransition(page, "确认排期并开始", "schedule", "in_progress");

  await page.getByLabel("交付说明", { exact: true }).fill("交付 1250 段视频与点云，质量报告已逐项核验。使用数据集版本 wm-data-e2e-v1。");
  await page.getByLabel("数据集 / 交付物地址", { exact: true }).fill("s3://world-model-e2e/rainy-night");
  await page.getByLabel("数据集版本", { exact: true }).fill("wm-data-e2e-v1");
  await page.getByLabel("质量 / 评测报告地址", { exact: true }).fill("https://quality.example.test/e2e/rainy-night");
  await page.getByLabel("验证模型版本（选填）", { exact: true }).fill("world-model-e2e-v3");
  await page.getByLabel("实测值 · 段", { exact: true }).fill("1250");
  await expect(page.getByRole("button", { name: "提交用户验收", exact: true })).toBeDisabled();
  await page.getByLabel("验证证据", { exact: true }).fill("报告中记录有效片段 1250 段，100% 关联来源和同步传感器时间戳。");
  await uiTransition(page, "提交用户验收", "deliver", "pending_acceptance");
  const accept = page.getByRole("button", { name: "验收通过", exact: true });
  await expect(accept).toBeDisabled();
  await page.getByLabel("验收记录", { exact: true }).fill("已核验数据集版本、有效片段数量和评测报告，全部达标，验收通过。");
  await expect(accept).toBeDisabled();
  await page.getByRole("checkbox", { name: "我已核对交付版本、验收指标和验证证据。", exact: true }).check();
  const completed = await uiTransition(page, "验收通过", "accept", "completed");
  expect(completed.requester_id).toBe(session.user.id);
  await expect(page.getByText(/已于 .* 确认验收通过。/)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出验收记录", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${completed.requirement_no}-验收记录.md`);
  const outputPath = await download.path();
  expect(outputPath).not.toBeNull();
  const record = await readFile(outputPath!, "utf8");
  expect(record).toContain(title);
  expect(record).toContain("状态：已完成");
  expect(record).toContain("数据集版本：wm-data-e2e-v1");
  expect(record).toContain("实测：1250 段");
  expect(record).toContain(`验收人：${session.user.display_name}`);
});

test("viewer scope and requester ownership prevent administrators from accepting another user's delivery", async ({ page }) => {
  await page.goto("/requirements");
  const admin = await me(page);
  const adminRequest = await prepareAcceptance(page, await prepareInProgress(page, uniqueTitle("管理员本人需求")));
  const targetResponse = await page.request.get(`${apiBase}/api/admin/impersonation/targets`);
  expect(targetResponse.ok()).toBeTruthy();
  const targets: ImpersonationTarget[] = await targetResponse.json();
  const viewer = targets.find((target) => target.username === "project-viewer")!;
  expect(viewer).toBeDefined();
  await post(page, "/api/admin/impersonation/start", {
    target_user_id: viewer.id, reason: "验证需求提报与最终验收的对象级权限隔离", duration_minutes: 15,
  });
  let viewerRequest = await post<Requirement>(page, "/api/requirements", completeRequest(uniqueTitle("项目观察员提报")));
  await page.goto("/requirements");
  await expect(page.getByRole("heading", { name: "需求管理", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "管理员视角", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: new RegExp(viewerRequest.title) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(adminRequest.title) })).toHaveCount(0);
  const hidden = await page.request.get(`${apiBase}/api/requirements/${adminRequest.id}`);
  expect(hidden.status()).toBe(404);
  await page.goto(`/requirements/${viewerRequest.id}`);
  await expect(page.getByRole("button", { name: "通过评审并锁定标准", exact: true })).toHaveCount(0);

  await post(page, "/api/admin/impersonation/stop", {});
  viewerRequest = await apiTransition(page, viewerRequest, { action: "approve" });
  viewerRequest = await apiTransition(page, viewerRequest, {
    action: "schedule", owner_id: admin.user.id, committed_due_date: dueDate(), planned_version: "wm-viewer-e2e-v1",
  });
  viewerRequest = await prepareAcceptance(page, viewerRequest);
  await page.goto(`/requirements/${viewerRequest.id}`);
  await expect(page.getByText("由提报人 项目观察员 确认验收。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "验收通过", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "我已核对交付版本、验收指标和验证证据。", exact: true })).toHaveCount(0);
  const denied = await page.request.post(`${apiBase}/api/requirements/${viewerRequest.id}/transitions`, {
    headers: { "X-CSRF-Token": (await me(page)).csrf_token },
    data: { action: "accept", expected_revision: viewerRequest.revision, acceptance_notes: "管理员尝试代其他提报人验收。" },
  });
  expect(denied.status()).toBe(403);

  await post(page, "/api/admin/impersonation/start", {
    target_user_id: viewer.id, reason: "验证只有实际提报人可以完成本人需求验收", duration_minutes: 15,
  });
  await page.goto(`/requirements/${viewerRequest.id}`);
  await expect(page.getByLabel("代登录状态")).toContainText("当前以 项目观察员 身份操作");
  await page.getByLabel("验收记录", { exact: true }).fill("提报人已核验数据质量报告，确认验收通过。");
  await page.getByRole("checkbox", { name: "我已核对交付版本、验收指标和验证证据。", exact: true }).check();
  const completed = await uiTransition(page, "验收通过", "accept", "completed");
  expect(completed.activities.find((activity) => activity.action === "accept")?.actor_name).toBe("项目观察员");
});

test("posting a discussion preserves unsaved delivery notes and measurement evidence", async ({ page }) => {
  await page.goto("/requirements");
  const requirement = await prepareInProgress(page, uniqueTitle("讨论保留交付输入"));
  await page.goto(`/requirements/${requirement.id}`);
  const notes = "尚未提交的交付说明：正在复核夜间场景质量，保留这段输入。";
  const evidence = "尚未提交的指标证据：抽样核验 1250 段视频。";
  const notesInput = page.getByRole("textbox", { name: "交付说明", exact: true });
  const versionInput = page.getByRole("textbox", { name: "数据集版本", exact: true });
  const actualInput = page.getByRole("spinbutton", { name: "实测值 · 段", exact: true });
  const evidenceInput = page.getByRole("textbox", { name: "验证证据", exact: true });
  await notesInput.fill(notes);
  await versionInput.fill("unsaved-dataset-v7");
  await actualInput.fill("1250");
  await evidenceInput.fill(evidence);
  const discussion = `补充协作记录 ${randomUUID().slice(0, 8)}，请重点复核遮挡场景。`;
  await page.getByLabel("讨论内容", { exact: true }).fill(discussion);
  await page.getByRole("button", { name: "发表讨论", exact: true }).click();
  await expect(page.getByText(discussion, { exact: true })).toBeVisible();
  await expect(page.getByLabel("讨论内容", { exact: true })).toHaveValue("");
  await expect(notesInput).toHaveValue(notes);
  await expect(versionInput).toHaveValue("unsaved-dataset-v7");
  await expect(actualInput).toHaveValue("1250");
  await expect(evidenceInput).toHaveValue(evidence);
  await expect(page.getByText("需求有新动态，未提交的内容已保留。", { exact: false })).toBeVisible();
  const persisted = await page.request.get(`${apiBase}/api/requirements/${requirement.id}`);
  const detail: Requirement = await persisted.json();
  expect(detail.status).toBe("in_progress");
  expect(detail.delivery_notes).toBeNull();
});

test("platform development uses functional scope, release evidence and signed manual acceptance without data metrics", async ({ page }) => {
  const title = uniqueTitle("平台开发任务重试与告警");
  await page.goto("/requirements");
  const session = await me(page);
  await page.getByRole("button", { name: "提交需求", exact: true }).click();
  const editor = page.locator(".req-form");
  await editor.getByRole("group", { name: "需求方向", exact: true }).getByRole("button", { name: /^平台开发/ }).click();
  await expect(editor.getByLabel("目标模型 / 基线版本", { exact: true })).toHaveCount(0);
  await expect(editor.getByLabel("需求数量", { exact: true })).toHaveCount(0);
  await expect(editor.getByRole("checkbox", { name: "视频", exact: true })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: /^数据采集/ })).toHaveCount(0);
  await expect(editor.getByLabel("目标值", { exact: true })).toHaveCount(0);
  await editor.getByLabel("需求标题", { exact: true }).fill(title);
  await editor.getByLabel("背景与问题", { exact: true }).fill("平台调度任务失败后需要工程师手工查日志重试，运营人员无法确认执行结果和异常原因。");
  await editor.getByLabel("期望结果", { exact: true }).fill("管理员能够安全重试失败任务并查看告警记录，运营人员可以追踪执行进展。");
  await editor.getByLabel("验收方法与补充条件", { exact: true }).fill("管理员对失败任务点击重试后产生新的执行记录，原失败原因仍可追溯；普通用户不能发起重试。按测试报告逐项人工核验。");
  await editor.getByRole("button", { name: "提交评审", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("请完善标出的字段");
  await expect(editor.getByLabel("功能模块", { exact: true })).toBeFocused();
  await expect(editor.getByLabel("功能模块", { exact: true })).toHaveAccessibleDescription("请填写功能模块。");
  await editor.getByLabel("功能模块", { exact: true }).fill("任务调度 / 失败重试与告警");
  await editor.getByLabel("使用对象", { exact: true }).fill("平台管理员、运营人员和开发工程师");
  await editor.getByLabel("功能范围", { exact: true }).fill("增加失败任务重试操作、执行记录和告警通知入口，复用现有角色权限。");
  await editor.getByLabel("范围外事项（选填）", { exact: true }).fill("不包含数据采集、模型训练和调度引擎重写。");
  await editor.getByLabel("依赖与约束（选填）", { exact: true }).fill("复用现有 RBAC 与任务执行服务，保留审计记录。");
  const createdPromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/requirements" && response.request().method() === "POST",
  );
  await editor.getByRole("button", { name: "提交评审", exact: true }).click();
  const createdResponse = await createdPromise;
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const created: Requirement = await createdResponse.json();
  expect(created.status).toBe("pending_review");
  expect(created.platform_spec?.module).toBe("任务调度 / 失败重试与告警");
  expect(created.data_spec?.modalities).toEqual([]);
  expect(created.data_spec?.quantity).toBe(0);
  expect(created.data_spec?.target_model).toBe("");
  expect(created.checks).toEqual([]);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await uiTransition(page, "通过评审并锁定标准", "approve", "pending_schedule");
  await page.getByRole("combobox", { name: /^负责人/ }).selectOption(session.user.id);
  await page.getByLabel("承诺交付日期", { exact: true }).fill(dueDate());
  await page.getByLabel("目标版本", { exact: true }).fill("platform-e2e-v4.2");
  await uiTransition(page, "确认排期并开始", "schedule", "in_progress");

  await page.getByLabel("交付说明", { exact: true }).fill("任务重试、告警入口与审计记录已发布，测试报告覆盖正常操作和越权场景。");
  const deliver = page.getByRole("button", { name: "提交用户验收", exact: true });
  await expect(deliver).toBeDisabled();
  await page.getByLabel("功能 / 发布入口", { exact: true }).fill("https://platform.example.test/releases/e2e-v4.2");
  await expect(deliver).toBeDisabled();
  await page.getByLabel("发布版本", { exact: true }).fill("platform-e2e-v4.2");
  await expect(deliver).toBeDisabled();
  await page.getByLabel("测试报告地址", { exact: true }).fill("https://ci.example.test/reports/e2e-v4.2");
  await page.getByLabel("运行环境（选填）", { exact: true }).fill("预发布环境");
  await expect(page.getByLabel(/实测值/)).toHaveCount(0);
  await expect(page.getByLabel("验证模型版本（选填）", { exact: true })).toHaveCount(0);
  await expect(deliver).toBeEnabled();
  const delivered = await uiTransition(page, "提交用户验收", "deliver", "pending_acceptance");
  expect(delivered.delivery?.environment).toBe("预发布环境");
  const accept = page.getByRole("button", { name: "验收通过", exact: true });
  await expect(accept).toBeDisabled();
  await page.getByRole("checkbox", { name: /我已核对交付版本/ }).check();
  await expect(accept).toBeDisabled();
  await page.getByLabel("验收记录", { exact: true }).fill("已在预发布环境按测试报告人工验证重试、告警与越权场景，功能范围全部完成，确认通过。");
  const completed = await uiTransition(page, "验收通过", "accept", "completed");
  expect(completed.checks).toEqual([]);
  expect(completed.requester_id).toBe(session.user.id);
  await expect(page.getByRole("button", { name: "导出验收记录", exact: true })).toBeVisible();
});

for (const width of [320, 390, 768, 1280]) {
  test(`requirement submission and kanban fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/requirements");
    await expect(page.getByRole("heading", { name: "需求管理", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "提交需求", exact: true }).click();
    const editor = page.locator(".req-form");
    await expect(editor.getByRole("heading", { name: "提报新需求", exact: true })).toBeVisible();
    await editor.getByLabel("需求标题", { exact: true }).fill(uniqueTitle("响应式长标题雨夜复杂交互场景"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    // A form can fit the viewport while its values are unreadably squeezed.
    const metric = editor.locator(".req-check-editor").first();
    const target = metric.getByLabel("目标值", { exact: true });
    const unit = metric.getByLabel("单位", { exact: true });
    await expect(target).toHaveValue("1000");
    for (const field of [target, unit]) {
      const bounds = await field.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeGreaterThanOrEqual(width <= 640 ? 100 : 90);
      expect(bounds!.height).toBeGreaterThanOrEqual(56);
    }
    const icon = await metric.getByRole("button", { name: "删除指标 1", exact: true }).boundingBox();
    const group = await metric.boundingBox();
    expect(icon).not.toBeNull();
    expect(icon!.width).toBeGreaterThanOrEqual(48);
    expect(icon!.height).toBeGreaterThanOrEqual(48);
    expect(icon!.x + icon!.width).toBeLessThanOrEqual(group!.x + group!.width + 1);
    await page.screenshot({ path: test.info().outputPath(`需求提报-${width}.png`), fullPage: true });
    await editor.getByRole("group", { name: "需求方向", exact: true }).getByRole("button", { name: /^平台开发/ }).click();
    await expect(editor.getByLabel("功能模块", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`平台开发提报-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "关闭提交表单", exact: true }).click();
    await page.getByRole("button", { name: "看板", exact: true }).click();
    const board = page.locator(".req-board");
    await expect(board).toBeVisible();
    await expect(board.getByRole("heading", { name: /用户验收/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await board.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`需求看板-${width}.png`), fullPage: true });
  });
}
