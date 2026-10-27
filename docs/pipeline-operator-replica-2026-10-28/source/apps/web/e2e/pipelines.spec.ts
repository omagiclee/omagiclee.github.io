import { expect, test, type Page } from "@playwright/test";

// These checks exercise real registry/pipeline APIs and React Flow editing.
// They deliberately do not claim to run video models or external inference.
async function createVideoTemplate(page: Page) {
  await page.goto("/pipelines?view=new&template=video");
  await page.getByRole("button", { name: "创建视频处理流程", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
}
async function openSourceParameters(page: Page) {
  await page.getByRole("button", { name: "配置节点 youtube_ingest", exact: true }).click();
  await expect(page.getByLabel("YouTube 视频链接")).toBeVisible();
}
async function openInformation(page: Page) {
  await page.getByRole("button", { name: "更多流程操作" }).click();
  await page.getByRole("menuitem", { name: "流程信息" }).click();
}

test("the independent registry enables installed media operators", async ({ page }) => {
  await page.goto("/operators");
  await expect(page.getByRole("heading", { name: "算子与插件", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "启用插件", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  const plugin = dialog.locator("article").filter({ hasText: "media.video" });
  await expect(plugin).toBeVisible();
  const register = plugin.getByRole("button", { name: "启用到项目" });
  if (await register.count()) await register.click();
  await expect(plugin).toContainText("项目已启用");
  await page.getByRole("button", { name: "关闭插件启用窗口" }).click();
  await expect(page.getByText("builtin.core", { exact: false })).toHaveCount(0);
  await page.goto("/pipelines?view=new");
  await expect(page.getByRole("button", { name: "添加算子 AutoShot 镜头切分 v1.0.0", exact: true })).toBeVisible();
});

test("a real video template persists React Flow node positions and immutable versions", async ({ page }) => {
  await createVideoTemplate(page);
  await openSourceParameters(page);
  await expect(page.getByLabel("YouTube 视频链接")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  const connection = page.locator('.react-flow__edge[data-id="youtube_ingest:autoshot:data"]');
  const sourceHandle = page.locator('.react-flow__node[data-id="youtube_ingest"] .react-flow__handle.source');
  const targetHandle = page.locator('.react-flow__node[data-id="autoshot"] .react-flow__handle.target');
  await sourceHandle.hover();
  await targetHandle.scrollIntoViewIfNeeded();
  let sourceBox = await sourceHandle.boundingBox();
  let targetBox = await targetHandle.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Connection handles did not render");
  await page.mouse.click((sourceBox.x + targetBox.x + sourceBox.width) / 2, (sourceBox.y + targetBox.y + sourceBox.height) / 2);
  await page.keyboard.press("Delete");
  await expect(connection).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await sourceHandle.hover();
  await targetHandle.scrollIntoViewIfNeeded();
  sourceBox = await sourceHandle.boundingBox();
  targetBox = await targetHandle.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Connection handles disappeared");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(connection).toHaveCount(1);
  await page.getByLabel("选择配置节点").selectOption("youtube_ingest");
  const title = `视频画布验证 ${Date.now()}`;
  await openInformation(page);
  await page.getByLabel("流程名称", { exact: true }).fill(title);
  await page.getByRole("button", { name: "应用到草稿", exact: true }).click();
  const node = page.locator('.react-flow__node[data-id="youtube_ingest"]');
  const header = node.locator(".pipe-canvas-card-heading");
  await header.hover();
  const box = await header.boundingBox();
  if (!box) throw new Error("Source node did not render");
  await page.mouse.move(box.x + 30, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 75, box.y + 55, { steps: 10 });
  await page.mouse.up();
  const saving = page.waitForResponse((response) => response.url().includes("/versions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存版本", exact: true }).click();
  const saved = await (await saving).json();
  expect(saved.version).toBe(2);
  const position = saved.graph.nodes.find((item: { id: string }) => item.id === "youtube_ingest").position;
  expect(Number.isFinite(position.x)).toBe(true);
  expect(Number.isFinite(position.y)).toBe(true);
  expect(position.x).not.toBe(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "修改流程名称", exact: true })).toBeVisible();
  const restored = await page.locator('.react-flow__node[data-id="youtube_ingest"]').evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
  expect(restored.x).toBeCloseTo(position.x, 3);
  expect(restored.y).toBeCloseTo(position.y, 3);
});

test("invalid source JSON survives node switching and backend rejects cycles", async ({ page }) => {
  await createVideoTemplate(page);
  await openSourceParameters(page);
  await page.getByLabel("YouTube 视频链接").fill("[invalid");
  await expect(page.getByRole("button", { name: "保存版本", exact: true })).toBeDisabled();
  await page.getByLabel("选择配置节点").selectOption("autoshot");
  await page.getByLabel("选择配置节点").selectOption("youtube_ingest");
  await expect(page.getByLabel("YouTube 视频链接")).toHaveValue("[invalid");
  await page.getByLabel("YouTube 视频链接").fill('["https://www.youtube.com/watch?v=aqz-KE-bpKQ"]');
  await page.getByLabel("选择配置节点").selectOption("autoshot");
  // The editor blocks invalid edges; the API must independently reject forged graphs.
  await expect(page.getByLabel("上游节点").locator('option[value="doubao_video_embed"]')).toBeDisabled();
  const apiBase = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8010}`;
  const session = await (await page.request.get(`${apiBase}/api/me`)).json();
  const pipelineId = new URL(page.url()).searchParams.get("pipelineId");
  const pipeline = await (await page.request.get(`${apiBase}/api/pipelines/${pipelineId}?project_id=demo`)).json();
  pipeline.graph.nodes.find((node: {id:string}) => node.id === "autoshot").inputs.data = "doubao_video_embed";
  const validation = await page.request.post(`${apiBase}/api/pipelines/validate?project_id=demo`, {headers:{"X-CSRF-Token":session.csrf_token}, data:{graph:pipeline.graph}});
  expect((await validation.json()).errors.join(" ")).toContain("cycle");
  const save = await page.request.post(`${apiBase}/api/pipelines/${pipelineId}/versions?project_id=demo`, {headers:{"X-CSRF-Token":session.csrf_token}, data:{name:pipeline.name,description:pipeline.description,graph:pipeline.graph,expected_version:pipeline.version}});
  expect(save.status()).toBe(422);
  expect(JSON.stringify(await save.json())).toContain("cycle");
});

test("the editor preserves useful first-screen canvas space and accessible narrow-screen panels", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await createVideoTemplate(page);
  const canvas = page.getByLabel("可视化流程画布");
  const geometry = await canvas.boundingBox();
  if (!geometry) throw new Error("Canvas is missing");
  expect(geometry.y).toBeLessThanOrEqual(300);
  expect(Math.min(geometry.y + geometry.height, 720) - geometry.y).toBeGreaterThanOrEqual(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("pipeline-1280.png"), fullPage: false });
  await openSourceParameters(page);
  const parameters = page.getByRole("button", { name: "参数", exact: true });
  const configuration = page.getByLabel("节点配置", { exact: true });
  await expect(configuration).toBeVisible();
  const configurationId = await configuration.getAttribute("id");
  expect(configurationId).toBeTruthy();
  await expect(parameters).toHaveAttribute("aria-controls", configurationId!);
  await expect(parameters).toHaveAttribute("aria-expanded", "true");
  await parameters.click();
  await expect(parameters).toHaveAttribute("aria-expanded", "false");
  await expect(configuration).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "参数", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "配置参数" })).toBeVisible();
  await expect(page.getByLabel("YouTube 视频链接")).toBeVisible();
  await page.getByRole("button", { name: "关闭面板" }).click();
  await expect(page.getByRole("dialog", { name: "配置参数" })).toBeHidden();
  await expect(parameters).toBeFocused();
  await expect(parameters).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("pipeline-390.png"), fullPage: false });
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  await expect(page.getByText("只读版本", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "版本", exact: true })).toHaveAttribute("aria-selected", "true");
});
