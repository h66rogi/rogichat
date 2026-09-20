import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { DeletionReceipt } from './deletion-ledger.js';

@Injectable()
export class AccountContentRepository {
  async candidate(tx: Transaction, userId: string) {
    // Copies first, across every room. Membership and publisher are not ownership.
    const found = await tx.prisma.messages.findFirst({ where: { content_owner_user_id: userId },
      orderBy: [{ deletion_root_id: 'desc' }, { id: 'asc' }], select: { id: true, room_id: true } });
    if (!found) return null;
    await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [found.room_id]);
    const [row] = await tx.rows<{ id: string; room_id: string; content_owner_user_id: string; deletion_root_id: string | null; deleted_at: Date | null }>(
      'SELECT id,room_id,content_owner_user_id,deletion_root_id,deleted_at FROM messages WHERE id=? AND room_id=? FOR UPDATE', [found.id, found.room_id]);
    if (!row || row.content_owner_user_id !== userId) throw new Error('account_content_scope');
    return row;
  }
  async restoredDependencies(tx: Transaction, receipt: DeletionReceipt) {
    // Select and lock one durable checkpoint before its room. FK-free restored
    // receipts may exist without a live message; absence alone is never proof.
    const [row] = await tx.rows<{ message_id: string; room_id: string; content_owner_user_id: string; environment: string; requested_at: Date; ledger_sha256: Buffer }>(`SELECT c.message_id,c.room_id,c.content_owner_user_id,c.environment,c.requested_at,c.ledger_sha256 FROM account_content_checkpoints c
      WHERE c.request_id=? AND c.rows_purged_at IS NOT NULL AND (
        EXISTS (SELECT 1 FROM command_receipts r WHERE r.room_id=c.room_id AND r.message_id=c.message_id AND (r.deleted=0 OR r.payload_digest IS NOT NULL)) OR
        EXISTS (SELECT 1 FROM push_deliveries p WHERE p.room_id=c.room_id AND p.message_id=c.message_id))
      ORDER BY c.message_id LIMIT 1 FOR UPDATE`, [receipt.intent.requestId]);
    if (!row) return null;
    if (row.content_owner_user_id !== receipt.intent.targetId || row.environment !== receipt.intent.environment || row.requested_at.toISOString() !== receipt.intent.requestedAt || row.ledger_sha256.toString('hex') !== receipt.sha256) throw new Error('account_content_checkpoint_conflict');
    await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [row.room_id]);
    return row;
  }
  async checkpoint(tx: Transaction, receipt: DeletionReceipt, message: { id: string; room_id: string; deletion_root_id: string | null }) {
    const identity = { request_id: receipt.intent.requestId, message_id: message.id };
    const prior = await tx.prisma.account_content_checkpoints.findUnique({ where: { request_id_message_id: identity }, select: {
      room_id: true, content_owner_user_id: true, deletion_root_id: true, environment: true, requested_at: true, ledger_sha256: true,
    } });
    if (prior && (prior.room_id !== message.room_id || prior.content_owner_user_id !== receipt.intent.targetId || prior.deletion_root_id !== message.deletion_root_id ||
      prior.environment !== receipt.intent.environment || prior.requested_at.toISOString() !== receipt.intent.requestedAt || Buffer.from(prior.ledger_sha256).toString('hex') !== receipt.sha256)) throw new Error('account_content_checkpoint_conflict');
    await tx.prisma.account_content_checkpoints.upsert({ where: { request_id_message_id: identity }, create: {
      ...identity, room_id: message.room_id, deletion_root_id: message.deletion_root_id, content_owner_user_id: receipt.intent.targetId,
      environment: receipt.intent.environment, requested_at: new Date(receipt.intent.requestedAt), ledger_sha256: Buffer.from(receipt.sha256, 'hex'),
    }, update: { rows_purged_at: null }, select: { message_id: true } });
  }
  async tombstone(tx: Transaction, messageId: string, userId: string) {
    return (await tx.prisma.messages.updateMany({ where: { id: messageId, content_owner_user_id: userId, deleted_at: null },
      data: { deleted_at: await tx.now(), text_content: null, version: { increment: 1n }, content_revision: { increment: 1n } } })).count;
  }
  attachments(tx: Transaction, roomId: string, messageId: string, limit: number) {
    return tx.prisma.message_attachments.findMany({ where: { room_id: roomId, message_id: messageId }, orderBy: { id: 'asc' }, take: limit, select: { id: true, asset_id: true } });
  }
  publication(tx: Transaction, roomId: string, messageId: string) {
    return tx.prisma.publication_media.findFirst({ where: { room_id: roomId, publication: { OR: [{ source_message_id: messageId }, { published_message_id: messageId }] } },
      orderBy: { id: 'asc' }, select: { id: true, destination_asset_id: true } });
  }
  detachAttachment(tx: Transaction, roomId: string, id: string) { return tx.prisma.message_attachments.deleteMany({ where: { room_id: roomId, id } }); }
  detachPublication(tx: Transaction, roomId: string, id: string) { return tx.prisma.publication_media.deleteMany({ where: { room_id: roomId, id } }); }
  async remove(tx: Transaction, receipt: DeletionReceipt, roomId: string, messageId: string) {
    // A corrupt cross-owner child is not authority to delete independent content.
    if (await tx.prisma.messages.findFirst({ where: { room_id: roomId, deletion_root_id: messageId }, select: { id: true } })) return false;
    if ((await tx.prisma.messages.deleteMany({ where: { id: messageId, room_id: roomId, content_owner_user_id: receipt.intent.targetId, deleted_at: { not: null } } })).count !== 1) throw new Error('account_content_row_conflict');
    await tx.prisma.account_content_checkpoints.update({ where: { request_id_message_id: { request_id: receipt.intent.requestId, message_id: messageId } }, data: { rows_purged_at: await tx.now() }, select: { message_id: true } });
    return true;
  }
  epoch(tx: Transaction, roomId: string) { return tx.prisma.rooms.update({ where: { id: roomId }, data: { content_epoch: { increment: 1n } }, select: { id: true } }); }
}
