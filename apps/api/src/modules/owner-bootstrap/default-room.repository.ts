import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
@Injectable()
export class DefaultRoomRepository {
  async claim(tx: Transaction, roomId: string) {
    const inserted = await tx.prisma.default_room_bindings.createMany({ data: [{ key: 'primary', room_id: roomId }], skipDuplicates: true });
    const [row] = await tx.rows<{ room_id: string; owner_bound: number; owner_subject_digest: Buffer | null }>('SELECT room_id,owner_bound,owner_subject_digest FROM default_room_bindings WHERE `key`=? FOR UPDATE', ['primary']);
    if (!row) throw new Error('default_room_conflict');
    return { ...row, owner_bound: Number(row.owner_bound) === 1, created: inserted.count === 1 };
  }
  async room(tx: Transaction, roomId: string) {
    // Validate current locked state, not a pre-activation repeatable-read snapshot.
    const [room] = await tx.rows<{ id: string; name: string; status: string; mode: string; owner_member_id: string | null }>('SELECT id,name,status,mode,owner_member_id FROM rooms WHERE id=? FOR UPDATE', [roomId]);
    return room ?? null;
  }
  async bindSpec(tx: Transaction, digest: Buffer) {
    await tx.prisma.default_room_bindings.updateMany({ where: { key: 'primary', owner_subject_digest: null }, data: { owner_subject_digest: new Uint8Array(digest) } });
  }
  async owner(tx: Transaction, subject: string) {
    // NOWAIT preserves login/deletion order; a contended bootstrap retries later
    // without holding the registry while waiting on another domain transaction.
    const [identity] = await tx.rows<{ user_id: string; status: string; provider_subject: Buffer }>('SELECT user_id,status,provider_subject FROM platform_soop WHERE provider_subject=? FOR UPDATE NOWAIT', [Buffer.from(subject)]);
    if (!identity || identity.status !== 'VERIFIED' || !Buffer.from(identity.provider_subject).equals(Buffer.from(subject))) return null;
    const [user] = await tx.rows<{ id: string; status: string }>('SELECT id,status FROM users WHERE id=? FOR UPDATE NOWAIT', [identity.user_id]);
    // These are current locking reads deliberately: Prisma snapshot reads after
    // a lock may still see an older RR snapshot and must not grant ownership.
    if (!user || user.status !== 'ACTIVE' ||
      (await tx.rows('SELECT user_id FROM account_deletion_obligations WHERE user_id=? FOR UPDATE NOWAIT', [user.id])).length ||
      (await tx.rows("SELECT request_id FROM deletion_intents WHERE scope='ACCOUNT' AND target_id=? LIMIT 1 FOR UPDATE NOWAIT", [user.id])).length) return null;
    return user.id;
  }
  async activate(tx: Transaction, roomId: string, userId: string) {
    await tx.prisma.creator_accounts.upsert({ where: { user_id: userId }, create: { user_id: userId, enabled: true }, update: { enabled: true }, select: { user_id: true } });
    await tx.prisma.rooms.update({ where: { id: roomId }, data: { status: 'ACTIVE' }, select: { id: true } });
  }
  async finish(tx: Transaction, roomId: string, ownerId: string, actorId: string, receiptId: string) {
    // Pending ROOM_OWNER streams have one real sender grant and no pair. Bind
    // them atomically to the actual owner, retaining stream/message IDs and ACLs.
    // Current locking read is required after owner discovery's earlier RR snapshot.
    const inboxes = await tx.rows<{ stream_id: string; member_id: string }>(`SELECT s.id AS stream_id,g.member_id
      FROM message_streams s JOIN stream_grants g ON g.room_id=s.room_id AND g.stream_id=s.id
      LEFT JOIN stream_pairs p ON p.room_id=s.room_id AND p.stream_id=s.id
      WHERE s.room_id=? AND s.kind='RESTRICTED' AND p.id IS NULL ORDER BY s.id FOR UPDATE`, [roomId]);
    if (new Set(inboxes.map(row => row.stream_id)).size !== inboxes.length) throw new Error('owner_inbox_conflict');
    const pending = inboxes.filter(row => row.member_id !== actorId);
    if (pending.length) {
      await tx.prisma.stream_pairs.createMany({ data: pending.map(row => {
        const members = [actorId, row.member_id].sort();
        return { id: randomUUID(), room_id: roomId, stream_id: row.stream_id, left_member_id: members[0]!, right_member_id: members[1]! };
      }) });
      await tx.prisma.stream_grants.createMany({ data: pending.map(row => ({ id: randomUUID(), room_id: roomId,
        stream_id: row.stream_id, member_id: actorId, can_read: true, can_send: true })) });
      await tx.prisma.room_members.updateMany({ where: { room_id: roomId, id: { in: pending.map(row => row.member_id) } }, data: { acl_epoch: { increment: 1n } } });
    }
    // First owner receives the inbox backlog. Existing fan period/history
    // boundaries and revoked sender grants are never repaired or rewritten.
    await tx.prisma.membership_periods.updateMany({ where: { room_id: roomId, member_id: actorId, left_at: null },
      data: { visible_from_order: 0n, history_policy: 'ALL_AVAILABLE' } });
    await tx.prisma.room_members.update({ where: { id: actorId }, data: { role: 'STREAMER' }, select: { id: true } });
    await tx.prisma.rooms.update({ where: { id: roomId }, data: { owner_member_id: actorId }, select: { id: true } });
    await tx.prisma.default_room_bindings.update({ where: { key: 'primary' }, data: { owner_bound: true }, select: { key: true } });
    await tx.prisma.audit_events.create({ data: { id: receiptId, actor_user_id: ownerId, room_id: roomId, action: 'DEFAULT_ROOM_OWNER_BOUND' }, select: { id: true } });
  }
}
