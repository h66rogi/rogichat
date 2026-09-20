import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { JobLease } from '../jobs/jobs.policy.js';
import type { Prisma } from '../../generated/prisma/client.js';

export interface PurgeIntent {
  request_id: string; environment: string; actor_user_id: string; scope: string;
  target_id: string; room_id: string | null; requested_at: Date; ledger_sha256: Buffer; blocked_at: Date | null;
}
export interface PurgeMessage { id: string; room_id: string; sender_user_id: string; content_owner_user_id: string; deletion_root_id: string | null; deleted_at: Date | null }

@Injectable()
export class MessagePurgeRepository {
  async intent(tx: Transaction, requestId: string) {
    // First lock matches durable replay. Return current data without creating an
    // RR snapshot before account/room serialization; all discovery below follows it.
    return (await tx.rows<PurgeIntent>('SELECT request_id,environment,actor_user_id,scope,target_id,room_id,requested_at,ledger_sha256,blocked_at FROM deletion_intents WHERE request_id=? FOR UPDATE', [requestId]))[0];
  }
  account(tx: Transaction, id: string) { return tx.rows('SELECT id FROM users WHERE id=? FOR UPDATE', [id]); }
  async room(tx: Transaction, id: string) { return (await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [id])).length === 1; }
  async message(tx: Transaction, roomId: string, id: string) {
    return (await tx.rows<PurgeMessage>('SELECT m.id,m.room_id,s.user_id AS sender_user_id,m.content_owner_user_id,m.deletion_root_id,m.deleted_at FROM messages m JOIN room_members s ON s.room_id=m.room_id AND s.id=m.sender_member_id WHERE m.room_id=? AND m.id=? FOR UPDATE', [roomId, id]))[0];
  }
  async request(tx: Transaction, intent: PurgeIntent) {
    return (await tx.rows<{ id: string; actor_user_id: string; room_id: string; message_id: string; requested_at: Date }>('SELECT id,actor_user_id,room_id,message_id,requested_at FROM deletion_requests WHERE id=? FOR UPDATE', [intent.request_id]))[0];
  }
  private scope(roomId: string, targetId: string): Prisma.messagesWhereInput {
    return { room_id: roomId, OR: [{ id: targetId }, { deletion_root_id: targetId }] };
  }
  async unsupported(tx: Transaction, roomId: string, targetId: string): Promise<boolean> {
    const scope = this.scope(roomId, targetId);
    // Existence probes are bounded too. Keep ALL provenance until a separate
    // media implementation can transfer or verify every external write attempt.
    if (await tx.prisma.messages.findFirst({ where: { ...scope, content_kind: { notIn: ['TEXT', 'STICKER'] } }, select: { id: true } })) return true;
    if (await tx.prisma.message_attachments.findFirst({ where: { room_id: roomId, message: scope }, select: { id: true } })) return true;
    return Boolean(await tx.prisma.publication_media.findFirst({ where: { room_id: roomId, publication: { OR: [{ source: scope }, { result: scope }] } }, select: { id: true } }));
  }
  copy(tx: Transaction, roomId: string, targetId: string) {
    return tx.prisma.messages.findFirst({ where: { room_id: roomId, deletion_root_id: targetId }, orderBy: { id: 'asc' }, select: { id: true } });
  }
  admittedCopyRequest(tx: Transaction, roomId: string, messageId: string) {
    // Room serialization freezes DB admission. Do not acquire a sibling intent
    // lock here: its worker locks intent/account BEFORE this room.
    return tx.prisma.deletion_requests.findFirst({ where: { room_id: roomId, message_id: messageId }, select: { id: true } });
  }
  proof(tx: Transaction, requestId: string) {
    return tx.prisma.message_purge_checkpoints.findUnique({ where: { request_id: requestId }, select: {
      environment: true, actor_user_id: true, room_id: true, target_id: true, requested_at: true, ledger_sha256: true, rows_purged_at: true,
    } });
  }
  async recordProof(tx: Transaction, intent: PurgeIntent) {
    await tx.prisma.message_purge_checkpoints.upsert({ where: { request_id: intent.request_id }, create: {
      request_id: intent.request_id, environment: intent.environment, actor_user_id: intent.actor_user_id,
      room_id: intent.room_id!, target_id: intent.target_id, requested_at: intent.requested_at,
      ledger_sha256: new Uint8Array(intent.ledger_sha256), rows_purged_at: await tx.now(),
    }, update: { rows_purged_at: await tx.now() }, select: { request_id: true } });
  }
  async advanceEpoch(tx: Transaction, roomId: string) {
    await tx.prisma.rooms.update({ where: { id: roomId }, data: { content_epoch: { increment: 1n } }, select: { id: true } });
  }
  async scrubReceipts(tx: Transaction, roomId: string, messageId: string, limit: number) {
    const page = await tx.prisma.command_receipts.findMany({ where: { room_id: roomId, message_id: messageId, OR: [{ deleted: false }, { payload_digest: { not: null } }] }, select: { id: true }, orderBy: { id: 'asc' }, take: limit });
    return page.length ? (await tx.prisma.command_receipts.updateMany({ where: { id: { in: page.map(r => r.id) } }, data: { deleted: true, payload_digest: null } })).count : 0;
  }
  async clearQuotes(tx: Transaction, roomId: string, messageId: string, limit: number) {
    const page = await tx.prisma.messages.findMany({ where: { room_id: roomId, quote_id: messageId }, select: { id: true }, orderBy: { id: 'asc' }, take: limit });
    if (!page.length) return 0;
    const result = await tx.prisma.messages.updateMany({ where: { id: { in: page.map(r => r.id) }, room_id: roomId, quote_id: messageId }, data: { quote_id: null, version: { increment: 1n } } });
    await this.advanceEpoch(tx, roomId);
    return result.count;
  }
  async publications(tx: Transaction, roomId: string, messageId: string, limit: number) {
    const page = await tx.prisma.message_publications.findMany({ where: { room_id: roomId, OR: [{ source_message_id: messageId }, { published_message_id: messageId }] }, select: { id: true }, orderBy: { id: 'asc' }, take: limit });
    if (!page.length) return 0;
    const ids = page.map(r => r.id);
    const jobs = await tx.prisma.jobs.findMany({ where: { purpose: 'PUBLICATION', room_id: roomId, resource_id: { in: ids } }, select: { id: true }, orderBy: { id: 'asc' }, take: limit });
    // Return after queue mutation; no later domain locks in this transaction.
    if (jobs.length) return (await tx.prisma.jobs.deleteMany({ where: { id: { in: jobs.map(r => r.id) }, purpose: 'PUBLICATION', room_id: roomId } })).count;
    return (await tx.prisma.message_publications.deleteMany({ where: { id: { in: ids }, room_id: roomId } })).count;
  }
  async reactions(tx: Transaction, roomId: string, messageId: string, limit: number) {
    const page = await tx.prisma.message_reactions.findMany({ where: { room_id: roomId, message_id: messageId }, select: { id: true }, orderBy: { id: 'asc' }, take: limit });
    return page.length ? (await tx.prisma.message_reactions.deleteMany({ where: { id: { in: page.map(r => r.id) }, room_id: roomId, message_id: messageId } })).count : 0;
  }
  async sticker(tx: Transaction, roomId: string, messageId: string) {
    // Only the message link: curated service asset/catalog and registrar survive.
    return (await tx.prisma.message_stickers.deleteMany({ where: { room_id: roomId, message_id: messageId } })).count;
  }
  async events(tx: Transaction, roomId: string, messageId: string, limit: number) {
    const page = await tx.prisma.room_events.findMany({ where: { room_id: roomId, message_id: messageId }, select: { id: true }, orderBy: { id: 'asc' }, take: limit });
    if (!page.length) return 0;
    const ids = page.map(r => r.id);
    const jobs = await tx.prisma.jobs.findMany({ where: { purpose: 'REALTIME_HINT', room_id: roomId, resource_id: { in: ids } }, select: { id: true }, orderBy: { id: 'asc' }, take: limit });
    if (jobs.length) return (await tx.prisma.jobs.deleteMany({ where: { id: { in: jobs.map(r => r.id) }, purpose: 'REALTIME_HINT', room_id: roomId } })).count;
    await this.advanceEpoch(tx, roomId);
    return (await tx.prisma.room_events.deleteMany({ where: { id: { in: ids }, room_id: roomId, message_id: messageId } })).count;
  }
  async remove(tx: Transaction, roomId: string, messageId: string) {
    await this.advanceEpoch(tx, roomId);
    return (await tx.prisma.messages.deleteMany({ where: { id: messageId, room_id: roomId, deleted_at: { not: null } } })).count;
  }
  async fence(tx: Transaction, lease: JobLease): Promise<boolean> {
    if (!(await tx.rows('SELECT id FROM jobs WHERE id=? FOR UPDATE', [lease.id])).length) return false;
    const now = await tx.now(); // Clock AFTER the lock wait, never a stale pre-wait expiry check.
    return (await tx.prisma.jobs.updateMany({ where: { id: lease.id, purpose: 'PURGE', room_id: lease.roomId, resource_id: lease.resourceId,
      state: 'RUNNING', generation: lease.generation, lease_owner: lease.leaseOwner, lease_token: lease.leaseToken, lease_until: { gt: now } },
    data: { lease_until: new Date(now.getTime() + 30_000) } })).count === 1;
  }
}
