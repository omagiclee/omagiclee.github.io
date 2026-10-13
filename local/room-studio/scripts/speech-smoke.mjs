import { chromium } from '../../../node_modules/playwright/index.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve('.data/test-command.wav')}%noloop`] });
try {
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1440, height: 1080 } });
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4178');
  await page.waitForFunction(() => document.getElementById('voiceState').textContent === '离线语音');
  await page.locator('#sampleButton').click();
  const count = (await page.evaluate(() => window.roomStudio.getState())).objects.length;
  await page.getByRole('button', { name: '开始录音', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('micButton').classList.contains('recording'));
  await page.waitForTimeout(3300); await page.getByRole('button', { name: '停止录音', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('voiceState').textContent === '离线语音', { timeout: 120000 });
  const texts = await page.locator('#messages').innerText();
  assert.match(texts, /添加/);
  const objects = (await page.evaluate(() => window.roomStudio.getState())).objects;
  assert.equal(objects.length, count + 1); assert.equal(objects.at(-1).type, 'table');
  console.log('PASS: browser recording -> FFmpeg conversion -> offline Chinese recognition -> add-table operation. Test input is synthetic speech.');
} finally { await browser.close(); }
