import { createHash, createPublicKey, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { deletionIntentKey } from '../deletion/deletion-ledger.js';
import type { LedgerEnvironment } from '../deletion/deletion-ledger.js';

export interface RestoreScope {
  environment: LedgerEnvironment;
  sourceCommit: string;
  schemaSha256: string;
  restoreRunId: string;
  snapshotSha256: string;
  targetId: string;
  ledgerSourceId: string;
}
export interface BoundaryPayload extends RestoreScope {
  version: 1;
  purpose: 'restore-ledger-boundary';
  issuedAt: number;
  expiresAt: number;
  ledgerBoundaryId: string;
  admissionFenceId: string;
  pendingAdmissionsResolved: true;
  inventory: { key: string; sha256: string }[];
}
export interface ReleasePayload extends RestoreScope {
  version: 1;
  purpose: 'restore-release';
  issuedAt: number;
  expiresAt: number;
  boundarySha256: string;
  observationSha256: string;
  nonce: string;
}
export interface VerifiedProof<T> { payload: T; sha256: string; issuer: string }
export const restoreRejected = (): never => { throw new Error('restore_gate_rejected'); };
export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_./:-]{1,256}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = ['environment', 'sourceCommit', 'schemaSha256', 'restoreRunId', 'snapshotSha256', 'targetId', 'ledgerSourceId'] as const;
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  return restoreRejected();
}
export function checkedScope(value: unknown): RestoreScope {
  if (!exact(value, fields) || !['qa', 'production'].includes(String(value.environment)) ||
      typeof value.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.sourceCommit) ||
      !hash(value.schemaSha256) || !hash(value.snapshotSha256) || !hash(value.ledgerSourceId) ||
      !identifier(value.restoreRunId) || !identifier(value.targetId)) return restoreRejected();
  return value as unknown as RestoreScope;
}
function base64(value: unknown, limit: number): Buffer {
  if (typeof value !== 'string' || value.length > limit * 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return restoreRejected();
  const result = Buffer.from(value, 'base64');
  if (!result.length || result.length > limit || result.toString('base64') !== value) return restoreRejected();
  return result;
}

// Trust comes from independently provisioned issuer keys, never the supplied proof.
// A signature authenticates the issuer's assertion; it is not global ledger discovery.
export class RestoreProofVerifier {
  private readonly boundaryKey: KeyObject;
  private readonly releaseKey: KeyObject;
  constructor(boundaryPublicKey: Buffer, releasePublicKey: Buffer) {
    this.boundaryKey = createPublicKey(boundaryPublicKey); this.releaseKey = createPublicKey(releasePublicKey);
    if ([this.boundaryKey, this.releaseKey].some(key => key.asymmetricKeyType !== 'ed25519') ||
        this.fingerprint(this.boundaryKey) === this.fingerprint(this.releaseKey)) restoreRejected();
  }
  private fingerprint(key: KeyObject): string { return sha256(key.export({ type: 'spki', format: 'der' })); }
  private check(envelope: unknown, expected: RestoreScope, purpose: string, now: number) {
    checkedScope(expected);
    if (!exact(envelope, ['payloadBase64', 'signatureBase64', 'keyId'])) return restoreRejected();
    const key = purpose === 'restore-ledger-boundary' ? this.boundaryKey : this.releaseKey;
    if (envelope.keyId !== this.fingerprint(key)) return restoreRejected();
    const bytes = base64(envelope.payloadBase64, 1024 * 1024), signature = base64(envelope.signatureBase64, 64);
    if (signature.length !== 64 || !verify(null, bytes, key, signature)) return restoreRejected();
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { return restoreRejected(); }
    if (!object(payload) || canonical(payload) !== bytes.toString('utf8') || fields.some(field => payload[field] !== expected[field]) ||
        payload.version !== 1 || payload.purpose !== purpose || !Number.isSafeInteger(now) ||
        typeof payload.issuedAt !== 'number' || typeof payload.expiresAt !== 'number' ||
        !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) ||
        payload.issuedAt > now || payload.expiresAt <= now || payload.expiresAt <= payload.issuedAt ||
        payload.expiresAt - payload.issuedAt > (purpose === 'restore-release' ? 300 : 3600)) return restoreRejected();
    return { payload, sha256: sha256(bytes), issuer: this.fingerprint(key) };
  }
  isolation(envelope: unknown, scope: RestoreScope, boundary: VerifiedProof<BoundaryPayload>, challenge: string, now: number) {
    if (!exact(envelope, ['payloadBase64', 'signatureBase64', 'keyId']) || envelope.keyId !== this.fingerprint(this.boundaryKey)) return restoreRejected();
    const bytes = base64(envelope.payloadBase64, 8192), signature = base64(envelope.signatureBase64, 64);
    if (signature.length !== 64 || !verify(null, bytes, this.boundaryKey, signature)) return restoreRejected();
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { return restoreRejected(); }
    if (!exact(payload, ['version', 'purpose', 'challenge', 'scopeSha256', 'boundarySha256', 'admissionFenceId', 'authorizationEpoch', 'authorizationKeySha256', 'storageScopeSha256', 'storageFenceId', 'mysqlLeaseName', 'mysqlLeaseOwner', 'mysqlServerUuid', 'issuedAt', 'expiresAt']) ||
        canonical(payload) !== bytes.toString('utf8') || payload.version !== 1 || payload.purpose !== 'restore-isolation-held' ||
        payload.challenge !== challenge || payload.scopeSha256 !== sha256(canonical(scope)) || payload.boundarySha256 !== boundary.sha256 ||
        payload.admissionFenceId !== boundary.payload.admissionFenceId || payload.mysqlLeaseName !== 'restore:' + sha256(canonical(scope)).slice(0, 48) ||
        typeof payload.mysqlLeaseOwner !== 'number' || !Number.isSafeInteger(payload.mysqlLeaseOwner) || payload.mysqlLeaseOwner < 1 ||
        typeof payload.mysqlServerUuid !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.mysqlServerUuid) || !hash(payload.authorizationKeySha256) || !hash(payload.storageScopeSha256) || !hash(payload.storageFenceId) || typeof payload.authorizationEpoch !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.authorizationEpoch) ||
        typeof payload.issuedAt !== 'number' || typeof payload.expiresAt !== 'number' || !Number.isSafeInteger(now) ||
        !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) ||
        payload.issuedAt > now || payload.expiresAt <= now || payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > 5) return restoreRejected();
    return { authorizationEpoch: payload.authorizationEpoch, authorizationKeySha256: payload.authorizationKeySha256, storageScopeSha256: payload.storageScopeSha256, storageFenceId: payload.storageFenceId, mysqlLeaseName: payload.mysqlLeaseName, mysqlLeaseOwner: payload.mysqlLeaseOwner, mysqlServerUuid: payload.mysqlServerUuid, expiresAt: payload.expiresAt };
  }
  boundary(envelope: unknown, expected: RestoreScope, now: number): VerifiedProof<BoundaryPayload> {
    const proof = this.check(envelope, expected, 'restore-ledger-boundary', now), payload = proof.payload;
    if (!exact(payload, [...fields, 'version', 'purpose', 'issuedAt', 'expiresAt', 'ledgerBoundaryId', 'admissionFenceId', 'pendingAdmissionsResolved', 'inventory']) ||
        !identifier(payload.ledgerBoundaryId) || !identifier(payload.admissionFenceId) || payload.pendingAdmissionsResolved !== true ||
        !Array.isArray(payload.inventory) || payload.inventory.length > 10000) return restoreRejected();
    let previous = '';
    for (const row of payload.inventory) {
      if (!exact(row, ['key', 'sha256']) || typeof row.key !== 'string' || row.key <= previous || !hash(row.sha256) ||
          row.key !== deletionIntentKey(expected.environment, row.key.split('/')[1] ?? '')) return restoreRejected();
      previous = row.key;
    }
    return { ...proof, payload: payload as unknown as BoundaryPayload };
  }
  release(envelope: unknown, expected: RestoreScope, now: number): VerifiedProof<ReleasePayload> {
    const proof = this.check(envelope, expected, 'restore-release', now), payload = proof.payload;
    if (!exact(payload, [...fields, 'version', 'purpose', 'issuedAt', 'expiresAt', 'boundarySha256', 'observationSha256', 'nonce']) ||
        !hash(payload.boundarySha256) || !hash(payload.observationSha256) || typeof payload.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(payload.nonce)) return restoreRejected();
    return { ...proof, payload: payload as unknown as ReleasePayload };
  }
}
