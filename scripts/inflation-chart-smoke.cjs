#!/usr/bin/env node
'use strict';

// Usage: node scripts/inflation-chart-smoke.cjs /path/to/hugo-build
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an isolated Chromium executable if needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(process.argv[2] || 'public');
const article = '/posts/family/investment-basics/';
const chart = '#china-us-cpi-1996-2025';
const screenshotDirectory = process.env.SITE_SMOKE_SCREENSHOT_DIR;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };

async function main() {
  assert(fs.existsSync(path.join(directory, article, 'index.html')), 'Build the Hugo site before running this check.');
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(directory, `.${pathname}`);
    if (!file.startsWith(`${directory}${path.sep}`) && file !== directory) { response.writeHead(403); return response.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); return response.end(); }
    response.writeHead(200, { 'content-type': `${mime[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    const context = await browser.newContext();
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      return route.fulfill({ status: 204, body: '' });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + article, { waitUntil: 'networkidle' });
      const figure = page.locator(chart);
      await figure.locator('svg').waitFor();
      const rows = await figure.locator('.inflation-chart__dataset').evaluate(el => JSON.parse(el.textContent));
      assert.equal(rows.length, 30);
      assert.equal(rows[0].year, 1996);
      assert.equal(rows.at(-1).year, 2025);
      assert(rows.some(row => row.china < 0), 'Negative inflation must be retained.');
      assert.equal(rows.at(-1).china, 0);
      assert.match(rows.at(-1).usLabel, /2\.6%\*/);
      const values = figure.locator('.inflation-chart__values');
      assert.match(await values.innerText(), /2025 年/);
      const canvas = figure.locator('.inflation-chart__canvas');
      await canvas.focus();
      await page.keyboard.press('Home');
      assert.match(await values.innerText(), /1996 年/);
      assert.match(await values.innerText(), /8\.3%/);
      await page.keyboard.press('ArrowRight');
      assert.match(await values.innerText(), /1997 年/);
      assert.equal(await canvas.getAttribute('aria-valuenow'), '1997');
      assert.equal(await canvas.getAttribute('role'), 'slider');
      await figure.locator('.inflation-chart__next').click();
      assert.match(await values.innerText(), /1998 年/);
      await canvas.focus();
      await page.keyboard.press('End');
      assert.match(await values.innerText(), /2025 年/);
      assert(await figure.locator('.inflation-chart__next').isDisabled());
      const overlay = figure.locator('.inflation-chart__overlay');
      const box = await overlay.boundingBox();
      await page.mouse.move(box.x + box.width * (2022 - 1996) / 29, box.y + box.height / 2);
      assert.match(await values.innerText(), /2022 年/);
      assert.match(await values.innerText(), /8\.0%/);
      await overlay.dispatchEvent('pointerdown', { clientX: box.x, clientY: box.y + box.height / 2, pointerType: 'touch' });
      assert.match(await values.innerText(), /1996 年/);
      const layout = await figure.evaluate(el => ({ right: el.getBoundingClientRect().right, left: el.getBoundingClientRect().left, scroll: el.scrollWidth, width: el.clientWidth, view: el.querySelector('svg').viewBox.baseVal.width, canvas: el.querySelector('.inflation-chart__canvas').clientWidth }));
      assert(layout.left >= 0 && layout.right <= width + 1, `Chart overflows viewport at ${width}px.`);
      assert(layout.scroll <= layout.width + 1, `Chart content overflows at ${width}px.`);
      assert.equal(layout.view, layout.canvas, 'SVG must relayout to container width.');
      await canvas.focus();
      await page.keyboard.press('End');
      await canvas.evaluate(el => el.blur());
      if (screenshotDirectory) {
        fs.mkdirSync(screenshotDirectory, { recursive: true });
        await figure.screenshot({ path: path.join(screenshotDirectory, `inflation-${width}.png`) });
      }
      await page.evaluate(() => document.documentElement.setAttribute('theme', 'dark'));
      assert.equal(await figure.evaluate(el => getComputedStyle(el).getPropertyValue('--ic-panel').trim()), '#252d39');
      if (screenshotDirectory && width === 390) await figure.screenshot({ path: path.join(screenshotDirectory, 'inflation-390-dark.png') });
    }
    // Width changes must trigger a fresh layout, without reinitializing or resetting selection.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(100);
    const resized = await page.locator(chart).evaluate(el => ({ view: el.querySelector('svg').viewBox.baseVal.width, width: el.querySelector('.inflation-chart__canvas').clientWidth }));
    assert.equal(resized.view, resized.width);
    assert.deepEqual(errors, [], 'Chart must not produce JavaScript errors.');
    const fallbackContext = await browser.newContext({ javaScriptEnabled: false });
    await fallbackContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.fulfill({ status: 204, body: '' }));
    const fallback = await fallbackContext.newPage();
    await fallback.goto(origin + article, { waitUntil: 'networkidle' });
    await fallback.locator(`${chart} summary`).click();
    assert.equal(await fallback.locator(`${chart} tbody tr`).count(), 30);
    assert(await fallback.locator(`${chart} table`).isVisible());
    await fallbackContext.close();
    await context.close();
    console.log('Inflation chart passed: 30 years, negative values, keyboard, touch, resize, 390/768/1440px, dark mode, and no-JS fallback.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
