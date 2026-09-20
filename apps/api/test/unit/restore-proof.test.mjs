import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { RestoreProofVerifier, canonical, sha256 } from '../../dist/modules/restore-gate/restore-proof.js';
const pair = () => generateKeyPairSync('ed25519');
function fixture() {
  const boundary = pair(), release = pair(), now = 1800000000;
  const pem = key => key.export({ type: 'spki', format: 'pem' });
  const verifier = new RestoreProofVerifier(pem(boundary.publicKey), pem(release.publicKey));
  const scope = { environment: 'qa', sourceCommit: 'a'.repeat(40), schemaSha256: 'b'.repeat(64),
    restoreRunId: randomUUID(), snapshotSha256: 'c'.repeat(64), targetId: randomUUID(), ledgerSourceId: 'd'.repeat(64) };
  const inventory = [{ key: `qa/${randomUUID()}/intent.json`, sha256: 'e'.repeat(64) }];
  const payload = { ...scope, version: 1, purpose: 'restore-ledger-boundary', issuedAt: now - 1, expiresAt: now + 60,
    ledgerBoundaryId: randomUUID(), admissionFenceId: randomUUID(), pendingAdmissionsResolved: true, inventory };
  const envelope = (body = payload, issuer = boundary, encoded = canonical(body)) => {
    const bytes = Buffer.from(encoded);
    return { payloadBase64: bytes.toString('base64'), signatureBase64: sign(null, bytes, issuer.privateKey).toString('base64'),
      keyId: sha256(issuer.publicKey.export({ type: 'spki', format: 'der' })) };
  };
  return { verifier, scope, payload, envelope, boundary, release, now, pem };
}
test('restore boundary and separate release issuer bind canonical bytes to independently supplied scope', () => {
  const f = fixture(), boundary = f.verifier.boundary(f.envelope(), f.scope, f.now);
  assert.equal(boundary.sha256, sha256(canonical(f.payload)));
  const release = { ...f.scope, version: 1, purpose: 'restore-release', issuedAt: f.now, expiresAt: f.now + 300,
    boundarySha256: boundary.sha256, observationSha256: 'f'.repeat(64), nonce: '0'.repeat(32) };
  assert.equal(f.verifier.release(f.envelope(release, f.release), f.scope, f.now).payload.nonce, release.nonce);
  assert.throws(() => f.verifier.release(f.envelope(release), f.scope, f.now));
  assert.throws(() => new RestoreProofVerifier(f.pem(f.boundary.publicKey), f.pem(f.boundary.publicKey)));
});
test('signed but expired, wrong-scope, duplicate, malformed or incomplete boundaries remain rejected', () => {
  const f = fixture();
  for (const mutation of [
    { expiresAt: f.now }, { issuedAt: f.now + 1 }, { expiresAt: f.now + 3601 }, { pendingAdmissionsResolved: false },
    { inventory: [...f.payload.inventory, ...f.payload.inventory] }, { inventory: [{ key: 'qa/not-a-receipt', sha256: 'e'.repeat(64) }] },
    { inventory: [{ ...f.payload.inventory[0], extra: true }] }, { unexpected: true }, { environment: 'production' },
    { snapshotSha256: 'f'.repeat(64) }, { sourceCommit: 'f'.repeat(40) },
  ]) assert.throws(() => f.verifier.boundary(f.envelope({ ...f.payload, ...mutation }), f.scope, f.now));
  const duplicate = canonical(f.payload).replace('"version":1', '"version":1,"version":1');
  assert.throws(() => f.verifier.boundary(f.envelope(f.payload, f.boundary, duplicate), f.scope, f.now));
  assert.throws(() => f.verifier.boundary(f.envelope(f.payload, f.boundary, JSON.stringify(f.payload, null, 2)), f.scope, f.now));
  const tampered = f.envelope(); tampered.payloadBase64 = Buffer.from(canonical({ ...f.payload, inventory: [] })).toString('base64');
  assert.throws(() => f.verifier.boundary(tampered, f.scope, f.now));
  assert.throws(() => f.verifier.boundary({ ...f.envelope(), trustedKey: f.pem(f.boundary.publicKey) }, f.scope, f.now));
  assert.throws(() => f.verifier.boundary(f.envelope(), { ...f.scope, unknown: true }, f.now));
});
test('empty inventory requires an explicit authoritative signature and release lifetime is at most five minutes', () => {
  const f = fixture();
  const boundary = f.verifier.boundary(f.envelope({ ...f.payload, inventory: [] }), f.scope, f.now);
  assert.equal(boundary.payload.inventory.length, 0);
  const release = { ...f.scope, version: 1, purpose: 'restore-release', issuedAt: f.now, expiresAt: f.now + 301,
    boundarySha256: boundary.sha256, observationSha256: 'f'.repeat(64), nonce: '0'.repeat(32) };
  assert.throws(() => f.verifier.release(f.envelope(release, f.release), f.scope, f.now));
});
test('custody responses authenticate fresh challenge, exact target lease and authorization epoch', () => {
  const f = fixture(), boundary = f.verifier.boundary(f.envelope(), f.scope, f.now), challenge = '1'.repeat(64);
  const payload = { version: 1, purpose: 'restore-isolation-held', challenge, scopeSha256: sha256(canonical(f.scope)),
    boundarySha256: boundary.sha256, admissionFenceId: f.payload.admissionFenceId, authorizationEpoch: randomUUID(),
    authorizationKeySha256: '2'.repeat(64), storageScopeSha256: '7'.repeat(64), storageFenceId: '8'.repeat(64), mysqlLeaseName: 'restore:' + sha256(canonical(f.scope)).slice(0, 48),
    mysqlLeaseOwner: 12, mysqlServerUuid: randomUUID(), issuedAt: f.now, expiresAt: f.now + 5 };
  const verify = value => f.verifier.isolation(value, f.scope, boundary, challenge, f.now);
  assert.equal(verify(f.envelope(payload)).authorizationEpoch, payload.authorizationEpoch);
  for (const mutation of [{ challenge: '3'.repeat(64) }, { scopeSha256: '4'.repeat(64) }, { boundarySha256: '5'.repeat(64) },
    { admissionFenceId: randomUUID() }, { mysqlLeaseName: 'other' }, { mysqlLeaseOwner: 0 }, { mysqlLeaseOwner: 1.5 },
    { storageScopeSha256: null }, { storageFenceId: 'X'.repeat(64) }, { authorizationEpoch: 'not-an-epoch' }, { authorizationKeySha256: '6'.repeat(63) }, { expiresAt: f.now }, { expiresAt: f.now + 6 },
    { issuedAt: f.now + 1 }, { extra: true }]) assert.throws(() => verify(f.envelope({ ...payload, ...mutation })));
  assert.throws(() => verify(f.envelope(payload, f.release)));
});
