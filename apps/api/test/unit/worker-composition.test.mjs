import { PurgeWorkerService } from '../../dist/modules/deletion/purge-worker.service.js';
import { PurgeWorkerModule } from '../../dist/modules/deletion/purge-worker.module.js';
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerModule } from '../../dist/worker.module.js';
import { WorkerLoop } from '../../dist/modules/jobs/worker-loop.js';
import { Jobs } from '../../dist/modules/jobs/jobs.service.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { Transactions } from '../../dist/infrastructure/database/transactions.js';
import { DATABASE } from '../../dist/infrastructure/database/database.tokens.js';
import { PublicationsCoreService } from '../../dist/modules/publications/publications-core.service.js';
import { MediaWorkerService } from '../../dist/modules/media/media-worker.service.js';
import { MediaCopyService } from '../../dist/modules/media/media-copy.service.js';
import { PushDeliveryService } from '../../dist/modules/notifications/push-delivery.service.js';
import { NotificationFanoutService } from '../../dist/modules/notifications/notification-fanout.service.js';

for (const mediaEnabled of [false, true]) for (const deletionEnabled of [false, true]) {
  test(`production worker wiring preserves publication/media and both PUSH modes: media=${mediaEnabled}, deletion=${deletionEnabled}`, async () => {
    // Invoke the actual Nest provider factory, but never instantiate production
    // infrastructure or contact a provider. These doubles exist only in tests.
    const settings = { config: { environment: 'test' }, ...(deletionEnabled ? { deletion: { ledger: {} } } : {}),
      ...(mediaEnabled ? { media: { config: {}, scratch: '/synthetic', decoderSocket: '/synthetic/decoder.sock' } } : {}) };
    const module = WorkerModule.production(settings);
    const provider = module.providers.find(value => value.provide === WorkerLoop);
    const calls = [], claims = [];
    const queue = [...(deletionEnabled ? [{ purpose: 'PURGE', roomId: null }] : []), { purpose: 'PUBLICATION', roomId: 'room' },
      { purpose: 'PUSH', roomId: null }, { purpose: 'PUSH', roomId: 'room' },
      ...(mediaEnabled ? [{ purpose: 'MEDIA', roomId: null }] : [])];
    const transactions = {};
    const record = name => async () => { calls.push(name); return 'completed'; };
    const dependencies = new Map([
      [Jobs, { claim: async input => { claims.push(input); return queue.length ? [queue.shift()] : []; },
        retry: async () => { throw new Error('unexpected retry'); } }],
      [LifecycleState, { draining: false }], [Transactions, transactions],
      [DATABASE, { check: async () => ({ ready: true }) }],
      [PublicationsCoreService, { publishText: async tx => {
        assert.equal(tx, transactions); calls.push('text'); return 'completed';
      } }],
      [PushDeliveryService, { consume: record('delivery') }],
      [NotificationFanoutService, { consume: record('fanout') }],
      [MediaWorkerService, { processMedia: record('media') }],
      [PurgeWorkerService, { process: async () => { calls.push('purge'); return 'subset_drained'; } }],
      [MediaCopyService, { processPublication: record('copy') }],
    ]);
    assert.equal(new Set(provider.inject).size, provider.inject.length);
    for (const token of provider.inject) assert.ok(dependencies.has(token));
    assert.equal(provider.inject.includes(MediaCopyService), mediaEnabled);
    assert.equal(provider.inject.includes(MediaWorkerService), mediaEnabled);
    assert.equal(provider.inject.includes(PurgeWorkerService), deletionEnabled);
    assert.equal(module.imports.some(value => value.module === PurgeWorkerModule), deletionEnabled);
    const loop = provider.useFactory(...provider.inject.map(token => dependencies.get(token)));
    assert.deepEqual(loop.stats().installedPurposes, [...(deletionEnabled ? ['PURGE'] : []), ...(mediaEnabled ? ['MEDIA'] : []), 'PUBLICATION', 'PUSH']);
    const result = await loop.tick();
    assert.equal(result.completed, mediaEnabled ? 4 : 3);
    assert.equal(result.subsetDrained, deletionEnabled ? 1 : 0);
    assert.deepEqual(calls, [...(deletionEnabled ? ['purge'] : []), ...(mediaEnabled ? ['copy', 'fanout', 'delivery', 'media'] : ['text', 'fanout', 'delivery'])]);
    for (const input of claims) assert.equal(input.leaseMs, mediaEnabled ? 300000 : 30000);
    await loop.stop();
  });
}
