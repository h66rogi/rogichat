import { affected } from '../../infrastructure/database/transactions.js';
import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
export interface RoomRow {
  id: string; name: string; mode: 'FAN' | 'GROUP'; status: 'ACTIVE' | 'CLOSED';
  history_policy: 'ALL_AVAILABLE' | 'SINCE_JOIN'; join_policy: string; policy_version: number; owner_member_id: string | null;
}
export interface MemberRow {
  id: string; room_id: string; user_id: string; role: 'FAN' | 'MEMBER' | 'STREAMER';
  status: 'ACTIVE' | 'LEFT' | 'BANNED'; active_period_id: string | null;
}


@Injectable()
export class RoomStateRepository {
  insertRoom(tx: Transaction, id: string, name: string, mode: string) {
    return tx.prisma.rooms.create({ data: { id, name, mode: mode as 'FAN' | 'GROUP' }, select: { id: true } });
  }
  insertCounter(tx: Transaction, roomId: string) {
    return tx.prisma.room_counters.create({ data: { room_id: roomId }, select: { room_id: true } });
  }
  insertSharedStream(tx: Transaction, id: string, roomId: string, kind: string) {
    return tx.prisma.message_streams.create({ data: { id, room_id: roomId, kind: kind as 'ROOM_SHARED' | 'RESTRICTED' }, select: { id: true } });
  }
  initialPolicy(tx: Transaction, roomId: string, policy: 'ALL_AVAILABLE' | 'SINCE_JOIN') {
    return tx.prisma.rooms.update({ where: { id: roomId }, data: { history_policy: policy }, select: { id: true } });
  }
  async assignOwner(tx: Transaction, roomId: string, actorId: string) {
    await tx.prisma.room_members.update({ where: { id: actorId }, data: { role: 'STREAMER' }, select: { id: true } });
    await tx.prisma.rooms.update({ where: { id: roomId }, data: { owner_member_id: actorId }, select: { id: true } });
  }
  lockRoom(tx: Transaction, roomId: string) {
    return tx.rows<RoomRow>('SELECT id,name,mode,status,history_policy,join_policy,policy_version,owner_member_id FROM rooms WHERE id=? FOR UPDATE', [roomId]);
  }
  counter(tx: Transaction, roomId: string) {
    return tx.rows<RowDataPacket>('SELECT last_order FROM room_counters WHERE room_id=? FOR UPDATE', [roomId]);
  }
  async advanceOrder(tx: Transaction, order: string, roomId: string) {
    return affected(tx.prisma.room_counters.updateMany({ where: { room_id: roomId }, data: { last_order: BigInt(order) } }));
  }
  member(tx: Transaction, roomId: string, userId: string) {
    return tx.rows<MemberRow>('SELECT id,room_id,user_id,role,status,active_period_id FROM room_members WHERE room_id=? AND user_id=? FOR UPDATE', [roomId, userId]);
  }
  insertMember(tx: Transaction, id: string, roomId: string, userId: string, role: string) {
    return tx.prisma.room_members.create({ data: { id, room_id: roomId, user_id: userId, role: role as 'FAN' | 'MEMBER' | 'STREAMER' }, select: { id: true } });
  }
  insertPeriod(tx: Transaction, id: string, roomId: string, memberId: string, policyVersion: number, history: string, boundary: string) {
    return tx.prisma.membership_periods.create({ data: { id, room_id: roomId, member_id: memberId, policy_version: policyVersion, history_policy: history as 'ALL_AVAILABLE' | 'SINCE_JOIN', visible_from_order: BigInt(boundary) }, select: { id: true } });
  }
  async activate(tx: Transaction, status: string, periodId: string, memberId: string) {
    return affected(tx.prisma.room_members.updateMany({ where: { id: memberId }, data: { status: status as 'ACTIVE', active_period_id: periodId, acl_epoch: { increment: 1n } } }));
  }
  async advanceMembership(tx: Transaction, userId: string) {
    return affected(tx.prisma.users.updateMany({ where: { id: userId }, data: { membership_generation: { increment: 1n } } }));
  }
  leavingMember(tx: Transaction, roomId: string, userId: string) {
    return tx.rows<MemberRow>('SELECT id,room_id,user_id,role,status,active_period_id FROM room_members WHERE room_id=? AND user_id=? FOR UPDATE', [roomId, userId]);
  }
  async closePeriod(tx: Transaction, periodId: string | null) {
    return affected(tx.prisma.membership_periods.updateMany({ where: { id: periodId ?? '', left_at: null }, data: { left_at: await tx.now() } }));
  }
  async leave(tx: Transaction, status: string, memberId: string) {
    return affected(tx.prisma.room_members.updateMany({ where: { id: memberId }, data: { status: status as 'LEFT' | 'BANNED', active_period_id: null, acl_epoch: { increment: 1n } } }));
  }
  async advanceLeavingMembership(tx: Transaction, userId: string) {
    return affected(tx.prisma.users.updateMany({ where: { id: userId }, data: { membership_generation: { increment: 1n } } }));
  }

}
