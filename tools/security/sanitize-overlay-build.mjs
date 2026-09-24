import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Next writes fresh preview and Server Action keys during every build. The
// copied OBS overlay has no draft-mode routes or Server Actions, so these
// capabilities remain disabled in the public runtime image.
const root = process.argv[2];
if (!root) throw new Error('Standalone .next directory is required');

const prerenderPath = join(root, 'prerender-manifest.json');
const prerender = JSON.parse(readFileSync(prerenderPath, 'utf8'));
for (const key of ['previewModeId', 'previewModeSigningKey', 'previewModeEncryptionKey']) {
  if (typeof prerender.preview?.[key] !== 'string') {
    throw new Error(`Missing generated preview field: ${key}`);
  }
}
prerender.preview.previewModeId = '0'.repeat(32);
prerender.preview.previewModeSigningKey = '0'.repeat(64);
prerender.preview.previewModeEncryptionKey = '0'.repeat(64);
writeFileSync(prerenderPath, JSON.stringify(prerender));

const serverReferencePath = join(root, 'server/server-reference-manifest.json');
const serverReference = JSON.parse(readFileSync(serverReferencePath, 'utf8'));
if (Object.keys(serverReference.node ?? {}).length || Object.keys(serverReference.edge ?? {}).length) {
  throw new Error('Server Actions were added; a runtime key must be designed before publishing');
}
if (typeof serverReference.encryptionKey !== 'string') {
  throw new Error('Missing generated Server Action encryption key');
}
serverReference.encryptionKey = Buffer.alloc(32).toString('base64');
writeFileSync(serverReferencePath, JSON.stringify(serverReference));
