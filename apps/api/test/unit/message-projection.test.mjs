import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { projectMessageDto } from '../../dist/modules/messages/message-projection.js';

const model = overrides => ({
  id: 'message-fixture', version: 18446744073709551615n, createdAt: new Date('2026-01-01T01:02:03.004Z'), audience: 'PRIVATE',
  author: { kind: 'member', actorId: 'room-scoped-actor', nickname: '합성 사용자', avatar: null },
  content: { type: 'TEXT', text: '합성 본문' }, quote: null, ...overrides,
});

test('message mapper preserves the legacy DTO, bigint precision, text null and nickname fallback', () => {
  assert.deepEqual(projectMessageDto(model()), {
    id: 'message-fixture', version: '18446744073709551615', createdAt: '2026-01-01T01:02:03.004Z', audience: 'PRIVATE',
    author: { kind: 'member', actorId: 'room-scoped-actor', nickname: '합성 사용자', avatar: null },
    content: { type: 'TEXT', text: '합성 본문' }, quote: null,
  });
  const nullable = projectMessageDto(model({ version: '12', content: { type: 'TEXT', text: null },
    author: { kind: 'member', actorId: 'actor', nickname: null, avatar: { assetId: 'avatar' } } }));
  assert.equal(nullable.version, '12'); assert.deepEqual(nullable.content, { type: 'TEXT', text: null });
  assert.equal(nullable.author.nickname, '사용자'); assert.deepEqual(nullable.author.avatar, { assetId: 'avatar' });
  assert.equal(projectMessageDto(model({ content: { type: 'TEXT', text: '' } })).content.text, '');
});

test('anonymous projection drops identity and allowlists fields at every nested level without enumerating extras', () => {
  const poison = { get secret() { throw new Error('extra field was inspected'); } };
  const input = model({ audience: 'SHARED', userId: 'private-user', objectKey: 'private-key',
    author: Object.assign(Object.create(poison), { kind: 'anonymous', actorId: 'private-actor', nickname: 'private-name', avatar: { assetId: 'private-avatar' } }),
    content: { type: 'TEXT', text: '공개 본문', assetIds: ['private-asset'], rawRow: 'private-row' },
    quote: { id: 'visible-quote', content: { type: 'TEXT', text: '열람 가능 인용', objectKey: 'private-key' }, sourceUserId: 'private-user' },
  });
  Object.defineProperty(input, 'unusedSecret', { enumerable: true, get() { throw new Error('extra field was inspected'); } });
  const result = projectMessageDto(input);
  assert.deepEqual(result.author, { kind: 'anonymous' });
  assert.deepEqual(result.content, { type: 'TEXT', text: '공개 본문' });
  assert.deepEqual(result.quote, { id: 'visible-quote', content: { type: 'TEXT', text: '열람 가능 인용' } });
  assert.deepEqual(Object.keys(result), ['id', 'version', 'createdAt', 'audience', 'author', 'content', 'quote']);
  assert.equal(JSON.stringify(result).includes('private-'), false);
});

test('all media kinds deep-map authorized attachments in input order, stripping keys and preserving empty arrays', () => {
  for (const type of ['PHOTO', 'VIDEO', 'STICKER']) {
    const input = model({ author: { kind: 'member', actorId: 'actor', nickname: '이름', avatar: { assetId: 'avatar', signedUrl: 'private-url' }, userId: 'private-user' },
      content: { type, text: 'private-text', attachments: [
        { assetId: 'z-first', width: 1920, height: 1080, variant: 'video', objectKey: 'private-key', ownerUserId: 'private-user' },
        { assetId: 'a-second', width: 640, height: 360, variant: 'poster', signedUrl: 'private-url' },
      ] },
    });
    const result = projectMessageDto(input);
    assert.deepEqual(result.content, { type, attachments: [
      { assetId: 'z-first', width: 1920, height: 1080, variant: 'video' },
      { assetId: 'a-second', width: 640, height: 360, variant: 'poster' },
    ] });
    assert.deepEqual(result.author, { kind: 'member', actorId: 'actor', nickname: '이름', avatar: { assetId: 'avatar' } });
    assert.equal(JSON.stringify(result).includes('private-'), false);
    assert.deepEqual(projectMessageDto(model({ content: { type, attachments: [] } })).content, { type, attachments: [] });
  }
});

test('projection has no mutable object or array aliases back to its read model', () => {
  const input = model({ author: { kind: 'member', actorId: 'actor', nickname: '이름', avatar: { assetId: 'avatar' } },
    content: { type: 'PHOTO', attachments: [{ assetId: 'photo', width: 1, height: 2, variant: 'image' }] },
    quote: { id: 'quote', content: { type: 'TEXT', text: '원래 인용' } },
  });
  const result = projectMessageDto(input);
  result.author.avatar.assetId = 'changed'; result.content.attachments[0].width = 99;
  result.content.attachments.push({ assetId: 'new', width: 1, height: 1, variant: 'image' }); result.quote.content.text = 'changed';
  assert.equal(input.author.avatar.assetId, 'avatar'); assert.equal(input.content.attachments[0].width, 1);
  assert.equal(input.content.attachments.length, 1); assert.equal(input.quote.content.text, '원래 인용');
  assert.equal(input.createdAt.toISOString(), '2026-01-01T01:02:03.004Z');
});

test('unsupported internal discriminants cannot silently create new response shapes', () => {
  assert.throws(() => projectMessageDto(model({ author: { kind: 'admin', userId: 'private-user' } })), /invalid_message_read_model/);
  assert.throws(() => projectMessageDto(model({ content: { type: 'RAW', objectKey: 'private-key' } })), /invalid_message_read_model/);
});

test('message projection AST has no imports, reexports or runtime module loading dependencies', async () => {
  const source = await readFile(new URL('../../src/modules/messages/message-projection.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('message-projection.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const forbidden = [];
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
      (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')))) forbidden.push(node.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.deepEqual(forbidden, []);
});
