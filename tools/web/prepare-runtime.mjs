#!/usr/bin/env node
// The final image must never contain generated Next.js authentication key material.
import assert from 'node:assert/strict';
import { cp, lstat, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function prepareRuntime(directory) {
  const next = path.join(directory, '.next');
  await assert.rejects(lstat(path.join(next, 'cache')), { code: 'ENOENT' }, 'Runtime preparation requires fresh cache-free standalone output');
  const actionPath = path.join(next, 'server/server-reference-manifest.json');
  const actions = JSON.parse(await readFile(actionPath, 'utf8'));
  assert.deepEqual(Object.keys(actions.node), [], 'Server Actions require a reviewed runtime key contract');
  assert.deepEqual(Object.keys(actions.edge), [], 'Edge Server Actions require a reviewed runtime key contract');
  const prerenderPath = path.join(next, 'prerender-manifest.json');
  const prerender = JSON.parse(await readFile(prerenderPath, 'utf8'));
  const keys = [actions.encryptionKey, prerender.preview.previewModeId,
    prerender.preview.previewModeSigningKey, prerender.preview.previewModeEncryptionKey];
  assert(keys.every(key => typeof key === 'string' && key.length >= 16), 'Unexpected Next key manifest shape');
  const actionScriptPath = path.join(next, 'server/server-reference-manifest.js');
  const script = await readFile(actionScriptPath, 'utf8');
  const match = /^self\.__RSC_SERVER_MANIFEST\s*=\s*("(?:[^"\\]|\\.)*")\s*;?\s*$/.exec(script);
  assert(match, 'Unexpected Next action script shape');
  assert.deepEqual(JSON.parse(JSON.parse(match[1])), actions, 'Action manifest copies diverged');
  delete actions.encryptionKey;
  await writeFile(actionPath, JSON.stringify(actions));
  await writeFile(actionScriptPath, `self.__RSC_SERVER_MANIFEST = ${JSON.stringify(JSON.stringify(actions))};\n`);
  prerender.preview = {};
  await writeFile(path.join(next, 'prerender-manifest.template.json'), JSON.stringify(prerender));
  // Replace the secret-bearing manifest atomically before any runtime image COPY.
  await writeFile(prerenderPath, JSON.stringify(prerender));
  await rename(prerenderPath, path.join(next, 'prerender-manifest.keyless.json'));
  await symlink('cache/rogichat-runtime/prerender-manifest.json', prerenderPath);
  // Remove the redundant keyless intermediate, leaving one reviewed template.
  const { unlink } = await import('node:fs/promises');
  await unlink(path.join(next, 'prerender-manifest.keyless.json'));
  await rename(path.join(directory, 'server.js'), path.join(directory, 'next-server.js'));
  await cp(new URL('./runtime-server.mjs', import.meta.url), path.join(directory, 'server.js'));
  async function inspect(root) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await inspect(file);
      else if (entry.isFile()) {
        const body = await readFile(file);
        assert(!keys.some(key => body.includes(key)), `Generated key remains in prepared runtime: ${path.relative(directory, file)}`);
      }
    }
  }
  await inspect(directory);
  assert((await lstat(prerenderPath)).isSymbolicLink());
  console.log('Prepared keyless runtime; unused Server Actions disabled and per-start keys confined to cache');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareRuntime(path.resolve(process.argv[2] ?? 'apps/web/.next/standalone/apps/web'));
}
