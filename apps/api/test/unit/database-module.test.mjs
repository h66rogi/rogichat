import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../../dist/infrastructure/database/database.module.js';
import { DATABASE } from '../../dist/infrastructure/database/database.tokens.js';
import { Transactions } from '../../dist/transactions.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';

test('database module shares explicit UnitOfWork and owns connection shutdown through Nest lifecycle', async () => {
  let closed = 0;
  const tx = Object.create(Transactions.prototype);
  const database = { transactions: tx, check: async () => ({ ready: true, reason: 'ready' }), close: async () => { closed++; } };
  const dependencies = DatabaseModule.register({ database });
  class Left {} class Right {} class Root {}
  Module({ imports: [dependencies] })(Left); Module({ imports: [dependencies] })(Right); Module({ imports: [Left, Right] })(Root);
  const app = await NestFactory.createApplicationContext(Root, { logger: false, abortOnError: false });
  assert.equal(app.get(DATABASE), database); assert.equal(app.get(Transactions), tx);
  const lifecycle = app.get(LifecycleState); assert.equal(lifecycle.draining, false);
  await app.close(); assert.equal(closed, 1); assert.equal(lifecycle.draining, true);
});

test('health-only fixtures do not require a transaction provider or real database configuration', async () => {
  let closed = 0;
  const database = { check: async () => ({ ready: true, reason: 'ready' }), close: async () => { closed++; } };
  const app = await NestFactory.createApplicationContext(DatabaseModule.register({ database, externallyOwned: true }), { logger: false, abortOnError: false });
  assert.equal(app.get(DATABASE), database); assert.throws(() => app.get(Transactions));
  await app.close(); assert.equal(closed, 0);
  assert.throws(() => DatabaseModule.register({}));
  assert.throws(() => DatabaseModule.register({ config: {}, database }));
  assert.throws(() => DatabaseModule.register({ config: {}, externallyOwned: true }));
  assert.throws(() => DatabaseModule.register({ config: {}, transactions: Object.create(Transactions.prototype) }));
  assert.throws(() => DatabaseModule.register({ database: { ...database, transactions: Object.create(Transactions.prototype) }, transactions: Object.create(Transactions.prototype) }));
});
