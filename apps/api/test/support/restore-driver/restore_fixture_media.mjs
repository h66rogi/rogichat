/** Actual RestoreMediaStore port over kernel-custodied, nonempty fixture bytes. */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { canonical } from './restore_proof.mjs';
import { inspectStorageFence } from './restore_storage_fence.mjs';
const fail = () => { throw new Error('restore_fixture_media_rejected'); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateMediaConfig(config) {
  if (!config || Object.keys(config).sort().join(',') !== 'accountId,bucket,prefix,root'
      || typeof config.root !== 'string' || !isAbsolute(config.root)
      || !/^[a-f0-9]{32}$/.test(config.accountId) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket)
      || config.prefix !== 'qa') fail();
  return hash(canonical({ accountId: config.accountId, bucket: config.bucket, prefix: config.prefix }));
}
export async function createFixtureMediaStore(config) {
  const storageScopeSha256 = validateMediaConfig(config), root = config.root, prefix = config.prefix;
  const fence = await inspectStorageFence(root, storageScopeSha256);
  async function held(signal) {
    signal.throwIfAborted();
    if (canonical(await inspectStorageFence(root, storageScopeSha256)) !== canonical(fence)) fail();
  }
  function pathFor(key) {
    if (typeof key !== 'string' || !key.startsWith(prefix + '/') || key.includes('\\')
        || key.split('/').some(part => !part || part === '.' || part === '..')) fail();
    const path = join(root, key), rel = relative(root, path);
    if (isAbsolute(rel) || rel.startsWith('..')) fail();
    return path;
  }
  async function object(key) {
    const path = pathFor(key), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 52 * 1024 * 1024) fail();
    const bytes = await readFile(path);
    if (bytes.length !== info.size) fail();
    return { bytes, etag: hash(bytes), modified: info.mtime.toISOString() };
  }
  return Object.freeze({ prefix, storageScopeSha256,
    async list(cursor, signal) {
      await held(signal);
      if (cursor !== null && (typeof cursor !== 'string' || !/^(0|[1-9][0-9]*)$/.test(cursor))) fail();
      const names = [];
      async function walk(directory) {
        for (const name of await readdir(directory)) {
          const path = join(directory, name), info = await lstat(path);
          if (info.isSymbolicLink()) fail();
          if (info.isDirectory()) await walk(path);
          else names.push(relative(root, path).split('\\').join('/'));
        }
      }
      // Missing prefix is unavailable, never silently interpreted as empty.
      await walk(join(root, prefix));
      names.sort();
      const offset = cursor === null ? 0 : Number(cursor);
      if (!Number.isSafeInteger(offset) || offset > names.length) fail();
      const objects = [];
      for (const key of names.slice(offset, offset + 1000)) {
        signal.throwIfAborted();
        const value = await object(key);
        objects.push({ key, bytes: value.bytes.length, etag: value.etag, modified: value.modified });
      }
      await held(signal);
      return { objects, next: offset + objects.length < names.length ? String(offset + objects.length) : null };
    },
    async read(key, signal) {
      await held(signal);
      const value = await object(key);
      await held(signal);
      return { stream: Readable.from([value.bytes]), bytes: value.bytes.length, etag: value.etag };
    },
    close() {},
  });
}
