import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../../dist/infrastructure/database/database.module.js';
import { RestoreGateModule } from '../../dist/modules/restore-gate/restore-gate.module.js';
import { RestoreGateService, restoreSchemaSha256 } from '../../dist/modules/restore-gate/restore-gate.service.js';
import { RestoreProofVerifier } from '../../dist/modules/restore-gate/restore-proof.js';
import { deletionFixture } from '../support/deletion-fixture.mjs';

test('operator graph resolves actual exported domain ports without API routes or background replay', async t => {
  const noRuntimeIo = () => assert.fail('boot must not start DB work or ledger replay');
  const database = { check: noRuntimeIo, close: async () => {}, transactions: { read: noRuntimeIo, write: noRuntimeIo } };
  const key = () => generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  const { ledger } = deletionFixture();
  const options = { scope: { environment: 'qa', sourceCommit: 'a'.repeat(40), schemaSha256: restoreSchemaSha256(),
    restoreRunId: randomUUID(), snapshotSha256: 'b'.repeat(64), targetId: randomUUID(), ledgerSourceId: ledger.sourceId },
    auth: { audience: 'rogi-test', key: randomBytes(32), authorizationEpoch: randomUUID() },
    verifier: new RestoreProofVerifier(key(), key()), isolation: { assertHeld: noRuntimeIo }, ledger: { ledger }, media: { store: null } };
  const graph = RestoreGateModule.register(DatabaseModule.register({ database }), options);
  assert.equal(graph.controllers, undefined); assert.deepEqual(graph.exports, [RestoreGateService]);
  const app = await NestFactory.createApplicationContext(graph, { logger: false, abortOnError: false }); t.after(() => app.close());
  assert.ok(app.get(RestoreGateService) instanceof RestoreGateService);
  await assert.rejects(NestFactory.createApplicationContext(RestoreGateModule.register(DatabaseModule.register({ database }), {
    ...options, scope: { ...options.scope, schemaSha256: '0'.repeat(64) },
  }), { logger: false, abortOnError: false }), /restore_gate_rejected/);
});
