import { createHash } from 'node:crypto';

export type LedgerEnvironment = 'qa' | 'production';
export interface DeletionIntent {
  readonly schemaVersion: 1;
  readonly environment: LedgerEnvironment;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly scope: 'MESSAGE' | 'ACCOUNT';
  readonly targetId: string;
  readonly roomId: string | null;
  readonly requestedAt: string;
}
export interface DeletionLedgerStore {
  /** Atomic create only. Existing bytes must never be overwritten. */
  putIfAbsent(key: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  /** Return null only for a confirmed missing object, never permission/network errors. */
  read(key: string, signal: AbortSignal): Promise<Uint8Array | null>;
  list(cursor: string | null, limit: number, signal: AbortSignal): Promise<{ keys: string[]; cursor: string | null }>;
  close(): void;
}
export class DeletionLedgerError extends Error {
  constructor(readonly code: 'LEDGER_UNAVAILABLE' | 'LEDGER_CONFLICT' | 'INVALID_LEDGER_INTENT') { super(code); }
}
export const LEDGER_MAX_BYTES = 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function checkedDeletionIntent(value: unknown, environment: LedgerEnvironment): Readonly<DeletionIntent> {
  const invalid = () => { throw new DeletionLedgerError('INVALID_LEDGER_INTENT'); };
  if (!['qa', 'production'].includes(environment) || !value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'actorUserId,environment,requestId,requestedAt,roomId,schemaVersion,scope,targetId' ||
      v.schemaVersion !== 1 || v.environment !== environment ||
      ![v.requestId, v.actorUserId, v.targetId].every(id => typeof id === 'string' && uuid.test(id)) ||
      typeof v.scope !== 'string' || !['MESSAGE', 'ACCOUNT'].includes(v.scope) || typeof v.requestedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.requestedAt) ||
      !Number.isFinite(Date.parse(v.requestedAt)) || new Date(v.requestedAt).toISOString() !== v.requestedAt ||
      (v.scope === 'ACCOUNT' ? v.roomId !== null || v.targetId !== v.actorUserId : typeof v.roomId !== 'string' || !uuid.test(v.roomId))) return invalid();
  return Object.freeze({ schemaVersion: 1, environment, requestId: v.requestId as string, actorUserId: v.actorUserId as string,
    scope: v.scope as DeletionIntent['scope'], targetId: v.targetId as string, roomId: v.roomId as string | null, requestedAt: v.requestedAt });
}
export function deletionIntentKey(environment: LedgerEnvironment, requestId: string): string {
  if (!['qa', 'production'].includes(environment) || !uuid.test(requestId)) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
  return `${environment}/${requestId}/intent.json`;
}
export function encodeDeletionIntent(intent: DeletionIntent): Buffer {
  return Buffer.from(JSON.stringify(checkedDeletionIntent(intent, intent.environment)));
}
export function decodeDeletionIntent(bytes: Uint8Array, environment: LedgerEnvironment): Readonly<DeletionIntent> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > LEDGER_MAX_BYTES) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const record = checkedDeletionIntent(JSON.parse(text) as unknown, environment);
    // Canonical bytes also reject duplicate JSON keys, whitespace and ambiguous encodings.
    if (!encodeDeletionIntent(record).equals(Buffer.from(bytes))) throw new Error();
    return record;
  } catch { throw new DeletionLedgerError('INVALID_LEDGER_INTENT'); }
}

/** Internal write-ahead port, NOT authorization and NOT deletion completion.
 * Caller first authorizes the exact immutable target and captures server/DB UTC,
 * closes that transaction, then records intent before the DB blocking mutation.
 * Request UUID is retained across retries; only the internal admission service calls this.
 */
export class DeletionLedger {
  constructor(private readonly store: DeletionLedgerStore, readonly environment: LedgerEnvironment) {
    if (!['qa', 'production'].includes(environment)) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
  }
  async inventory(cursor: string | null = null, limit = 50, signal?: AbortSignal) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
    const bounded = AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
    try {
      bounded.throwIfAborted();
      const page = await this.store.list(cursor, limit, bounded);
      if (!Array.isArray(page.keys) || page.keys.length > limit || new Set(page.keys).size !== page.keys.length ||
          (page.cursor !== null && (typeof page.cursor !== 'string' || !page.cursor.length || page.cursor.length > 2048 || page.cursor === cursor))) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
      for (const key of page.keys) this.checkedKey(key);
      bounded.throwIfAborted();
      return page;
    } catch (error) {
      if (error instanceof DeletionLedgerError) throw error;
      throw new DeletionLedgerError('LEDGER_UNAVAILABLE');
    }
  }
  private checkedKey(key: string) {
    if (typeof key !== 'string' || key !== deletionIntentKey(this.environment, key.split('/')[1] ?? '')) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
    return key;
  }
  async readByKey(key: string, signal?: AbortSignal) {
    this.checkedKey(key);
    const bounded = AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
    try {
      bounded.throwIfAborted();
      const bytes = await this.store.read(key, bounded);
      bounded.throwIfAborted();
      if (!bytes) throw new DeletionLedgerError('LEDGER_UNAVAILABLE');
      const intent = decodeDeletionIntent(bytes, this.environment);
      if (deletionIntentKey(this.environment, intent.requestId) !== key) throw new DeletionLedgerError('LEDGER_CONFLICT');
      return Object.freeze({ intent, sha256: createHash('sha256').update(bytes).digest('hex') });
    } catch (error) {
      if (error instanceof DeletionLedgerError) throw error;
      throw new DeletionLedgerError('LEDGER_UNAVAILABLE');
    }
  }
  async ensureIntent(value: DeletionIntent, signal?: AbortSignal) {
    const intended = checkedDeletionIntent(value, this.environment);
    const key = deletionIntentKey(this.environment, intended.requestId);
    const bounded = AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
    try {
      bounded.throwIfAborted();
      let bytes = await this.store.read(key, bounded);
      if (bytes === null) {
        try { await this.store.putIfAbsent(key, encodeDeletionIntent(intended), bounded); }
        catch { /* A lost write ACK is not success. Only a verified read-back can prove durability. */ }
        bounded.throwIfAborted();
        bytes = await this.store.read(key, bounded);
      }
      bounded.throwIfAborted();
      if (bytes === null) throw new DeletionLedgerError('LEDGER_UNAVAILABLE');
      const durable = decodeDeletionIntent(bytes, this.environment);
      // A retry never resets the first durable request time/deletion deadline.
      for (const field of ['requestId', 'actorUserId', 'scope', 'targetId', 'roomId'] as const) {
        if (durable[field] !== intended[field]) throw new DeletionLedgerError('LEDGER_CONFLICT');
      }
      return Object.freeze({ intent: durable, sha256: createHash('sha256').update(bytes).digest('hex') });
    } catch (error) {
      if (error instanceof DeletionLedgerError) throw error;
      throw new DeletionLedgerError('LEDGER_UNAVAILABLE');
    }
  }
}

export type DeletionReceipt = Awaited<ReturnType<DeletionLedger['ensureIntent']>>;
// Versioned namespace is an identifier, never authority. RFC 9562 UUIDv5.
const MESSAGE_NAMESPACE_V1 = Buffer.from('c905df9b942b53e8a72659c955726fcc', 'hex');
export function messageDeletionId(environment: LedgerEnvironment, actor: string, room: string, message: string): string {
  const bytes = createHash('sha1').update(MESSAGE_NAMESPACE_V1).update(JSON.stringify([environment, actor, 'MESSAGE', room, message])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
