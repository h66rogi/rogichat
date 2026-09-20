import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('worker deployment healthcheck resolves current runtime exports after module and ORM refactoring', async () => {
  const compose = await readFile(new URL('../../../../infrastructure/runtime/compose.app.yaml', import.meta.url), 'utf8');
  const imports = [...compose.matchAll(/import \{(\w+)\} from '\.\/dist\/([^']+)'/g)];
  assert.deepEqual(imports.map(([, name, path]) => [name, path]), [
    ['readConfig', 'infrastructure/config/config.js'],
    ['PrismaDatabase', 'infrastructure/database/database.js'],
  ]);
  for (const [, name, path] of imports) {
    const module = await import(new URL(`../../dist/${path}`, import.meta.url));
    assert.equal(typeof module[name], 'function');
  }
  assert.ok(compose.includes('finally{await db.close()}'));
  assert.ok(!compose.includes('MysqlDatabase'));
});

test('deployment auth preflight and migration gate resolve current compiled modules', async () => {
  const preflight = await readFile(new URL('../../../../tools/operations/backend_release.py', import.meta.url), 'utf8');
  const authPath = /const\{readAuthConfig\}=await import\('\.\/dist\/([^']+)'\)/.exec(preflight)?.[1];
  assert.equal(authPath, 'infrastructure/config/auth-config.js');
  const auth = await import(new URL(`../../dist/${authPath}`, import.meta.url));
  assert.equal(typeof auth.readAuthConfig, 'function');

  const gate = await readFile(new URL('../../../../tools/operations/migrate_entry.mjs', import.meta.url), 'utf8');
  const manifestPath = /import\(pathToFileURL\('\/workspace\/apps\/api\/dist\/([^']+)'\)\)/.exec(gate)?.[1];
  assert.equal(manifestPath, 'infrastructure/database/schema-manifest.js');
  const { migrationManifest } = await import(new URL(`../../dist/${manifestPath}`, import.meta.url));
  assert.ok(Array.isArray(migrationManifest) && migrationManifest.length > 0);
  assert.ok(migrationManifest.every(entry => /^[a-f0-9]{64}$/.test(entry.checksum)));
});
