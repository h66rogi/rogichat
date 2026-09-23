import { randomBytes } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { LiveSessionStatus, LiveSessionType, SongRequestSource, SongRequestStatus } from '../../../generated/prisma/client.js';
import { ApiError } from '../../auth/auth-primitives.js';
import { nextChannelContentId } from '../channel-content-id.js';
import { ChannelSongRequestSettingsService } from './channel-song-request-settings.service.js';
import { mergeEffectiveSongRequestSettings } from './effective-song-request-settings.js';
import type { UpdateChannelSongRequestSettingsDto } from './channel-song-request-settings.service.js';

/** Adapted source methods from meloming-back/src/song-live/session.service.ts. */
export class LiveSessionService {
  constructor(private readonly prisma: Prisma.TransactionClient, private readonly channelId: string,
    private readonly ownerId: string, private readonly ownerAlias: number) {}

  private async withEffectiveSettings(session: { id: number; settings: { requestEnabled: boolean; paused: boolean } | null }) {
    const channelSettings = await new ChannelSongRequestSettingsService(this.prisma).getByChannelId(this.channelId);
    const effective = mergeEffectiveSongRequestSettings(session.settings, channelSettings);
    return { ...session, settings: { ...(session.settings ?? {}), ...effective } };
  }

  private response(session: { id: number; platform: string | null; platformChannelId: string | null;
    status: string; visibility: string; overlayToken: string; startedAt: Date; endedAt: Date | null;
    createdAt: Date; updatedAt: Date; settings: { id: number; requestEnabled: boolean; paused: boolean } | null },
  effectiveSettings: object) {
    return { id: session.id, channelId: 1, userId: this.ownerAlias, platform: session.platform,
      platformChannelId: session.platformChannelId, status: session.status, visibility: session.visibility,
      overlayToken: session.overlayToken, startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null, createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(), settings: { id: session.settings?.id, ...effectiveSettings } };
  }

  /** Copied source startSession flow: active check, STANDARD row, settings row. */
  async startSession(dto: { platform?: 'SOOP'; practiceMode?: boolean }) {
    const activeSession = await this.prisma.liveSession.findFirst({ where: {
      channelId: this.channelId, status: LiveSessionStatus.ACTIVE, sessionType: LiveSessionType.STANDARD,
    }, select: { id: true } });
    if (activeSession) throw new ApiError('INVALID_REQUEST', 400);
    await new ChannelSongRequestSettingsService(this.prisma).getByChannelId(this.channelId);
    const sessionId = await nextChannelContentId(this.prisma);
    const session = await this.prisma.liveSession.create({ data: {
      id: sessionId, channelId: this.channelId, userId: this.ownerId,
      platform: 'SOOP', platformChannelId: null, overlayToken: randomBytes(32).toString('hex'),
      status: LiveSessionStatus.ACTIVE, sessionType: LiveSessionType.STANDARD,
      visibility: dto.practiceMode ? 'PRIVATE' : 'PUBLIC', playbackRevision: 1,
    }, select: { id: true } });
    await this.prisma.liveSessionSettings.create({ data: {
      id: await nextChannelContentId(this.prisma), liveSessionId: session.id, requestEnabled: true, paused: false,
    } });
    return this.getActiveSession();
  }

  /** Copied source getActiveSession query and effective settings merge. */
  async getActiveSession() {
    const session = await this.prisma.liveSession.findFirst({ where: {
      channelId: this.channelId, status: LiveSessionStatus.ACTIVE, sessionType: LiveSessionType.STANDARD,
    }, select: { id: true, platform: true, platformChannelId: true, status: true, visibility: true,
      overlayToken: true, startedAt: true, endedAt: true, createdAt: true, updatedAt: true,
      settings: { select: { id: true, requestEnabled: true, paused: true } } } });
    if (!session) return null;
    const merged = await this.withEffectiveSettings(session);
    return this.response(session, merged.settings);
  }

  /** Copied source public active projection. Practice sessions stay owner-only. */
  async getPublicActiveSession(ownerViewer: boolean) {
    const session = await this.prisma.liveSession.findFirst({ where: {
      channelId: this.channelId, status: LiveSessionStatus.ACTIVE, sessionType: LiveSessionType.STANDARD,
    }, select: { id: true, visibility: true, settings: { select: { requestEnabled: true, paused: true } } } });
    if (!session || (session.visibility === 'PRIVATE' && !ownerViewer)) return {
      sessionId: null, isLive: false, settings: null, queueCount: 0,
    };
    const channelSettings = await new ChannelSongRequestSettingsService(this.prisma).getByChannelId(this.channelId);
    const effective = mergeEffectiveSongRequestSettings(session.settings, channelSettings);
    const queueCount = await this.prisma.songRequest.count({ where: { liveSessionId: session.id,
      status: { in: [SongRequestStatus.PENDING,SongRequestStatus.ACCEPTED,SongRequestStatus.PLAYING] } } });
    return { sessionId: session.id, isLive: true, settings: effective, queueCount,
      isPracticeMode: session.visibility === 'PRIVATE' };
  }

  /** Copied source updateSettings scope split: transient live flags plus channel settings. */
  async updateSettings(sessionId:number,dto:UpdateChannelSongRequestSettingsDto & {requestEnabled?:boolean;paused?:boolean}) {
    const session=await this.prisma.liveSession.findFirst({where:{id:sessionId,channelId:this.channelId},select:{id:true,settings:{select:{id:true,requestEnabled:true,paused:true}}}});
    if(!session?.settings)throw new ApiError('NOT_FOUND',404);
    const liveScope:{requestEnabled?:boolean;paused?:boolean}={};
    if(dto.requestEnabled!==undefined)liveScope.requestEnabled=dto.requestEnabled;
    if(dto.paused!==undefined)liveScope.paused=dto.paused;
    if(dto.requestEnabled===false)liveScope.paused=false;
    const liveSettings=Object.keys(liveScope).length?await this.prisma.liveSessionSettings.update({where:{id:session.settings.id},data:liveScope}):session.settings;
    const channelService=new ChannelSongRequestSettingsService(this.prisma);
    const {requestEnabled,paused,...channelScope}=dto;
    void requestEnabled;void paused;
    const channelSettings=await channelService.update(this.channelId,channelScope);
    await this.prisma.liveSession.update({where:{id:session.id},data:{playbackRevision:{increment:1}}});
    return {id:session.settings.id,...mergeEffectiveSongRequestSettings(liveSettings,channelSettings)};
  }

  /** Copied source cloneSession row and request restoration, scoped to the single Rogichat room. */
  async cloneSession(sourceSessionId:number) {
    const source=await this.prisma.liveSession.findFirst({where:{id:sourceSessionId,channelId:this.channelId,sessionType:LiveSessionType.STANDARD},
      include:{settings:true,songRequests:{orderBy:[{queueOrder:'asc'},{createdAt:'asc'}]}}});
    if(!source)throw new ApiError('NOT_FOUND',404);
    const active=await this.prisma.liveSession.findFirst({where:{channelId:this.channelId,status:LiveSessionStatus.ACTIVE,sessionType:LiveSessionType.STANDARD},select:{id:true}});
    if(active)throw new ApiError('CONFLICT',409);
    await new ChannelSongRequestSettingsService(this.prisma).getByChannelId(this.channelId);
    const id=await nextChannelContentId(this.prisma);
    await this.prisma.liveSession.create({data:{id,channelId:this.channelId,userId:this.ownerId,
      platform:source.platform,platformChannelId:source.platformChannelId,overlayToken:randomBytes(32).toString('hex'),
      status:LiveSessionStatus.ACTIVE,sessionType:LiveSessionType.STANDARD,playbackRevision:1}});
    await this.prisma.liveSessionSettings.create({data:{id:await nextChannelContentId(this.prisma),liveSessionId:id,
      requestEnabled:source.settings?.requestEnabled??true,paused:false}});
    for(const [index,request] of source.songRequests.entries()) {
      await this.prisma.songRequest.create({data:{id:await nextChannelContentId(this.prisma),liveSessionId:id,
        songId:request.songId,sourceChannelId:request.sourceChannelId,rawArtist:request.rawArtist,rawTitle:request.rawTitle,
        rawMessage:request.rawMessage,requesterPlatformId:request.requesterPlatformId,requesterNickname:request.requesterNickname,
        status:request.status,source:request.source,requestType:request.requestType,
        donationAmount:request.donationAmount,donationNativeAmount:request.donationNativeAmount,
        donationCurrency:request.donationCurrency??(request.donationAmount!==null?'KRW_LEGACY':null),
        donationRateVersion:request.donationRateVersion,priority:request.priority,queueOrder:index+1,
        calculatedPrice:request.calculatedPrice,priceSource:request.priceSource,playedAt:request.playedAt,
        completedAt:request.completedAt,rejectionReason:request.rejectionReason,
        requestUserId:request.requestUserId,isAnonymous:request.isAnonymous}});
    }
    return this.getActiveSession();
  }

  /** Copied source endSession state transition; private practice requests are discarded. */
  async endSession(sessionId: number) {
    const session = await this.prisma.liveSession.findFirst({ where: {
      id: sessionId, channelId: this.channelId, status: LiveSessionStatus.ACTIVE,
    }, select: { id: true, visibility: true } });
    if (!session) throw new ApiError('NOT_FOUND', 404);
    await this.prisma.liveSession.update({ where: { id: sessionId }, data: {
      status: LiveSessionStatus.ENDED, endedAt: new Date(), playbackRevision: { increment: 1 },
    } });
    if (session.visibility === 'PRIVATE') await this.prisma.songRequest.deleteMany({ where: { liveSessionId: sessionId } });
    const ended = await this.prisma.liveSession.findUniqueOrThrow({ where: { id: sessionId },
      select: { id: true, platform: true, platformChannelId: true, status: true, visibility: true,
        overlayToken: true, startedAt: true, endedAt: true, createdAt: true, updatedAt: true,
        settings: { select: { id: true, requestEnabled: true, paused: true } } } });
    const merged = await this.withEffectiveSettings(ended);
    return this.response(ended, merged.settings);
  }

  /** Copied source getSessionHistory aggregation and pagination. */
  async getSessionHistory(page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const where = { channelId: this.channelId, sessionType: LiveSessionType.STANDARD,
      status: LiveSessionStatus.ENDED } as const;
    const [sessions, total] = await Promise.all([
      this.prisma.liveSession.findMany({ where, orderBy: { startedAt: 'desc' }, skip, take: limit,
        select: { id: true, platform: true, status: true, startedAt: true, endedAt: true, createdAt: true,
          _count: { select: { songRequests: true } } } }),
      this.prisma.liveSession.count({ where }),
    ]);
    const sessionsWithStats = await Promise.all(sessions.map(async session => {
      const stats = await this.prisma.songRequest.groupBy({ by: ['status'], where: { liveSessionId: session.id }, _count: true });
      const totalDonation = await this.prisma.songRequest.aggregate({ where: { liveSessionId: session.id }, _sum: { donationAmount: true } });
      return { ...session, stats: { totalRequests: session._count.songRequests,
        completedCount: stats.find(s => s.status === 'COMPLETED')?._count || 0,
        rejectedCount: stats.find(s => s.status === 'REJECTED')?._count || 0,
        totalDonation: totalDonation._sum.donationAmount || 0 },
        duration: session.endedAt ? Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000 / 60) : null };
    }));
    return { sessions: sessionsWithStats, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  /** Copied source getSessionDetail stats and ordered song projection. */
  async getSessionDetail(sessionId: number) {
    const session = await this.prisma.liveSession.findFirst({ where: { id: sessionId, channelId: this.channelId },
      select: { id: true, platform: true, status: true, startedAt: true, endedAt: true,
        channel: { select: { name: true } }, settings: true,
        songRequests: { where: { source: { not: SongRequestSource.COMPETITOR } },
          orderBy: [{ playedAt: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, rawTitle: true, rawArtist: true, requesterNickname: true, status: true, source: true,
            donationAmount: true, playedAt: true, completedAt: true, rejectionReason: true, createdAt: true,
            song: { select: { title: true, albumArt: true, artist: { select: { name: true } } } } } } } });
    if (!session) throw new ApiError('NOT_FOUND', 404);
    const stats = { totalRequests: session.songRequests.length,
      completedCount: session.songRequests.filter(r => r.status === 'COMPLETED').length,
      rejectedCount: session.songRequests.filter(r => r.status === 'REJECTED').length,
      pendingCount: session.songRequests.filter(r => r.status === 'PENDING').length,
      totalDonation: session.songRequests.reduce((sum,r) => sum + (r.donationAmount || 0),0),
      donationRequests: session.songRequests.filter(r => r.donationAmount && r.donationAmount > 0).length };
    const duration = session.endedAt ? Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000 / 60) : null;
    return { id: session.id, platform: session.platform, status: session.status, startedAt: session.startedAt,
      endedAt: session.endedAt, duration,
      channel: { id: 1, name: session.channel.name, webPath: 'hurogi', profileImageUrl: '/images/hurogi-profile.png' },
      settings: session.settings, stats,
      songRequests: session.songRequests.map((req,index) => ({ id: req.id, order: index + 1,
        title: req.song?.title || req.rawTitle, artist: req.song?.artist?.name || req.rawArtist,
        requester: req.requesterNickname, status: req.status, source: req.source,
        donationAmount: req.donationAmount, playedAt: req.playedAt, completedAt: req.completedAt,
        rejectionReason: req.rejectionReason, createdAt: req.createdAt, albumArt: req.song?.albumArt })) };
  }
}
