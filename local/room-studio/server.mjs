import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { validateDesign } from './public/commands.js';
import { validateGLB } from './glb.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, '.data');
const RECON = path.join(ROOT, '.bin/reconstruct');
const MODEL = path.join(ROOT, '.models/ggml-base.bin');
const SMALL_MODEL = path.join(ROOT, '.models/ggml-small-q5_1.bin');
const SFM_PYTHON = path.join(ROOT, '.venv/bin/python');
const BRUSH = path.join(ROOT, '.bin/brush/brush-app-aarch64-apple-darwin/brush_app');
const jobs = new Map();
const idPattern = /^[a-f\d-]{36}$/;
let activeJob = null;
let speechBusy = false;
const exists = p => fs.access(p).then(() => true, () => false);
function run(command, args, { timeout = 60000, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT });
    let output = '', error = '', buffer = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', data => {
      output = (output + data).slice(-64000);
      if (onLine) {
        buffer += data;
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) onLine(line);
      }
    });
    child.stderr.on('data', data => { error = (error + data).slice(-12000); });
    child.on('error', reason => { clearTimeout(timer); reject(reason); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error((error || output || `${command} exited with ${code}`).slice(-2000)));
    });
  });
}
async function writeJSON(file, value) {
  const temp = file + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2));
  await fs.rename(temp, file);
}
async function persist(job) {
  await writeJSON(path.join(DATA, job.id, 'job.json'), job);
}
async function filesBelow(directory, prefix = '') {
  const result = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    if (item.isDirectory()) result.push(...await filesBelow(path.join(directory, item.name), relative));
    else if (item.isFile()) result.push(relative);
  }
  return result;
}
async function reconstruct(job) {
  const base = path.join(DATA, job.id);
  try {
    job.stage = 'extracting'; job.progress = .03; await persist(job);
    const info = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path.join(base, 'input') ]));
    const duration = Number(info.format?.duration);
    if (!info.streams?.some(s => s.codec_type === 'video') || !Number.isFinite(duration)) throw new Error('文件中没有可读取的视频轨道。');
    if (duration < 10 || duration > 180) throw new Error('第一版接受 10 秒到 3 分钟的视频。建议用 45–90 秒缓慢走动拍摄一个房间。');
    const frames = path.join(base, 'frames'); await fs.mkdir(frames);
    const fps = Math.min(3, 120 / duration);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.join(base, 'input'), '-vf', `fps=${fps},scale=1600:1600:force_original_aspect_ratio=decrease`, '-q:v', '2', '-frames:v', '140', path.join(frames, 'frame-%04d.jpg')], { timeout: 180000 });
    const images = (await fs.readdir(frames)).filter(f => f.endsWith('.jpg')).sort();
    if (images.length < 25) throw new Error('提取的有效图像不足 25 张，请重新拍摄更长的视频。');
    job.frameCount = images.length;
    job.previews = images.filter((_, i) => i % Math.max(1, Math.floor(images.length / 8)) === 0).slice(0, 8).map(f => `/data/${job.id}/frames/${f}`);
    job.stage = 'reconstructing'; job.progress = .15; await persist(job);
    const artifacts = path.join(base, 'artifacts');
    if (job.engine === 'gsplat') {
      const colmap = path.join(base, 'colmap');
      await run(SFM_PYTHON, [path.join(ROOT, 'native/prepare_sfm.py'), frames, colmap], { timeout: 1800000, onLine(line) {
        try { const event = JSON.parse(line); if (event.stage) job.stage = event.stage; if (event.progress) job.progress = event.progress; if (event.error) job.detail = event.error; } catch {}
      } });
      job.camera = JSON.parse(await fs.readFile(path.join(colmap, 'metadata.json')));
      job.stage = 'training'; job.progress = .5; await persist(job);
      await fs.mkdir(artifacts);
      const steps = job.quality === 'standard' ? 8000 : 2000;
      await run(BRUSH, [path.join(colmap, 'dataset'), '--total-steps', String(steps), '--max-splats', '400000', '--max-resolution', '1000', '--export-every', String(steps), '--export-path', artifacts, '--export-name', 'room.ply', '--eval-split-every', '8', '--eval-every', String(steps), '--eval-save-to-disk'], { timeout: 3600000, onLine(line) {
        const match = line.match(/(?:Step|Iter(?:ation)?)\s*[:=]?\s*(\d+)/i); if (match) job.progress = .5 + .48 * Math.min(1, Number(match[1]) / steps);
      } });
      const outputs = await filesBelow(artifacts);
      const splat = outputs.find(f => f.endsWith('.ply'));
      if (!splat) throw new Error('3DGS 训练没有生成实景文件。');
      job.model = { splat: `/data/${job.id}/artifacts/${splat}` };
      job.stage = 'ready'; job.progress = 1; job.completedAt = new Date().toISOString(); await persist(job); return;
    }
    await run(RECON, [frames, artifacts], { timeout: 2400000, onLine(line) {
      try {
        const event = JSON.parse(line);
        if (event.progress != null) job.progress = .15 + .8 * Math.max(0, Math.min(1, event.progress));
        if (event.warning) job.warning = event.warning;
        if (event.error) job.detail = event.error;
      } catch {}
    } });
    const outputs = await filesBelow(artifacts);
    const obj = outputs.find(f => f.toLowerCase().endsWith('.obj'));
    if (!obj) throw new Error('重建进程未生成 OBJ 模型。请查看拍摄覆盖范围，避免纯白墙、镜面和快速转动。');
    const dir = path.posix.dirname(obj);
    const objText = await fs.readFile(path.join(artifacts, obj), 'utf8');
    const materialName = objText.match(/^mtllib\s+(.+)$/m)?.[1]?.trim();
    const mtl = materialName ? path.posix.normalize(path.posix.join(dir, materialName)) : outputs.find(f => f.toLowerCase().endsWith('.mtl'));
    job.model = { obj: `/data/${job.id}/artifacts/${obj}`, mtl: mtl && outputs.includes(mtl) ? `/data/${job.id}/artifacts/${mtl}` : null };
    job.stage = 'ready'; job.progress = 1; job.completedAt = new Date().toISOString();
  } catch (error) {
    job.stage = 'error'; job.error = error.message;
  } finally {
    await persist(job); activeJob = null;
  }
}
async function upload(req, destination, maxBytes) {
  let bytes = 0;
  const limiter = new Transform({ transform(chunk, _, callback) {
    bytes += chunk.length;
    callback(bytes > maxBytes ? new Error('文件超过允许大小。') : null, chunk);
  } });
  try { await pipeline(req, limiter, createWriteStream(destination, { flags: 'wx' })); }
  catch (error) { await fs.rm(destination, { force: true }); throw error; }
  if (!bytes) { await fs.rm(destination, { force: true }); throw new Error('文件为空。'); }
}
async function jsonBody(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error('请求过大。');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.obj': 'text/plain', '.mtl': 'text/plain', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.ply': 'application/octet-stream' };
function send(res, code, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function serveFile(res, root, relative) {
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) return send(res, 403, { error: 'Forbidden' });
  try {
    const info = await fs.stat(resolved);
    if (!info.isFile()) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': mime[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size });
    createReadStream(resolved).pipe(res);
  } catch { send(res, 404, { error: 'Not found' }); }
}
export async function createApp(port = 4178) {
  await fs.mkdir(DATA, { recursive: true });
  for (const id of await fs.readdir(DATA)) {
    if (!idPattern.test(id)) continue;
    try {
      const job = JSON.parse(await fs.readFile(path.join(DATA, id, 'job.json')));
      if (!['ready', 'error'].includes(job.stage)) {
        job.stage = 'error'; job.error = '上次处理被中断，请重新导入视频。'; await persist(job);
      }
      jobs.set(id, job);
    } catch {}
  }
  let nativeSupported = false;
  if (await exists(RECON)) {
    try { nativeSupported = JSON.parse(await run(RECON, ['--check'])).supported; } catch {}
  }
  const whisper = spawnSync('which', ['whisper-cli'], { encoding: 'utf8' }).stdout?.trim();
  const ffmpeg = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' }).stdout?.trim();
  let gsplatSupported = false;
  if (await exists(SFM_PYTHON) && await exists(BRUSH)) try { await run(SFM_PYTHON, ['-c', 'import pycolmap']); gsplatSupported = true; } catch {}
  const assetsRoot = path.join(DATA, 'assets'); await fs.mkdir(assetsRoot, { recursive: true });
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; frame-ancestors 'none'");
    const host = req.headers.host || '';
    const serverPort = req.socket?.localPort;
    if (!serverPort || res.destroyed) return;
    if (![`127.0.0.1:${serverPort}`, `localhost:${serverPort}`].includes(host)) return send(res, 403, { error: '仅允许本机访问。' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && ![`http://127.0.0.1:${serverPort}`, `http://localhost:${serverPort}`].includes(req.headers.origin)) return send(res, 403, { error: '请求来源不被允许。' });
    try {
      const url = new URL(req.url, `http://${host}`);
      const route = decodeURIComponent(url.pathname);
      if (route === '/api/health') return send(res, 200, { reconstruction: gsplatSupported && !!ffmpeg, nativeReconstruction: nativeSupported && !!ffmpeg, gsplat: gsplatSupported, speech: !!whisper && (await exists(SMALL_MODEL) || await exists(MODEL)), engine: 'COLMAP + Brush 3DGS', offline: true });
      if (route === '/api/assets' && req.method === 'GET') {
        const items = []; for (const id of await fs.readdir(assetsRoot)) { if (!idPattern.test(id)) continue; try { items.push(JSON.parse(await fs.readFile(path.join(assetsRoot, id, 'asset.json')))); } catch {} }
        return send(res, 200, items);
      }
      if (route === '/api/assets' && req.method === 'POST') {
        if (Number(req.headers['content-length']) > 150 * 1024 * 1024) return send(res, 413, { error: '商品模型不能超过 150 MB。' });
        const id = randomUUID(), base = path.join(assetsRoot, id); await fs.mkdir(base);
        try {
          await upload(req, path.join(base, 'model.glb'), 150 * 1024 * 1024);
          validateGLB(await fs.readFile(path.join(base, 'model.glb')));
          const asset = { id, name: (url.searchParams.get('name') || '我的商品').replace(/\.glb$/i, '').slice(0, 60), url: `/assets/${id}/model.glb`, importedAt: new Date().toISOString() };
          await writeJSON(path.join(base, 'asset.json'), asset); return send(res, 201, asset);
        } catch (error) { await fs.rm(base, { recursive: true, force: true }); throw error; }
      }
      if (route === '/api/reconstructions' && req.method === 'GET') return send(res, 200, [...jobs.values()].slice(-20).reverse());
      if (route === '/api/reconstructions' && req.method === 'POST') {
        const engine = url.searchParams.get('engine') || 'gsplat';
        if (!['gsplat', 'native'].includes(engine)) return send(res, 400, { error: '不支持的重建方式。' });
        if (!ffmpeg || (engine === 'gsplat' ? !gsplatSupported : !nativeSupported)) return send(res, 503, { error: '所选重建引擎尚未就绪，请完成本机依赖安装。' });
        if (activeJob) return send(res, 409, { error: '已有房间正在处理，请等待完成。' });
        if (Number(req.headers['content-length']) > 600 * 1024 * 1024) return send(res, 413, { error: '视频不能超过 600 MB。' });
        const id = randomUUID(); activeJob = id;
        const job = { id, name: (url.searchParams.get('name') || '我的房间').slice(0, 120), engine, quality: url.searchParams.get('quality') === 'standard' ? 'standard' : 'preview', stage: 'uploading', progress: 0, createdAt: new Date().toISOString() };
        const base = path.join(DATA, id); await fs.mkdir(base); jobs.set(id, job); await persist(job);
        try { await upload(req, path.join(base, 'input'), 600 * 1024 * 1024); }
        catch (error) { activeJob = null; job.stage = 'error'; job.error = error.message; await persist(job); throw error; }
        send(res, 202, job);
        reconstruct(job).catch(error => { console.error(error.message); activeJob = null; });
        return;
      }
      const jobMatch = route.match(/^\/api\/reconstructions\/([a-f\d-]{36})$/);
      if (jobMatch && req.method === 'GET') return send(res, jobs.has(jobMatch[1]) ? 200 : 404, jobs.get(jobMatch[1]) || { error: '未找到该房间。' });
      if (route === '/api/design' && req.method === 'GET') {
        try { return send(res, 200, JSON.parse(await fs.readFile(path.join(DATA, 'design.json')))); }
        catch { return send(res, 200, null); }
      }
      if (route === '/api/design' && req.method === 'PUT') {
        const value = await jsonBody(req);
        if (!validateDesign(value)) return send(res, 400, { error: '方案格式不正确。' });
        await writeJSON(path.join(DATA, 'design.json'), value); return send(res, 200, { saved: true });
      }
      if (route === '/api/speech' && req.method === 'POST') {
        const speechModel = await exists(SMALL_MODEL) ? SMALL_MODEL : MODEL;
        if (!whisper || !await exists(speechModel) || !ffmpeg) return send(res, 503, { error: '离线语音模型尚未安装。运行 npm run setup 后即可使用。' });
        if (speechBusy || activeJob) return send(res, 409, { error: '本机正在处理上一项任务，请稍后再试。' });
        speechBusy = true;
        const base = path.join(DATA, 'speech-' + randomUUID()); await fs.mkdir(base);
        try {
          await upload(req, path.join(base, 'input'), 10 * 1024 * 1024);
          const wav = path.join(base, 'speech.wav'), out = path.join(base, 'transcript');
          await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.join(base, 'input'), '-t', '30', '-ar', '16000', '-ac', '1', wav]);
          await run(whisper, ['-m', speechModel, '-f', wav, '-l', 'zh', '--prompt', '室内设计指令：添加家具，沙发，桌子，椅子，书架，绿植，墙面，移动，旋转。', '-otxt', '-of', out, '-nt', '-t', '4'], { timeout: 120000 });
          const transcript = (await fs.readFile(out + '.txt', 'utf8')).trim();
          return send(res, 200, { text: transcript });
        } finally { speechBusy = false; await fs.rm(base, { recursive: true, force: true }); }
      }
      if (route.startsWith('/api/')) return send(res, 404, { error: 'Unknown endpoint' });
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Method not allowed' });
      if (route.startsWith('/data/')) {
        const match = route.match(/^\/data\/([a-f\d-]{36})\/(artifacts|frames)\/(.+)$/);
        if (!match || !/\.(obj|mtl|png|jpe?g|usdz|usda|ply)$/i.test(match[3])) return send(res, 404, { error: 'Not found' });
        return serveFile(res, path.join(DATA, match[1], match[2]), match[3]);
      }
      if (route.startsWith('/vendor/three/')) return serveFile(res, path.join(ROOT, 'node_modules/three'), route.slice('/vendor/three/'.length));
      if (route.startsWith('/vendor/spark/')) return serveFile(res, path.join(ROOT, 'node_modules/@sparkjsdev/spark/dist'), route.slice('/vendor/spark/'.length));
      const assetFile = route.match(/^\/assets\/([a-f\d-]{36})\/model\.glb$/);
      if (assetFile) return serveFile(res, path.join(assetsRoot, assetFile[1]), 'model.glb');
      return serveFile(res, path.join(ROOT, 'public'), route === '/' ? 'index.html' : route.slice(1));
    } catch (error) { if (!res.headersSent) send(res, 400, { error: error.message }); else res.destroy(); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.ROOM_STUDIO_PORT || 4178);
  const app = await createApp(port);
  app.listen(port, '127.0.0.1', () => console.log(`Room Studio: http://127.0.0.1:${port}`));
}
