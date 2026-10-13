import { mkdir, access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const run = (command, args) => { const r = spawnSync(command, args, { stdio: 'inherit' }); if (r.status !== 0) throw new Error(`${command} failed; check network and local dependencies.`); };
await mkdir('.bin/brush', { recursive: true });
try { await access('.bin/brush/brush-app-aarch64-apple-darwin/brush_app'); } catch {
  const base = 'https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/';
  for (const [name, output] of [['brush-app-aarch64-apple-darwin.tar.xz', 'release.tar.xz'], ['brush-app-aarch64-apple-darwin.tar.xz.sha256', 'release.sha256']]) run('curl', ['-fL', '--retry', '2', '--connect-timeout', '15', '--max-time', '300', base + name, '-o', '.bin/brush/' + output]);
  const expected = (await readFile('.bin/brush/release.sha256', 'utf8')).split(/\s/)[0];
  const actual = createHash('sha256').update(await readFile('.bin/brush/release.tar.xz')).digest('hex');
  if (expected !== actual) throw new Error('Brush checksum mismatch; refusing to execute this download.');
  run('tar', ['-xf', '.bin/brush/release.tar.xz', '-C', '.bin/brush']);
}
try { await access('.venv/bin/python'); } catch {
  const python = ['python3.14', 'python3.13', 'python3.12', 'python3.11'].find(bin => spawnSync(bin, ['--version']).status === 0);
  if (!python) throw new Error('Install Python 3.11–3.14 first, then run this setup again.');
  run(python, ['-m', 'venv', '.venv']);
}
run('.venv/bin/python', ['-m', 'pip', 'install', '--disable-pip-version-check', 'pycolmap==4.2.1', 'numpy==2.5.4']);
console.log('Local 3DGS dependencies ready. Restart the studio with npm start.');
