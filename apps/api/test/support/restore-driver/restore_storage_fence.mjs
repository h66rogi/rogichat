/** Kernel-enforced, disposable Linux filesystem custody; never R2 custody. */
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { canonical } from './restore_proof.mjs';
const fail = () => { throw new Error('restore_storage_custody_rejected'); };
const below = (parent, child) => { const r = relative(parent, child); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const unescapeMount = value => value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));

export function readonlyMount(mountInfo, root) {
  const mounts = mountInfo.trim().split('\n').map(line => {
    const fields = line.split(' '), split = fields.indexOf('-');
    if (split < 6 || !/^[1-9][0-9]*$/.test(fields[0])) fail();
    return { id: fields[0], point: unescapeMount(fields[4]), options: fields[5].split(','), optional: fields.slice(6, split) };
  });
  const covering = mounts.filter(mount => below(mount.point, root)).sort((a, b) => b.point.length - a.point.length)[0];
  if (!covering || covering.point === '/' || !covering.options.includes('ro') || covering.options.includes('rw')
      || covering.optional.some(flag => flag.startsWith('shared:') || flag.startsWith('master:'))
      || mounts.some(mount => mount.id !== covering.id && below(root, mount.point))) fail();
  return covering;
}

export async function inspectStorageFence(storageRoot, storageScopeSha256) {
  if (process.platform !== 'linux' || process.getuid?.() === 0 || !isAbsolute(storageRoot)
      || typeof storageScopeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(storageScopeSha256)) fail();
  const status = await readFile('/proc/self/status', 'utf8');
  if (!/^NoNewPrivs:\s+1$/m.test(status)) fail();
  for (const key of ['CapEff', 'CapPrm', 'CapBnd']) {
    const value = new RegExp(`^${key}:\\s+([0-9a-f]+)$`, 'm').exec(status)?.[1];
    if (!value || (BigInt('0x' + value) & (1n << 21n)) !== 0n) fail();
  }
  const root = await realpath(storageRoot), info = await lstat(storageRoot, { bigint: true });
  if (root !== storageRoot || !info.isDirectory() || info.isSymbolicLink()) fail();
  const mount = readonlyMount(await readFile('/proc/self/mountinfo', 'utf8'), root);
  const namespace = await stat('/proc/self/ns/mnt', { bigint: true });
  let entries = 0, bytes = 0n;
  async function walk(directory) {
    for (const name of await readdir(directory)) {
      if (++entries > 10000) fail();
      const path = join(directory, name), item = await lstat(path, { bigint: true });
      if (item.isSymbolicLink() || item.dev !== info.dev) fail();
      if (item.isDirectory()) await walk(path);
      else {
        if (!item.isFile() || item.nlink !== 1n) fail();
        bytes += item.size;
        if (bytes > 256n * 1024n * 1024n) fail();
      }
    }
  }
  await walk(root);
  // Decimal strings preserve every kernel identifier without JS precision loss.
  const identity = { version: 1, storageScopeSha256, mountNamespaceInode: namespace.ino.toString(),
    mountId: mount.id, rootDev: info.dev.toString(), rootIno: info.ino.toString() };
  return { storageScopeSha256, storageFenceId: createHash('sha256').update(canonical(identity)).digest('hex') };
}
