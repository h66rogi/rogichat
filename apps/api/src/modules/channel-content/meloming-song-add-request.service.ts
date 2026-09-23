import { Inject, Injectable } from '@nestjs/common';
import { SongAddRequestStatus } from '../../generated/prisma/client.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { nextChannelContentId } from './channel-content-id.js';
import { SongAddRequestService } from './upstream/song-add-request.service.js';

type RequestFields = { channelId: number; title: string; artistName: string; albumArt?: string;
  karaokeUrl?: string; coverUrl?: string; originalUrl?: string; difficulty?: number;
  proficiency?: number; songKey?: string; bpm?: number; lyricsLink?: string;
  lyricsText?: string; categoryNames?: string[] };

function fields(value: unknown, create: boolean): RequestFields | Partial<RequestFields> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
  const raw = value as Record<string, unknown>;
  const allowed = ['channelId','title','artistName','albumArt','karaokeUrl','coverUrl','originalUrl',
    'difficulty','proficiency','songKey','bpm','lyricsLink','lyricsText','categoryNames','autoSearchAlbumArt'];
  if (Object.keys(raw).some(key => !allowed.includes(key)) ||
      (create && (raw.channelId !== 1 || typeof raw.title !== 'string' || typeof raw.artistName !== 'string')) ||
      (!create && raw.channelId !== undefined)) throw new ApiError('INVALID_REQUEST', 400);
  for (const key of ['title','artistName','albumArt','karaokeUrl','coverUrl','originalUrl','songKey','lyricsLink','lyricsText']) {
    const v = raw[key];
    if (v !== undefined && (typeof v !== 'string' || v.length > (key === 'lyricsText' ? 100000 : key === 'title' || key === 'artistName' ? 255 : 2048) ||
      (['title','artistName'].includes(key) && !v.trim()))) throw new ApiError('INVALID_REQUEST', 400);
  }
  for (const key of ['albumArt','karaokeUrl','coverUrl','originalUrl','lyricsLink']) {
    const v = raw[key];
    if (typeof v !== 'string' || !v) continue;
    try { if (!['http:','https:'].includes(new URL(v).protocol)) throw new Error('protocol'); }
    catch { throw new ApiError('INVALID_REQUEST', 400); }
  }
  for (const key of ['difficulty','proficiency','bpm']) {
    const v = raw[key];
    if (v !== undefined && (!Number.isSafeInteger(v) || Number(v) < 1 ||
      (key !== 'bpm' && Number(v) > 5))) throw new ApiError('INVALID_REQUEST', 400);
  }
  if (raw.categoryNames !== undefined && (!Array.isArray(raw.categoryNames) || raw.categoryNames.length > 50 ||
      raw.categoryNames.some(name => typeof name !== 'string' || !name.trim() || name.length > 255))) throw new ApiError('INVALID_REQUEST', 400);
  if (raw.autoSearchAlbumArt !== undefined && typeof raw.autoSearchAlbumArt !== 'boolean') throw new ApiError('INVALID_REQUEST', 400);
  const { autoSearchAlbumArt: _ignored, ...body } = raw;
  void _ignored;
  return body as RequestFields | Partial<RequestFields>;
}

function listQuery(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['status','cursorId','take'].includes(key))) throw new ApiError('INVALID_REQUEST', 400);
  const status = raw.status;
  if (status !== undefined && !Object.values(SongAddRequestStatus).includes(status as SongAddRequestStatus)) throw new ApiError('INVALID_REQUEST', 400);
  for (const key of ['cursorId','take']) if (raw[key] !== undefined &&
      (typeof raw[key] !== 'string' || !/^[1-9]\d{0,9}$/.test(raw[key]) || !Number.isSafeInteger(Number(raw[key])) ||
      (key === 'take' && Number(raw[key]) > 100))) throw new ApiError('INVALID_REQUEST', 400);
  return { ...(status ? { status: status as SongAddRequestStatus } : {}),
    ...(raw.cursorId ? { cursorId: Number(raw.cursorId) } : {}),
    ...(raw.take ? { take: Number(raw.take) } : {}) };
}

@Injectable()
export class MelomingSongAddRequestService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  private async ensureAlias(tx: Parameters<Parameters<Transactions['write']>[0]>[0], userId: string) {
    const existing = await tx.prisma.melomingUserAlias.findUnique({ where: { userId }, select: { id: true } });
    if (existing) return existing.id;
    return (await tx.prisma.melomingUserAlias.create({ data: { id: await nextChannelContentId(tx.prisma), userId }, select: { id: true } })).id;
  }

  permission(credentials: SessionCredentials) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const channel = await this.repository.primary(tx);
      const hasPermission = channel.ownerId === actor.userId;
      return { channelId: 1, hasPermission, canRequestSong: !hasPermission };
    });
  }

  create(credentials: CommandCredentials, value: unknown) {
    const dto = fields(value, true) as RequestFields;
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      await this.repository.lockPrimary(tx);
      const channel = await this.repository.primary(tx);
      await this.ensureAlias(tx, actor.userId);
      return new SongAddRequestService(tx.prisma, channel.roomId, channel.ownerId).createRequest(actor.userId, dto);
    });
  }

  my(credentials: SessionCredentials, raw: Record<string, unknown>) {
    const query = listQuery(raw);
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const channel = await this.repository.primary(tx);
      return new SongAddRequestService(tx.prisma, channel.roomId, channel.ownerId).getMyRequests(actor.userId, query);
    });
  }

  channelRequests(credentials: SessionCredentials, raw: Record<string, unknown>) {
    const query = listQuery(raw);
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const channel = await this.repository.primary(tx);
      await this.repository.requireOwner(tx, actor.userId);
      return new SongAddRequestService(tx.prisma, channel.roomId, channel.ownerId).getChannelRequests(actor.userId, channel.roomId, query);
    });
  }

  approve(credentials: CommandCredentials, id: number, value: unknown) {
    const dto = fields(value ?? {}, false);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      await this.ensureAlias(tx, actor.userId);
      const channel = await this.repository.primary(tx);
      return new SongAddRequestService(tx.prisma, channel.roomId, channel.ownerId).approveRequest(actor.userId, id, dto);
    });
  }

  reject(credentials: CommandCredentials, id: number, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'reason') ||
      ((value as Record<string, unknown>).reason !== undefined && (typeof (value as Record<string, unknown>).reason !== 'string' || String((value as Record<string, unknown>).reason).length > 500))) throw new ApiError('INVALID_REQUEST', 400);
    const reason = (value as { reason?: string }).reason;
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      await this.ensureAlias(tx, actor.userId);
      const channel = await this.repository.primary(tx);
      return new SongAddRequestService(tx.prisma, channel.roomId, channel.ownerId).rejectRequest(actor.userId, id, reason === undefined ? {} : { reason });
    });
  }

  cancel(credentials: CommandCredentials, id: number) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      await this.repository.lockPrimary(tx);
      const channel = await this.repository.primary(tx);
      return new SongAddRequestService(tx.prisma, channel.roomId, channel.ownerId).cancelRequest(actor.userId, id);
    });
  }
}
