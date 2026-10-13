import { chromium } from '../../../node_modules/playwright/index.mjs';
import { readFile, writeFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:4178';
const job = JSON.parse(await readFile('test-results/gsplat-fixture.json'));
let backup; try { backup = await readFile('.data/design.json'); } catch {}
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } }); const page = await context.newPage();
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.message); }); page.on('requestfailed', r => { errors.push(r.url()); console.error(r.url()); });
  await page.goto(base); await page.waitForFunction(() => window.roomStudio);
  await page.waitForFunction(() => document.getElementById('voiceState').textContent === '离线语音');
  if (!backup) { assert.equal((await page.evaluate(() => window.roomStudio.getState())).source, 'empty'); assert.ok(await page.locator('#realRoomEmpty').isVisible()); }
  await page.screenshot({ path: 'test-results/real-space-entry.png', fullPage: true });
  const template = await page.evaluate(() => window.roomStudio.getState());
  const design = { ...template, source: 'video', reconstructionId: job.id, objects: [] };
  await context.request.put(`${base}/api/design`, { data: design }); await page.reload();
  await page.waitForFunction(() => document.getElementById('scanTab').disabled === false, null, { timeout: 30000 });
  assert.match(await page.locator('#sourceLabel').textContent(), /3DGS/);
  await page.getByRole('button', { name: '视频拍摄视角' }).click();
  await page.locator('#pickDistance').click();
  const area = await page.locator('#viewport').boundingBox();
  await page.mouse.click(area.x + area.width * .47, area.y + area.height * .5);
  await page.mouse.click(area.x + area.width * .53, area.y + area.height * .5);
  await page.waitForFunction(() => window.roomStudio.getState().scaleVerified === true, null, { timeout: 10000 });
  // A self-contained, synthetic GLB with a textured material verifies imports.
  const bytes = await page.evaluate(async () => {
    const THREE = await import('three'); const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#549887'; ctx.fillRect(0, 0, 64, 64); ctx.fillStyle = '#d9c697'; ctx.fillRect(0, 0, 32, 32); ctx.fillRect(32, 32, 32, 32);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.8, .9, .6), new THREE.MeshStandardMaterial({ map: texture, roughness: .45 })); mesh.position.y = .45;
    const root = new THREE.Group(); root.add(mesh); const buffer = await new GLTFExporter().parseAsync(root, { binary: true }); return Array.from(new Uint8Array(buffer));
  });
  const file = Buffer.from(bytes); await writeFile('test-results/product-fixture.glb', file);
  await page.locator('#productInput').setInputFiles({ name: '[TEST] textured object.glb', mimeType: 'model/gltf-binary', buffer: file });
  await page.waitForFunction(() => window.roomStudio.getState().objects.some(o => o.type === 'product'));
  let state = await page.evaluate(() => window.roomStudio.getState()); assert.ok(Math.abs(state.objects[0].assetDimensions.width - .8) < .0001);
  await page.locator('#productWidth').fill('1.6'); await page.locator('#productWidth').blur();
  state = await page.evaluate(() => window.roomStudio.getState()); assert.equal(state.objects[0].realWidth, 1.6); assert.equal(state.objects[0].dimensionVerified, true);
  await page.locator('#objectY').fill('0.3'); await page.locator('#objectY').blur();
  await page.locator('#objectX').fill('1'); await page.locator('#objectX').blur();
  await page.getByLabel('设计指令').fill('向左移动半米'); await page.getByRole('button', { name: '执行指令' }).click();
  assert.equal((await page.evaluate(() => window.roomStudio.getState())).objects[0].x, .5);
  await page.locator('#lightAngle').evaluate(element => { element.value = '200'; element.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#lightIntensity').evaluate(element => { element.value = '1.3'; element.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#saveButton').click(); await page.waitForFunction(() => document.getElementById('savedLabel').textContent === '已保存在本机');
  await page.reload(); await page.waitForFunction(() => document.getElementById('scanTab').disabled === false, null, { timeout: 30000 });
  state = await page.evaluate(() => window.roomStudio.getState()); assert.equal(state.objects[0].realWidth, 1.6); assert.equal(state.objects[0].y, .3);
  assert.equal(state.lighting.angle, 200); assert.equal(state.lighting.intensity, 1.3);
  await page.waitForTimeout(500); await page.screenshot({ path: 'test-results/gsplat-product-test.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: actual trained 3DGS loads; embedded GLB texture imports; physical width, height offset, commands, saving and reopening retain the real asset. Test source is synthetic.');
} finally {
  await browser.close(); if (backup) await writeFile('.data/design.json', backup); else await rm('.data/design.json', { force: true });
}
