import { Inject, Injectable } from '@nestjs/common';
import axios from 'axios';
import { ClipPlatform, ClipRequestStatus, Prisma } from '../../generated/prisma/client.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { nextChannelContentId } from './channel-content-id.js';

// The DTO shape and URL providers follow Meloming's ClipService,
// ClipRequestService and ClipResolveService. Integer channel/user references
// are translated at the Rogichat boundary; content remains in this database.
const clipInclude = {
  clipChannels: { include: { song: { include: { artist: true } } } },
  stat: true,
} as const satisfies Prisma.ClipInclude;
type ClipRow = Prisma.ClipGetPayload<{ include: typeof clipInclude }>;
const requestInclude = {
  requester: { include: { profile: true, melomingAlias: true } },
  processedBy: { include: { profile: true, melomingAlias: true } },
  song: { include: { artist: true } },
} as const satisfies Prisma.ClipRequestInclude;
type RequestRow = Prisma.ClipRequestGetPayload<{ include: typeof requestInclude }>;

function id(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  throw new ApiError('INVALID_REQUEST', 400);
}

function optionalUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 2048) throw new ApiError('INVALID_REQUEST', 400);
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('URL');
  } catch { throw new ApiError('INVALID_REQUEST', 400); }
  return value;
}

function clipFields(value: unknown, request = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
  const raw = value as Record<string, unknown>;
  const allowed = request
    ? ['channelId', 'songId', 'title', 'description', 'platform', 'videoId', 'videoUrl', 'thumbnailUrl', 'duration', 'publishToHotClip']
    : ['title', 'description', 'platform', 'videoId', 'videoUrl', 'thumbnailUrl', 'duration', 'publishToHotClip', 'primaryChannel', 'taggedChannels', 'channels'];
  if (Object.keys(raw).some(key => !allowed.includes(key)) ||
    typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 255 ||
    !['YOUTUBE', 'SOOP', 'CHZZK'].includes(String(raw.platform)) ||
    (raw.description !== undefined && (typeof raw.description !== 'string' || raw.description.length > 65535)) ||
    (raw.videoId !== undefined && (typeof raw.videoId !== 'string' || !raw.videoId.trim() || raw.videoId.length > 100)) ||
    (raw.duration !== undefined && (!Number.isSafeInteger(raw.duration) || Number(raw.duration) < 0 || Number(raw.duration) > 86_400)) ||
    (raw.publishToHotClip !== undefined && typeof raw.publishToHotClip !== 'boolean')) throw new ApiError('INVALID_REQUEST', 400);
  const videoUrl = optionalUrl(raw.videoUrl);
  const thumbnailUrl = optionalUrl(raw.thumbnailUrl);
  if (!raw.videoId && !videoUrl) throw new ApiError('INVALID_REQUEST', 400);
  if (request) {
    if (raw.channelId !== 1) throw new ApiError('NOT_FOUND', 404);
    return { channelId: 1, songId: id(raw.songId), title: raw.title.trim(),
      description: raw.description as string | undefined, platform: raw.platform as ClipPlatform,
      videoId: raw.videoId as string | undefined, videoUrl, thumbnailUrl,
      duration: raw.duration as number | undefined, publishToHotClip: raw.publishToHotClip as boolean | undefined };
  }
  const main = raw.primaryChannel ?? (Array.isArray(raw.channels) ? raw.channels[0] : undefined);
  if (!main || typeof main !== 'object' || Array.isArray(main)) throw new ApiError('INVALID_REQUEST', 400);
  const primary = main as Record<string, unknown>;
  if (Object.keys(primary).some(key => !['channelId', 'songId'].includes(key)) || primary.channelId !== 1) throw new ApiError('INVALID_REQUEST', 400);
  if (raw.taggedChannels !== undefined && (!Array.isArray(raw.taggedChannels) || raw.taggedChannels.length > 0)) {
    // Rogichat has a single channel and cannot tag another Meloming account.
    throw new ApiError('INVALID_REQUEST', 400);
  }
  return { title: raw.title.trim(), description: raw.description as string | undefined,
    platform: raw.platform as ClipPlatform, videoId: raw.videoId as string | undefined,
    videoUrl, thumbnailUrl, duration: raw.duration as number | undefined,
    publishToHotClip: raw.publishToHotClip as boolean | undefined, songId: id(primary.songId) };
}

function listQuery(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['take', 'cursorId', 'page', 'songId', 'search', 'platform', 'contentType', 'sort'].includes(key))) throw new ApiError('INVALID_REQUEST', 400);
  const take = raw.take === undefined ? 20 : id(raw.take);
  if (take > 100) throw new ApiError('INVALID_REQUEST', 400);
  const cursorId = raw.cursorId === undefined ? undefined : id(raw.cursorId);
  const songId = raw.songId === undefined ? undefined : id(raw.songId);
  const page = raw.page === undefined ? 1 : id(raw.page);
  if (raw.search !== undefined && (typeof raw.search !== 'string' || raw.search.length > 100)) throw new ApiError('INVALID_REQUEST', 400);
  if (raw.platform !== undefined && !Object.values(ClipPlatform).includes(raw.platform as ClipPlatform)) throw new ApiError('INVALID_REQUEST', 400);
  if (raw.contentType !== undefined && raw.contentType !== 'SONG_CLIP') throw new ApiError('INVALID_REQUEST', 400);
  if (raw.sort !== undefined && !['latest', 'hot', 'views', 'likes'].includes(String(raw.sort))) throw new ApiError('INVALID_REQUEST', 400);
  return { take, cursorId, songId, page, search: raw.search as string | undefined,
    platform: raw.platform as ClipPlatform | undefined, sort: raw.sort as string | undefined };
}

function response(row: ClipRow, roomName: string) {
  return { id: row.id, title: row.title, description: row.description,
    platform: row.platform, videoId: row.videoId, videoUrl: row.videoUrl,
    thumbnailUrl: row.thumbnailUrl, duration: row.duration, status: row.status,
    contentType: row.contentType, publishToHotClip: row.publishToHotClip,
    mediaType: row.mediaType, selfHosted: row.selfHosted, autoGenerated: row.autoGenerated,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    channels: row.clipChannels.map(link => ({ channelId: 1, channelName: roomName,
      channelWebPath: 'hurogi', channelProfileImageUrl: '/images/hurogi-profile.png',
      songId: link.songId, songTitle: link.song?.title, songArtist: link.song?.artist.name,
      isPrimary: link.isPrimary })),
    stat: { likeCount: row.stat?.likeCount ?? 0, commentCount: row.stat?.commentCount ?? 0,
      viewCount: row.stat?.viewCount ?? 0 }, userReacted: false };
}

function requestResponse(row: RequestRow, roomName: string) {
  return { id: row.id, requester: { id: row.requester.melomingAlias?.id ?? 0,
      nickname: row.requester.profile?.nickname ?? '회원', profileImageUrl: undefined },
    channel: { id: 1, name: roomName, webPath: 'hurogi', profileImageUrl: '/images/hurogi-profile.png' },
    song: { id: row.songId, title: row.song.title, artistName: row.song.artist.name },
    title: row.title, description: row.description, platform: row.platform,
    videoId: row.videoId, videoUrl: row.videoUrl, thumbnailUrl: row.thumbnailUrl,
    duration: row.duration, publishToHotClip: row.publishToHotClip, status: row.status,
    processedBy: row.processedBy ? { id: row.processedBy.melomingAlias?.id ?? 0,
      nickname: row.processedBy.profile?.nickname ?? '관리자' } : undefined,
    processedAt: row.processedAt?.toISOString(), rejectionReason: row.rejectionReason,
    approvedClipId: row.approvedClipId, createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString() };
}

@Injectable()
export class MelomingClipService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  private async requireSong(tx: Transaction, roomId: string, songId: number) {
    const song = await tx.prisma.song.findFirst({ where: { id: songId, channelId: roomId }, select: { id: true } });
    if (!song) throw new ApiError('NOT_FOUND', 404);
  }

  private async createClip(tx: Transaction, roomId: string, fields: ReturnType<typeof clipFields>) {
    await this.requireSong(tx, roomId, fields.songId);
    const clipId = await nextChannelContentId(tx.prisma);
    const linkId = await nextChannelContentId(tx.prisma);
    const row = await tx.prisma.clip.create({ data: {
      id: clipId, title: fields.title, description: fields.description ?? null,
      platform: fields.platform, videoId: fields.videoId ?? null, videoUrl: fields.videoUrl ?? null,
      thumbnailUrl: fields.thumbnailUrl ?? null, duration: fields.duration ?? null,
      publishToHotClip: fields.publishToHotClip ?? true,
      clipChannels: { create: [{ id: linkId, channelId: roomId, songId: fields.songId, isPrimary: true }] },
      stat: { create: {} },
    }, include: clipInclude });
    const room = await tx.prisma.rooms.findUniqueOrThrow({ where: { id: roomId }, select: { name: true } });
    return response(row, room.name);
  }

  permission(credentials: SessionCredentials) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const channel = await this.repository.primary(tx);
      const hasPermission = channel.ownerId === actor.userId;
      return { channelId: 1, hasPermission, canRequestClip: !hasPermission };
    });
  }

  create(credentials: CommandCredentials, value: unknown) {
    const fields = clipFields(value);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return this.createClip(tx, roomId, fields);
    });
  }

  list(identifier: string, raw: Record<string, unknown>) {
    if (identifier !== 'hurogi') throw new ApiError('NOT_FOUND', 404);
    const query = listQuery(raw);
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      const room = await tx.prisma.rooms.findUniqueOrThrow({ where: { id: roomId }, select: { name: true } });
      const where: Prisma.ClipWhereInput = { status: 'VISIBLE', clipChannels: { some: { channelId: roomId,
        ...(query.songId ? { songId: query.songId } : {}) } },
        ...(query.platform ? { platform: query.platform } : {}),
        ...(query.search ? { title: { contains: query.search } } : {}) };
      const orderBy: Prisma.ClipOrderByWithRelationInput[] = query.sort === 'views' ? [{ stat: { viewCount: 'desc' } }, { id: 'desc' }]
        : query.sort === 'likes' ? [{ stat: { likeCount: 'desc' } }, { id: 'desc' }]
        : query.sort === 'hot' ? [{ stat: { hotScore: 'desc' } }, { id: 'desc' }]
        : [{ id: 'desc' }];
      const rows = await tx.prisma.clip.findMany({ where: query.cursorId ? { ...where, id: { lt: query.cursorId } } : where,
        include: clipInclude, orderBy, skip: query.cursorId ? 0 : (query.page - 1) * query.take,
        take: query.take + 1 });
      const hasMore = rows.length > query.take;
      const items = rows.slice(0, query.take);
      return { items: items.map(row => response(row, room.name)), nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
        total: await tx.prisma.clip.count({ where }) };
    });
  }

  detail(clipId: number) {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      const row = await tx.prisma.clip.findFirst({ where: { id: clipId, status: 'VISIBLE',
        clipChannels: { some: { channelId: roomId } } }, include: clipInclude });
      if (!row) throw new ApiError('NOT_FOUND', 404);
      const room = await tx.prisma.rooms.findUniqueOrThrow({ where: { id: roomId }, select: { name: true } });
      return response(row, room.name);
    });
  }

  createRequest(credentials: CommandCredentials, value: unknown) {
    const fields = clipFields(value, true);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const channel = await this.repository.primary(tx);
      if (channel.ownerId === actor.userId) throw new ApiError('FORBIDDEN', 403);
      await this.requireSong(tx, channel.roomId, fields.songId);
      await this.repository.lockPrimary(tx);
      const alias = await tx.prisma.melomingUserAlias.findUnique({ where: { userId: actor.userId }, select: { id: true } });
      if (!alias) await tx.prisma.melomingUserAlias.create({ data: { id: await nextChannelContentId(tx.prisma), userId: actor.userId } });
      const row = await tx.prisma.clipRequest.create({ data: { id: await nextChannelContentId(tx.prisma),
        requesterId: actor.userId, channelId: channel.roomId, songId: fields.songId,
        title: fields.title, description: fields.description ?? null, platform: fields.platform,
        videoId: fields.videoId ?? null, videoUrl: fields.videoUrl ?? null, thumbnailUrl: fields.thumbnailUrl ?? null,
        duration: fields.duration ?? null, publishToHotClip: fields.publishToHotClip ?? true }, include: requestInclude });
      const room = await tx.prisma.rooms.findUniqueOrThrow({ where: { id: channel.roomId }, select: { name: true } });
      return requestResponse(row, room.name);
    });
  }

  requests(credentials: SessionCredentials, raw: Record<string, unknown>) {
    if (Object.keys(raw).some(key => !['status', 'take', 'cursorId'].includes(key))) throw new ApiError('INVALID_REQUEST', 400);
    if (raw.status !== undefined && !Object.values(ClipRequestStatus).includes(raw.status as ClipRequestStatus)) throw new ApiError('INVALID_REQUEST', 400);
    const take = raw.take === undefined ? 20 : id(raw.take);
    if (take > 100) throw new ApiError('INVALID_REQUEST', 400);
    const cursorId = raw.cursorId === undefined ? undefined : id(raw.cursorId);
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      const room = await tx.prisma.rooms.findUniqueOrThrow({ where: { id: roomId }, select: { name: true } });
      const where: Prisma.ClipRequestWhereInput = { channelId: roomId,
        ...(raw.status ? { status: raw.status as ClipRequestStatus } : {}),
        ...(cursorId ? { id: { lt: cursorId } } : {}) };
      const [rows, pendingCount] = await Promise.all([
        tx.prisma.clipRequest.findMany({ where, include: requestInclude, orderBy: { id: 'desc' }, take: take + 1 }),
        tx.prisma.clipRequest.count({ where: { channelId: roomId, status: 'PENDING' } })]);
      const items = rows.slice(0, take);
      return { items: items.map(row => requestResponse(row, room.name)),
        nextCursor: rows.length > take ? items.at(-1)?.id : undefined, pendingCount };
    });
  }

  processRequest(credentials: CommandCredentials, requestId: number, action: 'approve' | 'reject', value?: unknown) {
    let reason: string | undefined;
    if (action === 'reject') {
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => key !== 'reason')) throw new ApiError('INVALID_REQUEST', 400);
      reason = (value as { reason?: unknown }).reason as string | undefined;
      if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) throw new ApiError('INVALID_REQUEST', 400);
    }
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      const prior = await tx.prisma.clipRequest.findFirst({ where: { id: requestId, channelId: roomId, status: 'PENDING' } });
      if (!prior) throw new ApiError('NOT_FOUND', 404);
      const clip = action === 'approve' ? await this.createClip(tx, roomId, {
        title: prior.title, description: prior.description ?? undefined, platform: prior.platform,
        videoId: prior.videoId ?? undefined, videoUrl: prior.videoUrl ?? undefined,
        thumbnailUrl: prior.thumbnailUrl ?? undefined, duration: prior.duration ?? undefined,
        publishToHotClip: prior.publishToHotClip, songId: prior.songId }) : null;
      const row = await tx.prisma.clipRequest.update({ where: { id: requestId }, data: {
        status: action === 'approve' ? 'APPROVED' : 'REJECTED', processedById: actor.userId,
        processedAt: new Date(), rejectionReason: reason ?? null, approvedClipId: clip?.id ?? null }, include: requestInclude });
      const room = await tx.prisma.rooms.findUniqueOrThrow({ where: { id: roomId }, select: { name: true } });
      return requestResponse(row, room.name);
    });
  }

  // Meloming ClipResolveService providers, with a fixed-host request destination.
  async resolve(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 ||
      typeof (value as { url?: unknown }).url !== 'string') throw new ApiError('INVALID_REQUEST', 400);
    const input = (value as { url: string }).url.trim();
    if (!input || input.length > 2048) throw new ApiError('INVALID_REQUEST', 400);
    let url: URL;
    try { url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); }
    catch { throw new ApiError('INVALID_REQUEST', 400); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new ApiError('INVALID_REQUEST', 400);
    const host = url.hostname.toLowerCase();
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be'].includes(host)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const videoId = host === 'youtu.be' ? parts[0] : url.searchParams.get('v') ??
        (['embed', 'shorts', 'v', 'live'].includes(parts[0] ?? '') ? parts[1] : undefined);
      if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new ApiError('INVALID_REQUEST', 400);
      try {
        const result = await axios.get<{ title: string; author_name: string }>('https://www.youtube.com/oembed', {
          params: { url: `https://www.youtube.com/watch?v=${videoId}`, format: 'json' }, timeout: 6000 });
        return { platform: 'YOUTUBE', videoId, title: result.data.title, authorName: result.data.author_name,
          thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, originalUrl: input };
      } catch { throw new ApiError('INVALID_REQUEST', 400); }
    }
    if (['vod.sooplive.com', 'vod.sooplive.co.kr', 'vod.afreecatv.com', 'sooplive.com', 'www.sooplive.com', 'sooplive.co.kr', 'www.sooplive.co.kr'].includes(host)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const videoId = parts[0] === 'player' ? parts[1] : parts[1] === 'post' ? parts[2] : url.searchParams.get('titleNo');
      if (!videoId || !/^\d{1,20}$/.test(videoId)) throw new ApiError('INVALID_REQUEST', 400);
      try {
        const form = new URLSearchParams({ nTitleNo: videoId, nApiLevel: '11', nPlaylistIdx: '0' });
        const result = await axios.post<{ result: number; data?: { full_title?: string; title?: string; content?: string; thumb?: string; total_file_duration?: number; writer_nick?: string } }>(
          'https://api.m.sooplive.co.kr/station/video/a/view', form, { timeout: 6000 });
        if (result.data.result !== 1 || !result.data.data) throw new Error('soop');
        const data = result.data.data;
        return { platform: 'SOOP', videoId, title: data.full_title || data.title || '제목 없음',
          description: data.content, thumbnailUrl: data.thumb?.startsWith('//') ? `https:${data.thumb}` : data.thumb,
          duration: data.total_file_duration ? Math.floor(data.total_file_duration / 1000) : undefined,
          authorName: data.writer_nick, originalUrl: input };
      } catch { throw new ApiError('INVALID_REQUEST', 400); }
    }
    if (host === 'chzzk.naver.com' || host === 'www.chzzk.naver.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'video') throw new ApiError('INVALID_REQUEST', 400);
      const videoId = parts[0] === 'clips' ? parts[1] : parts[0] === 'embed' && parts[1] === 'clip' ? parts[2] : undefined;
      if (!videoId || !/^[A-Za-z0-9_-]{1,100}$/.test(videoId)) throw new ApiError('INVALID_REQUEST', 400);
      try {
        const result = await axios.get<{ code: number; content?: { clipTitle: string; thumbnailImageUrl: string; duration: number; optionalProperty?: { ownerChannel?: { channelName: string } } } }>(
          `https://api.chzzk.naver.com/service/v1/clips/${videoId}/detail`, { params: { optionalProperties: 'OWNER_CHANNEL' }, timeout: 6000 });
        if (result.data.code !== 200 || !result.data.content) throw new Error('chzzk');
        return { platform: 'CHZZK', videoId, title: result.data.content.clipTitle,
          thumbnailUrl: result.data.content.thumbnailImageUrl, duration: result.data.content.duration,
          authorName: result.data.content.optionalProperty?.ownerChannel?.channelName, originalUrl: input };
      } catch { throw new ApiError('INVALID_REQUEST', 400); }
    }
    throw new ApiError('INVALID_REQUEST', 400);
  }
}
