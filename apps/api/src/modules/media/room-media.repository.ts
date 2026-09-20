import { affected } from '../../infrastructure/database/transactions.js';
import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
export interface PolicyRow {
  owner_member_id: string | null; photo_enabled: number | null; video_enabled: number | null;
  sticker_enabled: number | null; photo_max_bytes: number | null; video_max_bytes: number | null;
}

@Injectable()
export class RoomMediaRepository {
  async current(tx: Transaction, roomId: string) {
    if (tx.writable) return tx.rows<PolicyRow>('SELECT r.owner_member_id,p.photo_enabled,p.video_enabled,p.sticker_enabled,p.photo_max_bytes,p.video_max_bytes FROM rooms r LEFT JOIN room_media_policy p ON p.room_id=r.id WHERE r.id=? AND r.status="ACTIVE" FOR UPDATE', [roomId]);
    const room = await tx.prisma.rooms.findFirst({ where: { id: roomId, status: 'ACTIVE' }, select: { owner_member_id: true, media_policy: { select: { photo_enabled: true, video_enabled: true, sticker_enabled: true, photo_max_bytes: true, video_max_bytes: true } } } });
    return room ? [{ owner_member_id: room.owner_member_id, photo_enabled: room.media_policy ? Number(room.media_policy.photo_enabled) : null, video_enabled: room.media_policy ? Number(room.media_policy.video_enabled) : null, sticker_enabled: room.media_policy ? Number(room.media_policy.sticker_enabled) : null, photo_max_bytes: room.media_policy?.photo_max_bytes ?? null, video_max_bytes: room.media_policy?.video_max_bytes ?? null }] : [];
  }
  owner(tx: Transaction, ownerId: string | null, roomId: string, userId: string) {
    return tx.rows(`SELECT m.id FROM room_members m JOIN membership_periods p
    ON p.id=m.active_period_id AND p.room_id=m.room_id AND p.member_id=m.id
    WHERE m.id=? AND m.room_id=? AND m.user_id=? AND m.role='STREAMER' AND m.status='ACTIVE' AND p.left_at IS NULL FOR UPDATE`, [ownerId, roomId, userId]);
  }
  manager(tx: Transaction, userId: string) {
    return tx.rows<RowDataPacket>('SELECT manage_rooms FROM admin_capabilities WHERE user_id=? FOR UPDATE', [userId]);
  }
  update(tx: Transaction, roomId: string, photo: boolean, video: boolean, sticker: boolean, photoBytes: number, videoBytes: number, photoUpdate: boolean, videoUpdate: boolean, stickerUpdate: boolean, photoBytesUpdate: number, videoBytesUpdate: number) {
    return tx.prisma.room_media_policy.upsert({ where: { room_id: roomId }, create: { room_id: roomId, photo_enabled: photo, video_enabled: video, sticker_enabled: sticker, photo_max_bytes: photoBytes, video_max_bytes: videoBytes }, update: { photo_enabled: photoUpdate, video_enabled: videoUpdate, sticker_enabled: stickerUpdate, photo_max_bytes: photoBytesUpdate, video_max_bytes: videoBytesUpdate }, select: { room_id: true } });
  }
  advancePolicy(tx: Transaction, roomId: string) { return affected(tx.prisma.rooms.updateMany({ where: { id: roomId }, data: { policy_version: { increment: 1 } } })); }
  audit(tx: Transaction, id: string, userId: string, roomId: string, action: string) { return tx.prisma.audit_events.create({ data: { id, actor_user_id: userId, room_id: roomId, action }, select: { id: true } }); }

}
