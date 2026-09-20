#!/usr/bin/env node
/** Offline Ed25519 restore proof checks. This command never opens serving. */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const fail = () => { throw new Error('restore_proof_rejected'); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && /^[A-Za-z0-9_./:-]{1,256}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const ledgerKey = (key, environment) => typeof key === 'string' && new RegExp(`^${environment}/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/intent\\.json$`).test(key);
const scope = ['environment', 'sourceCommit', 'schemaSha256', 'restoreRunId', 'snapshotSha256', 'targetId', 'ledgerSourceId'];
const common = ['version', 'purpose', ...scope, 'issuedAt', 'expiresAt'];

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function base64(value, max) {
  if (typeof value !== 'string' || value.length > max * 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail();
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > max || bytes.toString('base64') !== value) fail();
  return bytes;
}

/** expected scope comes from the isolated target/operator, not from the envelope. */
export function checkProof(envelope, trustedPublicKey, expected, now = Math.floor(Date.now() / 1000)) {
  if (!exact(envelope, ['payloadBase64', 'signatureBase64', 'keyId']) || !sha(envelope.keyId)) fail();
  const key = createPublicKey(trustedPublicKey);
  if (key.asymmetricKeyType !== 'ed25519') fail();
  if (hash(key.export({ type: 'spki', format: 'der' })) !== envelope.keyId) fail();
  const bytes = base64(envelope.payloadBase64, 1024 * 1024);
  const signature = base64(envelope.signatureBase64, 64);
  if (signature.length !== 64 || !verify(null, bytes, key, signature)) fail();
  let payload;
  try { payload = JSON.parse(new globalThis.TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(); }
  // Requiring canonical bytes rejects duplicate keys and ambiguous JSON encodings.
  if (Buffer.from(canonical(payload)).compare(bytes) !== 0) fail();
  if (!exact(expected, ['purpose', ...scope]) || !scope.every(field => payload[field] === expected[field]) || payload.purpose !== expected.purpose) fail();
  if (payload.version !== 1 || !['qa', 'production'].includes(payload.environment)
      || !/^[a-f0-9]{40}$/.test(payload.sourceCommit)
      || !['schemaSha256', 'snapshotSha256', 'ledgerSourceId'].every(field => sha(payload[field]))
      || !['restoreRunId', 'targetId'].every(field => text(payload[field]))
      || !Number.isSafeInteger(now) || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)
      || payload.issuedAt > now || payload.expiresAt <= now || payload.expiresAt <= payload.issuedAt
      || payload.expiresAt - payload.issuedAt > 3600) fail();
  if (payload.purpose === 'restore-ledger-boundary') {
    if (!exact(payload, [...common, 'ledgerBoundaryId', 'admissionFenceId', 'pendingAdmissionsResolved', 'inventory'])
        || !text(payload.ledgerBoundaryId) || !text(payload.admissionFenceId) || payload.pendingAdmissionsResolved !== true
        || !Array.isArray(payload.inventory) || payload.inventory.length > 10000) fail();
    let previous = '';
    for (const record of payload.inventory) {
      if (!exact(record, ['key', 'sha256']) || !ledgerKey(record.key, payload.environment) || record.key <= previous || !sha(record.sha256)) fail();
      previous = record.key;
    }
  } else if (payload.purpose === 'restore-release') {
    if (!exact(payload, [...common, 'boundarySha256', 'observationSha256', 'nonce'])
        || !sha(payload.boundarySha256) || !sha(payload.observationSha256)
        || !/^[a-f0-9]{32}$/.test(payload.nonce) || payload.expiresAt - payload.issuedAt > 300) fail();
  } else fail();
  return { payload, payloadSha256: hash(bytes), keyId: envelope.keyId };
}

/** Check separate authority/verifier custody and current independently read state.
 * This still does not consume the nonce; only the backend release CAS may do so.
 */
export function checkReleasePair(boundaryEnvelope, releaseEnvelope, authorityKey, verifierKey,
                                 expectedScope, currentObservationSha256, now = Math.floor(Date.now() / 1000)) {
  if (!exact(expectedScope, scope) || !sha(currentObservationSha256)) fail();
  const boundary = checkProof(boundaryEnvelope, authorityKey,
    { ...expectedScope, purpose: 'restore-ledger-boundary' }, now);
  const release = checkProof(releaseEnvelope, verifierKey,
    { ...expectedScope, purpose: 'restore-release' }, now);
  if (boundary.keyId === release.keyId || release.payload.boundarySha256 !== boundary.payloadSha256
      || release.payload.observationSha256 !== currentObservationSha256) fail();
  return { boundary, release };
}

function main() {
  const [verb, proofFile, publicKeyFile, expectedFile, ...extra] = process.argv.slice(2);
  if (verb !== 'verify' || !proofFile || !publicKeyFile || !expectedFile || extra.length) fail();
  const boundedRead = path => { const data = readFileSync(path); if (data.length > 3 * 1024 * 1024) fail(); return data; };
  const result = checkProof(JSON.parse(boundedRead(proofFile)), boundedRead(publicKeyFile), JSON.parse(boundedRead(expectedFile)));
  console.log(JSON.stringify({ verified: true, purpose: result.payload.purpose,
    payloadSha256: result.payloadSha256, keyId: result.keyId, servingAuthorized: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { console.error('restore_proof_rejected'); process.exitCode = 1; }
}
