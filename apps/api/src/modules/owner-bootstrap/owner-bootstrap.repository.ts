import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { BOOTSTRAP_RECEIPT } from './owner-bootstrap.request.js';
import type { OwnerBootstrapRequest } from './owner-bootstrap.request.js';

@Injectable()
export class OwnerBootstrapRepository {
  async claim(tx: Transaction, r: OwnerBootstrapRequest) {
    // No FK/account locks. This one immutable singleton serializes all bootstrap
    // owners/rooms. A failed attempt rolls the receipt back with everything else.
    await tx.prisma.audit_events.createMany({ data: [{ id: BOOTSTRAP_RECEIPT, actor_user_id: r.ownerUserId,
      room_id: r.roomId, action: 'INITIAL_OWNER_BOOTSTRAP' }], skipDuplicates: true });
    await tx.rows('SELECT id FROM audit_events WHERE id=? FOR UPDATE', [BOOTSTRAP_RECEIPT]);
  }
  async lockTargets(tx: Transaction, r: OwnerBootstrapRequest) {
    // Login/deletion use guard -> identity -> account; API room commands can
    // hold account/capability/room in other orders. NOWAIT on every shared target
    // prevents a bootstrap waiter from closing any such lock-order cycle.
    await tx.rows('SELECT id FROM platform_soop WHERE provider_subject=? FOR UPDATE NOWAIT', [Buffer.from(r.expectedSubject)]);
    await tx.rows('SELECT id FROM users WHERE id=? FOR UPDATE NOWAIT', [r.ownerUserId]);
    await tx.rows('SELECT user_id FROM creator_accounts WHERE user_id=? FOR UPDATE NOWAIT', [r.ownerUserId]);
    await tx.rows('SELECT user_id FROM admin_capabilities WHERE user_id=? FOR UPDATE NOWAIT', [r.ownerUserId]);
    await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE NOWAIT', [r.roomId]);
  }
  async snapshot(tx: Transaction, r: OwnerBootstrapRequest, specId: string) {
    // First consistent read occurs only AFTER all target locks. The dedicated
    // service never accepts an earlier caller-owned RR snapshot.
    const receipts = await tx.prisma.audit_events.findMany({ where: { id: { in: [BOOTSTRAP_RECEIPT, r.requestId, specId] } },
      select: { id: true, actor_user_id: true, room_id: true, action: true } });
    const user = await tx.prisma.users.findUnique({ where: { id: r.ownerUserId }, select: { status: true,
      soop: { select: { status: true, provider_subject: true, verified_at: true } },
      creator: { select: { enabled: true } }, admin: { select: { manage_rooms: true } } } });
    const deletion = await tx.prisma.account_deletion_obligations.count({ where: { user_id: r.ownerUserId } });
    const intents = await tx.prisma.deletion_intents.count({ where: { scope: 'ACCOUNT', target_id: r.ownerUserId } });
    const room = await tx.prisma.rooms.findUnique({ where: { id: r.roomId }, select: { id: true, name: true, mode: true,
      status: true, history_policy: true, policy_version: true, join_policy: true, owner_member_id: true,
      owner: { select: { id: true, user_id: true, role: true, status: true, active_period: { select: {
        room_id: true, member_id: true, left_at: true, history_policy: true, policy_version: true } } } },
      counter: { select: { room_id: true } }, streams: { where: { kind: 'ROOM_SHARED' }, select: { id: true } } } });
    const otherRooms = await tx.prisma.rooms.count({ where: { id: { not: r.roomId } } });
    const otherCreators = await tx.prisma.creator_accounts.count({ where: { user_id: { not: r.ownerUserId }, enabled: true } });
    const otherManagers = await tx.prisma.admin_capabilities.count({ where: { user_id: { not: r.ownerUserId }, manage_rooms: true } });
    return { receipts, user, deletion, intents, room, otherRooms, otherCreators, otherManagers };
  }
  async grant(tx: Transaction, r: OwnerBootstrapRequest) {
    if (r.grantCreator) await tx.prisma.creator_accounts.upsert({ where: { user_id: r.ownerUserId },
      create: { user_id: r.ownerUserId, enabled: true }, update: { enabled: true }, select: { user_id: true } });
    if (r.grantManageRooms) await tx.prisma.admin_capabilities.upsert({ where: { user_id: r.ownerUserId },
      create: { user_id: r.ownerUserId, manage_rooms: true }, update: { manage_rooms: true }, select: { user_id: true } });
  }
  async receipt(tx: Transaction, r: OwnerBootstrapRequest, specId: string) {
    await tx.prisma.audit_events.createMany({ data: [
      { id: r.requestId, actor_user_id: r.ownerUserId, room_id: r.roomId, action: 'INITIAL_OWNER_REQUEST' },
      { id: specId, actor_user_id: r.ownerUserId, room_id: r.roomId, action: 'INITIAL_OWNER_SPEC' },
    ] });
  }
}
