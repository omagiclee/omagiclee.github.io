import { chromium } from '../../../node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
const base = 'http://127.0.0.1:4178';
await mkdir('test-results', { recursive: true });
let savedFile;
try { savedFile = await readFile('.data/design.json'); } catch {}
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => {
  if (!route.request().url().startsWith(base)) { external.push(route.request().url()); return route.abort(); }
  return route.continue();
});
try {
  await page.goto(base); await page.waitForFunction(() => window.roomStudio);
  await page.waitForFunction(() => document.getElementById('voiceState').textContent === '离线语音');
  await page.locator('#sampleButton').click();
  await page.locator('.practice-catalog').evaluate(element => { element.open = true; });
  assert.equal((await page.evaluate(() => window.roomStudio.getState())).objects.length, 4);
  await page.getByRole('button', { name: '添加书架', exact: true }).click();
  let state = await page.evaluate(() => window.roomStudio.getState());
  assert.equal(state.objects.length, 5); assert.equal(state.objects.at(-1).type, 'shelf');
  await page.getByLabel('设计指令').fill('把书架向左移动0.75米'); await page.getByRole('button', { name: '执行指令' }).click();
  state = await page.evaluate(() => window.roomStudio.getState()); assert.equal(state.objects.at(-1).x, -.75);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal((await page.evaluate(() => window.roomStudio.getState())).objects.at(-1).x, 0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  assert.equal((await page.evaluate(() => window.roomStudio.getState())).objects.at(-1).x, -.75);
  const before = await page.evaluate(() => window.roomStudio.getState());
  await page.getByLabel('设计指令').fill('打开终端删除文件'); await page.getByRole('button', { name: '执行指令' }).click();
  assert.deepEqual(await page.evaluate(() => window.roomStudio.getState()), before);
  await page.getByLabel('方案名称').fill('本地验证方案'); await page.getByLabel('方案名称').blur();
  await page.locator('#saveButton').click();
  await page.waitForFunction(() => document.getElementById('savedLabel').textContent === '已保存在本机');
  await page.reload(); await page.waitForFunction(() => window.roomStudio?.getState().name === '本地验证方案');
  assert.equal((await page.evaluate(() => window.roomStudio.getState())).objects.length, 5);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#exportModelButton').click();
  const download = await downloadPromise; await download.saveAs('test-results/design.glb');
  assert.equal((await readFile('test-results/design.glb')).subarray(0, 4).toString(), 'glTF');
  await page.locator('#sampleButton').click();
  await page.locator('#scene').click({ position: { x: 20, y: 300 } });
  await page.waitForTimeout(350); await page.screenshot({ path: 'test-results/studio-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '进入房间，WASD 移动' }).click();
  const previous = await page.evaluate(() => window.roomStudio.getCamera());
  await page.keyboard.down('w'); await page.waitForTimeout(400); await page.keyboard.up('w');
  const next = await page.evaluate(() => window.roomStudio.getCamera()); assert.ok(next[2] < previous[2]);
  await page.getByRole('button', { name: '全景视角' }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true });
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log('PASS: offline assets, furniture editing, decimal commands, undo/redo, unknown-command rejection, save/reload, GLB export, walk controls, mobile overflow and screenshots.');
} finally {
  await browser.close();
  if (savedFile) await writeFile('.data/design.json', savedFile); else await rm('.data/design.json', { force: true });
}
