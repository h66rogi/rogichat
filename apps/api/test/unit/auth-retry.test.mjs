import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { AuthFlow } from '../../dist/modules/auth/auth-flow.service.js';
import { Transactions } from '../../dist/infrastructure/database/transactions.js';
import { secret } from '../../dist/modules/auth/auth-primitives.js';

for (const rollbackFails of [false, true]) {
  test(`AuthFlow unique race retries only with confirmed rollback (${!rollbackFails}) and never re-exchanges broker code`, async () => {
    const context = new AsyncLocalStorage(); let claim, resolves = 0, exchanges = 0;
    const transactions = new Transactions({ $transaction: async callback => {
      const state = context.getStore();
      try { const result = await callback({}); state.commitStarted = true; return result; }
      catch (error) { if (!rollbackFails) state.rollbackConfirmed = true; throw error; }
    } }, context);
    const config = { key: randomBytes(32), audience: 'test', broker: { clientId: 'fixture' } };
    const repository = {
      insert: async (_tx, data) => { claim = { ...data, browser_digest: data.browserDigest }; },
      pending: async () => claim, claim: async () => {}, processing: async () => claim,
      finish: async () => {}, fail: async () => {},
    };
    const flow = new AuthFlow({ issue: async () => ({ token: 'issued', csrf: 'csrf' }) }, transactions, config, {
      request: async () => 'https://broker.example',
      exchange: async () => { exchanges++; return { schemaVersion: 1, provider: 'soop', transactionId: claim.id, clientId: 'fixture', authenticatedAt: new Date().toISOString() }; },
    }, repository, { resolve: async () => { if (++resolves === 1) throw Object.assign(new Error('unique'), { code: 'P2002' }); return 'user'; } });
    const browser = secret(); const { state } = await flow.start('login', browser);
    if (rollbackFails) await assert.rejects(flow.callback(state, secret(), browser), { code: 'AUTH_FAILED' });
    else assert.equal((await flow.callback(state, secret(), browser)).token, 'issued');
    assert.equal(resolves, rollbackFails ? 1 : 2); assert.equal(exchanges, 1);
  });
}
