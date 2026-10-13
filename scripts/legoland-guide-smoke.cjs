#!/usr/bin/env node
// node scripts/legoland-guide-smoke.cjs <built-site-directory>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || 'public');
const route = '/posts/family/tour/shanghai-legoland-2026-autumn/';
const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../content' + route + 'experiences.json')));
const videos = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../content' + route + 'videos.json')));
const research = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../content' + route + 'video-research.json')));
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
async function main() {
  assert(fs.existsSync(path.join(root, route, 'index.html')));
  assert.equal(new Set(catalog.items.map(x => x.id)).size, catalog.items.length);
  for (const [id, video] of Object.entries(videos.items)) {
    assert(catalog.items.some(x => x.id === id), `Unknown project video ${id}`);
    assert(video.title && video.creator && video.durationSeconds > 0);
    assert(['www.bilibili.com', 'www.douyin.com'].includes(new URL(video.url).hostname));
    if (video.embedUrl) {
      assert.equal(new URL(video.embedUrl).hostname, 'player.bilibili.com');
      assert.equal(new URL(video.embedUrl).searchParams.get('autoplay'), '0');
      if (video.startSeconds) assert.equal(Number(new URL(video.embedUrl).searchParams.get('t')), video.startSeconds);
    }
  }
  assert.equal(Object.keys(research.items).length, catalog.items.length);
  for (const item of catalog.items) {
    assert(research.items[item.id].reason);
    assert.equal(research.items[item.id].status, videos.items[item.id] ? 'matched' : 'not_confirmed');
  }
  for (const item of catalog.items) for (const field of ['image', 'fullImage']) assert(fs.existsSync(path.join(root, route, item[field])), `Missing ${item.id} ${field}`);
  const server = http.createServer((req, res) => {
    let file;
    try {
      file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (file !== root && !file.startsWith(root + path.sep)) throw Error('Outside build');
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
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
      assert.equal(await page.locator('[data-lego-catalog]').evaluate(el => el.closest('details')), null);
      assert.equal(await page.locator('.dg-experience:visible').count(), catalog.items.length);
      assert.equal(await page.locator('.dg-video-play').count(), Object.keys(videos.items).length);
      assert.equal(await page.locator('.dg-video-pending').count(), catalog.items.length - Object.keys(videos.items).length);
      assert.equal(await page.locator('iframe').count(), 0, 'Players must load only after a click');
      await page.locator('.dg-video-pending').first().click();
      assert((await page.locator('[data-catalog-detail-content]').innerText()).includes('视频检索说明'));
      await page.keyboard.press('Escape');
      assert.deepEqual(await page.locator('.lego-guide').evaluate(el => [...el.querySelectorAll('a[href^="#"]')].filter(a => !document.getElementById(decodeURIComponent(a.hash.slice(1)))).map(a => a.hash)), []);
      await page.goto(origin + route + '#ticket-rules', { waitUntil: 'networkidle' });
      assert.equal(await page.locator('#ticket-rules').evaluate(el => el.open), true);
      for (const type of ['骑乘', '景点', '拼搭体验', '演出', '小怪兽大派对']) {
        await page.locator('[data-catalog-type]').selectOption(type);
        assert.equal(await page.locator('.dg-experience:not([hidden])').count(), catalog.items.filter(x => x.type === type).length);
      }
      await page.locator('[data-catalog-type]').selectOption('');
      await page.locator('[data-catalog-fit]').selectOption('优先推荐');
      assert.equal(await page.locator('.dg-experience:not([hidden])').count(), catalog.items.filter(x => x.fit === '优先推荐').length);
      await page.locator('[data-catalog-search]').fill('初级驾驶');
      assert.equal(await page.locator('.dg-experience:not([hidden])').count(), 1);
      await page.locator('.dg-experience:not([hidden]) .dg-project-cell [data-catalog-detail]').click();
      await page.locator('[data-catalog-detail-dialog]').waitFor({ state: 'visible' });
      assert((await page.locator('[data-catalog-detail-content]').innerText()).includes('3—5 岁'));
      await page.keyboard.press('Escape');
      await page.locator('[data-catalog-search]').fill('not-found-987');
      assert.equal(await page.locator('.dg-experience:not([hidden])').count(), 0);
      assert(await page.locator('[data-catalog-empty]').isVisible());
      await page.locator('[data-catalog-search]').fill('');
      await page.locator('[data-catalog-fit]').selectOption('');
      await page.locator('[data-catalog-sort]').selectOption('land');
      assert.equal(await page.locator('.dg-experience:not([hidden])').count(), catalog.items.length);
      await page.locator('[data-catalog-sort]').selectOption('family');
      await page.locator('.dg-video-play').first().click();
      const videoDialog = page.locator('[data-catalog-video-dialog]');
      await videoDialog.waitFor({ state: 'visible' });
      assert.equal(await videoDialog.locator('iframe').count(), 1);
      const firstVideo = videos.items[catalog.items.find(x => videos.items[x.id]).id];
      assert.equal(await videoDialog.locator('iframe').getAttribute('src'), firstVideo.embedUrl);
      assert.equal(await videoDialog.locator('a').getAttribute('href'), firstVideo.url);
      assert(await videoDialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.keyboard.press('Escape');
      await videoDialog.locator('iframe').waitFor({ state: 'detached' });
      assert.equal(await page.locator('iframe').count(), 0, 'Closing must unload the player');
      await page.locator('.dg-video-play').first().click();
      await videoDialog.locator('[data-catalog-close]').click();
      await videoDialog.locator('iframe').waitFor({ state: 'detached' });
      assert.equal(await page.locator('iframe').count(), 0);
      const externalOnly = Object.entries(videos.items).find(([, v]) => !v.embedUrl);
      if (externalOnly) {
        await page.locator(`[data-catalog-video="lego-video-${externalOnly[0]}"]`).click();
        assert.equal(await videoDialog.locator('iframe').count(), 0);
        assert.equal(await videoDialog.locator('a').getAttribute('href'), externalOnly[1].url);
        assert((await videoDialog.innerText()).includes('原平台'));
        await videoDialog.locator('[data-catalog-close]').click();
      }
      await page.locator('.dg-experience [data-catalog-zoom]').first().click();
      await page.waitForFunction(() => { const i = document.querySelector('[data-catalog-full-photo]'); return i.complete && i.naturalWidth > 0; });
      await page.keyboard.press('Escape');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `Page overflow at ${width}px`);
      const dir = process.env.SITE_SMOKE_SCREENSHOT_DIR;
      if (dir) {
        fs.mkdirSync(dir, { recursive: true });
        await page.goto(origin + route, { waitUntil: 'networkidle' });
        await page.screenshot({ path: path.join(dir, `legoland-${width}-top.png`) });
        await page.locator('[data-lego-catalog]').evaluate(el => el.scrollIntoView({ block: 'start' }));
        await page.locator('.dg-catalog-table-wrap').evaluate(el => { el.scrollLeft = 240; });
        await page.screenshot({ path: path.join(dir, `legoland-${width}-catalog.png`) });
        await page.locator('.dg-video-play').first().click();
        await page.screenshot({ path: path.join(dir, `legoland-${width}-video.png`) });
        await page.keyboard.press('Escape');
        await page.evaluate(() => localStorage.setItem('theme', 'dark'));
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('body[theme="dark"]').waitFor({ state: 'attached' });
        await page.screenshot({ path: path.join(dir, `legoland-${width}-dark.png`) });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}px: ${catalog.items.length} entries, ${Object.keys(videos.items).length} video links, on-demand players and cleanup, filters, images, anchors, no overflow or browser errors`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
