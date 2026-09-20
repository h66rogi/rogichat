import { MembershipScopeService } from '../membership-scope/membership-scope.service.js';
import type { SyncInput } from './dto/sync.dto.js';
import { Injectable } from '@nestjs/common';
import { SyncRepository } from './sync.repository.js';
import { AccessService } from '../access/access.service.js';
import { MessagesQueryService } from '../messages/messages-query.service.js';
import { createHmac } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../../modules/auth/auth-primitives.js';
import type { Principal } from '../../modules/auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { CursorCodec, CursorError } from './cursor.js';
import type { CursorBinding, CursorPurpose } from '../../modules/sync/cursor.js';
import { UsersCoreService } from '../users/users-core.service.js';

const hash = (key: Buffer, value: unknown) => createHmac('sha256', key).update('sync-acl:v1:').update(JSON.stringify(value)).digest('base64url');
export const resetSync = () => ({ schemaVersion: 2, resetRequired: true, membershipScope: null, authorizationRevision: null, events: [], nextCursor: null, hasMore: false });

@Injectable()
export class SyncCoreService {
  private readonly codec: CursorCodec;
  constructor(private readonly key: Buffer, audience: string, private readonly repository: SyncRepository, private readonly access: AccessService, private readonly messages: MessagesQueryService, private readonly users: UsersCoreService, private readonly scopes: MembershipScopeService) { this.codec = new CursorCodec(key, audience); }
  private base(principal: Principal, input: SyncInput, purpose: CursorPurpose, acl: string, roomId: string | null, periodId: string | null): CursorBinding {
    return { purpose, userId: principal.userId, sessionId: principal.sessionId, deviceId: input.deviceId, cacheId: input.cacheId, roomId, periodId, acl };
  }
  private async scope(tx: Transaction, principal: Principal, roomId: string, input: SyncInput, purpose: CursorPurpose) {
    const viewer = await this.access.requireActiveMember(tx, identifier(roomId), principal.userId);
    const [state] = await this.repository.state(tx, viewer.id);
    const now = await this.repository.clock(tx);
    const tokens = await this.scopes.one(tx, principal.userId, roomId, now);
    return { viewer, now, tokens, high: String(state!.last_order), binding: this.base(principal, input, purpose, tokens.authorizationRevision, roomId, viewer.active_period_id) };
  }

  async manifest(tx: Transaction, principal: Principal, input: SyncInput) {
    const [account] = await this.repository.account(tx, principal.userId);
    // A bounded membership manifest, never the room's participant/activity list.
    const rooms = await this.repository.rooms(tx, principal.userId);
    if (rooms.length > 10000) throw new ServiceUnavailableException();
    const now = await this.repository.clock(tx);
    const tokens = await this.scopes.batch(tx, principal.userId, rooms.map(r => r.id), now);
    if (tokens.size !== rooms.length) throw new ServiceUnavailableException();
    const projected = new Map(rooms.map(r => [r.id, ({ roomId: r.id, name: r.name, mode: r.mode, actorId: r.actor_id, role: r.role, ...tokens.get(r.id)! })]));
    const generation = hash(this.key, [String(account!.membership_generation), [...projected.values()]]);
    const binding = this.base(principal, input, 'manifest', generation, null, null);
    let after = '';
    try { if (input.cursor) after = this.codec.decode(input.cursor, binding, now).lastId ?? ''; }
    catch (error) { if (error instanceof CursorError) return { schemaVersion: 2, resetRequired: true, rooms: [], generation: null, nextCursor: null, complete: false }; throw error; }
    const pending = rooms.filter(r => String(r.id) > after); const page = pending.slice(0, input.limit);
    const complete = pending.length <= input.limit;
    return { schemaVersion: 2, resetRequired: false, generation, complete,
      rooms: page.map(r => projected.get(r.id)!),
      nextCursor: complete ? null : this.codec.encode(binding, { from: '0', upper: null, lastId: String(page.at(-1)!.id) }, { now }) };
  }
  async snapshot(tx: Transaction, principal: Principal, roomId: string, input: SyncInput) {
    if (input.cursor) throw new ApiError('INVALID_REQUEST', 400);
    const scope = await this.scope(tx, principal, roomId, input, 'events');
    const result = await this.messages.page(tx, scope.viewer, { kind: 'snapshot', from: scope.high }, input.limit, scope.now);
    const page = result.items; const historyEdge = page.at(-1)?.createdOrder;
    return { schemaVersion: 2, resetRequired: false, ...scope.tokens, messages: displayOrder(page.map(row => row.message)),
      nextCursor: this.codec.encode(scope.binding, { from: scope.high, upper: null, lastId: null }, { now: scope.now }),
      historyCursor: result.hasMore ? this.codec.encode({ ...scope.binding, purpose: 'history' }, { from: String(historyEdge), upper: scope.high, lastId: null }, { now: scope.now }) : null };
  }
  async history(tx: Transaction, principal: Principal, roomId: string, input: SyncInput) {
    if (!input.cursor) throw new ApiError('INVALID_REQUEST', 400);
    const scope = await this.scope(tx, principal, roomId, input, 'history');
    try {
      const position = this.codec.decode(input.cursor, scope.binding, scope.now);
      const result = await this.messages.page(tx, scope.viewer, { kind: 'history', from: position.from }, input.limit, scope.now);
      const page = result.items; const historyEdge = page.at(-1)?.createdOrder;
      return { schemaVersion: 2, resetRequired: false, ...scope.tokens, messages: displayOrder(page.map(row => row.message)),
        nextCursor: result.hasMore ? this.codec.encode(scope.binding, { from: String(historyEdge), upper: position.upper, lastId: null }, { now: scope.now }) : null };
    } catch (error) { if (error instanceof CursorError) return { schemaVersion: 2, resetRequired: true, membershipScope: null, authorizationRevision: null, messages: [], nextCursor: null }; throw error; }
  }
  async events(tx: Transaction, principal: Principal, roomId: string, input: SyncInput) {
    if (!input.cursor) throw new ApiError('INVALID_REQUEST', 400);
    const scope = await this.scope(tx, principal, roomId, input, 'events');
    try {
      const position = this.codec.decode(input.cursor, scope.binding, scope.now);
      const high = position.upper ?? scope.high;
      // A source change invalidates visible derived quotes/publications without exposing source IDs.
      // Reset replaces that cache; it is not a room-wide hint about an otherwise hidden source.
      const affected = await this.messages.affected(tx, scope.viewer, position.from, high, scope.now);
      if (affected) return resetSync();
      const result = await this.messages.page(tx, scope.viewer, { kind: 'events', from: position.from, high }, input.limit, scope.now);
      const page = result.items; const hasMore = result.hasMore;
      const from = hasMore ? String(page.at(-1)!.eventOrder) : high;
      return { schemaVersion: 2, resetRequired: false, ...scope.tokens, events: page.map(row => row.blocked ? { type: 'message.deleted', messageId: row.id, version: String(row.version) } : { type: 'message.upsert', message: row.message }),
        hasMore, nextCursor: this.codec.encode(scope.binding, { from, upper: hasMore ? high : null, lastId: null }, { now: scope.now }) };
    } catch (error) { if (error instanceof CursorError) return resetSync(); throw error; }
  }
  async profiles(tx: Transaction, principal: Principal, roomId: string, input: SyncInput) {
    const scope = await this.scope(tx, principal, roomId, input, 'profile');
    const rows = await this.users.syncProfiles(tx, scope.viewer);
    if (rows.length > 10000) throw new ServiceUnavailableException();
    const generation = hash(this.key, [scope.binding.acl, rows]); const binding = { ...scope.binding, acl: generation };
    try {
      const after = input.cursor ? this.codec.decode(input.cursor, binding, scope.now).lastId ?? '' : '';
      const pending = rows.filter(row => String(row.actorId) > after); const page = pending.slice(0, input.limit); const complete = pending.length <= input.limit;
      return { schemaVersion: 2, resetRequired: false, ...scope.tokens, generation, complete, profiles: page,
        nextCursor: complete ? null : this.codec.encode(binding, { from: '0', upper: null, lastId: String(page.at(-1)!.actorId) }, { now: scope.now }) };
    } catch (error) { if (error instanceof CursorError) return { schemaVersion: 2, resetRequired: true, membershipScope: null, authorizationRevision: null, generation: null, complete: false, profiles: [], nextCursor: null }; throw error; }
  }
}

// Sort a copy of the authorized selection; internal cursor edges remain untouched.
function displayOrder<T extends { createdAt: string; id: string }>(messages: (T | null)[]): T[] {
  return messages.filter((m): m is T => m !== null).sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
