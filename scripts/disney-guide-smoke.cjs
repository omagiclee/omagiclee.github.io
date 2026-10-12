#!/usr/bin/env node
// node scripts/disney-guide-smoke.cjs <built-site-directory>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || 'public');
const route = '/posts/family/tour/shanghai-disney-2026-autumn/';
const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../content' + route + 'experiences.json'), 'utf8'));
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
async function main() {
  assert(fs.existsSync(path.join(root, route, 'index.html')), 'Build must include guide');
  assert.equal(new Set(catalog.items.map(x => x.id)).size, catalog.items.length);
  for (const item of catalog.items) for (const field of ['image', 'fullImage']) assert(fs.existsSync(path.join(root, route, item[field])), `Missing asset ${item.id} ${field}`);
  const server = http.createServer((req, res) => {
    let file;
    try {
      file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (file !== root && !file.startsWith(root + path.sep)) throw Error('Outside build');
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.statSync(file).isFile()) throw Error('Not a file');
    } catch { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chromium', headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.fulfill({ status: 204, body: '' }));
      assert((await page.goto(origin + route, { waitUntil: 'networkidle' })).ok());
      await page.waitForFunction(() => !document.querySelector('.dg-toc').hidden);
      assert.equal(await page.locator('#catalog-full').evaluate(el => el.tagName), 'H2');
      assert.equal(await page.locator('[data-disney-catalog]').evaluate(el => el.closest('details')), null, 'Full catalog must not be folded');
      assert.equal(await page.locator('.dg-experience:visible').count(), catalog.items.length);
      assert.equal(await page.locator('.dg-dpa-single').filter({ hasText: '参考' }).count(), 19, 'Keep 19 reference budgets visible');
      for (const id of ['hotel-price-history', 'hotel-refund', 'legacy-premier-research', 'bundle-research']) {
        assert.equal(await page.locator('#' + id).count(), 1, `Restore legacy research ${id}`);
        assert.equal(await page.locator('#' + id).evaluate(el => el.open), false, `Keep legacy research folded ${id}`);
      }
      if (width < 760) {
        assert.equal(await page.locator('.dg-shortlist td').first().evaluate(el => getComputedStyle(el).display), 'block');
        assert(await page.locator('.dg-ticket-prices .table-wrapper').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Core ticket prices must not need horizontal scroll');
      }
      for (const id of ['friday', 'saturday', 'sunday']) assert.equal(await page.locator('#' + id).count(), 1);
      assert.deepEqual(await page.locator('.disney-guide').evaluate(el => [...el.querySelectorAll('a[href^="#"]')].filter(a => !document.getElementById(decodeURIComponent(a.hash.slice(1)))).map(a => a.hash)), []);
      const text = await page.locator('.disney-guide').innerText();
      for (const phrase of ['¥3,768', '20:00', '08:30', '不安排午睡', '¥2,860', '周日', '近两年装修']) assert(text.includes(phrase), `Missing core fact ${phrase}`);
      await page.locator('.disney-guide a[href="#ticket-rules"]').click();
      assert.equal(await page.locator('#ticket-rules').evaluate(el => el.open), true);
      await page.goto(origin + route + '#catalog-full', { waitUntil: 'networkidle' });
      assert(await page.locator('[data-disney-catalog]').isVisible());
      await page.locator('[data-catalog-fit]').selectOption('优先推荐');
      assert.equal(await page.locator('.dg-experience:not([hidden])').count(), catalog.items.filter(x => x.fit === '优先推荐').length);
      await page.locator('[data-catalog-search]').fill('维尼');
      assert(await page.locator('.dg-experience:not([hidden])').count() > 0);
      await page.locator('[data-catalog-search]').fill('not-found-987');
      assert.equal(await page.locator('.dg-experience:not([hidden])').count(), 0);
      assert(await page.locator('[data-catalog-empty]').isVisible());
      await page.locator('[data-catalog-search]').fill('');
      await page.locator('[data-catalog-fit]').selectOption('');
      await page.locator('[data-catalog-sort]').selectOption('land');
      assert.equal(await page.locator('.dg-experience:not([hidden])').count(), catalog.items.length);
      await page.locator('[data-catalog-sort]').selectOption('family');
      await page.locator('.dg-experience [data-catalog-detail]').first().click();
      await page.locator('[data-catalog-detail-dialog]').waitFor({ state: 'visible' });
      assert((await page.locator('[data-catalog-detail-content]').innerText()).includes('奇梦之光'));
      await page.keyboard.press('Escape');
      await page.locator('.dg-experience [data-catalog-zoom]').first().click();
      await page.waitForFunction(() => { const i = document.querySelector('[data-catalog-full-photo]'); return i.complete && i.naturalWidth > 0; });
      await page.keyboard.press('Escape');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `Page overflow at ${width}px`);
      if (process.env.SITE_SMOKE_SCREENSHOT_DIR) {
        const dir = process.env.SITE_SMOKE_SCREENSHOT_DIR; fs.mkdirSync(dir, { recursive: true });
        await page.goto(origin + route, { waitUntil: 'networkidle' });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(dir, `disney-${width}.png`), fullPage: true });
        await page.screenshot({ path: path.join(dir, `disney-${width}-top.png`) });
        await page.evaluate(() => { localStorage.setItem('theme', 'dark'); });
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('body[theme="dark"]').waitFor({ state: 'attached' });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(dir, `disney-${width}-dark.png`), fullPage: true });
        await page.screenshot({ path: path.join(dir, `disney-${width}-dark-top.png`) });
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}px: two-day core, ${catalog.items.length} unfolded items, 19 reference budgets, folded historical research, anchors, filters, dialogs, no overflow`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
