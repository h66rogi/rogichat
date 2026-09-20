import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
@Injectable()
export class DefaultRoomRepository {
  async claim(tx: Transaction, roomId: string) {
    const inserted = await tx.prisma.default_room_bindings.createMany({ data: [{ key: 'primary', room_id: roomId }], skipDuplicates: true });
    const [row] = await tx.rows<{ room_id: string; owner_bound: number; owner_subject_digest: Buffer | null }>('SELECT room_id,owner_bound,owner_subject_digest FROM default_room_bindings WHERE `key`=? FOR UPDATE', ['primary']);
    if (!row) throw new Error('default_room_conflict');
    return { ...row, created: inserted.count === 1 };
  }
  async room(tx: Transaction, roomId: string) {
    // Validate current locked state, not a pre-activation repeatable-read snapshot.
    const [room] = await tx.rows<{ id: string; name: string; status: string; mode: string; owner_member_id: string | null }>('SELECT id,name,status,mode,owner_member_id FROM rooms WHERE id=? FOR UPDATE', [roomId]);
    return room ?? null;
  }
  async reserve(tx: Transaction, roomId: string) {
    await tx.prisma.rooms.update({ where: { id: roomId }, data: { status: 'CLOSED' }, select: { id: true } });
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
    await tx.prisma.room_members.update({ where: { id: actorId }, data: { role: 'STREAMER' }, select: { id: true } });
    await tx.prisma.rooms.update({ where: { id: roomId }, data: { owner_member_id: actorId }, select: { id: true } });
    await tx.prisma.default_room_bindings.update({ where: { key: 'primary' }, data: { owner_bound: true }, select: { key: true } });
    await tx.prisma.audit_events.create({ data: { id: receiptId, actor_user_id: ownerId, room_id: roomId, action: 'DEFAULT_ROOM_OWNER_BOUND' }, select: { id: true } });
  }
}
