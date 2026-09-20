import { reactionEmoji } from '../support/domain-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('reaction accepts exactly one Unicode emoji including flag/ZWJ/modifier sequences, or null removal', () => {
  assert.equal(reactionEmoji(null), null);
  for (const emoji of ['😀', '👍🏽', '🇰🇷', '👨‍👩‍👧‍👦', '❤️', '1️⃣', '🏳️‍🌈']) assert.equal(reactionEmoji(emoji), emoji);
  for (const value of [undefined, false, 1, [], {}, '', 'text', '😀😀', 'a😀', '😀 ', '😀\n', '1', '\u200d', '🇰', '😀'.repeat(33), '👨‍👩‍👧‍👦'.repeat(3)]) {
    assert.throws(() => reactionEmoji(value), { code: 'INVALID_REQUEST' });
  }
});
