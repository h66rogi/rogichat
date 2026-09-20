import assert from 'node:assert/strict';
import test from 'node:test';

import { PushScopeChanged } from './errors';
import { PushScope, adoptScope, sameIdentity } from './scope';

const identity = { account: 'account-one', session: 'session-one' };

void test('a completion that arrives after the session ended is discarded', async () => {
  const scope = new PushScope(identity);
  let released = (): void => {};
  const pending = scope.run(async () => {
    await new Promise<void>(resolve => { released = resolve; });
    return 'late result';
  });
  scope.end();
  released();
  await assert.rejects(pending, (error: unknown) => error instanceof PushScopeChanged);
});

void test('the scope signal aborts work in flight', async () => {
  const scope = new PushScope(identity);
  const seen: AbortSignal[] = [];
  const pending = scope.run(signal => {
    seen.push(signal);
    return new Promise<never>((_resolve, reject) => { signal.addEventListener('abort', () => { reject(new Error('aborted')); }); });
  });
  assert.equal(seen[0]?.aborted, false);
  scope.end();
  await assert.rejects(pending, (error: unknown) => error instanceof PushScopeChanged);
  assert.equal(seen[0]?.aborted, true);
});

void test('a failure inside a live scope keeps its own error', async () => {
  const scope = new PushScope(identity);
  await assert.rejects(scope.run(async () => { throw new RangeError('real failure'); }), RangeError);
  assert.ok(scope.active);
});

void test('work refuses to start once the scope has ended', async () => {
  const scope = new PushScope(identity);
  scope.end();
  let started = false;
  await assert.rejects(scope.run(async () => { started = true; }), (error: unknown) => error instanceof PushScopeChanged);
  assert.equal(started, false);
});

void test('a changed account or session replaces the scope and ends the previous one', () => {
  const first = new PushScope(identity);
  assert.equal(adoptScope(first, identity), first, 'an unchanged identity keeps its scope');

  const rotated = adoptScope(first, { account: identity.account, session: 'session-two' });
  assert.notEqual(rotated, first);
  assert.equal(first.active, false, 'the previous session is fenced');

  const switched = adoptScope(rotated, { account: 'account-two', session: 'session-three' });
  assert.notEqual(switched, rotated);
  assert.equal(rotated.active, false);
  assert.ok(switched.active);

  assert.ok(sameIdentity(identity, { ...identity }));
  assert.equal(sameIdentity(identity, { account: 'account-two', session: identity.session }), false);
});

void test('an ended scope is never adopted again', () => {
  const scope = new PushScope(identity);
  scope.end();
  assert.notEqual(adoptScope(scope, identity), scope);
});
