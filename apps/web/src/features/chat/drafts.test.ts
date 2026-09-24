/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises the runner awaits itself */
import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';

import { clearDraft, draftKeyFor, isAuthorizedTarget, isSameTarget, readDraft, targetLabel, writeDraft } from './drafts';
import { formatDateLabel, truncateExcerpt } from './formatters';
import type { ChatActorRef, ChatComposerTarget } from './types';

// Runs with the built-in runner (Node 24 strips types; the hook resolves extensionless imports):
//   node --import ./src/features/chat/testing/register-ts.mjs --test src/features/chat/drafts.test.ts
// Covers the authorization and draft-scoping rules only; no rendering or styling.

const streamer: ChatActorRef = { actorId: 'actor-streamer', displayName: '스트리머', avatarUrl: null, role: 'STREAMER' };
const fanA: ChatActorRef = { actorId: 'actor-fan-a', displayName: '팬 A', avatarUrl: null, role: 'FAN' };
const fanB: ChatActorRef = { actorId: 'actor-fan-b', displayName: '팬 B', avatarUrl: null, role: 'FAN' };

const shared: ChatComposerTarget = { scope: 'SHARED' };
const toStreamer: ChatComposerTarget = { scope: 'PRIVATE', recipient: streamer };
const toFanA: ChatComposerTarget = { scope: 'PRIVATE', recipient: fanA };
const toFanB: ChatComposerTarget = { scope: 'PRIVATE', recipient: fanB };

describe('isAuthorizedTarget', () => {
  it('lets a fan write to the shared chat only', () => {
    const opts = { viewerRole: 'FAN' as const, fanRecipient: streamer, streamerRecipients: [] };
    assert.equal(isAuthorizedTarget(toStreamer, opts), false);
    assert.equal(isAuthorizedTarget(shared, opts), true);
    assert.equal(isAuthorizedTarget(toFanA, opts), false);
  });

  it('locks a fan when no recipient was provided', () => {
    const opts = { viewerRole: 'FAN' as const, fanRecipient: null, streamerRecipients: [] };
    assert.equal(isAuthorizedTarget(toStreamer, opts), false);
  });

  it('lets a streamer write SHARED or PRIVATE to an authorized fan', () => {
    const opts = { viewerRole: 'STREAMER' as const, fanRecipient: null, streamerRecipients: [fanA] };
    assert.equal(isAuthorizedTarget(shared, opts), true);
    assert.equal(isAuthorizedTarget(toFanA, opts), true);
    assert.equal(isAuthorizedTarget(toFanB, opts), false, 'a fan not in the authorized list is rejected');
  });

  it('rejects a recipient that was revoked after selection', () => {
    const before = { viewerRole: 'STREAMER' as const, fanRecipient: null, streamerRecipients: [fanA, fanB] };
    const after = { ...before, streamerRecipients: [fanA] };
    assert.equal(isAuthorizedTarget(toFanB, before), true);
    assert.equal(isAuthorizedTarget(toFanB, after), false);
  });
});

describe('scoped drafts', () => {
  it('keeps SHARED and each PRIVATE draft separate', () => {
    let drafts = writeDraft({}, shared, { body: '전체에게' });
    drafts = writeDraft(drafts, toFanA, { body: 'A에게' });
    drafts = writeDraft(drafts, toFanB, { body: 'B에게' });

    assert.equal(readDraft(drafts, shared).body, '전체에게');
    assert.equal(readDraft(drafts, toFanA).body, 'A에게');
    assert.equal(readDraft(drafts, toFanB).body, 'B에게');
  });

  it('clears only the submitted draft', () => {
    let drafts = writeDraft({}, shared, { body: '전체' });
    drafts = writeDraft(drafts, toFanA, { body: 'A', quote: { messageId: 'm1', authorName: '팬 A', excerpt: '인용' } });
    drafts = clearDraft(drafts, toFanA);

    assert.equal(readDraft(drafts, toFanA).body, '');
    assert.equal(readDraft(drafts, toFanA).quote, null);
    assert.equal(readDraft(drafts, shared).body, '전체');
  });

  it('derives stable keys and equality from the target', () => {
    assert.equal(draftKeyFor(shared), 'shared');
    assert.equal(draftKeyFor(toFanA), 'private:actor-fan-a');
    assert.equal(isSameTarget(toFanA, { scope: 'PRIVATE', recipient: { ...fanA, displayName: '이름 변경' } }), true);
    assert.equal(isSameTarget(toFanA, toFanB), false);
    assert.equal(isSameTarget(null, shared), false);
  });

  it('always names the target', () => {
    assert.equal(targetLabel(null), '보낼 대상 없음');
    assert.equal(targetLabel(shared), '전체 참여자');
    assert.equal(targetLabel(toStreamer), '스트리머님에게만');
  });
});

describe('formatters', () => {
  it('labels today and yesterday relative to the given now', () => {
    // Chat dates use Korea time on both the server and the browser.
    const now = new Date('2026-09-20T06:00:00.000Z');
    assert.equal(formatDateLabel(new Date('2026-09-19T16:00:00.000Z'), now), '오늘');
    assert.equal(formatDateLabel(new Date('2026-09-19T14:59:00.000Z'), now), '어제');
    assert.notEqual(formatDateLabel(new Date('2026-09-17T15:00:00.000Z'), now), '어제');
  });

  it('collapses line breaks and truncates excerpts', () => {
    assert.equal(truncateExcerpt('첫 줄\n\n둘째 줄'), '첫 줄 둘째 줄');
    assert.equal(truncateExcerpt('가'.repeat(70)).length, 61);
  });
});


void test('fan writes shared regardless of legacy private-recipient records', () => {
  const second = { ...streamer, actorId: 'second-streamer' };
  const options = { viewerRole: 'FAN' as const, fanRecipient: null, fanRecipients: [streamer, second], streamerRecipients: [] };
  assert.equal(isAuthorizedTarget({ scope: 'PRIVATE', recipient: second }, options), false);
  assert.equal(isAuthorizedTarget({ scope: 'PRIVATE', recipient: fanA }, options), false);
  assert.equal(isAuthorizedTarget({ scope: 'SHARED' }, options), true);
});

test('room-owner drafts remain distinct for legacy recovery but are unavailable to the new composer', () => {
  const target: ChatComposerTarget = { scope: 'ROOM_OWNER' };
  const opts = { viewerRole: 'FAN' as const, fanRecipient: null, streamerRecipients: [], fanRoomOwner: true };
  assert.equal(isAuthorizedTarget(target, opts), false);
  assert.equal(isAuthorizedTarget(target, { ...opts, viewerRole: 'STREAMER' }), false);
  assert.equal(isAuthorizedTarget(shared, opts), true);
  assert.equal(isAuthorizedTarget(toFanA, opts), false);
  assert.equal(draftKeyFor(target), 'room-owner');
  assert.notEqual(draftKeyFor(target), draftKeyFor(toStreamer));
  assert.equal(targetLabel(target), '방장에게만');
});
