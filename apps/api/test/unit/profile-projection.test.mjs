import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { projectActorProfileDto } from '../../dist/modules/users/profile-projection.js';

const model = overrides => ({ actorId: 'scoped-actor', nickname: '합성 닉네임', avatar: null, role: 'FAN', ...overrides });

test('actor profile preserves the legacy visible DTO while excluding raw birthday and internal identity/revisions', () => {
  const expected = { actorId: 'scoped-actor', nickname: '합성 닉네임', avatar: null, role: 'FAN' };
  const privateFields = { userId: 'private-user', birthday: { month: 1, day: 2 }, birthday_month: 1, birthday_day: 2,
    birthday_visible_to_streamers: true, revision: 'private-revision', membershipPeriodId: 'private-period', objectKey: 'private-key' };
  const input = model(privateFields);
  Object.defineProperty(input, 'privateSecret', { enumerable: true, get() { throw new Error('unexpected private-field access'); } });
  assert.deepEqual(projectActorProfileDto(input), expected);
  for (const visibleBirthday of [undefined, null]) assert.deepEqual(projectActorProfileDto(model({ ...privateFields, visibleBirthday })), expected);
  // Prototype state is not an explicitly authorized visible field.
  const inherited = Object.assign(Object.create({ visibleBirthday: { month: 1, day: 2 } }), model());
  assert.deepEqual(projectActorProfileDto(inherited), expected);
});

test('only explicit visibleBirthday is deep-mapped, without year, extra metadata or avatar URL', () => {
  const input = model({ avatar: { assetId: 'avatar', objectKey: 'private-key', signedUrl: 'private-url' },
    visibleBirthday: { month: 2, day: 29, year: 2000, privateNote: 'private-note' } });
  const result = projectActorProfileDto(input);
  assert.deepEqual(result, { actorId: 'scoped-actor', nickname: '합성 닉네임', avatar: { assetId: 'avatar' }, role: 'FAN', birthday: { month: 2, day: 29 } });
  assert.equal(JSON.stringify(result).includes('private-'), false);
  result.avatar.assetId = 'changed'; result.birthday.month = 3;
  assert.equal(input.avatar.assetId, 'avatar'); assert.equal(input.visibleBirthday.month, 2);
});

test('projection never infers birthday disclosure from the target actor role or stored privacy flag', () => {
  for (const role of ['FAN', 'MEMBER', 'STREAMER']) {
    const result = projectActorProfileDto(model({ role, birthdayVisibleToStreamers: true, birthday: { month: 1, day: 1 } }));
    assert.equal(result.role, role); assert.equal(Object.hasOwn(result, 'birthday'), false);
    const disclosed = projectActorProfileDto(model({ role, visibleBirthday: { month: 1, day: 1 } }));
    assert.deepEqual(disclosed.birthday, { month: 1, day: 1 });
  }
});

test('profile projection AST has no imports, reexports or runtime module loading dependencies', async () => {
  const source = await readFile(new URL('../../src/modules/users/profile-projection.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('profile-projection.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const forbidden = [];
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
      (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')))) forbidden.push(node.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.deepEqual(forbidden, []);
});
