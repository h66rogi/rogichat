import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelWardrobeService } from './upstream/channel-wardrobe.service.js';

/** Meloming's Channel key maps to the one owner-bound Rogichat room. */
@Injectable()
export class ChannelContentRepository {
  async lockLyricsQuotaWindow(tx: Transaction, userId: string): Promise<{
    window_started_at: Date | null; window_ends_at: Date | null; used_count: number;
  } | undefined> {
    const rows = await tx.rows<{ window_started_at: Date | null; window_ends_at: Date | null; used_count: number }>(
      'SELECT window_started_at,window_ends_at,used_count FROM lyrics_quota_windows WHERE user_id=? FOR UPDATE', [userId]);
    return rows[0];
  }

  async lockPrimary(tx: Transaction): Promise<void> {
    await tx.rows('SELECT `key` FROM default_room_bindings WHERE `key`=? FOR UPDATE', ['primary']);
  }

  wardrobe(tx: Transaction): ChannelWardrobeService { return new ChannelWardrobeService(tx.prisma); }

  async primary(tx: Transaction): Promise<{ roomId: string; ownerId: string | null }> {
    const binding = await tx.prisma.default_room_bindings.findUnique({ where: { key: 'primary' }, select: { room_id: true, owner_bound: true } });
    if (!binding) throw new ApiError('NOT_FOUND', 404);
    const room = await tx.prisma.rooms.findUnique({ where: { id: binding.room_id }, select: { id: true, status: true, owner: { select: { user_id: true, status: true } } } });
    if (!room || room.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 404);
    return { roomId: room.id, ownerId: binding.owner_bound && room.owner?.status === 'ACTIVE' ? room.owner.user_id : null };
  }

  async requireOwner(tx: Transaction, userId: string): Promise<string> {
    const channel = await this.primary(tx);
    if (channel.ownerId !== userId) throw new ApiError('FORBIDDEN', 403);
    const user = await tx.prisma.users.findUnique({ where: { id: userId }, select: { status: true, creator: { select: { enabled: true } } } });
    if (user?.status !== 'ACTIVE' || !user.creator?.enabled) throw new ApiError('FORBIDDEN', 403);
    return channel.roomId;
  }

  async requireConsoleToken(tx: Transaction, token: string): Promise<{ userId: string; roomId: string }> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError('UNAUTHENTICATED', 401);
    const room = await tx.prisma.rooms.findUnique({ where: { console_token: token },
      select: { id: true, owner: { select: { user_id: true } } } });
    if (!room?.owner?.user_id) throw new ApiError('UNAUTHENTICATED', 401);
    const roomId = await this.requireOwner(tx, room.owner.user_id);
    if (roomId !== room.id) throw new ApiError('UNAUTHENTICATED', 401);
    const owner = await tx.prisma.users.findUnique({ where: { id: room.owner.user_id },
      select: { reviewer_expires_at: true, soop: { select: { status: true } } } });
    if (!owner || (owner.soop?.status !== 'VERIFIED' &&
      (!owner.reviewer_expires_at || owner.reviewer_expires_at <= await tx.now()))) {
      throw new ApiError('FORBIDDEN', 403);
    }
    return { userId: room.owner.user_id, roomId };
  }
}
