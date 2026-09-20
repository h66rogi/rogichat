import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, lstat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareRuntime } from './prepare-runtime.mjs';
import { initializeRuntime } from './runtime-server.mjs';

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'web-runtime-key-test-'));
  try {
    await mkdir(path.join(directory, '.next/server'), { recursive: true });
    const actions = { node: {}, edge: {}, encryptionKey: randomBytes(32).toString('base64') };
    const preview = { previewModeId: randomBytes(16).toString('hex'), previewModeSigningKey: randomBytes(32).toString('hex'), previewModeEncryptionKey: randomBytes(32).toString('hex') };
    await writeFile(path.join(directory, '.next/server/server-reference-manifest.json'), JSON.stringify(actions));
    await writeFile(path.join(directory, '.next/server/server-reference-manifest.js'), `self.__RSC_SERVER_MANIFEST=${JSON.stringify(JSON.stringify(actions))}`);
    await writeFile(path.join(directory, '.next/prerender-manifest.json'), JSON.stringify({ version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview }));
    await writeFile(path.join(directory, 'server.js'), 'export {};');
    await run(directory, actions, preview);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

await test('prepared image has no generated keys; every start creates protected fresh keys atomically', async () => {
  await fixture(async (directory, actions, preview) => {
    await prepareRuntime(directory);
    const manifestPath = path.join(directory, '.next/prerender-manifest.json');
    assert((await lstat(manifestPath)).isSymbolicLink());
    const actionBody = await readFile(path.join(directory, '.next/server/server-reference-manifest.json'), 'utf8');
    assert(!actionBody.includes(actions.encryptionKey));
    const template = await readFile(path.join(directory, '.next/prerender-manifest.template.json'), 'utf8');
    assert(!Object.values(preview).some(value => template.includes(value)));
    initializeRuntime(directory);
    const first = await readFile(manifestPath);
    assert.equal((await lstat(path.join(directory, '.next/cache/rogichat-runtime/prerender-manifest.json'))).mode & 0o777, 0o600);
    assert.equal((await lstat(path.join(directory, '.next/cache/rogichat-runtime'))).mode & 0o777, 0o700);
    const value = JSON.parse(first);
    assert(Object.values(value.preview).every(key => typeof key === 'string' && key.length >= 32));
    initializeRuntime(directory);
    const second = await readFile(manifestPath);
    assert(createHash('sha256').update(first).digest('hex') !== createHash('sha256').update(second).digest('hex'), 'Keys must change on restart');
    assert.equal(await readFile(path.join(directory, '.next/prerender-manifest.template.json'), 'utf8'), template);
  });
});

await test('Server Actions and hidden duplicate generated keys block image preparation', async () => {
  await fixture(async (directory, actions) => {
    actions.node.exampleAction = {};
    await writeFile(path.join(directory, '.next/server/server-reference-manifest.json'), JSON.stringify(actions));
    await assert.rejects(prepareRuntime(directory), /Server Actions require/);
  });
  await fixture(async (directory, actions) => {
    await writeFile(path.join(directory, 'unexpected-key-copy.txt'), actions.encryptionKey);
    await assert.rejects(prepareRuntime(directory), /Generated key remains/);
  });
});
