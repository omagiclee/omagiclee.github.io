import { mkdir, access, rename, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
await mkdir('.bin/module-cache', { recursive: true });
await mkdir('.models', { recursive: true });
const result = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-O', 'native/Reconstruct.swift', '-o', '.bin/reconstruct', '-module-cache-path', '.bin/module-cache'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const target = '.models/ggml-small-q5_1.bin';
try { await access(target); } catch {
  console.log('Downloading the multilingual Whisper small Q5 model (about 181 MiB). Only setup requires internet.');
  try {
    const result = spawnSync('curl', ['-fL', '--retry', '2', '--connect-timeout', '15', '--max-time', '600', 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin', '-o', target + '.part'], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Whisper model download failed. Check your network/proxy settings and run setup again.');
    await rename(target + '.part', target);
  } catch (error) {
    await rm(target + '.part', { force: true });
    throw error;
  }
}
console.log('Setup complete. Run npm start.');
