#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.local-photos', 'venv', 'bin', 'python');
const args = process.argv.slice(2);
const setup = args.includes('--setup');
const test = args.includes('--test');
const noBuild = args.includes('--no-build');
const pythonCandidates = [process.env.LOCAL_PHOTOS_PYTHON, 'python3.12', 'python3.13', 'python3.14',
  path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'), 'python3'].filter(Boolean);
function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
try {
  const privateRoot = path.join(root, '.local-photos');
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  chmodSync(privateRoot, 0o700);
  if (setup) {
    if (!existsSync(runtime)) {
      const python = pythonCandidates.find(candidate => {
        const result = spawnSync(candidate, ['-c', 'import sys; exit(0 if (3,10) <= sys.version_info[:2] <= (3,14) else 1)']);
        return !result.error && result.status === 0;
      });
      if (!python) throw new Error('Python 3.10–3.14 is required. Set LOCAL_PHOTOS_PYTHON to its executable.');
      mkdirSync(path.join(root, '.local-photos'), { recursive: true, mode: 0o700 });
      run(python, ['-m', 'venv', path.join(root, '.local-photos', 'venv')]);
    }
    run(runtime, ['-m', 'pip', 'install', '-r', 'local/photos/requirements.txt', '--disable-pip-version-check']);
    console.log('Local photo dependencies are ready. Start with: npm run photos');
    process.exit(0);
  }
  if (!existsSync(runtime)) throw new Error('Run npm run photos:setup first.');
  if (test) {
    run(runtime, ['-m', 'unittest', 'discover', '-s', 'local/photos/tests', '-v']);
    run('node', ['scripts/local-photos-smoke.cjs']);
    run('node', ['scripts/local-photos-amap-smoke.cjs']);
    run('node', ['scripts/local-photos-footprints-smoke.cjs']);
    run('node', ['scripts/local-photos-organizer-smoke.cjs']);
    process.exit(0);
  }
  const forwarded = args.filter(arg => arg !== '--no-build');
  const portIndex = forwarded.indexOf('--port');
  const port = portIndex >= 0 ? Number(forwarded[portIndex + 1]) : 8765;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a port between 1 and 65535.');
  const site = path.join(root, '.local-photos', 'site');
  if (!noBuild) {
    console.log('Building the local blog with its private photo entry…');
    run('hugo', ['--environment', 'local-photos', '--config', 'hugo.toml,local/photos/hugo-local.toml',
      '--baseURL', `http://127.0.0.1:${port}/`, '--destination', site, '--cleanDestinationDir']);
  }
  const child = spawn(runtime, ['local/photos/app.py', '--site', site, ...forwarded], { cwd: root, stdio: 'inherit' });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = signal ? 0 : code || 0; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
} catch (error) { console.error(error.message); process.exitCode = 1; }
