import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateReplyDraft, privateReplyCommand, failedPrivateReply, reactionRefreshTargets } from '../../../../packages/contracts/interactions-client.mjs';
test('right-to-left only enters private composer; explicit send and target failures never widen audience', () => {
  const input = { direction: 'right-to-left', roomId: 'room', ownActorId: 'streamer', targetActorId: 'fan', quoteId: 'source' };
  const initial = privateReplyDraft(input);
  assert.equal(initial.text, ''); assert.equal(initial.intent, 'PRIVATE');
  assert.throws(() => privateReplyCommand(initial, 'client-key'));
  const draft = { ...initial, text: '답장 초안' };
  const command = privateReplyCommand(draft, 'same-key');
  for (const status of [403, 404, 503]) {
    const failed = failedPrivateReply(draft, status);
    assert.equal(failed.text, draft.text); assert.equal(failed.intent, 'PRIVATE');
    assert.deepEqual(privateReplyCommand(failed, 'same-key'), command);
  }
  assert.equal(privateReplyDraft({ ...input, targetActorId: null }), null); // Anonymous public copy.
  assert.equal(privateReplyDraft({ ...input, direction: 'left-to-right' }), null);
  assert.equal(privateReplyDraft({ ...input, targetActorId: input.ownActorId }), null);
  assert.deepEqual(reactionRefreshTargets([{ type: 'message.upsert', message: { id: 'a' } }, { type: 'message.upsert', message: { id: 'a' } }, { type: 'message.deleted', messageId: 'b' }]), ['a']);
});
