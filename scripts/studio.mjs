#!/usr/bin/env node
/**
 * One command to run Guide Studio: seeds the demo on first run, starts the API
 * server and the studio dev server together with tidy prefixed logs, opens the
 * browser, and shuts both down cleanly on Ctrl-C.
 *
 *   pnpm studio            (or)   ./studio
 *
 * On launch it fast-forward-pulls the latest code (skip with STUDIO_NO_PULL=1).
 * Env overrides: PORT (api, 5170), STUDIO_PORT (5173), GUIDE_DATA_DIR (./data).
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = process.env.PORT ?? '5170';
const STUDIO_PORT = process.env.STUDIO_PORT ?? '5173';
const DATA_DIR = process.env.GUIDE_DATA_DIR ?? path.join(ROOT, 'data');
const URL = `http://localhost:${STUDIO_PORT}`;

const C = { api: '\x1b[36m', studio: '\x1b[33m', sys: '\x1b[35m', dim: '\x1b[2m', reset: '\x1b[0m' };
const log = (tag, color, line) => process.stdout.write(`${color}${tag.padEnd(7)}${C.reset}${C.dim}│${C.reset} ${line}\n`);
const pipe = (child, tag, color) => {
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) log(tag, color, l);
    });
  }
};

// 0. Pull the latest code (fast-forward only, so it never clobbers local work).
//    Failures (offline, diverged, dirty tree) are non-fatal — we launch what's
//    on disk. Skip with STUDIO_NO_PULL=1.
if (process.env.STUDIO_NO_PULL !== '1') {
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout?.trim();
  if (branch && branch !== 'HEAD') {
    log('git', C.sys, `checking ${branch} for updates…`);
    const head = () => git(['rev-parse', 'HEAD']).stdout?.trim() ?? '';
    const lockfile = path.join(ROOT, 'pnpm-lock.yaml');
    const readLock = () => (existsSync(lockfile) ? readFileSync(lockfile, 'utf8') : '');
    const before = head();
    const lockBefore = readLock();
    const pull = git(['pull', '--ff-only']);
    if (pull.status === 0) {
      const after = head();
      if (after && after !== before) {
        log('git', C.sys, `updated ${before.slice(0, 7)} → ${after.slice(0, 7)}`);
        if (readLock() !== lockBefore) {
          log('git', C.sys, 'dependencies changed — installing…');
          const r = spawnSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit' });
          if (r.status !== 0) log('git', C.sys, 'pnpm install failed — continuing with current deps');
        }
      } else {
        log('git', C.sys, 'already up to date');
      }
    } else {
      const why = (pull.stderr || pull.stdout || '').trim().split('\n')[0] || 'offline or local changes';
      log('git', C.sys, `skipped pull (${why}) — launching current code`);
    }
  }
}

// 1. Seed the demo on first run (no db yet).
if (!existsSync(path.join(DATA_DIR, 'guide.db'))) {
  log('seed', C.sys, 'first run — seeding the demo guide (The Sandling Hotel)…');
  const r = spawnSync('node', ['--import', 'tsx', 'apps/server/src/seed.ts', 'fixtures/demo/seed.json'], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, GUIDE_DATA_DIR: DATA_DIR },
  });
  if (r.status !== 0) { log('seed', C.sys, 'seeding failed — is `pnpm install` done?'); process.exit(1); }
}

// 2. Start the API server.
const api = spawn('node', ['--import', 'tsx', 'apps/server/src/main.ts'], {
  cwd: ROOT, env: { ...process.env, GUIDE_DATA_DIR: DATA_DIR, PORT: API_PORT },
});
pipe(api, 'api', C.api);

// 3. Start the studio dev server, proxying to the API.
const studio = spawn('npx', ['vite', '--port', STUDIO_PORT, '--strictPort'], {
  cwd: path.join(ROOT, 'apps/studio'),
  env: { ...process.env, GUIDE_API: `http://localhost:${API_PORT}` },
});
pipe(studio, 'studio', C.studio);

// 4. Open the browser once the studio server is up.
let opened = false;
const open = () => {
  if (opened) return;
  opened = true;
  log('sys', C.sys, `opening ${URL}`);
  const cmd = process.platform === 'darwin' ? ['open', [URL]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', URL]]
    : ['xdg-open', [URL]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* headless */ }
};
studio.stdout.on('data', (d) => { if (/localhost:|ready in/i.test(d.toString())) setTimeout(open, 400); });
setTimeout(open, 6000); // fallback if the ready line isn't matched

log('sys', C.sys, `api → http://localhost:${API_PORT}   studio → ${URL}   (Ctrl-C to stop)`);

// 5. Clean shutdown.
let closing = false;
const shutdown = (code = 0) => {
  if (closing) return;
  closing = true;
  for (const child of [api, studio]) { try { child.kill('SIGTERM'); } catch { /* */ } }
  setTimeout(() => process.exit(code), 300);
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));
api.on('exit', (c) => { log('api', C.api, `exited (${c})`); shutdown(c ?? 1); });
studio.on('exit', (c) => { log('studio', C.studio, `exited (${c})`); shutdown(c ?? 1); });
