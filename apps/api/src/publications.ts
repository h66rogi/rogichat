import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { Transaction, Transactions } from './transactions.js';
import { ApiError, digest } from './auth-core.js';
import { activeMember } from './profiles.js';
import { identifier } from './rooms.js';
import { loadMessage, recordMessageEvent } from './messages.js';
import { canPublishSource } from './access.js';
import { nextOrder } from './repositories.js';
import { completeJob, enqueueJob, JobFailure } from './jobs.js';
import type { JobLease } from './jobs.js';

async function sourceForOwner(tx: Transaction, roomId: string, userId: string, messageId: string) {
  const [room] = await tx.rows<RowDataPacket>('SELECT id,status,owner_member_id FROM rooms WHERE id=? FOR UPDATE', [identifier(roomId)]);
  if (!room || room.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 404);
  const viewer = await activeMember(tx, roomId, userId);
  const source = await loadMessage(tx, roomId, identifier(messageId));
  if (!source || !canPublishSource({ accountActive: true, soopLinked: true, roomId, memberRoomId: roomId, roomActive: true,
    memberId: viewer.id, memberActive: true, periodActive: true, visibleFrom: BigInt(viewer.visible_from_order), role: viewer.role, ownerMemberId: String(room.owner_member_id) }, {
    roomId: source.room_id, streamId: source.stream_id, streamRoomId: source.room_id, streamKind: source.stream_kind, order: BigInt(source.created_order),
    deleted: source.deleted_at !== null, moderated: Number(source.moderated) === 1, deletionRootBlocked: Number(source.root_blocked) === 1 || ['DELETING', 'DELETED'].includes(source.content_owner_status), grant: null })) throw new ApiError('NOT_FOUND', 404);
  if (source.content_kind !== 'TEXT' || source.text_content === null || source.deletion_root_id) throw new ApiError('INVALID_REQUEST', 400);
  const [revision] = await tx.rows<RowDataPacket>('SELECT content_revision FROM messages WHERE room_id=? AND id=? FOR UPDATE', [roomId, source.id]);
  return { viewer, source, revision: String(revision!.content_revision) };
}
const receipt = (row: RowDataPacket) => ({ publicationId: String(row.id), status: String(row.state).toLowerCase(), ...(row.state === 'PUBLISHED' ? { messageId: String(row.published_message_id) } : {}) });

// Caller requires current verified session and CSRF on this same transaction.
export async function requestPublication(tx: Transaction, roomId: string, userId: string, messageId: string) {
  const { source, viewer, revision } = await sourceForOwner(tx, roomId, userId, messageId);
  const [existing] = await tx.rows<RowDataPacket>('SELECT id,state,published_message_id FROM message_publications WHERE room_id=? AND source_message_id=? AND source_version=? FOR UPDATE', [roomId, messageId, revision]);
  if (existing) return receipt(existing);
  const id = randomUUID();
  await tx.execute('INSERT INTO message_publications (id,room_id,source_message_id,source_version,publisher_member_id) VALUES (?,?,?,?,?)', [id, roomId, source.id, revision, viewer.id]);
  await enqueueJob(tx, { purpose: 'PUBLICATION', roomId, resourceId: id, dedupeKey: digest(`publication:${id}`) });
  return { publicationId: id, status: 'preparing' };
}
export async function publicationStatus(tx: Transaction, roomId: string, userId: string, publicationId: string) {
  const viewer = await activeMember(tx, identifier(roomId), userId);
  const [row] = await tx.rows<RowDataPacket>('SELECT p.id,p.state,p.published_message_id FROM message_publications p JOIN rooms r ON r.id=p.room_id WHERE p.room_id=? AND p.id=? AND r.owner_member_id=? AND p.publisher_member_id=?', [roomId, identifier(publicationId), viewer.id, viewer.id]);
  if (!row || viewer.role !== 'STREAMER') throw new ApiError('NOT_FOUND', 404);
  return receipt(row);
}
class StaleLease extends Error {}
// External I/O is unnecessary for text. Media preparation will be outside this finalizing TX.
export async function publishText(transactions: Transactions, lease: JobLease): Promise<'completed' | 'lease_lost'> {
  if (lease.purpose !== 'PUBLICATION' || !lease.roomId || !lease.resourceId) throw new JobFailure('INVALID_RESOURCE', true);
  try {
    return await transactions.write(async tx => {
      // Nonlocking lookup only discovers the account lock; every authority fact is rechecked below.
      const [candidate] = await tx.rows<RowDataPacket>('SELECT m.user_id FROM message_publications p JOIN room_members m ON m.room_id=p.room_id AND m.id=p.publisher_member_id WHERE p.room_id=? AND p.id=?', [lease.roomId, lease.resourceId]);
      if (!candidate) throw new JobFailure('INVALID_RESOURCE', true);
      const [account] = await tx.rows<RowDataPacket>("SELECT u.id FROM users u JOIN platform_soop s ON s.user_id=u.id AND s.status='VERIFIED' WHERE u.id=? AND u.status='ACTIVE' FOR UPDATE", [candidate.user_id]);
      await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [lease.roomId]);
      const [publication] = await tx.rows<RowDataPacket>('SELECT id,state,source_message_id,source_version,publisher_member_id FROM message_publications WHERE room_id=? AND id=? FOR UPDATE', [lease.roomId, lease.resourceId]);
      if (!publication) throw new JobFailure('INVALID_RESOURCE', true);
      if (publication.state === 'PREPARING') {
        let eligible: Awaited<ReturnType<typeof sourceForOwner>> | undefined;
        if (account) {
          try { eligible = await sourceForOwner(tx, lease.roomId!, String(account.id), String(publication.source_message_id)); }
          catch (error) { if (!(error instanceof ApiError)) throw error; }
        }
        if (!eligible || eligible.viewer.id !== publication.publisher_member_id || eligible.revision !== String(publication.source_version)) {
          await tx.execute("UPDATE message_publications SET state='REVOKED' WHERE id=?", [publication.id]);
        } else {
          const streams = await tx.rows<RowDataPacket>("SELECT id FROM message_streams WHERE room_id=? AND kind='ROOM_SHARED' FOR UPDATE", [lease.roomId]);
          if (streams.length !== 1) throw new JobFailure('INVALID_RESOURCE', true);
          const id = randomUUID(); const order = await nextOrder(tx, lease.roomId!);
          await tx.execute('INSERT INTO messages (id,room_id,stream_id,sender_member_id,content_owner_user_id,deletion_root_id,text_content,created_order) VALUES (?,?,?,?,?,?,?,?)',
            [id, lease.roomId, streams[0]!.id, eligible.viewer.id, eligible.source.content_owner_user_id, eligible.source.id, eligible.source.text_content, order.toString()]);
          await tx.execute("UPDATE message_publications SET state='PUBLISHED',published_message_id=? WHERE id=?", [id, publication.id]);
          await tx.execute('INSERT INTO audit_events (id,actor_user_id,room_id,action) VALUES (?,?,?,?)', [randomUUID(), account!.id, lease.roomId, 'MESSAGE_PUBLISHED']);
          await recordMessageEvent(tx, { id, room_id: lease.roomId!, stream_id: String(streams[0]!.id) }, '1', order, 'MESSAGE_CREATED');
        }
      }
      if (!await completeJob(tx, lease)) throw new StaleLease();
      return 'completed' as const;
    });
  } catch (error) { if (error instanceof StaleLease) return 'lease_lost'; throw error; }
}
