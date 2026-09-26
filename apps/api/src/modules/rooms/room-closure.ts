import type { Transaction } from '../../infrastructure/database/transactions.js';

/** Shared closure command used by an owner leaving and owner account cleanup. */
export async function closeOwnedRoom(tx: Transaction, roomId: string) {
  // The caller holds the room lock. Visibility queries all require ACTIVE.
  // Revoke every membership in the same commit so old device scopes cannot rejoin.
  const now = await tx.now();
  await tx.prisma.rooms.update({ where: { id: roomId }, data: { status: 'CLOSED', content_epoch: { increment: 1n } }, select: { id: true } });
  const members = await tx.prisma.room_members.findMany({ where: { room_id: roomId, status: 'ACTIVE' }, select: { id: true, user_id: true } });
  await tx.prisma.membership_periods.updateMany({ where: { room_id: roomId, left_at: null }, data: { left_at: now } });
  await tx.prisma.room_test_grants.updateMany({ where: { room_id: roomId, revoked_at: null }, data: { revoked_at: now } });
  await tx.prisma.stream_grants.updateMany({ where: { room_id: roomId, revoked_at: null }, data: { revoked_at: now } });
  await tx.prisma.room_members.updateMany({ where: { room_id: roomId, status: 'ACTIVE' }, data: { status: 'LEFT', active_period_id: null, acl_epoch: { increment: 1n } } });
  await tx.prisma.users.updateMany({ where: { id: { in: [...new Set(members.map(member => member.user_id))] } }, data: { membership_generation: { increment: 1n } } });
  // Remove message bodies and captions in the closure transaction. The
  // CLOSED room, revoked memberships and object tombstones fence every reader.
  await tx.prisma.messages.updateMany({ where: { room_id: roomId }, data: { text_content: null, deleted_at: now } });
  await tx.prisma.media_assets.updateMany({ where: { room_id: roomId, deleted_at: null }, data: { deleted_at: now } });
  await tx.prisma.notification_reads.deleteMany({ where: { room_id: roomId } });
  await tx.execute("DELETE j FROM jobs j JOIN messages m ON m.id=j.resource_id WHERE j.purpose='PUSH' AND j.room_id IS NULL AND m.room_id=?", [roomId]);
  await tx.prisma.jobs.deleteMany({ where: { purpose: 'PUSH', room_id: roomId } });
  await tx.prisma.push_deliveries.deleteMany({ where: { room_id: roomId } });
}
