import { provisionRoomInput, historyPolicyInput } from './dto/room.dto.js';
import { Inject, Injectable } from '@nestjs/common';
import { RoomsRepository } from './rooms.repository.js';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../../modules/auth/auth-primitives.js';
import { RoomStateService } from './room-state.service.js';

import { identifier } from '../../common/validation/identifier.js';


function domainError(error: unknown): never {
  if (error instanceof Error && error.message === 'room_unavailable') throw new ApiError('NOT_FOUND', 404);
  if (error instanceof Error && ['membership_banned', 'join_policy_unsupported'].includes(error.message)) throw new ApiError('FORBIDDEN', 403);
  if (error instanceof Error && error.message === 'owner_transfer_required') throw new ApiError('CONFLICT', 409);
  throw error;
}

@Injectable()
export class RoomsCoreService {
  constructor(@Inject(RoomsRepository) private readonly repository: RoomsRepository, @Inject(RoomStateService) private readonly state: RoomStateService) {}
  private async manager(tx: Transaction, userId: string): Promise<boolean> {
    const [row] = await this.repository.manager(tx, userId);
    return Number(row?.manage_rooms) === 1;
  }
  private async audit(tx: Transaction, userId: string, roomId: string, action: string) {
    // No messages, nicknames, birthdays, tokens or free-form request payloads in audit events.
    await this.repository.audit(tx, randomUUID(), userId, roomId, action);
  }
  async provisionRoom(tx: Transaction, userId: string, body: unknown) {
    if (!await this.manager(tx, userId)) throw new ApiError('FORBIDDEN', 403);
    const input = provisionRoomInput(body);
    const { name, ownerUserId: ownerId, historyPolicy: policy } = input;
    const [owner] = await this.repository.eligibleOwner(tx, ownerId);
    if (!owner) throw new ApiError('INVALID_REQUEST', 400);
    const roomId = await this.state.createRoom(tx, name, input.mode);
    await this.repository.initialPolicy(tx, policy, roomId);
    const actorId = await this.state.joinRoom(tx, roomId, ownerId);
    await this.repository.promoteOwner(tx, actorId);
    await this.repository.assignOwner(tx, actorId, roomId);
    await this.audit(tx, userId, roomId, 'ROOM_CREATED');
    return { roomId, ownerActorId: actorId };
  }
  async listRooms(tx: Transaction, userId: string, after?: string) {
    const rows = await this.repository.visibleRooms(tx, userId, after ? identifier(after) : '');
    return { rooms: rows.slice(0, 50).map(r => ({ roomId: r.id, name: r.name, mode: r.mode, joined: r.member_status === 'ACTIVE', ...(r.member_status === 'ACTIVE' ? { actorId: r.actor_id } : {}) })), next: rows.length > 50 ? rows[49]!.id : null };
  }
  async enterRoom(tx: Transaction, roomId: string, userId: string) {
    try {
      const actorId = await this.state.joinRoom(tx, identifier(roomId), userId);
      // Return this membership's snapshot, not the room's later mutable policy.
      const [period] = await this.repository.period(tx, actorId);
      return { actorId, historyPolicy: period!.history_policy, policyVersion: period!.policy_version, visibleFromOrder: String(period!.visible_from_order) };
    } catch (error) { domainError(error); }
  }
  async exitRoom(tx: Transaction, roomId: string, userId: string) {
    try { await this.state.leaveRoom(tx, identifier(roomId), userId); }
    catch (error) { domainError(error); }
  }
  async setHistoryPolicy(tx: Transaction, roomId: string, userId: string, body: unknown) {
    const policy = historyPolicyInput(body);
    try {
      const room = await this.state.lockRoom(tx, identifier(roomId));
      const [owner] = await this.repository.activeOwner(tx, room.owner_member_id, roomId, userId);
      if (!owner && !await this.manager(tx, userId)) throw new ApiError('FORBIDDEN', 403);
      if (room.history_policy !== policy) {
        await this.repository.changePolicy(tx, policy, roomId);
        await this.audit(tx, userId, roomId, 'HISTORY_POLICY_CHANGED');
      }
      return { historyPolicy: policy, policyVersion: room.policy_version + (room.history_policy === policy ? 0 : 1) };
    } catch (error) { domainError(error); }
  }

}
