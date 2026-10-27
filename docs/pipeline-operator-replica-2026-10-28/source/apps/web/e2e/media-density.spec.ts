import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`media discovery keeps empty guidance compact and preserves keyboard filtering at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/projects/demo/explore");
    await expect(page.getByRole("heading", { name: "还没有可检索的镜头" })).toBeVisible();
    const empty = page.locator(".media-empty");
    const bounds = await empty.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(96);
    expect(bounds!.height).toBeLessThanOrEqual(144);
    const steps = page.getByRole("list", { name: "开始探索的步骤" });
    await expect(steps).toBeHidden();
    await page.locator(".media-onboarding-guide summary").click();
    await expect(steps).toBeVisible();
    await expect(steps.getByRole("listitem")).toHaveCount(3);
    await page.locator(".media-onboarding-guide summary").click();
    await expect(page.getByRole("link", { name: "去创建处理流程", exact: true })).toBeVisible();
    const person = page.getByRole("button", { name: "人物标签", exact: true });
    await person.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitemradio", { name: "检出人物", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(person).toBeFocused();
    await expect(person).toHaveText("检出人物");
    const submitted = page.waitForRequest((request) => request.method() === "POST" && request.url().includes("/api/media/search") && request.postDataJSON()?.person_status === "detected");
    await page.getByRole("button", { name: "检索镜头", exact: true }).click();
    expect((await submitted).postDataJSON()).toMatchObject({ mode: "filter", person_status: "detected", limit: 24 });
    await expect(page.getByRole("heading", { name: "还没有可检索的镜头" })).toBeVisible();
    if (width === 390) {
      await page.screenshot({ path: "../../.data/ui-review-media-density/verification.png", fullPage: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
