import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../dist/app.module.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { MessagesCoreModule } from '../../dist/modules/messages/messages-core.module.js';
import { MediaCoreModule } from '../../dist/modules/media/media-core.module.js';
import { PublicationsCoreModule } from '../../dist/modules/publications/publications-core.module.js';
import { UsersCoreModule } from '../../dist/modules/users/users-core.module.js';
import { JobsCoreModule } from '../../dist/modules/jobs/jobs-core.module.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { Transactions } from '../../dist/infrastructure/database/transactions.js';
import { provisionRoomInput, historyPolicyInput } from '../../dist/modules/rooms/dto/room.dto.js';
import { updateProfileInput } from '../../dist/modules/users/dto/update-profile.dto.js';

const root = fileURLToPath(new URL('../../src', import.meta.url));
async function sources(directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'generated') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sources(path));
    else if (path.endsWith('.ts')) result.push({ path, text: await readFile(path, 'utf8') });
  }
  return result;
}
function syntax(source) { return ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true); }
function walk(node, visit) { visit(node); ts.forEachChild(node, child => walk(child, visit)); }

test('source root is composition only and legacy runtime/session adapters are absent', async () => {
  const files = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort();
  assert.deepEqual(files, ['app.module.ts', 'application.ts', 'main.ts', 'media-decoder-main.ts', 'worker.module.ts', 'worker.ts']);
  for (const source of await sources()) {
    assert.doesNotMatch(source.text, /\b(?:AuthRuntime|class Sessions|forwardRef|ModuleRef)\b/, source.path);
    const tree = syntax(source);
    walk(tree, node => {
      if (ts.isDecorator(node)) assert.notEqual(node.expression.getText(tree), 'Global()', source.path);
    });
  }
  for (const name of ['main.ts', 'worker.ts']) assert.ok((await readFile(resolve(root, name), 'utf8')).trim().split('\n').length <= 3);
});

test('controllers are transport-only, services contain no SQL, repositories cannot create hidden transactions', async () => {
  // Meloming's copied channel domain helpers receive the current Prisma
  // transaction explicitly. Keep this exact, transaction-bound constructor
  // pattern without allowing hidden connections or arbitrary service creation.
  const channelHelpers = new Set([
    'ArtistService', 'CategoryService', 'ChannelMusicbookSettingsService',
    'ChannelSongRequestSettingsService', 'LiveSessionService', 'OmakaseService',
    'SessionSetlistService', 'SongAddRequestService', 'SongExportService',
    'SongHelperService', 'SongPricingService', 'SongRequestQueueService',
    'SongRequestService', 'LyricsRetrievalService', 'OverlayLayoutService',
    'OverlayService', 'OverlayThemeService',
  ]);
  const copiedSqlHelpers = new Set([
    'modules/channel-content/upstream/song-autocomplete.service.ts',
    'modules/channel-content/upstream/artist.service.ts',
    'modules/channel-content/upstream/category.service.ts',
  ]);
  for (const source of await sources()) {
    const tree = syntax(source);
    const controller = source.path.endsWith('.controller.ts');
    const service = source.path.endsWith('.service.ts');
    const repository = source.path.endsWith('.repository.ts');
    const copiedSqlHelper = [...copiedSqlHelpers].some(path => source.path.endsWith(path));
    walk(tree, node => {
      if ((controller || service) && ts.isNewExpression(node)) {
        const name = node.expression.getText(tree);
        const first = node.arguments?.[0]?.getText(tree);
        const originalTransactionHelper = service && source.path.includes('/modules/channel-content/') &&
          channelHelpers.has(name) && ['tx.prisma', 'this.prisma', 'prisma'].includes(first);
        if (!originalTransactionHelper) assert.doesNotMatch(name, /(?:Service|Repository|Database|Transactions|Broker|Gateway)$/, `manual dependency construction: ${source.path}`);
      }
      if ((controller || service) && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const sourceBoundRaw = copiedSqlHelper && service && ['$queryRaw', '$executeRaw'].includes(method) &&
          ['tx.prisma', 'this.prisma'].includes(node.expression.expression.getText(tree));
        assert.ok(sourceBoundRaw || !['rows', 'execute', '$queryRaw', '$executeRaw', '$transaction'].includes(method), `${source.path}: ${node.expression.getText(tree)}`);
        if (controller) assert.ok(!['write', 'read'].includes(node.expression.name.text), source.path);
      }
      if (repository && ts.isNewExpression(node)) assert.ok(!/Transactions|Database|PrismaClient/.test(node.expression.getText(tree)), source.path);
      if (repository && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) assert.ok(!['write', '$transaction'].includes(node.expression.name.text), source.path);
      if ((controller || service) && !copiedSqlHelper && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) assert.doesNotMatch(node.text, /^\s*(SELECT|INSERT|UPDATE|DELETE|START TRANSACTION)\s/i, source.path);
    });
  }
});

function persistenceViolations(source) {
  const violations = [];
  const forbiddenDriver = value => value === 'mysql2' || value.startsWith('mysql2/');
  const typedBindings = bindings => bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(entry => entry.isTypeOnly);
  walk(syntax(source), node => {
    if ((ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      ['$queryRawUnsafe', '$executeRawUnsafe'].includes(node.text)) violations.push('unsafe SQL');
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && forbiddenDriver(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      if (!clause?.isTypeOnly && !(clause && !clause.name && typedBindings(clause.namedBindings))) violations.push('runtime mysql2 import');
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && forbiddenDriver(node.moduleSpecifier.text)) {
      const onlyTypes = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(entry => entry.isTypeOnly));
      if (!onlyTypes) violations.push('runtime mysql2 export');
    }
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      const spec = node.moduleReference.expression;
      if (spec && ts.isStringLiteral(spec) && forbiddenDriver(spec.text)) violations.push('runtime mysql2 require');
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const spec = node.arguments[0];
      if (spec && (ts.isStringLiteral(spec) || ts.isNoSubstitutionTemplateLiteral(spec)) && forbiddenDriver(spec.text)) violations.push('runtime mysql2 load');
    }
  });
  return violations;
}

test('authored runtime forbids unsafe Prisma SQL and a parallel mysql2 driver while allowing type-only imports', async () => {
  for (const source of await sources()) assert.deepEqual(persistenceViolations(source), [], source.path);
  for (const text of ["import type { RowDataPacket } from 'mysql2';", "import { type RowDataPacket } from 'mysql2';", "export type { RowDataPacket } from 'mysql2';"])
    assert.deepEqual(persistenceViolations({ path: 'type-only.ts', text }), []);
  for (const text of ["import { createPool } from 'mysql2/promise';", "import 'mysql2';", "import('mysql2/promise');", "const sql = require('mysql2');", "export { createPool } from 'mysql2';", "tx.$queryRawUnsafe(query);", "tx['$executeRawUnsafe'](query);"])
    assert.ok(persistenceViolations({ path: 'forbidden.ts', text }).length > 0, text);
});

test('runtime import graph has no cycles or decoder-to-API dependency paths', async () => {
  const all = await sources(); const paths = new Set(all.map(source => source.path)); const edges = new Map();
  for (const source of all) {
    const imports = [];
    walk(syntax(source), node => {
      if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly || !ts.isStringLiteral(node.moduleSpecifier)) return;
      const spec = node.moduleSpecifier.text;
      if (spec.startsWith('.')) {
        const target = resolve(dirname(source.path), spec.replace(/\.js$/, '.ts'));
        if (paths.has(target)) imports.push(target);
        if (source.path.includes('/isolated/')) assert.ok(!target.includes('/modules/') && !target.includes('/infrastructure/'), `decoder credential boundary: ${spec}`);
        const own = relative(root, source.path).split('/'); const other = relative(root, target).split('/');
        if (own[0] === 'modules' && other[0] === 'modules' && own[1] !== other[1]) assert.ok(!target.endsWith('.repository.ts'), `private repository import: ${source.path} -> ${spec}`);
      }
    });
    edges.set(source.path, imports);
  }
  const done = new Set(); const visiting = new Set();
  function visit(path) {
    assert.ok(!visiting.has(path), `runtime import cycle at ${path}`);
    if (done.has(path)) return;
    visiting.add(path); for (const child of edges.get(path) ?? []) visit(child); visiting.delete(path); done.add(path);
  }
  for (const path of paths) visit(path);
});

test('transaction-scoped domain module graphs boot without session/auth configuration or hidden UnitOfWork', async () => {
  for (const module of [MessagesCoreModule, MediaCoreModule, PublicationsCoreModule, UsersCoreModule, JobsCoreModule]) {
    const app = await NestFactory.createApplicationContext(module, { logger: false, abortOnError: false });
    try {
      assert.throws(() => app.get(SessionService)); assert.throws(() => app.get(Transactions));
      for (const exported of Reflect.getMetadata('exports', module)) assert.ok(!exported.name.endsWith('Repository'));
    } finally { await app.close(); }
  }
});

test('AppModule feature composition rejects implicit database/session transaction sources', () => {
  const database = { check: async () => ({ ready: true, reason: 'ready' }), close: async () => {} };
  const graph = AppModule.register(database, new LifecycleState());
  assert.equal(graph.controllers, undefined);
  assert.equal(graph.providers, undefined);
  assert.ok(graph.imports.every(module => module.module.name !== 'RuntimeModule'));
});

test('room and profile DTOs preserve bounded normalized input and reject authority/private field injection', () => {
  const owner = '10000000-0000-4000-8000-000000000001';
  assert.deepEqual(provisionRoomInput({ name: ' 방 ', mode: 'FAN', ownerUserId: owner, historyPolicy: 'SINCE_JOIN' }), { name: '방', mode: 'FAN', ownerUserId: owner, historyPolicy: 'SINCE_JOIN' });
  for (const input of [{ historyPolicy: 'ALL_AVAILABLE', owner: owner }, { historyPolicy: 'all' }]) assert.throws(() => historyPolicyInput(input), { code: 'INVALID_REQUEST' });
  assert.deepEqual(updateProfileInput({ birthday: { month: 2, day: 29 }, birthdayVisibleToStreamers: false }), { birthday: { month: 2, day: 29 }, birthdayVisibleToStreamers: false });
  for (const input of [{ birthday: { year: 2000, month: 2, day: 29 } }, { userId: owner }, { birthdayVisibleToStreamers: 'true' }, {}]) assert.throws(() => updateProfileInput(input), { code: 'INVALID_REQUEST' });
});
