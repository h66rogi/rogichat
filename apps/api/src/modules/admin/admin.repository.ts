import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { Prisma } from '../../generated/prisma/client.js';
@Injectable()
export class AdminRepository {
  async capabilities(tx: Transaction, userId: string) {
    if (tx.writable) {
      const [row] = await tx.rows<{ manage_test_access: number; manage_rooms: number; manage_users: number; manage_stickers: number }>('SELECT manage_test_access,manage_rooms,manage_users,manage_stickers FROM admin_capabilities WHERE user_id=? FOR UPDATE', [userId]);
      return row ? { manage_test_access: Boolean(Number(row.manage_test_access)), enabled: Boolean(Number(row.manage_test_access) || Number(row.manage_rooms) || Number(row.manage_users) || Number(row.manage_stickers)) } : { manage_test_access: false, enabled: false };
    }
    const row = await tx.prisma.admin_capabilities.findUnique({ where: { user_id: userId }, select: { manage_test_access: true, manage_rooms: true, manage_users: true, manage_stickers: true } });
    return { manage_test_access: row?.manage_test_access ?? false, enabled: Boolean(row && Object.values(row).some(Boolean)) };
  }
  password(tx: Transaction, userId: string) { return tx.prisma.password_accounts.findFirst({ where: { user_id: userId, disabled_at: null }, select: { user_id: true } }); }
  async lockRoom(tx: Transaction, roomId: string) { return (await tx.rows<{ mode: string; status: string }>('SELECT mode,status FROM rooms WHERE id=? FOR UPDATE', [roomId]))[0]; }
  receipt(tx: Transaction, memberId: string, requestId: string) {
    return tx.prisma.room_test_grants.findUnique({ where: { member_id_request_id: { member_id: memberId, request_id: requestId } }, select: { id: true, room_id: true, payload_digest: true, expires_at: true, revoked_at: true } });
  }
  create(tx: Transaction, data: Prisma.room_test_grantsUncheckedCreateInput) { return tx.prisma.room_test_grants.create({ data, select: { id: true, room_id: true, expires_at: true, revoked_at: true } }); }
  async revoke(tx: Transaction, roomId: string, userId: string, grantId: string) {
    return tx.prisma.room_test_grants.updateMany({ where: { id: grantId, room_id: roomId, member: { user_id: userId }, revoked_at: null }, data: { revoked_at: await tx.now() } });
  }
  find(tx: Transaction, roomId: string, userId: string, grantId: string) {
    return tx.prisma.room_test_grants.findFirst({ where: { id: grantId, room_id: roomId, member: { user_id: userId } }, select: { id: true, member_id: true } });
  }
  list(tx: Transaction, roomId: string, userId: string, after: string) {
    return tx.prisma.room_test_grants.findMany({ where: { room_id: roomId, id: { gt: after }, member: { user_id: userId } }, orderBy: { id: 'asc' }, take: 51, select: { id: true, room_id: true, expires_at: true, revoked_at: true, created_at: true } });
  }
  async invalidate(tx: Transaction, memberId: string, userId: string) {
    await tx.prisma.room_members.update({ where: { id: memberId }, data: { acl_epoch: { increment: 1n } }, select: { id: true } });
    await tx.prisma.users.update({ where: { id: userId }, data: { membership_generation: { increment: 1n } }, select: { id: true } });
  }
  audit(tx: Transaction, userId: string, roomId: string, grantId: string, action: string, reason: Buffer) {
    return tx.prisma.access_audit.create({ data: { id: randomUUID(), operator_user_id: userId, target_user_id: userId, room_id: roomId, grant_id: grantId, action, reason_digest: new Uint8Array(reason) }, select: { id: true } });
  }
}
