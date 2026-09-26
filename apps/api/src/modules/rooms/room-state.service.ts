import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { uuid } from '../../common/validation/identifier.js';
import { RoomStateRepository } from './room-state.repository.js';
import type { RoomRow } from './room-state.repository.js';
@Injectable()
export class RoomStateService {
  constructor(@Inject(RoomStateRepository) private readonly repository: RoomStateRepository) {}
  // Internal provisioning primitive. HTTP callers must separately require manage_rooms capability.
  async createRoom(tx: Transaction, name: string, mode: 'FAN' | 'GROUP', id: string = randomUUID()): Promise<string> {
    uuid(id);
    await this.repository.insertRoom(tx, id, name, mode);
    await this.repository.insertCounter(tx, id);
    await this.repository.insertSharedStream(tx, randomUUID(), id, 'ROOM_SHARED');
    return id;
  }

  // Shared internal domain composition; caller owns authorization and account fences.
  async createOwnedRoom(tx: Transaction, name: string, mode: 'FAN' | 'GROUP', policy: 'ALL_AVAILABLE' | 'SINCE_JOIN', ownerId: string, id?: string) {
    const roomId = await this.createRoom(tx, name, mode, id);
    await this.repository.initialPolicy(tx, roomId, policy);
    const ownerActorId = await this.joinRoom(tx, roomId, ownerId);
    await this.repository.assignOwner(tx, roomId, ownerActorId);
    return { roomId, ownerActorId };
  }

  async lockRoom(tx: Transaction, roomId: string): Promise<RoomRow> {
    const [room] = await this.repository.lockRoom(tx, uuid(roomId));
    if (!room || room.status !== 'ACTIVE') throw new Error('room_unavailable');
    return room;
  }

  // Commit-ordered, rollback-safe counter. All commands lock room before this counter.
  async nextOrder(tx: Transaction, roomId: string): Promise<bigint> {
    await this.lockRoom(tx, roomId);
    const [counter] = await this.repository.counter(tx, roomId);
    if (!counter) throw new Error('room_counter_missing');
    const next = BigInt(counter.last_order as string) + 1n;
    await this.repository.advanceOrder(tx, next.toString(), roomId);
    return next;
  }

  // Caller owns account/session authorization. Room lock serializes membership and future message writes.
  async joinRoom(tx: Transaction, roomId: string, userId: string): Promise<string> {
    const room = await this.lockRoom(tx, roomId);
    if (room.join_policy !== 'OPEN_AUTHENTICATED') throw new Error('join_policy_unsupported');
    const [existing] = await this.repository.member(tx, roomId, uuid(userId));
    if (existing?.status === 'BANNED') throw new Error('membership_banned');
    if (existing?.status === 'ACTIVE' && existing.active_period_id) return existing.id;
    const memberId = existing?.id ?? randomUUID();
    if (!existing) await this.repository.insertMember(tx, memberId, roomId, userId, room.mode === 'FAN' ? 'FAN' : 'MEMBER');
    const boundary = await this.nextOrder(tx, roomId);
    const periodId = randomUUID();
    await this.repository.insertPeriod(tx, periodId, roomId, memberId, room.policy_version, room.history_policy, room.history_policy === 'ALL_AVAILABLE' ? '0' : boundary.toString());
    await this.repository.activate(tx, 'ACTIVE', periodId, memberId);
    await this.repository.advanceMembership(tx, userId);
    return memberId;
  }

  async leaveRoom(tx: Transaction, roomId: string, userId: string): Promise<void> {
    const room = await this.lockRoom(tx, roomId);
    const [member] = await this.repository.leavingMember(tx, roomId, uuid(userId));
    if (!member || member.status !== 'ACTIVE') return;
    if (room.owner_member_id === member.id) {
      await this.repository.closeOwnedRoom(tx, roomId);
      return;
    }
    await this.repository.closePeriod(tx, member.active_period_id);
    await this.repository.leave(tx, 'LEFT', member.id);
    await this.repository.advanceLeavingMembership(tx, userId);
  }


}
