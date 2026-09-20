import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

@Injectable()
export class BlockPolicyRepository {
  async privateCounterpart(tx: Transaction, roomId: string, actorId: string, streamId: string) {
    const row = tx.writable
      ? (await tx.rows<{ left_member_id: string; right_member_id: string }>('SELECT left_member_id,right_member_id FROM stream_pairs WHERE room_id=? AND stream_id=? FOR UPDATE', [roomId, streamId]))[0]
      : await tx.prisma.stream_pairs.findFirst({ where: { room_id: roomId, stream_id: streamId }, select: { left_member_id: true, right_member_id: true } });
    return row?.left_member_id === actorId ? row.right_member_id : row?.right_member_id === actorId ? row.left_member_id : null;
  }
  async targets(tx: Transaction, roomId: string, actorId: string, bilateral: boolean): Promise<string[]> {
    // A command may already own an RR snapshot before acquiring the room lock.
    // Current locks, not snapshot reads, must decide send/push admission.
    if (tx.writable) {
      const rows = await tx.rows<{ blocker_actor_id: string; target_actor_id: string }>(
        `SELECT blocker_actor_id,target_actor_id FROM actor_blocks WHERE room_id=? AND (blocker_actor_id=? OR (target_actor_id=? AND ?)) FOR UPDATE`,
        [roomId, actorId, actorId, bilateral]);
      return rows.map(row => row.blocker_actor_id === actorId ? row.target_actor_id : row.blocker_actor_id);
    }
    const rows = await tx.prisma.actor_blocks.findMany({ where: { room_id: roomId,
      OR: [{ blocker_actor_id: actorId }, ...(bilateral ? [{ target_actor_id: actorId }] : [])] },
      select: { blocker_actor_id: true, target_actor_id: true } });
    return rows.map(row => row.blocker_actor_id === actorId ? row.target_actor_id : row.blocker_actor_id);
  }
}
