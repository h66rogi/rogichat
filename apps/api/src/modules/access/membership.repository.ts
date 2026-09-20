import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../transactions.js';

export interface ActiveMember extends RowDataPacket {
  id: string; room_id: string; user_id: string; role: 'FAN' | 'MEMBER' | 'STREAMER';
  mode: 'FAN' | 'GROUP'; active_period_id: string; visible_from_order: string;
}

@Injectable()
export class MembershipRepository {
  async findActive(tx: Transaction, roomId: string, userId: string): Promise<ActiveMember | undefined> {
    const [member] = await tx.rows<ActiveMember>(`SELECT m.id,m.room_id,m.user_id,m.role,m.active_period_id,r.mode,p.visible_from_order FROM room_members m JOIN rooms r ON r.id=m.room_id JOIN membership_periods p ON p.id=m.active_period_id AND p.room_id=m.room_id AND p.member_id=m.id WHERE m.room_id=? AND m.user_id=? AND m.status='ACTIVE' AND r.status='ACTIVE' AND p.left_at IS NULL${tx.writable ? ' FOR UPDATE' : ''}`, [roomId, userId]);
    return member;
  }
}
