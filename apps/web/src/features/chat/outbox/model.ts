import { token, uuid, receipt, type Receipt } from '../contract';
import type { SendPayload } from '../commands';

/** Frozen with the media/controller owner; only wire asset/catalog references are durable. */
export type OutboxPayload = Omit<SendPayload, 'content'> & { readonly content:
  Readonly<{ type: 'TEXT'; text: string }> | Readonly<{ type: 'PHOTO' | 'VIDEO'; assetIds: readonly string[] }> | Readonly<{ type: 'STICKER'; stickerId: string }> };

export const OUTBOX_LIMITS = Object.freeze({ records: 256, bytes: 2 * 1024 * 1024, payloadMs: 15 * 60_000, identityMs: 24 * 60 * 60_000, leaseMs: 30_000 });
export type OutboxErrorCode = 'LOCKED' | 'LEASE_LOST' | 'BUSY' | 'STORAGE_FAILED' | 'UPDATE_REQUIRED' | 'CAPACITY' | 'INVALID_COMMAND' | 'RECEIPT_FIRST' | 'READ_ONLY';
export class OutboxError extends Error {
  readonly code: OutboxErrorCode;
  constructor(code: OutboxErrorCode) { super(code); this.code = code; this.name = 'OutboxError'; }
}
export interface OutboxRoom { roomId: string; membershipScope: string; authorizationRevision: string }
/** Only complete, single-generation manifests from a freshly verified session qualify. */
export interface OutboxAuthority { accountPartition: string; sessionKey: string; rooms: readonly OutboxRoom[] }
export interface OutboxRecord {
  clientMessageId: string; roomId: string; accountPartition: string; sessionKey: string;
  membershipScope: string; authorizationRevision: string;
  createdAt: number; payloadExpiresAt: number; expiresAt: number;
  attempted: boolean; payload?: OutboxPayload; result?: Receipt;
}
export interface OutboxState {
  schema: 1; fence: number; authorityEpoch: number; owner: string | null; leaseUntil: number;
  authority: OutboxAuthority | null; records: OutboxRecord[];
}
export function emptyState(): OutboxState { return { schema: 1, fence: 0, authorityEpoch: 0, owner: null, leaseUntil: 0, authority: null, records: [] }; }
export function normalizeAuthority(value: OutboxAuthority): OutboxAuthority {
  if (!/^[a-f0-9]{64}$/.test(value.sessionKey) || value.rooms.length > 10_000) throw new OutboxError('INVALID_COMMAND');
  const rooms = value.rooms.map(room => ({ roomId: uuid(room.roomId), membershipScope: token(room.membershipScope), authorizationRevision: token(room.authorizationRevision) })).sort((a, b) => a.roomId < b.roomId ? -1 : 1);
  if (new Set(rooms.map(room => room.roomId)).size !== rooms.length) throw new OutboxError('INVALID_COMMAND');
  return { accountPartition: token(value.accountPartition), sessionKey: value.sessionKey, rooms };
}
/** Reconstruct allowlisted wire fields; no upload proofs/URL/blob metadata crosses this boundary. */
export function normalizePayload(value: OutboxPayload): OutboxPayload {
  let content: OutboxPayload['content'];
  if (value.content.type === 'TEXT') {
    const text = value.content.text.normalize('NFC');
    if (!text.trim() || text.includes('\0') || [...text].length > 4000 || new TextEncoder().encode(text).length > 16384) throw new OutboxError('INVALID_COMMAND');
    content = Object.freeze({ type: 'TEXT', text });
  } else if (value.content.type === 'PHOTO' || value.content.type === 'VIDEO') {
    const assetIds = value.content.assetIds.map(uuid);
    if (assetIds.length < 1 || assetIds.length > (value.content.type === 'PHOTO' ? 4 : 1) || new Set(assetIds).size !== assetIds.length) throw new OutboxError('INVALID_COMMAND');
    content = Object.freeze({ type: value.content.type, assetIds: Object.freeze(assetIds) });
  } else if (value.content.type === 'STICKER') content = Object.freeze({ type: 'STICKER', stickerId: uuid(value.content.stickerId) });
  else throw new OutboxError('INVALID_COMMAND');
  if (!['PRIVATE', 'SHARED'].includes(value.intent)) throw new OutboxError('INVALID_COMMAND');
  if (value.intent === 'SHARED' && value.recipientActorId !== undefined) throw new OutboxError('INVALID_COMMAND');
  return Object.freeze({ clientMessageId: uuid(value.clientMessageId), membershipScope: token(value.membershipScope), intent: value.intent,
    ...(value.intent === 'PRIVATE' ? { recipientActorId: uuid(value.recipientActorId) } : {}), ...(value.quoteId ? { quoteId: uuid(value.quoteId) } : {}), content });
}
export function expire(state: OutboxState, now: number) {
  state.records = state.records.filter(record => record.expiresAt > now);
  for (const record of state.records) if (record.payloadExpiresAt <= now) delete record.payload;
}
export function permitted(record: OutboxRecord, authority: OutboxAuthority): boolean {
  return record.accountPartition === authority.accountPartition && record.sessionKey === authority.sessionKey && authority.rooms.some(room => room.roomId === record.roomId && room.membershipScope === record.membershipScope && room.authorizationRevision === record.authorizationRevision);
}
export function applyAuthority(state: OutboxState, authority: OutboxAuthority, now: number) {
  expire(state, now);
  // Destructive scrubbing is irreversible even when observed scopes cycle A -> B -> A.
  for (const record of state.records) if (!permitted(record, authority)) { delete record.payload; if (record.result?.status !== 'deleted') delete record.result; }
  state.authority = authority;
}
export function insert(state: OutboxState, roomId: string, payload: OutboxPayload, now: number): OutboxRecord {
  const authority = state.authority;
  const room = authority?.rooms.find(room => room.roomId === roomId);
  if (!authority || !room || room.membershipScope !== payload.membershipScope) throw new OutboxError('LOCKED');
  const prior = state.records.find(record => record.clientMessageId === payload.clientMessageId);
  if (prior) {
    if (!permitted(prior, authority) || prior.roomId !== roomId || !prior.payload || JSON.stringify(prior.payload) !== JSON.stringify(payload)) throw new OutboxError('READ_ONLY');
    return prior;
  }
  expire(state, now);
  const record: OutboxRecord = { clientMessageId: payload.clientMessageId, roomId, accountPartition: authority.accountPartition, sessionKey: authority.sessionKey, membershipScope: room.membershipScope, authorizationRevision: room.authorizationRevision, createdAt: now, payloadExpiresAt: now + OUTBOX_LIMITS.payloadMs, expiresAt: now + OUTBOX_LIMITS.identityMs, attempted: false, payload };
  if (state.records.length >= OUTBOX_LIMITS.records || new TextEncoder().encode(JSON.stringify([...state.records, record])).length > OUTBOX_LIMITS.bytes) throw new OutboxError('CAPACITY');
  state.records.push(record); return record;
}
export function applyReceipt(record: OutboxRecord, value: Receipt) {
  const result = receipt(value, record.clientMessageId, 'lookup');
  if (record.result?.status === 'deleted') return;
  record.result = result; delete record.payload;
}
/** Never persist CSRF itself. Domain separation also binds identical session values to an environment. */
export async function outboxSessionKey(environment: string, sessionBinding: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['rogichat-outbox-session-v1', environment, sessionBinding])));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
