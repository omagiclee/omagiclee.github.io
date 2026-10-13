// A clearly synthetic fixture checks the real video -> native model pipeline.
// It is never presented as a reconstruction of a user's room.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const root = '/private/tmp/room-studio-reconstruction-test';
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
let frames;
try {
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:4178');
  frames = await page.evaluate(async () => {
    const T = await import('three');
    const scene = new T.Scene(); scene.background = new T.Color('#d8d9d5');
    scene.add(new T.HemisphereLight('#ffffff', '#777777', 2));
    const light = new T.DirectionalLight('#ffffff', 2); light.position.set(3, 6, 4); scene.add(light);
    const materials = [];
    for (let face = 0; face < 6; face++) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512; const ctx = canvas.getContext('2d');
      ctx.fillStyle = ['#a55d47', '#588286', '#8c9770', '#917299', '#b39854', '#658aa1'][face]; ctx.fillRect(0, 0, 512, 512);
      let seed = 193 + face * 87;
      for (let i = 0; i < 180; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; const x = seed % 512; seed = (seed * 1664525 + 1013904223) >>> 0; const y = seed % 512; ctx.fillStyle = i % 2 ? '#eeeecc' : '#222f37'; ctx.fillRect(x, y, 8 + i % 17, 8 + i % 11); }
      ctx.fillStyle = '#fff8da'; ctx.font = 'bold 180px sans-serif'; ctx.fillText(String(face + 1), 190, 320);
      const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; materials.push(new T.MeshStandardMaterial({ map: texture, roughness: 1 }));
    }
    const box = new T.Mesh(new T.BoxGeometry(1.3, 1.1, 1), materials); scene.add(box);
    const marker = new T.Mesh(new T.SphereGeometry(.16, 20, 20), new T.MeshStandardMaterial({ color: '#293f4b' })); marker.position.set(.35, .7, .2); scene.add(marker);
    const camera = new T.PerspectiveCamera(45, 1, .1, 20); const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(720, 720); renderer.outputColorSpace = T.SRGBColorSpace;
    const images = [];
    for (let i = 0; i < 60; i++) { const angle = i * Math.PI * 2 / 30; const height = i < 30 ? .6 : 1.5; camera.position.set(Math.sin(angle) * 2.7, height, Math.cos(angle) * 2.7); camera.lookAt(0, .08, 0); renderer.render(scene, camera); images.push(renderer.domElement.toDataURL('image/jpeg', .96).split(',')[1]); }
    renderer.dispose(); return images;
  });
} finally { await browser.close(); }
for (let i = 0; i < frames.length; i++) await writeFile(`${root}/frame-${String(i + 1).padStart(4, '0')}.jpg`, Buffer.from(frames[i], 'base64'));
const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '3', '-i', `${root}/frame-%04d.jpg`, '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', `${root}/fixture.mp4`], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr);
const response = await fetch('http://127.0.0.1:4178/api/reconstructions?engine=native&name=%5BTEST%5D%20Synthetic%20object%20-%20not%20a%20room', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await readFile(`${root}/fixture.mp4`) });
const initial = await response.json(); if (!response.ok) throw new Error(JSON.stringify(initial));
await writeFile(`${root}/job-id.txt`, initial.id); console.log(`Synthetic fixture job: ${initial.id}`);
let lastStage = '';
for (let i = 0; i < 300; i++) {
  const job = await (await fetch(`http://127.0.0.1:4178/api/reconstructions/${initial.id}`)).json();
  if (job.stage !== lastStage || i % 6 === 0) { console.log(`${job.stage}: ${Math.round(job.progress * 100)}%`); lastStage = job.stage; }
  if (job.stage === 'error') throw new Error(job.error);
  if (job.stage === 'ready') {
    const obj = await (await fetch(`http://127.0.0.1:4178${job.model.obj}`)).text(); const vertices = (obj.match(/^v /gm) || []).length;
    if (vertices < 100) throw new Error('Native output has too few vertices');
    if (!job.model.mtl) throw new Error('Native output is missing materials');
    await writeFile('test-results/reconstruction.json', JSON.stringify({ fixture: 'synthetic textured object, not a real room', engine: 'Apple Photogrammetry', frames: job.frameCount, vertices, job }, null, 2));
    console.log(`PASS: actual native reconstruction generated ${vertices} vertices and textured materials.`); break;
  }
  if (i === 299) throw new Error('Reconstruction test exceeded 25 minutes');
  await new Promise(resolve => setTimeout(resolve, 5000));
}
