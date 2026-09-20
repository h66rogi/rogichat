#!/usr/bin/env node
/**
 * Runs a built web standalone server locally the way the container does.
 *
 * Usage: node tools/web/serve-standalone.mjs --shape production|qa [--port 3101] [--host 127.0.0.1]
 *
 * Copies the shape's static assets and the public directory next to the traced standalone server
 * (idempotent, inside the ignored build directory) and starts `server.js`. Used by the Playwright
 * webServer entry and for manual browser review. Requires a prior `pnpm web:build` / `pnpm web:build:qa`.
 */
import { spawn } from 'node:child_process';
import { cp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'apps', 'web');
const DIST = { production: '.next', qa: '.next-qa' };

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const shape = option('shape', 'qa');
const distDir = DIST[shape];
if (!distDir) throw new Error(`Unknown shape ${shape}; expected production or qa`);
const port = option('port', '3101');
const host = option('host', '127.0.0.1');

const standaloneWeb = path.join(WEB, distDir, 'standalone', 'apps', 'web');
await stat(path.join(standaloneWeb, 'server.js')).catch(() => {
  throw new Error(`${shape} standalone output missing under apps/web/${distDir}; build it first`);
});
await cp(path.join(WEB, distDir, 'static'), path.join(standaloneWeb, distDir, 'static'), { recursive: true });
await cp(path.join(WEB, 'public'), path.join(standaloneWeb, 'public'), { recursive: true });

const child = spawn(process.execPath, ['server.js'], {
  cwd: standaloneWeb,
  env: { ...process.env, PORT: port, HOSTNAME: host, NODE_ENV: 'production' },
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => process.exit(code ?? 0));
