#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const live = process.argv.includes('--live');
const root = path.resolve(__dirname, '..'), python = path.join(root, '.local-photos/venv/bin/python');
const artifacts = path.join(root, '.local-photos/browser-tests'); fs.mkdirSync(artifacts, { recursive: true });
const fixtureRoot = fs.mkdtempSync(path.join(artifacts, live ? 'footprints-live-' : 'footprints-'));
const folder = path.join(fixtureRoot, 'Trip'), state = path.join(fixtureRoot, 'state');
const setup = spawnSync(python, ['-c', 'import sys; from pathlib import Path; sys.path.insert(0,"local/photos/tests"); from test_photos import city_fixture; city_fixture(Path(sys.argv[1]),Path(sys.argv[2]))', folder, state], { cwd: root, encoding: 'utf8' });
assert.equal(setup.status, 0, setup.stderr);
const server = spawn(python, ['local/photos/app.py', '--no-scan', '--port', '0', '--folder', folder, '--state', state], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: live ? process.env : { ...process.env, HUGO_AMAP_WEB_KEY: 'fixture-key', HUGO_AMAP_SECURITY_JSCODE: 'fixture-code' } });
let browser;
const mockSDK = `(()=>{
 window.__footprints={polygons:[],calls:[],fit:0,markers:0};
 class MapMock{constructor(id){this.root=document.getElementById(id);this.level=8;setTimeout(()=>this.complete?.(),0);}on(e,f){if(e==='complete')this.complete=f;}add(items){for(const v of Array.isArray(items)?items:[items])if(v.content)this.root.append(v.content);}remove(items){items.forEach(v=>v.content?.remove());}setFitView(){window.__footprints.fit++;}getZoom(){return this.level;}setZoomAndCenter(v){this.level=v;}destroy(){this.root.replaceChildren();}}
 class Marker{constructor(o){this.content=o.content;window.__footprints.markers++;}}
 class Polygon{constructor(o){this.options=o;window.__footprints.polygons.push(this);}on(e,f){if(e==='click')this.click=f;}setOptions(o){Object.assign(this.options,o);}}
 class DistrictSearch{search(name,fn){window.__footprints.calls.push(name);setTimeout(()=>fn('complete',{districtList:[{name,boundaries:[[[120,30],[121,30],[121,31],[120,31],[120,30]]]}]}),10);}}
 window.AMap={Map:MapMock,Marker,Polygon,DistrictSearch,Pixel:class{}};
})();`;
function ready() { return new Promise((resolve, reject) => { let output = ''; const timer = setTimeout(() => reject(new Error('Server timeout')), 20000); server.stdout.on('data', data => { output += data; const match = output.match(/(?:Local Photos|本地相册): (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } }); server.once('error', reject); }); }
async function main() {
  const base = await ready(); browser = await chromium.launch({ channel: 'chromium', headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1050 } }), page = await context.newPage();
  const errors = [], remote = new Set(); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      remote.add(url.origin);
      if (!/^https:\/\/([a-z0-9-]+\.)*(amap\.com|autonavi\.com)$/.test(url.origin)) return route.abort();
      if (!live) { if (url.hostname === 'webapi.amap.com' && url.pathname === '/maps') return route.fulfill({ contentType: 'text/javascript', body: mockSDK }); return route.abort(); }
    }
    route.continue();
  });
  await page.goto(base + '/local-photos/#footprints', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#footprint-city-count').textContent === '2');
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  assert.equal(await page.locator('#view-title').textContent(), '足迹');
  await page.waitForFunction(() => document.querySelector('#footprint-map-status').textContent.includes('已点亮 2 处行政区域'), {}, { timeout: 35000 });
  await page.waitForTimeout(100);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#footprint-map-status').textContent.includes('已复用 2 处本地缓存'), {}, { timeout: 35000 });
  if (!live) assert.equal(await page.evaluate(() => window.__footprints.calls.length), 0, 'Refreshing must reuse persistent boundaries');
  assert.equal(await page.locator('#footprint-amap .footprint-map-pin').count(), 0);
  assert.equal(await page.locator('#footprint-amap .amap-marker').count(), 0);
  if (!live) assert.equal(await page.evaluate(() => window.__footprints.markers), 0);
  await page.locator('.footprint-city').filter({ hasText: '上海市' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#footprint-photo-grid .photo-card').length === 3);
  assert.equal(await page.locator('#footprint-city-title').textContent(), '上海市');
  if (!live) assert.equal(await page.evaluate(() => window.__footprints.polygons.some(p => p.options.fillColor === '#d99b62')), true);
  if (live) await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(fixtureRoot, 'footprints-desktop.png'), fullPage: true });
  await page.locator('#footprint-search').fill('杭州');
  await page.waitForFunction(() => document.querySelectorAll('.footprint-city').length === 1);
  await page.locator('.footprint-city').click();
  await page.waitForFunction(() => document.querySelectorAll('#footprint-photo-grid .photo-card').length === 4);
  await page.locator('#footprint-search').fill('');
  await page.waitForFunction(() => document.querySelectorAll('.footprint-city').length === 2);
  await page.locator('.footprint-city').filter({ hasText: '上海市' }).click();
  await page.locator('#footprint-make-album').click();
  assert.equal(await page.locator('#journey-city-scope').isVisible(), true);
  await page.locator('#journey-form button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('#journey-title').textContent === '上海市的回忆');
  assert.equal(await page.locator('.timeline-moment').count(), 3);
  await page.locator('[data-view=footprints]').click();
  await page.waitForFunction(() => document.querySelector('#footprint-workbench').hidden === false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(fixtureRoot, 'footprints-mobile.png'), fullPage: true });
  await page.locator('#footprint-provider').selectOption('offline');
  await page.waitForFunction(() => document.querySelectorAll('.footprint-offline-city').length === 2);
  assert.equal(await page.locator('#footprint-offline circle').count(), 0);
  assert((await page.locator('#footprint-offline .footprint-offline-city path').count()) >= 2, 'Multipart city boundaries must remain filled');
  assert.equal(await page.locator('#footprint-amap').isHidden(), true);
  assert.deepEqual(errors, []);
  if (!live) assert.deepEqual([...remote], ['https://webapi.amap.com']);
  console.log(`${live ? 'Live' : 'Mock'} city-footprint checks passed: Chinese UI, city aggregation, administrative-area lighting, city photos, search, scoped travel albums, mobile and offline fallback. Artifacts: ${fixtureRoot}`);
  await context.close();
}
main().catch(error => { console.error(live ? error.message : error.stack); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.kill('SIGTERM'); });
