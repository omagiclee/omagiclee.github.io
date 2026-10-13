#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const coordtransform = require('../local/photos/ui/coordtransform.js');
const live = process.argv.includes('--live');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.local-photos/browser-tests');
fs.mkdirSync(artifacts, { recursive: true });
const fixtureRoot = fs.mkdtempSync(path.join(artifacts, live ? 'amap-live-' : 'amap-'));
const python = path.join(root, '.local-photos/venv/bin/python');
const folder = path.join(fixtureRoot, 'Trip');
const created = spawnSync(python, ['-c', 'import sys; from pathlib import Path; sys.path.insert(0,"local/photos/tests"); from test_photos import fixture; fixture(Path(sys.argv[1]))', folder], { cwd: root, encoding: 'utf8' });
assert.equal(created.status, 0, created.stderr);
const server = spawn(python, ['local/photos/app.py', '--port', '0', '--folder', folder, '--state', path.join(fixtureRoot, 'state')], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: live ? process.env : { ...process.env, HUGO_AMAP_WEB_KEY: 'fixture-key', HUGO_AMAP_SECURITY_JSCODE: 'fixture-code' },
});
let browser;
const mockSDK = `(() => {
 window.__amapCalls = { positions: [], fit: 0, pan: 0, destroyed: 0 };
 class MapMock { constructor(id) { this.root=document.getElementById(id);this.level=13;setTimeout(()=>this.complete?.(),0); } on(event,fn){if(event==='complete')this.complete=fn;} add(items){for(const item of Array.isArray(items)?items:[items]){if(item.content)this.root.append(item.content);}} remove(items){items.forEach(item=>item.content?.remove());} setFitView(){window.__amapCalls.fit++;} setZoomAndCenter(level){this.level=level;} getZoom(){return this.level;} setZoom(level){this.level=level;} getBounds(){return {contains:()=>false};} panTo(){window.__amapCalls.pan++;} destroy(){this.root.replaceChildren();window.__amapCalls.destroyed++;} }
 class Marker { constructor(options){this.content=options.content;this.position=options.position;window.__amapCalls.positions.push(options.position);} setPosition(p){this.position=p;} show(){this.content.hidden=false;} hide(){this.content.hidden=true;} }
 class Polyline { constructor(options){this.path=options.path;} setPath(p){this.path=p;window.__amapFollowed=p;} }
 window.AMap={Map:MapMock,Marker,Polyline,Pixel:class {}};
})();`;
function readiness() { return new Promise((resolve,reject) => { let output=''; const timer=setTimeout(()=>reject(new Error('Server timeout')),20000); server.stdout.on('data',chunk=>{output+=chunk; const match=output.match(/(?:Local Photos|本地相册): (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});server.on('error',reject); }); }
async function main() {
  const base = await readiness();
  browser = await chromium.launch({ channel:'chromium',headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}) });
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const origins = new Set(), errors = [], network = [];
  page.on('pageerror',e=>errors.push(e.message));
  if (live) page.on('response', async response => {
    const url = new URL(response.url()); if (!/(amap\.com|autonavi\.com)$/.test(url.hostname)) return;
    const entry = { host: url.hostname, path: url.pathname, status: response.status(), type: response.headers()['content-type'] };
    network.push(entry);
    if (entry.type?.includes('json')) { try { const value = await response.json(); entry.info = value.info; entry.infocode = value.infocode; entry.code = value.errcode; } catch {} }
  });
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(['http:','https:'].includes(url.protocol)&&url.origin!==base){
      origins.add(url.origin);
      if(!/^https:\/\/([a-z0-9-]+\.)*(amap\.com|autonavi\.com)$/.test(url.origin))return route.abort();
      if(!live){ if(url.hostname==='webapi.amap.com'&&url.pathname==='/maps')return route.fulfill({contentType:'text/javascript',body:mockSDK});return route.abort(); }
    }
    return route.continue();
  });
  await page.goto(base+'/local-photos/',{waitUntil:'domcontentloaded'});
  await page.locator('[data-view=journeys]').click();
  await page.waitForFunction(()=>window.PhotoAmap && document.querySelectorAll('.timeline-moment').length===7);
  await page.waitForFunction(()=>!document.querySelector('#amap-canvas').hidden && document.querySelector('#route-map').hasAttribute('hidden') || document.querySelector('#map-provider-status').textContent.includes('暂时无法加载'),{},{timeout:35000});
  if(await page.locator('#amap-canvas').isHidden())throw new Error('AMap failed to initialize; offline fallback is active.');
  assert.equal(await page.locator('#map-provider').inputValue(),'amap');
  assert.equal(await page.locator('#route-map').isHidden(),true);
  await page.locator('#journey-scrubber').fill('3');
  await page.locator('#map-fit').click();
  await page.locator('#map-in').click();
  if(!live){
    const calls=await page.evaluate(()=>window.__amapCalls);
    assert(calls.fit>=2);
    assert(calls.pan>=1);
    const shifted=coordtransform.wgs84togcj02(121+28/60,31+12/60);
    assert(calls.positions.some(p=>Math.abs(p[0]-shifted[0])<1e-9&&Math.abs(p[1]-shifted[1])<1e-9));
    const known=coordtransform.wgs84togcj02(116.404,39.915);
    assert(Math.abs(known[0]-116.41024449916938)<1e-9);
    assert.deepEqual(coordtransform.wgs84togcj02(-.12,51.5),[-.12,51.5]);
    await page.locator('.amap-photo-pin').last().click();
    assert(Number(await page.locator('#journey-scrubber').inputValue())>0);
  }
  if (live) await page.waitForTimeout(3000);
  await page.screenshot({path:path.join(fixtureRoot,'amap-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#map-provider').selectOption('offline');
  await page.waitForFunction(()=>!document.querySelector('#route-map').hasAttribute('hidden')&&document.querySelector('#amap-canvas').hidden);
  assert.equal(await page.locator('#route-map .map-pin').count()>0,true);
  if(!live)assert((await page.evaluate(()=>window.__amapCalls.destroyed))>=1);
  if (live && errors.length) console.log(JSON.stringify({errors,network}));
  assert.deepEqual(errors,[]);
  console.log(`${live?'Live':'Mock'} AMap checks passed: shared loader, street map, GPS conversion, timeline, map controls, mobile layout and offline switch. Map origins: ${[...origins].join(', ')}. Artifacts: ${fixtureRoot}`);
  await context.close();
  if(!live){
    const fallback=await browser.newContext(); const page=await fallback.newPage();
    await page.route('https://webapi.amap.com/**',route=>route.abort());
    await page.goto(base+'/local-photos/',{waitUntil:'domcontentloaded'});
    await page.locator('[data-view=journeys]').click();
    await page.waitForFunction(()=>document.querySelector('#map-provider-status').textContent.includes('暂时无法加载'));
    assert.equal(await page.locator('#map-provider').inputValue(),'offline');
    assert(await page.locator('#route-map').isVisible());
    await fallback.close(); console.log('AMap unavailable: offline fallback verified.');
  }
}
main().catch(e=>{console.error(live ? e.message : e.stack);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill('SIGTERM');});
