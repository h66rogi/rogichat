import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppleLifecycleService } from '../../dist/modules/auth/apple/apple-lifecycle.service.js';
import { AppleRepository } from '../../dist/modules/auth/apple/apple.repository.js';

test('restore ports retain the caller transaction, reject invalid cursors and distinguish quarantine from revocation without config or I/O', async () => {
  const tx = { writable: true }; let pages = 0;
  const input = { phase: 'credentials', afterId: randomUUID(), limit: 10 };
  const port = new AppleLifecycleService(undefined, undefined, undefined, undefined, undefined, {
    async page(actual, value) { assert.equal(actual, tx); assert.equal(value, input); pages++; return { phase: value.phase, lastId: value.afterId, hasMore: false, processed: 0, pendingRevocations: 0 }; },
    async readiness(actual) { assert.equal(actual, tx); return { quarantined: true, identitiesPending: false, transactionsPending: false, credentialsPending: false, upstreamRevocationPending: true }; },
  });
  assert.equal((await port.quarantineRestored(tx, input)).providerConfigured, false);
  assert.deepEqual(await port.restoredQuarantineReadiness(tx), { quarantined: true, identitiesPending: false, transactionsPending: false, credentialsPending: false, upstreamRevocationPending: true, providerConfigured: false });
  for (const changed of [{ phase: 'users' }, { limit: 0 }, { limit: 101 }, { limit: 1.1 }, { afterId: 'arbitrary SQL' }, { afterId: undefined }]) {
    await assert.rejects(port.quarantineRestored(tx, { ...input, ...changed }), /invalid_apple_restore_page/);
  }
  await assert.rejects(port.quarantineRestored({ writable: false }, input), /invalid_apple_restore_page/);
  await assert.rejects(port.restoredQuarantineReadiness({ writable: false }), /current_fence/);
  assert.equal(pages, 1);
});

test('a late external exchange response preserves a quarantined family as revocation-only', async () => {
  const repository = new AppleRepository(); const id = randomUUID(), token = new Uint8Array([1, 2, 3]);
  for (const status of ['EXCHANGE_PENDING', 'EXCHANGE_UNKNOWN', 'REVOKE_PENDING', 'REVOKING', 'REVOKED']) {
    let update;
    const tx = {
      async rows(sql, params) { assert.match(sql, /FOR UPDATE$/); assert.deepEqual(params, [id]); return [{ id, status }]; },
      prisma: { apple_provider_credentials: { async update(value) { update = value; } } },
    };
    await repository.saveCredential(tx, { id, transactionId: id, audience: 'test', token, expires: new Date() });
    assert.equal(update.data.token, token);
    assert.equal(update.data.status, status === 'EXCHANGE_PENDING' ? 'PENDING' : 'REVOKE_PENDING');
    assert.equal(update.data.lease_token, null);
  }
});
