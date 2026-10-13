#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const buildDirectory = path.resolve(process.argv[2] || 'public');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const screenshotDirectory = process.env.SITE_SMOKE_SCREENSHOT_DIR
  ? path.resolve(process.env.SITE_SMOKE_SCREENSHOT_DIR)
  : null;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

function contentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function resolveRequest(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }

  const candidate = path.resolve(buildDirectory, `.${pathname}`);
  if (candidate !== buildDirectory && !candidate.startsWith(`${buildDirectory}${path.sep}`)) return null;

  try {
    const stat = await fsp.stat(candidate);
    if (stat.isDirectory()) return path.join(candidate, 'index.html');
    return candidate;
  } catch {
    if (!path.extname(candidate)) return path.join(candidate, 'index.html');
    return candidate;
  }
}

function startServer() {
  const server = http.createServer(async (request, response) => {
    const filePath = await resolveRequest(request.url);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': contentType(filePath),
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(filePath).pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseURL: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())),
      });
    });
  });
}

function assertDescending(dates, label) {
  const timestamps = dates.map(value => Date.parse(value));
  assert(timestamps.every(Number.isFinite), `${label} contains an invalid date`);
  for (let index = 1; index < timestamps.length; index += 1) {
    assert(timestamps[index - 1] >= timestamps[index], `${label} is not sorted newest first`);
  }
}

async function main() {
  assert(fs.existsSync(path.join(buildDirectory, 'index.html')), `No static site found at ${buildDirectory}`);
  if (screenshotDirectory) await fsp.mkdir(screenshotDirectory, { recursive: true });

  const server = await startServer();
  let browser;
  let context;
  try {
    browser = await chromium.launch({
      channel: 'chromium',
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    context = await browser.newContext();
  } catch (error) {
    if (context) await context.close();
    if (browser) await browser.close();
    await server.close();
    throw error;
  }
  const page = await context.newPage();
  const runtimeErrors = [];

  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => runtimeErrors.push(`page: ${error.message}`));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === server.baseURL || !['http:', 'https:'].includes(url.protocol)) route.continue();
    else route.fulfill({ status: 204, body: '' });
  });

  async function visit(pathname, viewport) {
    runtimeErrors.length = 0;
    if (viewport) await page.setViewportSize(viewport);
    const response = await page.goto(`${server.baseURL}${pathname}`, { waitUntil: 'networkidle' });
    assert(response && response.ok(), `${pathname} returned ${response ? response.status() : 'no response'}`);
  }

  async function assertNoRuntimeErrors(label) {
    await page.waitForTimeout(50);
    assert.deepEqual(runtimeErrors, [], `${label} emitted browser errors:\n${runtimeErrors.join('\n')}`);
  }

  async function assertNoOverflow(pathname, width) {
    await visit(pathname, { width, height: 900 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      const animations = [...document.querySelectorAll('.animate__animated')]
        .flatMap(element => element.getAnimations())
        .map(animation => animation.finished.catch(() => undefined));
      await Promise.all(animations);
    });
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll('body *')]
        .map(element => ({
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${[...element.classList].map(name => `.${name}`).join('')}`,
          left: Math.round(element.getBoundingClientRect().left),
          right: Math.round(element.getBoundingClientRect().right),
          scrollWidth: element.scrollWidth,
        }))
        .filter(item => item.left < -1 || item.right > document.documentElement.clientWidth + 1)
        .slice(0, 8),
    }));
    assert(
      dimensions.scrollWidth <= dimensions.clientWidth + 1,
      `${pathname} overflows at ${width}px (${dimensions.scrollWidth}px > ${dimensions.clientWidth}px): ${JSON.stringify(dimensions.offenders)}`,
    );
    if (screenshotDirectory && pathname === '/') {
      await page.screenshot({ path: path.join(screenshotDirectory, `home-${width}.png`), fullPage: true });
    }
    await assertNoRuntimeErrors(`${pathname} at ${width}px`);
  }

  try {
    await visit('/', { width: 1440, height: 1000 });
    const homeSections = await page.evaluate(() => Object.fromEntries(
      [...document.querySelectorAll('.posts-section')].map(section => [
        section.querySelector('.posts-section-title')?.textContent.trim(),
        [...section.querySelectorAll('.post-row')].map(row => ({
          title: row.querySelector('.post-row-title')?.textContent.trim(),
          date: row.querySelector('.post-row-date')?.getAttribute('datetime'),
        })),
      ]),
    ));
    assert.equal(homeSections['Recommended Posts']?.length, 6, 'Home must show exactly six recommended posts');
    assert.equal(homeSections['Recent Posts']?.length, 8, 'Home must show eight recent posts');
    assertDescending(homeSections['Recommended Posts'].map(post => post.date), 'Recommended posts');
    assertDescending(homeSections['Recent Posts'].map(post => post.date), 'Recent posts');
    const sectionTitles = await page.locator('.posts-section-title').allTextContents();
    assert.equal(sectionTitles[0]?.trim(), 'Recommended Posts', 'Recommended posts must be the first home section');
    assert.equal(sectionTitles[1]?.trim(), 'Recent Posts', 'Recent posts must appear before the topic series');
    const expectedTagCount = Number(await page.locator('.stat-item[href="/tags/"] .stat-number').textContent());
    assert(Number.isInteger(expectedTagCount) && expectedTagCount > 0, 'Home tag count is invalid');
    const title = page.locator('.posts-section-title').first();
    const lightTitleColor = await title.evaluate(element => getComputedStyle(element).color);
    await page.locator('#header-desktop .theme-switch').click();
    await page.locator('body[theme="dark"]').waitFor({ state: 'attached' });
    await page.waitForTimeout(500);
    const darkTitleColor = await title.evaluate(element => getComputedStyle(element).color);
    assert.notEqual(darkTitleColor, lightTitleColor, 'Homepage title color did not change in dark mode');
    await page.locator('#header-desktop .theme-switch').click();
    await page.locator('body[theme="light"]').waitFor({ state: 'attached' });
    await assertNoRuntimeErrors('home sections');
    console.log('✓ homepage ordering and dark mode');

    const responsivePages = [
      '/',
      '/tags/',
      '/categories/',
      '/tags/llms/',
      '/posts/ai-data/data-platform/kubernetes/',
    ];
    for (const width of [390, 768, 1440]) {
      for (const pathname of responsivePages) await assertNoOverflow(pathname, width);
    }
    console.log('✓ responsive overflow checks');

    await visit('/tags/', { width: 1440, height: 900 });
    const tags = page.locator('.taxonomy-tag-list .taxonomy-tag');
    assert.equal(await tags.count(), expectedTagCount, 'Rendered tag count does not match the home statistic');
    for (let index = 0; index < await tags.count(); index += 1) {
      assert(await tags.nth(index).isVisible(), `Tag ${index + 1} is hidden`);
    }
    console.log('✓ tag visibility and count');

    await visit('/', { width: 390, height: 844 });
    const menuToggle = page.locator('#menu-toggle-mobile');
    const menu = page.locator('#menu-mobile');
    await menuToggle.click();
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'true', 'Mobile menu did not expose its open state');
    assert(await menu.evaluate(element => element.classList.contains('active')), 'Mobile menu did not open');
    await menuToggle.click();
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'false', 'Mobile menu did not expose its closed state');
    assert(!(await menu.evaluate(element => element.classList.contains('active'))), 'Mobile menu did not close');
    await menuToggle.click();
    await page.locator('#search-input-mobile').click();
    await page.locator('#search-cancel-mobile').click();
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'false', 'Search cancel did not reset mobile menu state');
    assert(!(await menu.evaluate(element => element.classList.contains('active'))), 'Search cancel left the mobile menu open');
    assert(!(await page.locator('body').evaluate(element => element.classList.contains('blur'))), 'Search cancel left the page blurred');
    await assertNoRuntimeErrors('mobile menu');
    console.log('✓ mobile menu state');

    const mermaidPages = [
      '/posts/aigc/comfyui/architecture/',
      '/posts/agent-ai/openclaw/concept/',
      '/posts/ai-data/data-platform/release-environments/',
      '/posts/ai-data/data-platform/requirements-management/',
      '/posts/ai-data/data-platform/technology-stack/',
      '/posts/ai-data/data-platform/ci-cd/',
      '/posts/ai-data/data-platform/kubernetes/',
      '/posts/toolkits/llm-inference-engines/vscode-with-continue-extension/',
      '/posts/toolkits/pytorch/ddp/',
      '/posts/ai-data/data-platform/operator-as-plugin/',
    ];
    for (const pathname of mermaidPages) {
      await visit(pathname, { width: 1440, height: 900 });
      const diagrams = page.locator('.mermaid');
      assert(await diagrams.count() > 0, `${pathname} has no Mermaid container`);
      await page.waitForFunction(() => {
        const diagrams = [...document.querySelectorAll('.mermaid')];
        return diagrams.length && diagrams.every(element => element.querySelector('svg'));
      }, null, { timeout: 30_000 });
      assert.equal(await diagrams.locator('svg').count(), await diagrams.count(), `${pathname} has an unrendered Mermaid diagram`);
      await assertNoRuntimeErrors(`Mermaid page ${pathname}`);
    }
    await visit('/posts/aigc/comfyui/architecture/', { width: 1440, height: 900 });
    await page.waitForFunction(() => document.querySelectorAll('.mermaid svg').length === 3);
    for (let index = 0; index < 2; index += 1) {
      const revision = await page.locator('.mermaid').first().getAttribute('data-render-revision');
      await page.locator('#header-desktop .theme-switch').click();
      await page.waitForFunction(previous => [...document.querySelectorAll('.mermaid')].every(
        element => Number(element.dataset.renderRevision) > Number(previous) && element.querySelector('svg')
      ), revision, { timeout: 30_000 });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Mermaid diagrams overflow the mobile page');
    assert(await page.locator('.mermaid').nth(1).evaluate(element => element.scrollWidth > element.clientWidth),
      'The sequence diagram should scroll horizontally on mobile');
    await assertNoRuntimeErrors('Mermaid theme switching and mobile layout');
    console.log('✓ Mermaid diagrams, theme switching and mobile layout');

    await visit('/posts/generative-models/diffusion/basics/ddpm/', { width: 1440, height: 900 });
    await page.locator('.ps-root').first().waitFor({ state: 'attached', timeout: 10_000 });
    const pseudocodeSources = page.locator('pre.pseudocode');
    for (let index = 0; index < await pseudocodeSources.count(); index += 1) {
      assert(!(await pseudocodeSources.nth(index).isVisible()), 'A pseudocode source block remains visible');
    }
    assert(!runtimeErrors.some(error => error.includes('t &gt; 1')), 'Pseudocode emitted the escaped t > 1 KaTeX error');
    await assertNoRuntimeErrors('pseudocode page');
    console.log('✓ pseudocode rendering');

    await visit('/', { width: 1440, height: 900 });
    assert.equal(
      await page.locator('script[src*="autocomplete"], script[src*="lunr"], script[src*="katex"], link[href*="katex"]').count(),
      0,
      'Search and math libraries should be absent from the initial home page',
    );
    await page.locator('#search-toggle-desktop').click();
    for (const query of ['transformer', 'Kubernetes', '自动驾驶', '数据', '保险']) {
      const input = page.locator('#search-input-desktop');
      await input.fill('');
      await page.locator('#search-dropdown-desktop .suggestion-title').first().waitFor({ state: 'hidden' });
      await input.fill(query);
      const suggestions = page.locator('#search-dropdown-desktop .suggestion-title');
      try {
        await suggestions.first().waitFor({ state: 'visible', timeout: 15_000 });
      } catch (error) {
        const diagnostic = await page.locator('#search-dropdown-desktop').innerHTML();
        const state = await page.evaluate(() => ({
          autocomplete: typeof window.autocomplete,
          input: document.querySelector('#search-input-desktop')?.value,
          lunr: typeof window.lunr,
          scripts: [...document.querySelectorAll('script[id^="search-"]')].map(script => ({ id: script.id, loaded: script.dataset.loaded, src: script.src })),
        }));
        throw new Error(`Search did not render suggestions for ${query}. Errors: ${runtimeErrors.join(' | ')}. State: ${JSON.stringify(state)}. Dropdown: ${diagnostic}`, { cause: error });
      }
      assert(await suggestions.count() > 0, `Search returned no results for ${query}`);
    }
    assert(await page.locator('script[src*="autocomplete"], script[src*="lunr"]').count() >= 2, 'Search libraries did not load on demand');
    await assertNoRuntimeErrors('English and Chinese search');
    console.log('✓ lazy English and Chinese search');

    console.log('Site browser smoke tests passed.');
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
