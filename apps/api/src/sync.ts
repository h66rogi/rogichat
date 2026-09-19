import { createHmac } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from './transactions.js';
import { ApiError, object } from './auth-core.js';
import type { Principal } from './auth-core.js';
import { activeMember } from './profiles.js';
import { identifier } from './rooms.js';
import { CursorCodec, CursorError } from './cursor.js';
import type { CursorBinding, CursorPurpose } from './cursor.js';

export interface SyncInput { deviceId: string; cacheId: string; cursor?: string; limit: number }
export function syncInput(value: unknown): SyncInput {
  const input = object(value, ['deviceId', 'cacheId', 'cursor', 'limit']);
  const limit = input.limit === undefined ? 50 : typeof input.limit === 'string' && /^(?:[1-9][0-9]?|100)$/.test(input.limit) ? Number(input.limit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 4096))) throw new ApiError('INVALID_REQUEST', 400);
  return { deviceId: identifier(input.deviceId), cacheId: identifier(input.cacheId), limit, ...(typeof input.cursor === 'string' ? { cursor: input.cursor } : {}) };
}
const hash = (key: Buffer, value: unknown) => createHmac('sha256', key).update('sync-acl:v1:').update(JSON.stringify(value)).digest('base64url');
export const resetSync = () => ({ schemaVersion: 1, resetRequired: true, events: [], nextCursor: null, hasMore: false });
async function clock(tx: Transaction): Promise<Date> { return (await tx.rows<RowDataPacket>('SELECT UTC_TIMESTAMP(3) AS now'))[0]!.now as Date; }

export class Sync {
  private readonly codec: CursorCodec;
  constructor(private readonly key: Buffer, audience: string) { this.codec = new CursorCodec(key, audience); }
  private base(principal: Principal, input: SyncInput, purpose: CursorPurpose, acl: string, roomId: string | null, periodId: string | null): CursorBinding {
    return { purpose, userId: principal.userId, sessionId: principal.sessionId, deviceId: input.deviceId, cacheId: input.cacheId, roomId, periodId, acl };
  }
  private async scope(tx: Transaction, principal: Principal, roomId: string, input: SyncInput, purpose: CursorPurpose) {
    const viewer = await activeMember(tx, identifier(roomId), principal.userId);
    const [state] = await tx.rows<RowDataPacket>('SELECT m.acl_epoch,r.policy_version,u.membership_generation,c.last_order FROM room_members m JOIN rooms r ON r.id=m.room_id JOIN users u ON u.id=m.user_id JOIN room_counters c ON c.room_id=r.id WHERE m.id=?', [viewer.id]);
    const grants = await tx.rows<RowDataPacket>(`SELECT stream_id,can_read,can_send,valid_from,expires_at,revoked_at,
      (valid_from<=UTC_TIMESTAMP(3) AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) AND revoked_at IS NULL) AS active
      FROM stream_grants WHERE room_id=? AND member_id=? ORDER BY stream_id LIMIT 10001`, [roomId, viewer.id]);
    if (grants.length > 10000) throw new ServiceUnavailableException();
    const acl = hash(this.key, [viewer.id, viewer.role, viewer.mode, viewer.active_period_id, viewer.visible_from_order, String(state!.acl_epoch), state!.policy_version, String(state!.membership_generation), grants]);
    return { viewer, now: await clock(tx), high: String(state!.last_order), binding: this.base(principal, input, purpose, acl, roomId, viewer.active_period_id) };
  }
  async manifest(tx: Transaction, principal: Principal, input: SyncInput) {
    const [account] = await tx.rows<RowDataPacket>('SELECT membership_generation FROM users WHERE id=?', [principal.userId]);
    // A bounded membership manifest, never the room's participant/activity list.
    const rooms = await tx.rows<RowDataPacket>(`SELECT r.id,r.name,r.mode,m.id AS actor_id,m.role,m.active_period_id,m.acl_epoch FROM room_members m JOIN rooms r ON r.id=m.room_id AND r.status='ACTIVE' JOIN membership_periods p ON p.id=m.active_period_id AND p.room_id=m.room_id AND p.member_id=m.id AND p.left_at IS NULL WHERE m.user_id=? AND m.status='ACTIVE' ORDER BY r.id LIMIT 10001`, [principal.userId]);
    if (rooms.length > 10000) throw new ServiceUnavailableException();
    const generation = hash(this.key, [String(account!.membership_generation), rooms]);
    const binding = this.base(principal, input, 'manifest', generation, null, null); const now = await clock(tx);
    let after = '';
    try { if (input.cursor) after = this.codec.decode(input.cursor, binding, now).lastId ?? ''; }
    catch (error) { if (error instanceof CursorError) return { schemaVersion: 1, resetRequired: true, rooms: [], generation: null, nextCursor: null, complete: false }; throw error; }
    const pending = rooms.filter(r => String(r.id) > after); const page = pending.slice(0, input.limit);
    const complete = pending.length <= input.limit;
    return { schemaVersion: 1, resetRequired: false, generation, complete,
      rooms: page.map(r => ({ roomId: r.id, name: r.name, mode: r.mode, actorId: r.actor_id, role: r.role })),
      nextCursor: complete ? null : this.codec.encode(binding, { from: '0', upper: null, lastId: String(page.at(-1)!.id) }, { now }) };
  }
  async snapshot(tx: Transaction, principal: Principal, roomId: string, input: SyncInput) {
    if (input.cursor) throw new ApiError('INVALID_REQUEST', 400);
    const scope = await this.scope(tx, principal, roomId, input, 'events');
    const rows = await selectMessages(tx, scope.viewer.id, roomId, scope.viewer.visible_from_order, 'm.created_order<=?', [scope.high], input.limit + 1, false);
    const page = rows.slice(0, input.limit);
    return { schemaVersion: 1, resetRequired: false, messages: page.map(project).reverse(),
      nextCursor: this.codec.encode(scope.binding, { from: scope.high, upper: null, lastId: null }, { now: scope.now }),
      historyCursor: rows.length > input.limit ? this.codec.encode({ ...scope.binding, purpose: 'history' }, { from: String(page.at(-1)!.created_order), upper: scope.high, lastId: null }, { now: scope.now }) : null };
  }
  async history(tx: Transaction, principal: Principal, roomId: string, input: SyncInput) {
    if (!input.cursor) throw new ApiError('INVALID_REQUEST', 400);
    const scope = await this.scope(tx, principal, roomId, input, 'history');
    try {
      const position = this.codec.decode(input.cursor, scope.binding, scope.now);
      const rows = await selectMessages(tx, scope.viewer.id, roomId, scope.viewer.visible_from_order, 'm.created_order<?', [position.from], input.limit + 1, false);
      const page = rows.slice(0, input.limit);
      return { schemaVersion: 1, resetRequired: false, messages: page.map(project).reverse(),
        nextCursor: rows.length > input.limit ? this.codec.encode(scope.binding, { from: String(page.at(-1)!.created_order), upper: position.upper, lastId: null }, { now: scope.now }) : null };
    } catch (error) { if (error instanceof CursorError) return { schemaVersion: 1, resetRequired: true, messages: [], nextCursor: null }; throw error; }
  }
  async events(tx: Transaction, principal: Principal, roomId: string, input: SyncInput) {
    if (!input.cursor) throw new ApiError('INVALID_REQUEST', 400);
    const scope = await this.scope(tx, principal, roomId, input, 'events');
    try {
      const position = this.codec.decode(input.cursor, scope.binding, scope.now);
      const high = position.upper ?? scope.high;
      // A source change invalidates visible derived quotes/publications without exposing source IDs.
      // Reset replaces that cache; it is not a room-wide hint about an otherwise hidden source.
      const affected = await tx.rows<RowDataPacket>(`SELECT m.id FROM messages m JOIN message_streams s ON s.id=m.stream_id AND s.room_id=m.room_id LEFT JOIN messages quoted ON quoted.id=m.quote_id AND quoted.room_id=m.room_id WHERE m.room_id=? AND ${audience} AND EXISTS (SELECT 1 FROM room_events e WHERE e.room_id=m.room_id AND e.event_order>? AND e.event_order<=? AND (e.message_id=m.quote_id OR e.message_id=m.deletion_root_id OR e.message_id=quoted.deletion_root_id)) LIMIT 1`, [roomId, scope.viewer.visible_from_order, scope.viewer.id, position.from, high]);
      if (affected.length) return resetSync();
      const rows = await selectMessages(tx, scope.viewer.id, roomId, scope.viewer.visible_from_order, 'e.event_order>? AND e.event_order<=?', [position.from, high], input.limit + 1, true);
      const page = rows.slice(0, input.limit); const hasMore = rows.length > input.limit;
      const from = hasMore ? String(page.at(-1)!.event_order) : high;
      return { schemaVersion: 1, resetRequired: false, events: page.map(row => Number(row.blocked) === 1 ? { type: 'message.deleted', messageId: row.id, version: String(row.version) } : { type: 'message.upsert', message: project(row) }),
        hasMore, nextCursor: this.codec.encode(scope.binding, { from, upper: hasMore ? high : null, lastId: null }, { now: scope.now }) };
    } catch (error) { if (error instanceof CursorError) return resetSync(); throw error; }
  }
  async profiles(tx: Transaction, principal: Principal, roomId: string, input: SyncInput) {
    const scope = await this.scope(tx, principal, roomId, input, 'profile');
    const rows = await tx.rows<RowDataPacket>(`SELECT m.id,m.role,p.nickname,
      CASE WHEN ?='STREAMER' AND p.birthday_visible_to_streamers=1 THEN p.birthday_month ELSE NULL END AS month,
      CASE WHEN ?='STREAMER' AND p.birthday_visible_to_streamers=1 THEN p.birthday_day ELSE NULL END AS day
      FROM room_members m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE' JOIN platform_soop soop ON soop.user_id=u.id AND soop.status='VERIFIED' JOIN user_profiles p ON p.user_id=m.user_id JOIN membership_periods mp ON mp.id=m.active_period_id AND mp.room_id=m.room_id AND mp.member_id=m.id AND mp.left_at IS NULL
      WHERE m.room_id=? AND m.status='ACTIVE' AND (?='GROUP' OR ?='STREAMER' OR m.role='STREAMER' OR m.id=?) ORDER BY m.id LIMIT 10001`, [scope.viewer.role, scope.viewer.role, roomId, scope.viewer.mode, scope.viewer.role, scope.viewer.id]);
    if (rows.length > 10000) throw new ServiceUnavailableException();
    const generation = hash(this.key, [scope.binding.acl, rows]); const binding = { ...scope.binding, acl: generation };
    try {
      const after = input.cursor ? this.codec.decode(input.cursor, binding, scope.now).lastId ?? '' : '';
      const pending = rows.filter(row => String(row.id) > after); const page = pending.slice(0, input.limit); const complete = pending.length <= input.limit;
      return { schemaVersion: 1, resetRequired: false, generation, complete, profiles: page.map(row => ({ actorId: row.id, nickname: row.nickname, avatar: null, role: row.role, ...(row.month === null ? {} : { birthday: { month: row.month, day: row.day } }) })),
        nextCursor: complete ? null : this.codec.encode(binding, { from: '0', upper: null, lastId: String(page.at(-1)!.id) }, { now: scope.now }) };
    } catch (error) { if (error instanceof CursorError) return { schemaVersion: 1, resetRequired: true, generation: null, complete: false, profiles: [], nextCursor: null }; throw error; }
  }
}

// SQL filters BEFORE pagination: hidden events must not affect counts, gaps or hasMore.
const grant = (alias: string) => `EXISTS (SELECT 1 FROM stream_grants g WHERE g.room_id=${alias}.room_id AND g.stream_id=${alias}.stream_id AND g.member_id=? AND g.can_read=1 AND g.revoked_at IS NULL AND g.valid_from<=UTC_TIMESTAMP(3) AND (g.expires_at IS NULL OR g.expires_at>UTC_TIMESTAMP(3)))`;
const audience = `m.created_order>=? AND (s.kind='ROOM_SHARED' OR ${grant('m')})`;
const blocked = `(m.deleted_at IS NOT NULL OR m.moderated=1 OR u.status IN ('DELETING','DELETED') OR (m.deletion_root_id IS NOT NULL AND (root.id IS NULL OR root.deleted_at IS NOT NULL OR root.moderated=1 OR ru.status IN ('DELETING','DELETED'))))`;
async function selectMessages(tx: Transaction, actorId: string, roomId: string, visibleFrom: string, range: string, values: unknown[], limit: number, events: boolean) {
  return tx.rows<RowDataPacket>(`SELECT m.id,m.version,m.created_order,m.created_at,m.deletion_root_id,m.sender_member_id,m.text_content,s.kind,p.nickname,${blocked} AS blocked,
    ${events ? 'e.event_order,' : ''}
    CASE WHEN m.deletion_root_id IS NULL AND q.id IS NOT NULL AND q.deleted_at IS NULL AND q.moderated=0 AND qu.status NOT IN ('DELETING','DELETED') AND (q.deletion_root_id IS NULL OR (qr.id IS NOT NULL AND qr.deleted_at IS NULL AND qr.moderated=0 AND qru.status NOT IN ('DELETING','DELETED'))) AND q.created_order>=? AND (qs.kind='ROOM_SHARED' OR (q.stream_id=m.stream_id AND ${grant('q')})) THEN q.id ELSE NULL END AS quote_id,
    q.text_content AS quote_text
    FROM ${events ? 'room_events e JOIN messages m ON m.id=e.message_id AND m.room_id=e.room_id AND m.stream_id=e.stream_id' : 'messages m'}
    JOIN message_streams s ON s.id=m.stream_id AND s.room_id=m.room_id JOIN users u ON u.id=m.content_owner_user_id
    JOIN room_members sender ON sender.id=m.sender_member_id AND sender.room_id=m.room_id LEFT JOIN user_profiles p ON p.user_id=sender.user_id
    LEFT JOIN messages root ON root.id=m.deletion_root_id AND root.room_id=m.room_id LEFT JOIN users ru ON ru.id=root.content_owner_user_id
    LEFT JOIN messages q ON q.id=m.quote_id AND q.room_id=m.room_id LEFT JOIN message_streams qs ON qs.id=q.stream_id AND qs.room_id=q.room_id LEFT JOIN users qu ON qu.id=q.content_owner_user_id
    LEFT JOIN messages qr ON qr.id=q.deletion_root_id AND qr.room_id=q.room_id LEFT JOIN users qru ON qru.id=qr.content_owner_user_id
    WHERE m.room_id=? AND ${audience} AND ${range} ${events ? '' : `AND NOT ${blocked}`}
    ORDER BY ${events ? 'e.event_order ASC' : 'm.created_order DESC'} LIMIT ?`, [visibleFrom, actorId, roomId, visibleFrom, actorId, ...values, limit]);
}
function project(row: RowDataPacket) {
  return { id: row.id, version: String(row.version), createdAt: (row.created_at as Date).toISOString(), audience: row.kind === 'ROOM_SHARED' ? 'SHARED' : 'PRIVATE',
    author: row.deletion_root_id ? { kind: 'anonymous' } : { kind: 'member', actorId: row.sender_member_id, nickname: row.nickname ?? '사용자', avatar: null },
    content: { type: 'TEXT', text: row.text_content }, quote: row.quote_id ? { id: row.quote_id, content: { type: 'TEXT', text: row.quote_text } } : null };
}
