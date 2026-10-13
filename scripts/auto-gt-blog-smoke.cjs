const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const root = path.resolve(process.argv[2] || 'public');
  const evidence = path.resolve(process.argv[3] || '/tmp/auto-gt-blog-evidence');
  await fsp.mkdir(evidence, { recursive: true });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp' };
  const server = http.createServer(async (request, response) => {
    let target;
    try { target = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)); }
    catch { response.writeHead(400); response.end(); return; }
    if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!fs.existsSync(target)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(target).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base || !['http:', 'https:'].includes(url.protocol)) route.continue();
    else route.fulfill({ status: 204, body: '' });
  });
  const page = await context.newPage(), errors = [], report = { checks: [] };
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const response = await page.goto(base + '/posts/data-flywheel/image-quality-auto-gt/', { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      assert.match(await page.locator('h1').first().innerText(), /影像画质 Auto GT/);
      await page.waitForFunction(() => document.querySelectorAll('.mermaid svg').length >= 2, { timeout: 20_000 });
      assert.equal(await page.locator('article .mermaid svg').count(), 2);
      assert.ok(await page.locator('article table').count() >= 2);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= width, `Article overflows at ${width}`);
      const references = await page.locator('article a[href^="https://"]').count();
      assert.ok(references >= 20, 'Research sources are not rendered');
      const images = page.locator('article img');
      for (let index = 0; index < await images.count(); index++) {
        await images.nth(index).scrollIntoViewIfNeeded();
        assert.ok(await images.nth(index).evaluate((image) => image.complete && image.naturalWidth > 0), 'Article image failed');
      }
      await page.screenshot({ path: path.join(evidence, `article-${width}.png`), fullPage: true });
      report.checks.push({ width, diagrams: 2, tables: await page.locator('article table').count(), references, images: await images.count() });
    }
    assert.deepEqual(errors, []);
    report.status = 'passed';
    console.log(JSON.stringify(report));
  } finally {
    report.page_errors = errors;
    await fsp.writeFile(path.join(evidence, 'article-check.json'), JSON.stringify(report, null, 2));
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
