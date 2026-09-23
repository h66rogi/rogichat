import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { nextChannelContentId } from './channel-content-id.js';
import { calculateBirthdayDdayFromDate, calculateMilestonesFromDate, pickNextUpcomingEvent } from './upstream/channel-anniversary.utils.js';

type Page = { page?: number | undefined; limit?: number | undefined };
function pagination(query: Page) {
  const page = Math.max(1, Math.min(100000, query.page ?? 1));
  const limit = Math.max(1, Math.min(100, query.limit ?? 20));
  return { page, limit, skip: (page - 1) * limit };
}
function channelId(value: number) { if (value !== 1) throw new ApiError('NOT_FOUND', 404); }
function toggle(isFavorite: boolean, kind: 'channel' | 'song', existing = false) {
  return { success: true, isFavorite, message: isFavorite
    ? existing ? '이미 즐겨찾기에 추가된 채널입니다.' : kind === 'channel' ? '채널이 즐겨찾기에 추가되었습니다.' : '노래를 즐겨찾기에 추가했습니다.'
    : kind === 'channel' ? '채널이 즐겨찾기에서 해제되었습니다.' : '노래 즐겨찾기가 해제되었습니다.' };
}

/** Meloming FavoritesService contract with UUID account/room storage and numeric public aliases. */
@Injectable()
export class MelomingFavoritesService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
  ) {}

  toggleChannel(credentials: CommandCredentials, id: number, forceAdd = false) {
    channelId(id);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      await this.repository.lockPrimary(tx);
      const { roomId } = await this.repository.primary(tx);
      const existing = await tx.prisma.userChannelFavorite.findUnique({ where: { userId_channelId: { userId: actor.userId, channelId: roomId } }, select: { id: true } });
      if (existing) {
        if (forceAdd) return toggle(true, 'channel', true);
        await tx.prisma.userChannelFavorite.delete({ where: { id: existing.id } });
        return toggle(false, 'channel');
      }
      const alias = await tx.prisma.melomingUserAlias.findUnique({ where: { userId: actor.userId }, select: { id: true } });
      if (!alias) await tx.prisma.melomingUserAlias.create({ data: { id: await nextChannelContentId(tx.prisma), userId: actor.userId } });
      await tx.prisma.userChannelFavorite.updateMany({ where: { userId: actor.userId, sortOrder: { not: null } }, data: { sortOrder: { increment: 1 } } });
      await tx.prisma.userChannelFavorite.create({ data: { id: await nextChannelContentId(tx.prisma), userId: actor.userId, channelId: roomId, sortOrder: 0 } });
      return toggle(true, 'channel');
    });
  }

  removeChannel(credentials: CommandCredentials, id: number) {
    channelId(id);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const { roomId } = await this.repository.primary(tx);
      const changed = await tx.prisma.userChannelFavorite.deleteMany({ where: { userId: actor.userId, channelId: roomId } });
      if (!changed.count) throw new ApiError('NOT_FOUND', 404);
      return toggle(false, 'channel');
    });
  }

  toggleSong(credentials: CommandCredentials, songId: number) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      await this.repository.lockPrimary(tx);
      const { roomId } = await this.repository.primary(tx);
      const song = await tx.prisma.song.findFirst({ where: { id: songId, channelId: roomId }, select: { id: true } });
      if (!song) throw new ApiError('NOT_FOUND', 404);
      const existing = await tx.prisma.userSongLike.findUnique({ where: { userId_songId: { userId: actor.userId, songId } }, select: { id: true } });
      if (existing) {
        await tx.prisma.userSongLike.delete({ where: { id: existing.id } });
        return toggle(false, 'song');
      }
      await tx.prisma.userSongLike.create({ data: { id: await nextChannelContentId(tx.prisma), userId: actor.userId, songId } });
      return toggle(true, 'song');
    });
  }

  removeSong(credentials: CommandCredentials, songId: number) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const { roomId } = await this.repository.primary(tx);
      const changed = await tx.prisma.userSongLike.deleteMany({ where: { userId: actor.userId, songId, song: { channelId: roomId } } });
      if (!changed.count) throw new ApiError('NOT_FOUND', 404);
      return toggle(false, 'song');
    });
  }

  channelStatus(credentials: SessionCredentials, id: number) {
    channelId(id);
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const { roomId } = await this.repository.primary(tx);
      const row = await tx.prisma.userChannelFavorite.findUnique({ where: { userId_channelId: { userId: actor.userId, channelId: roomId } }, select: { createdAt: true } });
      return { isFavorite: !!row, ...(row?.createdAt ? { createdAt: row.createdAt.toISOString() } : {}) };
    });
  }

  songStatus(credentials: SessionCredentials, songId: number) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const { roomId } = await this.repository.primary(tx);
      const song = await tx.prisma.song.findFirst({ where: { id: songId, channelId: roomId }, select: { id: true } });
      if (!song) throw new ApiError('NOT_FOUND', 404);
      const row = await tx.prisma.userSongLike.findUnique({ where: { userId_songId: { userId: actor.userId, songId } }, select: { createdAt: true } });
      return { isFavorite: !!row, ...(row?.createdAt ? { createdAt: row.createdAt.toISOString() } : {}) };
    });
  }

  stats(credentials: SessionCredentials) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const [myChannelFavorites, mySongFavorites] = await Promise.all([
        tx.prisma.userChannelFavorite.count({ where: { userId: actor.userId } }),
        tx.prisma.userSongLike.count({ where: { userId: actor.userId } }),
      ]);
      return { myChannelFavorites, mySongFavorites };
    });
  }

  channelCount(id: number) {
    channelId(id);
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      return { channelId: 1, totalFavorites: await tx.prisma.userChannelFavorite.count({ where: { channelId: roomId } }) };
    });
  }

  songCount(songId: number) {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      const song = await tx.prisma.song.findFirst({ where: { id: songId, channelId: roomId }, select: { id: true } });
      if (!song) throw new ApiError('NOT_FOUND', 404);
      return { songId, totalFavorites: await tx.prisma.userSongLike.count({ where: { songId } }) };
    });
  }

  channels(credentials: SessionCredentials, query: Page) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const { roomId } = await this.repository.primary(tx);
      const { page, limit, skip } = pagination(query);
      const [total, rows, room, songCount, artistCount, favoritesCount] = await Promise.all([
        tx.prisma.userChannelFavorite.count({ where: { userId: actor.userId, channelId: roomId } }),
        tx.prisma.userChannelFavorite.findMany({ where: { userId: actor.userId, channelId: roomId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }], skip, take: limit, select: { id: true, createdAt: true } }),
        tx.prisma.rooms.findUnique({ where: { id: roomId }, select: { name: true, owner: { select: { user: { select: { profile: { select: { nickname: true } } } } } } } }),
        tx.prisma.song.count({ where: { channelId: roomId } }), tx.prisma.artist.count({ where: { channelId: roomId } }),
        tx.prisma.userChannelFavorite.count({ where: { channelId: roomId } }),
      ]);
      const favorites = rows.map(row => ({ id: row.id, channelId: 1, channelName: room?.name ?? '후로기',
        profileImageUrl: '/images/hurogi-profile.png', webPath: 'hurogi', themeColor: '#ff8c9d',
        ownerNickname: room?.owner?.user.profile?.nickname ?? '후로기', channelDescription: '',
        createdAt: row.createdAt?.toISOString() ?? '', songCount, artistCount,
        favoritesCount, isOwnerProSubscriber: false, isOwnerAmbassador: false }));
      return { favorites, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  songs(credentials: SessionCredentials, query: Page) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const { roomId } = await this.repository.primary(tx);
      const { page, limit, skip } = pagination(query);
      const where = { userId: actor.userId, song: { channelId: roomId } };
      const [total, rows] = await Promise.all([
        tx.prisma.userSongLike.count({ where }),
        tx.prisma.userSongLike.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit,
          select: { id: true, songId: true, createdAt: true,
            song: { select: { title: true, albumArt: true, artist: { select: { name: true } } } } } }),
      ]);
      return { favorites: rows.map(row => ({ id: row.id, songId: row.songId, songTitle: row.song.title,
        artistName: row.song.artist.name, albumArt: row.song.albumArt ?? '', channelName: '후로기',
        webPath: 'hurogi', channelProfileImageUrl: '/images/hurogi-profile.png', createdAt: row.createdAt?.toISOString() ?? '' })),
        total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  users(credentials: SessionCredentials, id: number, query: Page) {
    channelId(id);
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      const { page, limit, skip } = pagination(query);
      const [total, rows] = await Promise.all([
        tx.prisma.userChannelFavorite.count({ where: { channelId: roomId } }),
        tx.prisma.userChannelFavorite.findMany({ where: { channelId: roomId }, orderBy: { createdAt: 'desc' }, skip, take: limit,
          select: { createdAt: true, user: { select: { melomingAlias: { select: { id: true } }, profile: { select: { nickname: true } }, soop: { select: { profile_image_url: true } } } } } }),
      ]);
      return { users: rows.map(row => ({ userId: row.user.melomingAlias?.id ?? 0,
        nickname: row.user.profile?.nickname ?? '', profileImageUrl: row.user.soop?.profile_image_url ?? '',
        createdAt: row.createdAt?.toISOString() ?? '' })), total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  reorder(credentials: CommandCredentials, ids: number[]) {
    if (ids.length > 100 || ids.some(id => id !== 1)) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const { roomId } = await this.repository.primary(tx);
      const existing = await tx.prisma.userChannelFavorite.findMany({ where: { userId: actor.userId }, select: { channelId: true } });
      const existingSet = new Set(existing.map(row => row.channelId));
      const valid = ids.includes(1) && existingSet.has(roomId);
      await tx.prisma.userChannelFavorite.updateMany({ where: { userId: actor.userId, channelId: roomId }, data: { sortOrder: valid ? 0 : null } });
      return { success: true as const };
    });
  }

  anniversaries(credentials: SessionCredentials) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const { roomId } = await this.repository.primary(tx);
      const favorite = await tx.prisma.userChannelFavorite.findUnique({ where: { userId_channelId: { userId: actor.userId, channelId: roomId } }, select: { id: true } });
      if (!favorite) return { items: [] };
      const profile = await tx.prisma.channelProfile.findUnique({ where: { channelId: roomId }, select: { birthday: true, debutDate: true } });
      const milestones = profile?.debutDate ? calculateMilestonesFromDate(profile.debutDate) : null;
      const birthday = profile?.birthday ? calculateBirthdayDdayFromDate(profile.birthday) : null;
      const next = milestones || birthday ? pickNextUpcomingEvent(milestones, birthday) : null;
      return { items: [{ channelId: 1, channelName: '후로기', webPath: 'hurogi',
        profileImageUrl: '/images/hurogi-profile.png', themeColor: '#ff8c9d',
        anniversaries: milestones || birthday ? { milestones, birthday,
          nextUpcomingEvent: next ? { type: next.type, label: next.label, daysUntil: next.daysUntil } : null } : null }] };
    });
  }
}
