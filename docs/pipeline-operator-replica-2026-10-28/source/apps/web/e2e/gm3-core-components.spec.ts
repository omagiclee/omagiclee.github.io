import { expect, test } from "@playwright/test";

const fixture = "/e2e/fixtures/gm3-core.html";
test("shared fields retain error, disabled and readonly states through hover and focus", async ({ page }) => {
  await page.goto(fixture);
  for (const type of ["input", "textarea", "select"]) {
    const error = page.getByTestId(`${type}-error`);
    const errorColor = await error.evaluate(() => {
      const p = document.createElement("span"); p.style.color = "var(--md-sys-color-error)"; document.body.append(p); const color = getComputedStyle(p).color; p.remove(); return color;
    });
    await error.hover();
    await expect(error).toHaveCSS("border-color", errorColor);
    await error.focus();
    await expect(error).toHaveCSS("border-color", errorColor);
    await expect(error).toHaveCSS("outline-color", errorColor);
    await expect.poll(() => error.evaluate(e => getComputedStyle(e).boxShadow)).toContain(errorColor);
    const disabled = page.getByTestId(`${type}-disabled-error`);
    await expect(disabled).toBeDisabled();
    expect(await disabled.evaluate(e => getComputedStyle(e).boxShadow)).toBe("none");
    expect(await disabled.evaluate(e => getComputedStyle(e).borderColor)).not.toBe(errorColor);
  }
  for (const type of ["input", "textarea"]) {
    const readonly = page.getByTestId(`${type}-readonly`);
    const before = await readonly.evaluate(e => getComputedStyle(e).borderColor);
    await readonly.hover(); await readonly.focus();
    await expect(readonly).toBeFocused(); await expect(readonly).toHaveCSS("border-color", before);
    await page.keyboard.press("x"); await expect(readonly).toHaveValue("readonly");
  }
});

test("invalid progress becomes indeterminate and invalid range does not leak ARIA values", async ({ page }) => {
  await page.goto(fixture);
  for (const index of [3, 4]) {
    const progress = page.getByTestId(`progress-${index}`);
    await expect(progress).toHaveAttribute("data-indeterminate");
    await expect(progress).not.toHaveAttribute("aria-valuenow");
    await expect(progress).toHaveAttribute("aria-valuetext", "进度尚未确定");
  }
  await expect(page.getByTestId("progress-invalid-range")).toHaveAttribute("aria-valuemin", "0");
  await expect(page.getByTestId("progress-invalid-range")).toHaveAttribute("aria-valuemax", "100");
  await expect(page.getByTestId("progress-invalid-range")).toHaveAttribute("aria-valuenow", "42");
});

test("toolbar current choice is announced and radio choice restores focus", async ({ page }) => {
  await page.goto(fixture);
  const trigger = page.getByRole("button", { name: "统计周期", exact: true });
  await expect(trigger).toHaveAccessibleDescription("最近 30 天");
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "最近 7 天" }).click();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAccessibleDescription("最近 7 天");
  await expect(page.getByRole("button", { name: "禁用周期", exact: true })).toBeDisabled();
});

test("tabs preserve keyboard navigation and associated content in RTL", async ({ page }) => {
  await page.goto(`${fixture}?dir=rtl`);
  const first = page.getByRole("tab", { name: "First" });
  await first.focus(); await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Second" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tabpanel")).toHaveText("second panel");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", await page.getByRole("tab", { name: "Second" }).getAttribute("id") ?? "");
  await page.keyboard.press("End"); await expect(page.getByRole("tab", { name: "Third" })).toBeFocused();
  await page.keyboard.press("Home"); await expect(first).toBeFocused();
});

test("keyboard focus layer takes precedence when the same button is hovered", async ({ page }) => {
  await page.goto(fixture);
  await page.locator("h1").click();
  for (const variant of ["default", "elevated", "secondary", "outline", "ghost", "link", "destructive", "destructive-text"]) {
    const button = page.getByTestId(`button-${variant}`);
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await button.hover();
    await expect.poll(() => button.evaluate(e => e.matches(":focus-visible"))).toBe(true);
    await expect.poll(() => button.evaluate(e => getComputedStyle(e.querySelector(".md-button-container")!, "::before").opacity)).toBe("0.12");
  }
});

test("reduced motion cancels indeterminate progress animation in RTL and LTR", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const direction of ["ltr", "rtl"]) {
    await page.goto(`${fixture}?dir=${direction}`);
    await expect.poll(() => page.getByTestId("progress-3").evaluate(e => getComputedStyle(e.querySelector(".md-linear-progress-indicator")!).animationName)).toBe("none");
  }
});

test("filled and tonal button hover elevation resets for focused and pressed states", async ({ page }) => {
  await page.goto(fixture);
  for (const variant of ["default", "secondary", "destructive"]) {
    const button = page.getByTestId(`button-${variant}`);
    await page.locator("h1").click();
    await button.hover();
    await expect.poll(() => button.evaluate(e => getComputedStyle(e.querySelector(".md-button-container")!).boxShadow)).not.toBe("none");
    await button.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    await expect(button).toBeFocused();
    await expect.poll(() => button.evaluate(e => getComputedStyle(e.querySelector(".md-button-container")!).boxShadow)).toBe("none");
    const bounds = await button.boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    await expect.poll(() => button.evaluate(e => getComputedStyle(e.querySelector(".md-button-container")!).boxShadow)).toBe("none");
    await page.mouse.up();
  }
});

test("sortable grid header retains a 48px target and keyboard sorting", async ({ page }) => {
  await page.goto(fixture);
  const header = page.getByRole("columnheader").first();
  await expect(header).toBeVisible();
  expect((await header.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await header.click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-sort", "descending");
});

test("forced colors uses the native select arrow without a duplicate custom arrow", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  for (const direction of ["ltr", "rtl"]) {
    await page.goto(`${fixture}?dir=${direction}`);
    const select = page.getByTestId("select-normal");
    await expect(select).toHaveCSS("appearance", "auto");
    expect(await select.evaluate(element => getComputedStyle(element.parentElement!, "::after").display)).toBe("none");
    await select.focus();
    await expect(select).toBeFocused();
    // The macOS headless native picker does not commit keyboard selection, even
    // for an unstyled select. Verify focus and the native selection API separately.
    await select.selectOption({ label: "另一个选项" });
    await expect(select).toHaveValue("另一个选项");
  }
});

test("enlarged labels reserve space above enlarged field values", async ({ page }) => {
  await page.goto(fixture);
  await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>("body *")].filter(element => !(element instanceof SVGElement) && (element.matches("input:not([type=checkbox]):not([type=radio]),textarea,select") || [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())));
    const sizes = elements.map(element => ({ element, font: parseFloat(getComputedStyle(element).fontSize), line: parseFloat(getComputedStyle(element).lineHeight) }));
    for (const { element, font, line } of sizes) {
      element.style.fontSize = `${font * 2}px`;
      if (Number.isFinite(line)) element.style.lineHeight = `${line * 2}px`;
    }
  });
  const fields = await page.locator(".md-field").evaluateAll(elements => elements.map(element => {
    const label = element.querySelector(".md-field-label")!;
    const control = element.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")!;
    const style = getComputedStyle(control);
    return { overlap: label.getBoundingClientRect().bottom - control.getBoundingClientRect().top, available: control.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom), line: parseFloat(style.lineHeight), scroll: control.scrollHeight, height: control.clientHeight };
  }));
  for (const field of fields) {
    expect(field.overlap).toBeLessThanOrEqual(8.1);
    expect(field.available).toBeGreaterThanOrEqual(field.line);
    expect(field.scroll).toBeLessThanOrEqual(field.height + 1);
  }
});

test("native console select indicator follows the text direction", async ({ page }) => {
  for (const direction of ["ltr", "rtl"]) {
    await page.goto(`${fixture}?dir=${direction}`);
    const select = page.getByTestId("select-native");
    await expect(select).toHaveCSS("appearance", "none");
    await expect(select).toHaveCSS("background-position", direction === "rtl" ? "20px 50%, 15px 50%" : "calc(100% - 20px) 50%, calc(100% - 15px) 50%");
    await select.focus(); await expect(select).toBeFocused();
    await select.selectOption({ label: "另一个选项" });
    await expect(select).toHaveValue("另一个选项");
  }
});
