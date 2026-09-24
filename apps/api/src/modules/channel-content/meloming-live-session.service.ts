import { isChannelIdentifier } from './channel-identity.js';
import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { nextChannelContentId } from './channel-content-id.js';
import { LiveSessionService } from './upstream/live-session.service.js';
import { parseSongRequestSettings } from './meloming-song-request-settings.service.js';

export type ConsoleCredentials = { readonly consoleToken: string };
type LiveCredentials = SessionCredentials | ConsoleCredentials;

function identifier(value: unknown) {
  if (value !== undefined && !isChannelIdentifier(value, true)) throw new ApiError('NOT_FOUND', 404);
}
function positive(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d{0,3}$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
  return Math.min(Number(value),max);
}

@Injectable()
export class MelomingLiveSessionService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  private async owner(tx: Parameters<Parameters<Transactions['write']>[0]>[0], credentials: LiveCredentials) {
    if ('consoleToken' in credentials) return this.repository.requireConsoleToken(tx, credentials.consoleToken);
    const actor = await this.auth.require(tx, credentials, true);
    return { userId: actor.userId, roomId: await this.repository.requireOwner(tx, actor.userId) };
  }

  private async source(tx: Parameters<Parameters<Transactions['write']>[0]>[0], ownerId: string, roomId: string) {
    let alias = await tx.prisma.melomingUserAlias.findUnique({ where: { userId: ownerId }, select: { id: true } });
    if (!alias) alias = await tx.prisma.melomingUserAlias.create({ data: {
      id: await nextChannelContentId(tx.prisma), userId: ownerId,
    }, select: { id: true } });
    return new LiveSessionService(tx.prisma,roomId,ownerId,alias.id);
  }

  start(credentials: CommandCredentials | ConsoleCredentials, raw: Record<string, unknown>, value: unknown) {
    identifier(raw.identifier);
    if (Object.keys(raw).some(key => key !== 'identifier') || !value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !['platform','practiceMode'].includes(key)) ||
      (body.platform !== undefined && body.platform !== 'SOOP') ||
      (body.practiceMode !== undefined && typeof body.practiceMode !== 'boolean')) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.write(async tx => {
      const { userId, roomId } = await this.owner(tx, credentials);
      await this.repository.lockPrimary(tx);
      const soop=await tx.prisma.platform_soop.findUnique({where:{user_id:userId},
        select:{status:true,provider_subject:true}});
      const platformChannelId=soop?.status==='VERIFIED'?Buffer.from(soop.provider_subject).toString('utf8'):undefined;
      return (await this.source(tx,userId,roomId)).startSession({ platform: 'SOOP',
        practiceMode: body.practiceMode === true,...(platformChannelId?{platformChannelId}:{}) });
    });
  }

  active(credentials: LiveCredentials, raw: Record<string, unknown>) {
    identifier(raw.identifier);
    if (Object.keys(raw).some(key => key !== 'identifier')) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.write(async tx => {
      const { userId, roomId } = await this.owner(tx, credentials);
      return (await this.source(tx,userId,roomId)).getActiveSession();
    });
  }

  publicActive(credentials: SessionCredentials, raw: Record<string, unknown>) {
    identifier(raw.identifier);
    if (raw.identifier === undefined || Object.keys(raw).some(key => key !== 'identifier')) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.write(async tx => {
      const channel = await this.repository.primary(tx);
      let ownerViewer = false;
      if (credentials.token) {
        const actor = await this.auth.require(tx, credentials, true);
        ownerViewer = actor.userId === channel.ownerId;
      }
      if (!channel.ownerId) return { sessionId: null, isLive: false, settings: null, queueCount: 0 };
      return (await this.source(tx,channel.ownerId,channel.roomId)).getPublicActiveSession(ownerViewer);
    });
  }

  end(credentials: CommandCredentials | ConsoleCredentials, sessionId: number) {
    return this.transactions.write(async tx => {
      const { userId, roomId } = await this.owner(tx, credentials);
      await this.repository.lockPrimary(tx);
      return (await this.source(tx,userId,roomId)).endSession(sessionId);
    });
  }

  updateSettings(credentials:CommandCredentials | ConsoleCredentials,sessionId:number,value:unknown) {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError('INVALID_REQUEST',400);
    const raw=value as Record<string,unknown>;
    if(raw.requestEnabled!==undefined&&typeof raw.requestEnabled!=='boolean'||
      raw.paused!==undefined&&typeof raw.paused!=='boolean')throw new ApiError('INVALID_REQUEST',400);
    const {requestEnabled,paused,...channelScope}=raw;
    const parsed=parseSongRequestSettings(channelScope);
    return this.transactions.write(async tx=>{
      const { userId, roomId } = await this.owner(tx, credentials);
      await this.repository.lockPrimary(tx);
      return (await this.source(tx,userId,roomId)).updateSettings(sessionId,{...parsed,
        ...(requestEnabled!==undefined?{requestEnabled:requestEnabled as boolean}:{}),
        ...(paused!==undefined?{paused:paused as boolean}:{})});
    });
  }

  clone(credentials:CommandCredentials | ConsoleCredentials,sessionId:number,raw:Record<string,unknown>) {
    identifier(raw.identifier);
    if(Object.keys(raw).some(key=>key!=='identifier'))throw new ApiError('INVALID_REQUEST',400);
    return this.transactions.write(async tx=>{
      const { userId, roomId } = await this.owner(tx, credentials);
      await this.repository.lockPrimary(tx);
      return (await this.source(tx,userId,roomId)).cloneSession(sessionId);
    });
  }

  /** Adapted from Meloming SessionService.publishLyricsPlaybackState. */
  publishLyricsPlaybackState(credentials: CommandCredentials | ConsoleCredentials, sessionId: number, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
    const raw = value as Record<string, unknown>;
    if (Object.keys(raw).some(key => !['songRequestId','playbackSource','anchorMs','anchorAt',
      'playbackRate','durationMs','offsetMs','clientInstanceId'].includes(key)) ||
      (raw.songRequestId !== undefined && raw.songRequestId !== null &&
        (!Number.isSafeInteger(raw.songRequestId) || (raw.songRequestId as number) < 1)) ||
      !['video','manual'].includes(raw.playbackSource as string) ||
      typeof raw.anchorMs !== 'number' || !Number.isFinite(raw.anchorMs) || raw.anchorMs < 0 ||
      (raw.anchorAt !== undefined && raw.anchorAt !== null &&
        (typeof raw.anchorAt !== 'string' || Number.isNaN(Date.parse(raw.anchorAt)))) ||
      typeof raw.playbackRate !== 'number' || !Number.isFinite(raw.playbackRate) ||
        raw.playbackRate < 0.25 || raw.playbackRate > 4 ||
      typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs) || raw.durationMs < 0 ||
      typeof raw.offsetMs !== 'number' || !Number.isFinite(raw.offsetMs) ||
        raw.offsetMs < -60000 || raw.offsetMs > 60000 ||
      typeof raw.clientInstanceId !== 'string' || !raw.clientInstanceId ||
        raw.clientInstanceId.length > 64) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.read(async tx => {
      const { roomId } = await this.owner(tx, credentials);
      const session = await tx.prisma.liveSession.findFirst({
        where: { id: sessionId, channelId: roomId },
        select: { id: true, status: true, overlayToken: true },
      });
      if (!session) throw new ApiError('NOT_FOUND', 404);
      if (session.status !== 'ACTIVE' || !session.overlayToken) return null;
      return { overlayToken: session.overlayToken, sessionId: session.id,
        state: { songRequestId: raw.songRequestId ?? null,
          playbackSource: raw.playbackSource as 'video' | 'manual',
          anchorMs: raw.anchorMs as number, anchorAt: raw.anchorAt ?? null,
          playbackRate: raw.playbackRate as number, durationMs: raw.durationMs as number,
          offsetMs: raw.offsetMs as number, clientInstanceId: raw.clientInstanceId as string,
          emittedAt: new Date().toISOString() } };
    });
  }

  history(credentials: LiveCredentials, raw: Record<string, unknown>) {
    identifier(raw.identifier);
    if (Object.keys(raw).some(key => !['identifier','page','limit'].includes(key))) throw new ApiError('INVALID_REQUEST', 400);
    const page = positive(raw.page,1,1000), limit = positive(raw.limit,10,50);
    return this.transactions.write(async tx => {
      const { userId, roomId } = await this.owner(tx, credentials);
      return (await this.source(tx,userId,roomId)).getSessionHistory(page,limit);
    });
  }

  detail(credentials: LiveCredentials, sessionId: number) {
    return this.transactions.write(async tx => {
      const { userId, roomId } = await this.owner(tx, credentials);
      return (await this.source(tx,userId,roomId)).getSessionDetail(sessionId);
    });
  }
}
