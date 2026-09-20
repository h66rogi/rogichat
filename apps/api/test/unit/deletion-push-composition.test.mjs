import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { AppModule } from '../../dist/app.module.js';
import { WorkerModule } from '../../dist/worker.module.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { DeletionModule } from '../../dist/modules/deletion/deletion.module.js';
import { DeletionLedger } from '../../dist/modules/deletion/deletion-ledger.js';
import { DeletionReconciler } from '../../dist/modules/deletion/deletion-reconciler.js';
import { MessagesModule } from '../../dist/modules/messages/messages.module.js';
import { NotificationsModule } from '../../dist/modules/notifications/notifications.module.js';
import { PushModule, PushTransportModule } from '../../dist/modules/notifications/push-module.js';
import { PushTransport } from '../../dist/modules/notifications/push-transport.js';

const child = (module, token) => module.imports.find(entry => entry.module === token);
const provider = (module, token) => module.providers.find(entry => entry.provide === token);

test('API composition keeps explicit push and deletion options distinct', () => {
  const ledger = { synthetic: 'isolated graph only' };
  const push = { audience: 'push-composition-fixture', vapid: null };
  const config = { key: randomBytes(32), audience: 'auth-composition-fixture', origin: 'http://localhost:3001', secure: false };
  const module = AppModule.register({}, new LifecycleState(), { config }, undefined, push, { ledger });
  const deletion = child(child(module, MessagesModule), DeletionModule);
  assert.equal(provider(deletion, DeletionLedger).useValue, ledger);
  assert.equal(provider(deletion, DeletionReconciler), undefined);
  const transport = child(child(module, NotificationsModule), PushTransportModule);
  assert.equal(provider(transport, PushTransport).useFactory({}).config, push);
});

test('worker preserves independent deletion replay alongside push handlers', () => {
  const ledger = { synthetic: 'isolated graph only' };
  const push = { audience: 'worker-composition-fixture', vapid: null };
  const module = WorkerModule.production({ config: { environment: 'test' }, push, deletion: { ledger } });
  const deletion = child(module, DeletionModule);
  assert.equal(provider(deletion, DeletionLedger).useValue, ledger);
  assert.deepEqual(provider(deletion, DeletionReconciler).inject.map(token => token.name), ['DeletionLedger', 'DeletionApplyService']);
  const transport = child(child(module, PushModule), PushTransportModule);
  assert.equal(provider(transport, PushTransport).useFactory({}).config, push);
});
