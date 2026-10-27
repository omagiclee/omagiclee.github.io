import { expect, test } from "@playwright/test";

// Real API and isolated database. No running Dagster daemon is required here:
// actual plan execution and reviewed publication are covered by
// tests/test_pipeline_closed_loop.py using the real Dagster executor.
test("saved text input produces a stable target plan and guarded debug submission", async ({ page }) => {
  await page.goto("/projects/demo/pipelines?view=new&template=text");
  await page.getByLabel("固定输入文档", { exact: true }).fill("keep first document\ndiscard second document\nkeep third document");
  await page.getByRole("button", { name: "创建文本流程", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.getByRole("button", { name: "配置节点 filter", exact: true }).click();
  await page.getByLabel("调试样本条数").fill("2");

  await page.getByRole("button", { name: "更多流程操作" }).click();
  await page.getByRole("menuitemcheckbox", { name: "复用节点缓存" }).click();
  await page.keyboard.press("Escape");
  const firstPlanResponse = page.waitForResponse(response => response.url().endsWith("/run-plan") && response.request().method() === "POST");
  await page.getByRole("button", { name: "预检调试计划", exact: true }).click();
  const firstPlan = await firstPlanResponse;
  expect(firstPlan.status(), await firstPlan.text()).toBe(200);
  expect(firstPlan.request().postDataJSON().use_cache).toBe(false);
  const plan = await firstPlan.json();
  expect(plan.node_ids).toEqual(["documents", "filter"]);
  expect(plan.sample.sources[0].record_count).toBe(2);
  await expect(page.getByRole("region", { name: "不可变执行计划" })).toBeVisible();

  await page.getByRole("button", { name: "更多流程操作" }).click();
  await page.getByRole("menuitem", { name: "流程信息" }).click();
  await page.getByLabel("流程名称", { exact: true }).fill(`目标调试 ${Date.now()}`);
  await page.getByRole("button", { name: "应用到草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "预检调试计划", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "运行到此节点", exact: true })).toBeDisabled();
  await expect(page.getByText(/有未保存的修改，请先保存版本/)).toBeVisible();
  const saving = page.waitForResponse(response => response.url().includes("/versions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存版本", exact: true }).click();
  expect((await (await saving).json()).version).toBe(2);
  await expect(page.getByRole("button", { name: "预检调试计划", exact: true })).toBeEnabled();

  const secondPlanResponse = page.waitForResponse(response => response.url().endsWith("/run-plan") && response.request().method() === "POST");
  await page.getByRole("button", { name: "预检调试计划", exact: true }).click();
  const secondPlan = await (await secondPlanResponse).json();
  expect(secondPlan.semantic_digest).toBe(plan.semantic_digest);
  expect(secondPlan.sample.sources).toEqual(plan.sample.sources);
  const submitting = page.waitForResponse(response => /\/pipelines\/[^/]+\/runs\?/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "运行到此节点", exact: true }).click();
  const submitted = await submitting;
  expect(submitted.status(), await submitted.text()).toBe(202);
  const run = await submitted.json();
  expect(run.mode).toBe("debug");
  expect(run.execution_plan.plan_digest).toBe(secondPlan.plan_digest);
  expect(run.execution_plan.sample.sources[0].record_count).toBe(2);
  await expect(page).toHaveURL(/view=runs/);
  await expect(page.locator(".pipe-run-canvas .react-flow__node")).toHaveCount(2);
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => {
      const source = await page.locator('.pipe-run-canvas .react-flow__node[data-id="documents"]').boundingBox();
      const target = await page.locator('.pipe-run-canvas .react-flow__node[data-id="filter"]').boundingBox();
      return !!source && !!target && source.y + source.height < target.y;
    }).toBe(true);
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    await page.screenshot({ path: test.info().outputPath(`debug-run-${width}.png`), fullPage: true });
  }
});

test("external video source is rejected at preflight without submitting a run", async ({ page }) => {
  await page.goto("/projects/demo/pipelines?view=new&template=video");
  await page.getByRole("button", { name: "创建视频处理流程", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await page.getByRole("button", { name: "配置节点 youtube_ingest", exact: true }).click();
  const response = page.waitForResponse(result => result.url().endsWith("/run-plan") && result.request().method() === "POST");
  await page.getByRole("button", { name: "预检调试计划", exact: true }).click();
  expect((await response).status()).toBe(422);
  await expect(page.getByRole("alert").filter({ hasText: /外部源|副作用/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "运行到此节点", exact: true })).toBeDisabled();
});
