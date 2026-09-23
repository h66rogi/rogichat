import { SongRequestSource, SongRequestStatus } from '../../../generated/prisma/client.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApiError } from '../../auth/auth-primitives.js';
import { songRequestWithSongSelect } from './song-request.selections.js';
import { SongRequestQueueService } from './song-request-queue.service.js';

type RequestRow = Prisma.SongRequestGetPayload<{select:typeof songRequestWithSongSelect}>;

/** Copied and adapted from meloming-back SongRequestService controller methods. */
export class SongRequestService {
  private readonly queue:SongRequestQueueService;
  constructor(private readonly prisma:Prisma.TransactionClient,private readonly channelId:string) {
    this.queue = new SongRequestQueueService(prisma,channelId);
  }

  private async project(request:RequestRow) {
    const alias = request.requestUserId ? await this.prisma.melomingUserAlias.findUnique({
      where:{userId:request.requestUserId},select:{id:true} }) : null;
    return { id:request.id,liveSessionId:request.liveSessionId,songId:request.songId,
      sourceChannelId:request.sourceChannelId ? 1 : null,
      rawArtist:request.rawArtist,rawTitle:request.rawTitle,rawMessage:request.rawMessage,
      requesterPlatformId:request.requesterPlatformId,requesterNickname:request.requesterNickname,
      requestUserId:alias?.id ?? null,isAnonymous:request.isAnonymous,status:request.status,source:request.source,
      requestType:request.requestType,donationAmount:request.donationAmount,
      donationNativeAmount:request.donationNativeAmount,donationCurrency:request.donationCurrency,
      priority:request.priority,queueOrder:request.queueOrder,calculatedPrice:request.calculatedPrice,
      priceSource:request.priceSource,formattedPrice:request.calculatedPrice == null ? '무료' : `${request.calculatedPrice.toLocaleString()}원`,
      playedAt:request.playedAt?.toISOString() ?? null,completedAt:request.completedAt?.toISOString() ?? null,
      rejectionReason:request.rejectionReason,createdAt:request.createdAt.toISOString(),updatedAt:request.updatedAt.toISOString(),
      song:request.song ? { ...request.song,categories:await this.prisma.songCategory.findMany({
        where:{songId:request.song.id},select:{category:{select:{id:true,name:true,color:true}}}
      }).then(rows=>rows.map(row=>row.category)) } : null };
  }

  /** Source getQueueBySessionId. */
  async getQueueBySessionId(liveSessionId:number,includeCompleted=false) {
    const session = await this.prisma.liveSession.findFirst({where:{id:liveSessionId,channelId:this.channelId},select:{id:true,visibility:true}});
    if (!session) throw new ApiError('NOT_FOUND',404);
    const requests = await this.queue.getQueue(liveSessionId,includeCompleted);
    const mapped = await Promise.all(requests.map(request=>this.project(request)));
    return {requests:mapped,total:mapped.length};
  }

  /** Source createRequest trust boundary: public DTO identity and donation are discarded. */
  async createRequest(dto:{liveSessionId:number;songId?:number;rawArtist:string;rawTitle:string;rawMessage?:string;
    requestType?:'NORMAL'|'RANDOM';position?:'FRONT'|'BACK'|'AFTER';afterRequestId?:number},
    actor:{userId:string;nickname:string;alias:number;operator:boolean}) {
    const created = await this.queue.addToQueue(dto.liveSessionId,{
      ...(dto.songId ? {songId:dto.songId}:{}),rawArtist:dto.rawArtist,rawTitle:dto.rawTitle,
      ...(dto.rawMessage ? {rawMessage:dto.rawMessage}:{}),
      requesterPlatformId:`web_${actor.alias}`,requesterNickname:actor.nickname,requestUserId:actor.userId,
      allowManualBypass:actor.operator,requestType:dto.requestType ?? 'NORMAL',
      ...(actor.operator && dto.position ? {insertPosition:dto.position}:{}),
      ...(actor.operator && dto.afterRequestId ? {insertAfterRequestId:dto.afterRequestId}:{}),
    });
    return this.project(created);
  }

  async getNowPlaying(liveSessionId:number) {
    const request = await this.prisma.songRequest.findFirst({where:{liveSessionId,status:SongRequestStatus.PLAYING},
      orderBy:[{playedAt:'desc'},{id:'desc'}],select:songRequestWithSongSelect});
    return request ? this.project(request) : null;
  }

  private async sessionForRequest(requestId:number) {
    const request = await this.prisma.songRequest.findFirst({where:{id:requestId,liveSession:{channelId:this.channelId}},
      select:{id:true,liveSessionId:true,status:true,requestUserId:true}});
    if (!request) throw new ApiError('NOT_FOUND',404);
    return request;
  }

  /** Source updateStatus state timestamp handling, with the revision in one transaction. */
  async updateStatus(requestId:number,status:'PENDING'|'ACCEPTED'|'REJECTED'|'PLAYING'|'COMPLETED',rejectionReason?:string) {
    const existing = await this.sessionForRequest(requestId);
    const now=new Date();
    const updated = await this.prisma.songRequest.update({where:{id:requestId},data:{status,
      ...(status==='PLAYING'?{playedAt:now,completedAt:null,rejectionReason:null}:{}),
      ...(status==='COMPLETED'?{completedAt:now,rejectionReason:null}:{}),
      ...(status==='REJECTED'?{rejectionReason:rejectionReason ?? null}:{}),
      ...(status==='PENDING'?{playedAt:null,completedAt:null,rejectionReason:null}:{})},
      select:songRequestWithSongSelect});
    await this.prisma.liveSession.update({where:{id:existing.liveSessionId},data:{playbackRevision:{increment:1}}});
    return this.project(updated);
  }

  async deleteRequest(requestId:number) { await this.sessionForRequest(requestId); await this.queue.removeFromQueue(requestId); }
  async cancelMyRequest(requestId:number,userId:string) {
    const request=await this.sessionForRequest(requestId);
    if (request.requestUserId!==userId) throw new ApiError('FORBIDDEN',403);
    if (request.status!==SongRequestStatus.PENDING) throw new ApiError('INVALID_REQUEST',400);
    await this.queue.removeFromQueue(requestId);
  }
  async updateQueueOrder(requestId:number,newOrder:number) { await this.sessionForRequest(requestId); await this.queue.updateOrder(requestId,newOrder); }

  /** Source playNext: complete current only when a next request exists. */
  async playNext(liveSessionId:number) {
    const session=await this.prisma.liveSession.findFirst({where:{id:liveSessionId,channelId:this.channelId,status:'ACTIVE'},select:{id:true}});
    if (!session) return null;
    const next=await this.prisma.songRequest.findFirst({where:{liveSessionId,status:{in:[SongRequestStatus.PENDING,SongRequestStatus.ACCEPTED]}},
      orderBy:[{priority:'desc'},{queueOrder:'asc'}],select:{id:true}});
    const current=await this.prisma.songRequest.findFirst({where:{liveSessionId,status:SongRequestStatus.PLAYING},
      orderBy:[{playedAt:'desc'},{id:'desc'}],select:{id:true}});
    if (!next) return this.getNowPlaying(liveSessionId);
    const now=new Date();
    if (current) await this.prisma.songRequest.update({where:{id:current.id},data:{status:'COMPLETED',completedAt:now}});
    const playing=await this.prisma.songRequest.update({where:{id:next.id},data:{status:'PLAYING',playedAt:now},select:songRequestWithSongSelect});
    await this.prisma.liveSession.update({where:{id:liveSessionId},data:{playbackRevision:{increment:1}}});
    return this.project(playing);
  }

  /** Source skipCurrent: reject playing and advance. */
  async skipCurrent(liveSessionId:number,reason?:string) {
    const current=await this.prisma.songRequest.findFirst({where:{liveSessionId,status:SongRequestStatus.PLAYING},
      orderBy:[{playedAt:'desc'},{id:'desc'}],select:{id:true}});
    if (current) await this.prisma.songRequest.update({where:{id:current.id},data:{status:'REJECTED',rejectionReason:reason || '스킵됨'}});
    return this.playNext(liveSessionId);
  }

  async playNow(requestId:number) {
    const request=await this.sessionForRequest(requestId);
    const current=await this.prisma.songRequest.findFirst({where:{liveSessionId:request.liveSessionId,status:'PLAYING'},select:{id:true}});
    if (current && current.id!==requestId) await this.prisma.songRequest.update({where:{id:current.id},data:{status:'COMPLETED',completedAt:new Date()}});
    return this.updateStatus(requestId,'PLAYING');
  }

  async clearQueue(liveSessionId:number) {
    const deleted=await this.prisma.songRequest.deleteMany({where:{liveSessionId,status:SongRequestStatus.PENDING}});
    if (deleted.count) await this.prisma.liveSession.update({where:{id:liveSessionId},data:{playbackRevision:{increment:1}}});
    return {deletedCount:deleted.count,message:'대기열이 초기화되었습니다.'};
  }

  async getSongRequestStats(songId:number) {
    const result=await this.prisma.songRequest.aggregate({where:{songId,song:{channelId:this.channelId},
      status:{not:SongRequestStatus.REJECTED}},_count:{id:true},_max:{createdAt:true}});
    return {totalRequestCount:result._count.id,lastRequestedAt:result._max.createdAt?.toISOString() ?? null};
  }

  /** Source getSongRequestHistory: REJECTED excluded, anonymity and deletion masked. */
  async getSongRequestHistory(songId:number,page=1,limit=20) {
    const skip=(page-1)*limit;
    const where={songId,song:{channelId:this.channelId},status:{not:SongRequestStatus.REJECTED},
      source:{not:SongRequestSource.COMPETITOR}};
    const [rows,total]=await Promise.all([
      this.prisma.songRequest.findMany({where,select:{id:true,requesterNickname:true,isAnonymous:true,
        status:true,source:true,donationAmount:true,donationCurrency:true,createdAt:true,
        requestUser:{select:{status:true}}},orderBy:{createdAt:'desc'},skip,take:limit}),
      this.prisma.songRequest.count({where}),
    ]);
    const requests=rows.map(r=>({id:r.id,requesterNickname:r.isAnonymous?'익명':
      r.requestUser?.status==='DELETED'?'(탈퇴한 사용자)':r.requesterNickname,
      isAnonymous:r.isAnonymous,status:r.status,source:r.source,donationAmount:r.donationAmount,
      donationCurrency:r.donationCurrency,createdAt:r.createdAt.toISOString()}));
    return {requests,pagination:{page,limit,total,totalPages:Math.ceil(total/limit)}};
  }

  async getRequestedSongIds(sessionId:number) {
    const rows=await this.prisma.songRequest.findMany({where:{liveSessionId:sessionId,status:{not:SongRequestStatus.REJECTED},songId:{not:null}},
      select:{songId:true}});
    return {songIds:[...new Set(rows.map(row=>row.songId).filter((id):id is number=>id!==null))]};
  }
}
