import { expect, test, type Page } from "@playwright/test";

async function choose(page: Page, label: string, option: string) {
  const trigger = page.getByRole("button", { name: label, exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitemradio", { name: option, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText(option);
}

for (const width of [1440, 390]) {
  test(`directory menus preserve project filters and reset pagination at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/projects/demo/pipelines?page=2&q=未匹配");
    await choose(page, "筛选最近运行状态", "失败");
    let params = new URL(page.url()).searchParams;
    expect(params.get("status")).toBe("failed");
    expect(params.get("q")).toBe("未匹配");
    expect(params.has("page")).toBe(false);
    await page.goto("/projects/demo/runs?page=2&pipelineId=missing-flow");
    await choose(page, "筛选运行状态", "失败");
    params = new URL(page.url()).searchParams;
    expect(params.get("status")).toBe("failed");
    expect(params.get("pipelineId")).toBe("missing-flow");
    expect(params.has("page")).toBe(false);
    expect(new URL(page.url()).pathname).toBe("/projects/demo/runs");
    await page.goto("/projects/demo/operators");
    await choose(page, "按功能分类筛选算子", "模型推理与增强");
    await choose(page, "按模态筛选算子", "视频");
    await page.getByRole("button", { name: "按模态筛选算子", exact: true }).click();
    await expect(page.getByRole("menuitemradio", { name: "视频", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
