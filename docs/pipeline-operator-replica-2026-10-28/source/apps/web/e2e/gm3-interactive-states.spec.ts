import { expect, test } from "@playwright/test";

test("an invalid focused field keeps its error color and a stable accessible name", async ({ page }) => {
  await page.goto("/events");
  await page.locator(".events-entry > summary").click();
  await page.getByRole("button", { name: "写入事件", exact: true }).click();
  const field = page.getByRole("textbox", { name: "事件名称", exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const state = await field.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--md-sys-color-error)";
    document.body.append(probe);
    const errorColor = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(element);
    const description = (element.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent).join(" ");
    return { border: style.borderColor, shadow: style.boxShadow, errorColor, description };
  });
  await expect(field).toHaveCSS("border-color", state.errorColor);
  await expect.poll(() => field.evaluate((element) => getComputedStyle(element).boxShadow)).toContain(state.errorColor);
  expect(state.description).toContain("事件名称至少 2 个字符");
});

test("a pending filled action uses disabled content and container roles", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/events", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  try {
    await page.goto("/events");
    await page.locator(".events-entry > summary").click();
    await page.getByRole("textbox", { name: "事件名称", exact: true }).fill(`GM3 状态回归 ${Date.now()}`);
    await page.getByRole("textbox", { name: "数据源", exact: true }).fill("gm3-state-regression");
    await page.getByRole("button", { name: "写入事件", exact: true }).click();
    const action = page.getByRole("button", { name: "写入中", exact: true });
    await expect(action).toBeDisabled();
    const state = await action.evaluate((element) => {
      const probe = document.createElement("span");
      document.body.append(probe);
      probe.style.color = "color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent)";
      const disabledContent = getComputedStyle(probe).color;
      probe.style.backgroundColor = "color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent)";
      const disabledContainer = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const container = element.querySelector(".md-button-container")!;
      return { color: getComputedStyle(element).color, background: getComputedStyle(container).backgroundColor, opacity: getComputedStyle(element).opacity, stateLayer: getComputedStyle(container, "::before").opacity, disabledContent, disabledContainer };
    });
    await expect(action).toHaveCSS("color", state.disabledContent);
    expect(state.background).toBe(state.disabledContainer);
    expect(state.opacity).toBe("1");
    expect(state.stateLayer).toBe("0");
  } finally {
    release();
  }
});
