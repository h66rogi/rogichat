import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelWardrobeService } from './upstream/channel-wardrobe.service.js';

/** Meloming's Channel key maps to the one owner-bound Rogichat room. */
@Injectable()
export class ChannelContentRepository {
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
}
