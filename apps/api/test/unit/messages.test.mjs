import { sendInput } from '../../dist/modules/messages/dto/send-message.dto.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const input = () => ({ membershipScope: 'A'.repeat(43), clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: '합성 메시지' } });
test('sticker sends require one catalog UUID, never caller-supplied assets or mixed content', () => {
  const body = input(), stickerId = randomUUID();
  assert.deepEqual(sendInput({ ...body, content: { type: 'STICKER', stickerId } }).content, { type: 'STICKER', stickerId });
  for (const content of [
    { type: 'STICKER', assetIds: [randomUUID()] }, { type: 'STICKER', stickerId: 'bad' },
    { type: 'STICKER', stickerId, assetIds: [] }, { type: 'STICKER', stickerId, text: '' },
    { type: 'STICKER', stickerId, objectKey: 'private' }, { type: 'TEXT', text: 'x', stickerId },
    { type: 'PHOTO', assetIds: [randomUUID()], stickerId }, { type: 'VIDEO', assetIds: [randomUUID()], stickerId },
  ]) assert.throws(() => sendInput({ ...body, content }), { code: 'INVALID_REQUEST' });
});
test('message input canonicalizes typed text, enforces code-point bounds, and rejects actor/audience injection', () => {
  const body = input();
  assert.deepEqual(sendInput(body), { ...body, recipientActorId: null, quoteId: null });
  assert.equal(sendInput({ ...body, content: { type: 'TEXT', text: 'e\u0301' } }).content.text, 'é');
  assert.equal([...sendInput({ ...body, content: { type: 'TEXT', text: '😀'.repeat(4000) } }).content.text].length, 4000);
  for (const bad of [null, [], {}, { ...body, senderId: randomUUID() }, { ...body, role: 'STREAMER' },
    { ...body, isPublic: true }, { ...body, clientMessageId: '1' }, { ...body, intent: 'AUTO' },
    { ...body, recipientActorId: randomUUID() }, { ...body, intent: 'PRIVATE' }, { ...body, quoteId: 'bad' },
    ...['', '  \n', '\u0000', '😀'.repeat(4001)].map(text => ({ ...body, content: { type: 'TEXT', text } })),
    { ...body, content: { type: 'HTML', text: 'x' } }, { ...body, content: { type: 'TEXT', text: 'x', url: 'https://invalid.test' } },
  ]) assert.throws(() => sendInput(bad), { code: 'INVALID_REQUEST' });
  const recipientActorId = randomUUID(); const quoteId = randomUUID();
  assert.deepEqual(sendInput({ ...body, intent: 'PRIVATE', recipientActorId, quoteId }), { ...body, intent: 'PRIVATE', recipientActorId, quoteId });
});
