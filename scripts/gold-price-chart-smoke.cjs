#!/usr/bin/env node
'use strict';
// Usage: node scripts/gold-price-chart-smoke.cjs /path/to/hugo-build
// Uses an isolated headless Chromium; never a personal browser profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const directory = path.resolve(process.argv[2] || 'public');
const article = '/posts/family/investment-basics/';
const chart = '#gold-price-monthly-30y';
const screenshotDirectory = process.env.SITE_SMOKE_SCREENSHOT_DIR;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };
const label = d => `${d.month.slice(0, 4)} 年 ${Number(d.month.slice(5))} 月`;
async function main() {
  assert(fs.existsSync(path.join(directory, article, 'index.html')), 'Build the Hugo site before running this check.');
  const server = http.createServer((request, response) => {
    let file = path.resolve(directory, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
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
    browser = await chromium.launch({ channel: 'chromium', headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    const context = await browser.newContext();
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.fulfill({ status: 204, body: '' }));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + article, { waitUntil: 'networkidle' });
      const figure = page.locator(chart); await figure.locator('svg').waitFor();
      const rows = await figure.locator('.gold-price-chart__dataset').evaluate(el => JSON.parse(el.textContent));
      assert.equal(rows.length, 360, 'Show 30 years of monthly observations.');
      rows.forEach((d, i) => {
        assert.match(d.month, /^\d{4}-(0[1-9]|1[0-2])$/);
        assert(d.price > 0);
        if (i) {
          const month = text => Number(text.slice(0, 4)) * 12 + Number(text.slice(5));
          assert.equal(month(d.month), month(rows[i - 1].month) + 1);
          assert(Math.abs((d.price / rows[i - 1].price - 1) * 100 - d.change) < .03, `Verify rounded monthly change for ${d.month}.`);
        }
      });
      const values = figure.locator('.gold-price-chart__values'), canvas = figure.locator('.gold-price-chart__canvas');
      assert((await values.innerText()).includes(label(rows.at(-1))));
      await canvas.focus(); await page.keyboard.press('Home');
      assert((await values.innerText()).includes(label(rows[0])));
      assert(await figure.locator('.gold-price-chart__previous').isDisabled());
      await page.keyboard.press('ArrowRight');
      assert((await values.innerText()).includes(label(rows[1])));
      assert.equal(await canvas.getAttribute('aria-valuenow'), '1');
      await figure.locator('.gold-price-chart__next').click();
      assert((await values.innerText()).includes(label(rows[2])));
      await canvas.focus(); await page.keyboard.press('End');
      assert((await values.innerText()).includes(label(rows.at(-1))));
      assert(await figure.locator('.gold-price-chart__next').isDisabled());
      const overlay = figure.locator('.gold-price-chart__overlay'), box = await overlay.boundingBox();
      await page.mouse.move(box.x + box.width * 180 / 359, box.y + box.height / 2);
      assert((await values.innerText()).includes(label(rows[180])));
      await overlay.dispatchEvent('pointerdown', { clientX: box.x, clientY: box.y + box.height / 2, pointerType: 'touch' });
      assert((await values.innerText()).includes(label(rows[0])));
      await figure.locator('[data-mode="change"]').click();
      assert.equal(await figure.locator('[data-mode="change"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await figure.locator('.gold-price-chart__bar').count(), rows.filter(d => Number.isFinite(d.change)).length);
      assert(await figure.locator('.gold-price-chart__bar--negative').count() > 0);
      assert.match(await figure.locator('.gold-price-chart__unit').innerText(), /环比/);
      await canvas.focus(); await page.keyboard.press('ArrowRight');
      assert((await values.innerText()).includes(label(rows[1])));
      await figure.locator('[data-mode="price"]').click();
      assert.equal(await figure.locator('.gold-price-chart__line').count(), 1);
      await canvas.focus(); await page.keyboard.press('End'); await canvas.evaluate(el => el.blur());
      const layout = await figure.evaluate(el => ({ right: el.getBoundingClientRect().right, left: el.getBoundingClientRect().left, scroll: el.scrollWidth, width: el.clientWidth, view: el.querySelector('svg').viewBox.baseVal.width, canvas: el.querySelector('.gold-price-chart__canvas').clientWidth }));
      assert(layout.left >= 0 && layout.right <= width + 1, `Chart overflows viewport at ${width}px.`);
      assert(layout.scroll <= layout.width + 1, `Chart content overflows at ${width}px.`);
      assert.equal(layout.view, layout.canvas);
      if (screenshotDirectory) { fs.mkdirSync(screenshotDirectory, { recursive: true }); await figure.screenshot({ path: path.join(screenshotDirectory, `gold-${width}.png`) }); }
      await page.evaluate(() => document.documentElement.setAttribute('theme', 'dark'));
      assert.equal(await figure.evaluate(el => getComputedStyle(el).getPropertyValue('--gc-panel').trim()), '#252d39');
      if (screenshotDirectory && width === 390) await figure.screenshot({ path: path.join(screenshotDirectory, 'gold-390-dark.png') });
    }
    await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(100);
    const resized = await page.locator(chart).evaluate(el => ({ view: el.querySelector('svg').viewBox.baseVal.width, width: el.querySelector('.gold-price-chart__canvas').clientWidth }));
    assert.equal(resized.view, resized.width);
    assert.deepEqual(errors, []);
    const fallbackContext = await browser.newContext({ javaScriptEnabled: false });
    await fallbackContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.fulfill({ status: 204, body: '' }));
    const fallback = await fallbackContext.newPage(); await fallback.goto(origin + article, { waitUntil: 'networkidle' });
    await fallback.locator(`${chart} summary`).click();
    assert.equal(await fallback.locator(`${chart} tbody tr`).count(), 360);
    assert(await fallback.locator(`${chart} table`).isVisible());
    await fallbackContext.close(); await context.close();
    console.log('Gold chart passed: 360 consecutive months, rounded changes, keyboard, touch, modes, resize, 390/768/1440px, dark theme, and no-JS table.');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
