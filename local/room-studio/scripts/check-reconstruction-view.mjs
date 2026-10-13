import { chromium } from '../../../node_modules/playwright/index.mjs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const report = JSON.parse(await readFile('test-results/reconstruction.json'));
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => errors.push(r.url()));
  await page.goto('http://127.0.0.1:4178');
  await page.getByRole('button', { name: /Synthetic object/ }).click();
  await page.waitForFunction(id => window.roomStudio.getState().reconstructionId === id, report.job.id);
  assert.equal(await page.locator('#sourceLabel').textContent(), '视频重建 · 比例需校准');
  assert.equal((await page.evaluate(() => window.roomStudio.getState())).objects.length, 0);
  await page.getByRole('button', { name: '添加椅子', exact: true }).click();
  assert.equal((await page.evaluate(() => window.roomStudio.getState())).objects.length, 1);
  await page.locator('#scanWidth').fill('2.5'); await page.locator('#scanWidth').blur();
  assert.equal((await page.evaluate(() => window.roomStudio.getState())).scanWidth, 2.5);
  await page.getByRole('button', { name: '扫描绕 X 轴旋转 90°' }).click();
  assert.equal((await page.evaluate(() => window.roomStudio.getState())).scanRotation, 90);
  await page.getByRole('button', { name: '探索示例空间' }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('scanTab').disabled === false);
  await page.locator('#scanTab').click(); await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/synthetic-reconstruction.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: actual OBJ, MTL and textures load; scan calibration, furniture overlay and undo restore work. Fixture is synthetic, not a real room.');
} finally { await browser.close(); }
