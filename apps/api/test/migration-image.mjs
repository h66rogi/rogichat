import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = '/workspace/apps/api';
const require = createRequire(`${root}/package.json`);
const prisma = require('prisma/package.json');
const engines = path.dirname(require.resolve('@prisma/engines/package.json', {
  paths: [require.resolve('prisma/package.json')],
}));
assert.equal(prisma.version, '7.10.0');
assert(existsSync(path.join(engines, 'schema-engine-debian-openssl-3.0.x')));
assert.equal(typeof require('mysql2/promise').createConnection, 'function');
assert(existsSync(`${root}/prisma/schema.prisma`));

const { migrationManifest } = await import(pathToFileURL(`${root}/dist/infrastructure/database/schema-manifest.js`));
const { initializeDefaultRoom } = await import(pathToFileURL(`${root}/dist/modules/owner-bootstrap/default-room-initialize.js`));
assert(Array.isArray(migrationManifest) && migrationManifest.length > 0);
assert.equal(typeof initializeDefaultRoom, 'function');
console.log('Migration CLI, engine, driver, manifest and initializer imports passed.');
