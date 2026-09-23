import { randomInt } from 'node:crypto';
import { LiveSessionStatus, SongRequestSource, SongRequestStatus, SongRequestType } from '../../../generated/prisma/client.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApiError } from '../../auth/auth-primitives.js';
import { nextChannelContentId } from '../channel-content-id.js';
import { ChannelSongRequestSettingsService } from './channel-song-request-settings.service.js';
import { mergeEffectiveSongRequestSettings } from './effective-song-request-settings.js';
import { songRequestWithSongSelect } from './song-request.selections.js';

type RequestData = {
  songId?: number; rawArtist: string; rawTitle: string; rawMessage?: string;
  requesterPlatformId: string; requesterNickname: string; requestUserId?: string;
  isAnonymous?: boolean; allowManualBypass?: boolean; requestType?: SongRequestType;
  insertPosition?: 'FRONT' | 'BACK' | 'AFTER'; insertAfterRequestId?: number;
};

/** Copied and adapted from meloming-back SongRequestQueueService. */
export class SongRequestQueueService {
  constructor(private readonly prisma: Prisma.TransactionClient, private readonly channelId: string) {}

  /** Source addToQueue ordering, settings guards and song/category checks. */
  async addToQueue(liveSessionId: number, requestData: RequestData) {
    const requestType = requestData.requestType ?? SongRequestType.NORMAL;
    const isRandomRequest = requestType === SongRequestType.RANDOM;
    let rawArtist = this.normalizeOptionalText(requestData.rawArtist,255) ?? '';
    let rawTitle = this.normalizeOptionalText(requestData.rawTitle,255) ?? '';
    const rawMessage = this.normalizeOptionalText(requestData.rawMessage,1000);
    const requesterPlatformId = this.normalizeRequiredText(requestData.requesterPlatformId,'신청자 플랫폼 ID',64);
    const requesterNickname = this.normalizeRequiredText(requestData.requesterNickname,'신청자 닉네임',255);
    const session = await this.prisma.liveSession.findFirst({ where: { id: liveSessionId, channelId: this.channelId },
      include: { settings: true } });
    if (!session || session.status !== LiveSessionStatus.ACTIVE) throw new ApiError('NOT_FOUND',404);
    const channelSettings = await new ChannelSongRequestSettingsService(this.prisma).getByChannelId(session.channelId);
    const settings = mergeEffectiveSongRequestSettings(session.settings,channelSettings);
    const allowManualBypass = requestData.allowManualBypass === true;
    if (!settings.requestEnabled) throw new ApiError('INVALID_REQUEST',400);
    if (settings.paused && !allowManualBypass) throw new ApiError('INVALID_REQUEST',400);
    if (!allowManualBypass) {
      if (settings.requestMode === 'CHAT_ONLY' || settings.donationOnlyEnabled) throw new ApiError('INVALID_REQUEST',400);
      if (settings.maxQueueSize > 0 && await this.prisma.songRequest.count({ where: { liveSessionId,
        status: { in: [SongRequestStatus.PENDING,SongRequestStatus.ACCEPTED,SongRequestStatus.PLAYING] } } }) >= settings.maxQueueSize) throw new ApiError('INVALID_REQUEST',400);
      if (settings.maxTotalRequests > 0 && await this.prisma.songRequest.count({ where: { liveSessionId,
        status: { not: SongRequestStatus.REJECTED } } }) >= settings.maxTotalRequests) throw new ApiError('INVALID_REQUEST',400);
      if (settings.maxRequestsPerUser > 0 && await this.prisma.songRequest.count({ where: { liveSessionId,requesterPlatformId,
        status: { not: SongRequestStatus.REJECTED } } }) >= settings.maxRequestsPerUser) throw new ApiError('INVALID_REQUEST',400);
    }
    let matchedSongId = requestData.songId;
    const blockedCategoryIds = settings.blockedCategoryIds;
    if (isRandomRequest) {
      if (!settings.randomRequestEnabled) throw new ApiError('INVALID_REQUEST',400);
      const candidates = await this.prisma.song.findMany({ where: { channelId: this.channelId,
        ...(rawTitle || rawArtist ? { OR: [{ title: { contains: rawTitle || rawArtist } },{ artist: { name: { contains: rawTitle || rawArtist } } }] } : {}),
        ...(blockedCategoryIds.length ? { songCategories: { none: { categoryId: { in: blockedCategoryIds } } } } : {}),
      }, select: { id: true,title: true,artist: { select: { name: true } } },take:2000 });
      const eligible = settings.preventDuplicateSongs && !allowManualBypass
        ? await Promise.all(candidates.map(async song => ({ song,
          duplicate: await this.prisma.songRequest.findFirst({ where: { liveSessionId,songId:song.id,
            status:{not:SongRequestStatus.REJECTED} },select:{id:true} }) })))
          .then(rows => rows.filter(row => !row.duplicate).map(row => row.song)) : candidates;
      if (!eligible.length) throw new ApiError('INVALID_REQUEST',400);
      const winner = eligible[randomInt(eligible.length)]!;
      matchedSongId = winner.id;
      rawArtist = winner.artist.name;
      rawTitle = winner.title;
    } else if (matchedSongId) {
      const song = await this.prisma.song.findFirst({ where: { id: matchedSongId,channelId:this.channelId },
        select: { id:true,title:true,artist:{select:{name:true}} } });
      if (!song) throw new ApiError('NOT_FOUND',404);
      rawArtist = song.artist.name;
      rawTitle = song.title;
    } else if (settings.requireSongMatch && !allowManualBypass) throw new ApiError('INVALID_REQUEST',400);
    if (!rawArtist && !rawTitle) throw new ApiError('INVALID_REQUEST',400);
    if (matchedSongId && blockedCategoryIds.length && !allowManualBypass) {
      const blocked = await this.prisma.songCategory.findFirst({ where: { songId:matchedSongId,
        categoryId:{in:blockedCategoryIds} },select:{id:true} });
      if (blocked) throw new ApiError('INVALID_REQUEST',400);
    }
    if (settings.preventDuplicateSongs && !allowManualBypass) {
      const duplicateWhere: Prisma.SongRequestWhereInput = { liveSessionId,status:{not:SongRequestStatus.REJECTED},
        ...(matchedSongId ? {songId:matchedSongId}:{rawArtist,rawTitle}) };
      if (await this.prisma.songRequest.findFirst({where:duplicateWhere,select:{id:true}})) throw new ApiError('INVALID_REQUEST',400);
    }
    const insertPosition = allowManualBypass ? (requestData.insertPosition ?? 'BACK') : 'BACK';
    let nextOrder:number;
    if (insertPosition === 'AFTER') {
      if (!requestData.insertAfterRequestId) throw new ApiError('INVALID_REQUEST',400);
      const after = await this.prisma.songRequest.findFirst({ where: { id:requestData.insertAfterRequestId,liveSessionId },
        select:{queueOrder:true} });
      if (!after) throw new ApiError('NOT_FOUND',404);
      nextOrder = after.queueOrder + 1;
      await this.prisma.songRequest.updateMany({ where:{liveSessionId,queueOrder:{gte:nextOrder}},
        data:{queueOrder:{increment:1}} });
    } else if (insertPosition === 'FRONT') {
      const minRow = await this.prisma.songRequest.findFirst({where:{liveSessionId,status:{not:SongRequestStatus.REJECTED}},
        orderBy:{queueOrder:'asc'},select:{queueOrder:true}});
      nextOrder = minRow ? minRow.queueOrder - 1 : 1;
    } else {
      const lastRequest = await this.prisma.songRequest.findFirst({where:{liveSessionId,status:{not:SongRequestStatus.REJECTED}},
        orderBy:{queueOrder:'desc'},select:{queueOrder:true}});
      nextOrder = lastRequest ? lastRequest.queueOrder + 1 : 1;
    }
    const createdRequest = await this.prisma.songRequest.create({ data: {
      id:await nextChannelContentId(this.prisma),liveSessionId,songId:matchedSongId ?? null,
      rawArtist,rawTitle,rawMessage:rawMessage ?? null,requesterPlatformId,requesterNickname,
      source:SongRequestSource.MANUAL,requestType,priority:0,queueOrder:nextOrder,
      requestUserId:requestData.requestUserId ?? null,isAnonymous:requestData.isAnonymous ?? false,
    },select:songRequestWithSongSelect });
    await this.prisma.liveSession.update({where:{id:liveSessionId},data:{playbackRevision:{increment:1}}});
    return createdRequest;
  }

  /** Source getQueue status filter and priority/order sort. */
  async getQueue(liveSessionId:number,includeCompleted=false) {
    const statusFilter = includeCompleted ? undefined : { in: [SongRequestStatus.PENDING,SongRequestStatus.ACCEPTED,SongRequestStatus.PLAYING] };
    return this.prisma.songRequest.findMany({ where: { liveSessionId,source:{not:SongRequestSource.COMPETITOR},
      ...(statusFilter ? {status:statusFilter}:{}) },
      orderBy:[{priority:'desc'},{queueOrder:'asc'}],select:songRequestWithSongSelect });
  }

  /** Source updateOrder keeps completed/playing order stable. */
  async updateOrder(requestId:number,newOrderInPending:number) {
    const current = await this.prisma.songRequest.findUnique({where:{id:requestId},select:{queueOrder:true,liveSessionId:true,status:true}});
    if (!current || (current.status !== SongRequestStatus.PENDING && current.status !== SongRequestStatus.ACCEPTED)) throw new ApiError('INVALID_REQUEST',400);
    const pending = await this.prisma.songRequest.findMany({where:{liveSessionId:current.liveSessionId,
      status:{in:[SongRequestStatus.PENDING,SongRequestStatus.ACCEPTED]}},orderBy:[{queueOrder:'asc'},{id:'asc'}],select:{id:true}});
    if (newOrderInPending < 1 || newOrderInPending > pending.length) throw new ApiError('INVALID_REQUEST',400);
    const reordered = pending.filter(row => row.id !== requestId);
    reordered.splice(newOrderInPending - 1,0,{id:requestId});
    const base = await this.prisma.songRequest.findFirst({where:{liveSessionId:current.liveSessionId,
      status:{in:[SongRequestStatus.COMPLETED,SongRequestStatus.PLAYING]}},orderBy:{queueOrder:'desc'},select:{queueOrder:true}});
    for (let i=0;i<reordered.length;i++) await this.prisma.songRequest.update({where:{id:reordered[i]!.id},data:{queueOrder:(base?.queueOrder ?? 0)+i+1}});
    await this.prisma.liveSession.update({where:{id:current.liveSessionId},data:{playbackRevision:{increment:1}}});
  }

  /** Source removeFromQueue compacts subsequent queue positions. */
  async removeFromQueue(requestId:number) {
    const request = await this.prisma.songRequest.findUnique({where:{id:requestId},select:{queueOrder:true,liveSessionId:true}});
    if (!request) throw new ApiError('NOT_FOUND',404);
    await this.prisma.songRequest.delete({where:{id:requestId}});
    await this.prisma.songRequest.updateMany({where:{liveSessionId:request.liveSessionId,queueOrder:{gt:request.queueOrder}},
      data:{queueOrder:{decrement:1}}});
    await this.prisma.liveSession.update({where:{id:request.liveSessionId},data:{playbackRevision:{increment:1}}});
  }

  private normalizeRequiredText(value:unknown,_fieldName:string,maxLength:number):string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) throw new ApiError('INVALID_REQUEST',400);
    return value.trim();
  }
  private normalizeOptionalText(value:unknown,maxLength:number):string|undefined {
    if (value == null) return undefined;
    if (typeof value !== 'string' || value.trim().length > maxLength) throw new ApiError('INVALID_REQUEST',400);
    return value.trim() || undefined;
  }
}
