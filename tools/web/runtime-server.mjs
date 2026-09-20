import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function initializeRuntime(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, '.next/prerender-manifest.template.json'), 'utf8'));
  if (!manifest.preview || Object.keys(manifest.preview).length !== 0) throw new Error('Invalid keyless manifest');
  const destination = path.join(directory, '.next/cache/rogichat-runtime');
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(destination);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid runtime directory');
  fs.chmodSync(destination, 0o700);
  manifest.preview = {
    previewModeId: crypto.randomBytes(16).toString('hex'),
    previewModeSigningKey: crypto.randomBytes(32).toString('hex'),
    previewModeEncryptionKey: crypto.randomBytes(32).toString('hex'),
  };
  const temporary = path.join(destination, `.manifest-${crypto.randomBytes(16).toString('hex')}.tmp`);
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(manifest));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, path.join(destination, 'prerender-manifest.json'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  try {
    initializeRuntime(directory);
    await import(new URL('./next-server.js', import.meta.url));
  } catch {
    // No filesystem path, manifest content or runtime key is ever logged.
    console.error('Web runtime initialization failed');
    process.exit(1);
  }
}
