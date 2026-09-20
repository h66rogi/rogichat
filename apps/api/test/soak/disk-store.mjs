// Disposable test object store: real bytes on private disk, never an R2 emulator claim.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, chmod, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export class DiskStore {
  constructor(directory) { this.directory = directory; }
  path(key) {
    assert.match(key, /^test\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/(input|image|video|poster)$/);
    return join(this.directory, createHash('sha256').update(key).digest('hex'));
  }
  async put(key, source, bytes, contentType, signal) {
    signal.throwIfAborted(); assert.ok(['video/mp4', 'image/webp'].includes(contentType)); assert.equal((await stat(source)).size, bytes);
    await copyFile(source, this.path(key), constants.COPYFILE_EXCL); await chmod(this.path(key), 0o600);
  }
  async read(key, signal) { signal.throwIfAborted(); return { stream: createReadStream(this.path(key)), bytes: (await stat(this.path(key))).size }; }
  async remove(key, signal) { signal.throwIfAborted(); await unlink(this.path(key)).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  async signedGet() { throw new Error('fixture_has_no_public_route'); }
}
