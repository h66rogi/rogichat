#!/usr/bin/env node
// Fail closed on route manifests and every shipped application artifact.
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const dist = path.resolve(process.argv[2] ?? 'apps/web/.next');
const forbiddenRoute = /\/(preview|demo|mock|fixtures?)(\/|$)/i;
const markers = ['rogichat-preview-fixture-7f415df1', '.preview.tsx', 'NEXT_PUBLIC_ROGICHAT_WEB_ENV'];
for (const manifest of ['app-path-routes-manifest.json', 'routes-manifest.json', 'prerender-manifest.json']) {
  const data = JSON.parse(await readFile(path.join(dist, manifest), 'utf8'));
  function inspect(value) {
    if (typeof value === 'string') assert(!forbiddenRoute.test(value), `Forbidden route in ${manifest}: ${value}`);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { inspect(key); inspect(child); }
  }
  inspect(data);
}
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    // Next itself implements preview mode; third-party libraries are not application fixtures.
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') await walk(file); }
    else if (entry.isFile()) {
      assert(!/(^|\/)(preview|fixtures?|demo|mock)(\/|\.)/i.test(path.relative(dist, file)), `Forbidden shipped file: ${file}`);
      const body = await readFile(file);
      for (const marker of markers) assert(!body.includes(marker), `Forbidden marker ${marker}: ${file}`);
    }
  }
}
for (const directory of ['server', 'static', 'standalone']) { await stat(path.join(dist, directory)); await walk(path.join(dist, directory)); }
console.log('Production route and application artifact isolation passed');
