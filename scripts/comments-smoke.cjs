#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const directory = path.resolve(process.argv[2] || '/tmp/blog-artalk-preview');
const articlePath = '/posts/llm/bbpe/';
const screenshots = path.resolve(process.env.COMMENTS_SCREENSHOT_DIR || '/tmp/blog-artalk-screenshots');
const localEndpoint = 'http://127.0.0.1:23366';
const html = fs.readFileSync(path.join(directory, articlePath, 'index.html'), 'utf8');
assert(html.includes(`data-server="${localEndpoint}"`), 'Tests must use the local Artalk endpoint.');
assert(html.includes('Blog (Local)'), 'Tests must use an isolated local site.');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const server = http.createServer((request, response) => {
  let file;
  try { file = path.resolve(directory, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)); }
  catch { response.writeHead(400); response.end(); return; }
  if (file !== directory && !file.startsWith(directory + path.sep)) { response.writeHead(403); response.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});

(async () => {
  await fsp.mkdir(screenshots, { recursive: true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(1314, '127.0.0.1', resolve); });
  const browser = await chromium.launch({ headless: true, channel: 'chromium', ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().startsWith(localEndpoint)) apiRequests.push(request.url()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || !['http:', 'https:'].includes(url.protocol)) route.continue();
    else route.fulfill({ status: 204, body: '' });
  });
  const articleURL = `http://127.0.0.1:1314${articlePath}`;
  const selectPassage = async () => {
    await page.evaluate(() => [...document.querySelectorAll('#content > p')].find(p => p.textContent.length > 35).scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(200);
    const text = await page.evaluate(() => {
      const paragraph = [...document.querySelectorAll('#content > p')].find(p => p.textContent.length > 35);
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      const range = document.createRange();
      range.setStart(node, 0); range.setEnd(node, Math.min(node.textContent.length, 45));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      return selection.toString().trim();
    });
    await page.locator('#selection-discussion').waitFor({ state: 'visible' });
    return text;
  };
  try {
    await page.goto(articleURL, { waitUntil: 'networkidle' });
    assert.equal(apiRequests.length, 0, 'Artalk must not request the backend before the discussion is needed.');
    const passage = await selectPassage();
    await page.locator('[data-quote-reply]').click();
    await page.locator('#discussion-panel[open] #artalk-comments .atk-main-editor textarea').waitFor();
    const editor = page.locator('#artalk-comments .atk-main-editor textarea');
    assert.equal(await page.locator('.discussion-quote-preview blockquote').innerText(), passage);
    assert.equal(await editor.inputValue(), '', 'Quote metadata must stay out of the composer.');
    const suffix = `[Local browser check ${Date.now()}]`;
    await editor.fill(suffix);
    await page.locator('#artalk-comments input[name="name"]').fill('Local preview check');
    await page.locator('#artalk-comments input[name="email"]').fill('preview@example.invalid');
    await page.locator('#artalk-comments .atk-send-btn').click();
    await page.locator('#artalk-comments .atk-comment').filter({ hasText: suffix }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshots, 'desktop-quote.png') });
    await page.locator('.discussion-close').click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#comments').scrollIntoViewIfNeeded();
    const comment = page.locator('#artalk-comments .atk-comment').filter({ hasText: suffix });
    await comment.waitFor();
    assert((await comment.innerText()).includes(passage), 'Quote must persist after a reload.');
    const contextLink = await comment.getByRole('link', { name: 'View context' }).getAttribute('href');
    await comment.getByText('Reply', { exact: true }).first().click();
    const replyText = `Reply to ${suffix}`;
    await editor.fill(replyText);
    await page.locator('#artalk-comments .atk-send-btn').click();
    await page.locator('#artalk-comments .atk-content').filter({ hasText: replyText }).waitFor({ timeout: 15000 });
    await comment.getByRole('link', { name: 'View context' }).click();
    await page.waitForFunction(() => !!document.querySelector('.discussion-context-target'));
    assert(new URL(page.url()).hash.startsWith('#quote='));

    await page.locator('.theme-switch:visible').first().click();
    await page.waitForFunction(() => document.body.getAttribute('theme') === 'dark' && document.querySelector('#artalk-comments').classList.contains('atk-dark-mode'));
    await page.locator('.discussion-open').click();
    await editor.fill('Draft survives moving the editor.');
    await page.keyboard.press('Escape');
    assert.equal(await editor.inputValue(), 'Draft survives moving the editor.');
    await page.locator('.discussion-open').click();
    assert.equal(await editor.inputValue(), 'Draft survives moving the editor.');
    await page.screenshot({ path: path.join(screenshots, 'desktop-dark.png') });
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(350);
    await page.locator('#menu-toggle-mobile').click();
    await page.locator('.theme-switch:visible').first().click();
    if (await page.locator('#menu-toggle-mobile').getAttribute('aria-expanded') === 'true') await page.locator('#menu-toggle-mobile').click();
    await selectPassage();
    await page.locator('[data-quote-reply]').click();
    await page.locator('#discussion-panel[open]').waitFor();
    assert(await page.locator('.discussion-close').evaluate(button => button.getBoundingClientRect().right <= innerWidth), 'Close control is clipped.');
    assert((await editor.inputValue()).includes('Draft survives moving the editor.'), 'Selecting a quote must preserve an existing draft.');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflows.');
    assert(await page.evaluate(() => { const panel = document.querySelector('#discussion-panel').getBoundingClientRect(); return panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight + 1; }), 'Mobile panel is clipped.');
    await page.screenshot({ path: path.join(screenshots, 'mobile-quote.png') });
    await page.keyboard.press('Escape');
    await page.goto('about:blank');
    await page.goto(articleURL + contextLink.slice(contextLink.indexOf('#')), { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!document.querySelector('.discussion-context-target'));
    await page.goto(articleURL + '#quote=%7Binvalid', { waitUntil: 'networkidle' });
    assert.deepEqual(errors, [], 'Comment interactions emitted runtime errors.');
    console.log(JSON.stringify({ passed: ['lazy loading', 'real local posting and replies', 'quote persistence', 'context links', 'theme sync', 'draft preservation', 'mobile panel', 'malformed context link'], screenshots }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(screenshots, 'failure.png') });
    console.error('Browser errors:', errors);
    throw error;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
