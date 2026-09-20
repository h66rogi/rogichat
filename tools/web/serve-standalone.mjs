#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { cp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'apps', 'web');
const distDir = '.next';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const port = option('port', '3101');
const host = option('host', '127.0.0.1');

const standaloneWeb = path.join(WEB, distDir, 'standalone', 'apps', 'web');
await stat(path.join(standaloneWeb, 'server.js')).catch(() => {
  throw new Error(`Production standalone output missing under apps/web/${distDir}; build it first`);
});
await cp(path.join(WEB, distDir, 'static'), path.join(standaloneWeb, distDir, 'static'), { recursive: true });
await cp(path.join(WEB, 'public'), path.join(standaloneWeb, 'public'), { recursive: true });

const child = spawn(process.execPath, ['server.js'], {
  cwd: standaloneWeb,
  env: { ...process.env, PORT: port, HOSTNAME: host, NODE_ENV: 'production', ROGICHAT_WEB_ENV: process.env.ROGICHAT_WEB_ENV ?? 'qa', ROGICHAT_API_ORIGIN: process.env.ROGICHAT_API_ORIGIN ?? 'https://api.qa.rogi.chat' },
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => process.exit(code ?? 0));
