import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { nextChannelContentId } from './channel-content-id.js';
import { SongRequestService } from './upstream/song-request.service.js';
import type { ConsoleCredentials } from './meloming-live-session.service.js';

type RequestCredentials = SessionCredentials | ConsoleCredentials;
type WriteCredentials = CommandCredentials | ConsoleCredentials;

function integer(value:unknown):number {
  if (typeof value==='number' && Number.isSafeInteger(value) && value>0) return value;
  if (typeof value==='string' && /^[1-9]\d{0,9}$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  throw new ApiError('INVALID_REQUEST',400);
}
function createBody(value:unknown,manual=false) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST',400);
  const raw=value as Record<string,unknown>;
  const allowed=['liveSessionId','songId','rawArtist','rawTitle','rawMessage','requesterPlatformId','requesterNickname',
    'anonymousNickname','source','donationAmount','donationNativeAmount','donationCurrency','position','afterRequestId','requestType','reviveFromRequestId'];
  if (Object.keys(raw).some(key=>!allowed.includes(key))) throw new ApiError('INVALID_REQUEST',400);
  const liveSessionId = manual ? undefined : integer(raw.liveSessionId);
  const songId = raw.songId===undefined ? undefined : integer(raw.songId);
  for (const key of ['rawArtist','rawTitle','rawMessage']) if (raw[key]!==undefined &&
    (typeof raw[key]!=='string' || String(raw[key]).length>(key==='rawMessage'?1000:255))) throw new ApiError('INVALID_REQUEST',400);
  if (raw.position!==undefined && !['FRONT','BACK','AFTER'].includes(String(raw.position))) throw new ApiError('INVALID_REQUEST',400);
  if (raw.requestType!==undefined && !['NORMAL','RANDOM'].includes(String(raw.requestType))) throw new ApiError('INVALID_REQUEST',400);
  const afterRequestId=raw.afterRequestId===undefined?undefined:integer(raw.afterRequestId);
  const reviveFromRequestId=raw.reviveFromRequestId===undefined?undefined:integer(raw.reviveFromRequestId);
  if(raw.anonymousNickname!==undefined && (typeof raw.anonymousNickname!=='string'||
    !raw.anonymousNickname.trim()||raw.anonymousNickname.trim().length>20))throw new ApiError('INVALID_REQUEST',400);
  if (raw.requesterPlatformId !== undefined && (typeof raw.requesterPlatformId !== 'string' ||
    !raw.requesterPlatformId.trim() || raw.requesterPlatformId.length > 128)) throw new ApiError('INVALID_REQUEST',400);
  if (raw.requesterNickname !== undefined && (typeof raw.requesterNickname !== 'string' ||
    !raw.requesterNickname.trim() || raw.requesterNickname.length > 100)) throw new ApiError('INVALID_REQUEST',400);
  return { liveSessionId,songId,rawArtist:typeof raw.rawArtist==='string'?raw.rawArtist:'',
    rawTitle:typeof raw.rawTitle==='string'?raw.rawTitle:'',
    ...(typeof raw.rawMessage==='string'?{rawMessage:raw.rawMessage}:{}),
    ...(raw.position?{position:raw.position as 'FRONT'|'BACK'|'AFTER'}:{}),
    ...(afterRequestId?{afterRequestId}:{}),
    ...(raw.requestType?{requestType:raw.requestType as 'NORMAL'|'RANDOM'}:{}),
    ...(reviveFromRequestId?{reviveFromRequestId}:{}),
    ...(typeof raw.requesterPlatformId==='string'?{requesterPlatformId:raw.requesterPlatformId}:{}),
    ...(typeof raw.requesterNickname==='string'?{requesterNickname:raw.requesterNickname}:{}),
    ...(typeof raw.anonymousNickname==='string'?{anonymousNickname:raw.anonymousNickname.trim()}:{}) };
}

@Injectable()
export class MelomingLiveSongRequestService {
  constructor(@Inject(Transactions) private readonly transactions:Transactions,
    @Inject(AuthService) private readonly auth:AuthService,
    @Inject(ChannelContentRepository) private readonly repository:ChannelContentRepository) {}

  private async session(tx:Parameters<Parameters<Transactions['read']>[0]>[0],id:number,credentials?:RequestCredentials) {
    const channel=await this.repository.primary(tx);
    const session=await tx.prisma.liveSession.findFirst({where:{id,channelId:channel.roomId},select:{id:true,status:true,visibility:true}});
    if (!session) throw new ApiError('NOT_FOUND',404);
    if (session.visibility==='PRIVATE') {
      if (!credentials) throw new ApiError('NOT_FOUND',404);
      const owner = await this.owner(tx,credentials);
      if (owner.roomId!==channel.roomId) throw new ApiError('NOT_FOUND',404);
    }
    return channel;
  }
  private async owner(tx:Parameters<Parameters<Transactions['write']>[0]>[0],credentials:RequestCredentials) {
    if ('consoleToken' in credentials) {
      const consoleOwner = await this.repository.requireConsoleToken(tx,credentials.consoleToken);
      return {actor:{userId:consoleOwner.userId},roomId:consoleOwner.roomId};
    }
    const actor=await this.auth.require(tx,credentials,true);
    const roomId=await this.repository.requireOwner(tx,actor.userId);
    return {actor,roomId};
  }
  private async actor(tx:Parameters<Parameters<Transactions['write']>[0]>[0],credentials:RequestCredentials) {
    const actor='consoleToken' in credentials
      ? {userId:(await this.repository.requireConsoleToken(tx,credentials.consoleToken)).userId}
      : await this.auth.require(tx,credentials,true);
    const channel=await this.repository.primary(tx);
    const user=await tx.prisma.users.findUnique({where:{id:actor.userId},select:{profile:{select:{nickname:true}}}});
    if (!user?.profile) throw new ApiError('FORBIDDEN',403);
    let alias=await tx.prisma.melomingUserAlias.findUnique({where:{userId:actor.userId},select:{id:true}});
    if (!alias) alias=await tx.prisma.melomingUserAlias.create({data:{id:await nextChannelContentId(tx.prisma),userId:actor.userId},select:{id:true}});
    return {userId:actor.userId,nickname:user.profile.nickname,alias:alias.id,operator:channel.ownerId===actor.userId,channel};
  }

  queue(credentials:RequestCredentials,raw:Record<string,unknown>) {
    if (Object.keys(raw).some(key=>!['sessionId','includeCompleted'].includes(key)) ||
      (raw.includeCompleted!==undefined && !['true','false'].includes(String(raw.includeCompleted)))) throw new ApiError('INVALID_REQUEST',400);
    const sessionId=integer(raw.sessionId);
    return this.transactions.read(async tx=>{
      if ('consoleToken' in credentials) await this.repository.requireConsoleToken(tx,credentials.consoleToken);
      const channel=await this.session(tx,sessionId,credentials);
      return new SongRequestService(tx.prisma,channel.roomId).getQueueBySessionId(sessionId,raw.includeCompleted==='true');
    });
  }

  create(credentials:WriteCredentials|SessionCredentials,value:unknown,anonymousPlatformId?:string) {
    const dto=createBody(value);
    return this.transactions.write(async tx=>{
      await this.repository.lockPrimary(tx);
      await this.session(tx,dto.liveSessionId!,credentials);
      if ('consoleToken' in credentials) {
        const owner=await this.repository.requireConsoleToken(tx,credentials.consoleToken);
        if (!dto.requesterPlatformId || !dto.requesterNickname) throw new ApiError('INVALID_REQUEST',400);
        return new SongRequestService(tx.prisma,owner.roomId).createConsoleRequest({
          liveSessionId:dto.liveSessionId!,...(dto.songId?{songId:dto.songId}:{}),
          rawArtist:dto.rawArtist,rawTitle:dto.rawTitle,
          ...(dto.rawMessage?{rawMessage:dto.rawMessage}:{}),
          ...(dto.position?{position:dto.position}:{}),
          ...(dto.afterRequestId?{afterRequestId:dto.afterRequestId}:{}),
          ...(dto.requestType?{requestType:dto.requestType}:{}),
          requesterPlatformId:dto.requesterPlatformId,requesterNickname:dto.requesterNickname });
      }
      if(!credentials.token) {
        if(!dto.anonymousNickname||!anonymousPlatformId)throw new ApiError('UNAUTHENTICATED',401);
        return new SongRequestService(tx.prisma,(await this.repository.primary(tx)).roomId).createAnonymousRequest({
          liveSessionId:dto.liveSessionId!,...(dto.songId?{songId:dto.songId}:{}),rawArtist:dto.rawArtist,rawTitle:dto.rawTitle,
          ...(dto.rawMessage?{rawMessage:dto.rawMessage}:{}),...(dto.requestType?{requestType:dto.requestType}:{})
        },dto.anonymousNickname,anonymousPlatformId);
      }
      const actor=await this.actor(tx,credentials);
      return new SongRequestService(tx.prisma,actor.channel.roomId).createRequest({
        liveSessionId:dto.liveSessionId!,...(dto.songId?{songId:dto.songId}:{}),rawArtist:dto.rawArtist,rawTitle:dto.rawTitle,
        ...(dto.rawMessage?{rawMessage:dto.rawMessage}:{}),...(dto.position?{position:dto.position}:{}),
        ...(dto.afterRequestId?{afterRequestId:dto.afterRequestId}:{}),
        ...(dto.requestType?{requestType:dto.requestType}:{}) },actor);
    });
  }

  manual(credentials:WriteCredentials,sessionId:number,value:unknown) {
    const dto=createBody(value,true);
    return this.transactions.write(async tx=>{
      const {actor,roomId}=await this.owner(tx,credentials);
      await this.session(tx,sessionId);
      await this.repository.lockPrimary(tx);
      const identity=await this.actor(tx,credentials);
      if (dto.reviveFromRequestId) {
        const source=await tx.prisma.songRequest.findFirst({where:{id:dto.reviveFromRequestId,liveSessionId:sessionId},
          select:{songId:true,rawArtist:true,rawTitle:true,rawMessage:true}});
        if (!source) throw new ApiError('NOT_FOUND',404);
        return new SongRequestService(tx.prisma,roomId).createRequest({liveSessionId:sessionId,
          ...(source.songId?{songId:source.songId}:{}),rawArtist:source.rawArtist,rawTitle:source.rawTitle,
          ...(source.rawMessage?{rawMessage:source.rawMessage}:{}),
          ...(dto.position?{position:dto.position}:{}),...(dto.afterRequestId?{afterRequestId:dto.afterRequestId}:{})},identity);
      }
      void actor;
      return new SongRequestService(tx.prisma,roomId).createRequest({liveSessionId:sessionId,
        ...(dto.songId?{songId:dto.songId}:{}),rawArtist:dto.rawArtist,rawTitle:dto.rawTitle,
        ...(dto.rawMessage?{rawMessage:dto.rawMessage}:{}),...(dto.position?{position:dto.position}:{}),
        ...(dto.afterRequestId?{afterRequestId:dto.afterRequestId}:{})},identity);
    });
  }

  nowPlaying(credentials:RequestCredentials,raw:Record<string,unknown>) {
    if (Object.keys(raw).some(key=>key!=='sessionId')) throw new ApiError('INVALID_REQUEST',400);
    const sessionId=integer(raw.sessionId);
    return this.transactions.read(async tx=>{
      if ('consoleToken' in credentials) await this.repository.requireConsoleToken(tx,credentials.consoleToken);
      const channel=await this.session(tx,sessionId,credentials);
      return new SongRequestService(tx.prisma,channel.roomId).getNowPlaying(sessionId);
    });
  }

  status(credentials:WriteCredentials,requestId:number,value:unknown) {
    if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!['status','rejectionReason'].includes(key))) throw new ApiError('INVALID_REQUEST',400);
    const raw=value as Record<string,unknown>;
    if (!['PENDING','ACCEPTED','REJECTED','PLAYING','COMPLETED'].includes(String(raw.status)) ||
      (raw.rejectionReason!==undefined && (typeof raw.rejectionReason!=='string'||raw.rejectionReason.length>255))) throw new ApiError('INVALID_REQUEST',400);
    return this.transactions.write(async tx=>{
      const {roomId}=await this.owner(tx,credentials);
      await this.repository.lockPrimary(tx);
      return new SongRequestService(tx.prisma,roomId).updateStatus(requestId,raw.status as 'PENDING'|'ACCEPTED'|'REJECTED'|'PLAYING'|'COMPLETED',raw.rejectionReason as string|undefined);
    });
  }

  remove(credentials:WriteCredentials,requestId:number,mine=false) {
    return this.transactions.write(async tx=>{
      const {actor,roomId}=await this.owner(tx,credentials);
      await this.repository.lockPrimary(tx);
      const service=new SongRequestService(tx.prisma,roomId);
      if (mine) await service.cancelMyRequest(requestId,actor.userId);
      else await service.deleteRequest(requestId);
    });
  }

  order(credentials:WriteCredentials,requestId:number,value:unknown) {
    if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==1) throw new ApiError('INVALID_REQUEST',400);
    const newOrder=integer((value as {newOrder?:unknown}).newOrder);
    return this.transactions.write(async tx=>{
      const {roomId}=await this.owner(tx,credentials);await this.repository.lockPrimary(tx);
      await new SongRequestService(tx.prisma,roomId).updateQueueOrder(requestId,newOrder);
    });
  }

  advance(credentials:WriteCredentials,raw:Record<string,unknown>,kind:'next'|'skip') {
    if (Object.keys(raw).some(key=>!['sessionId','reason'].includes(key))) throw new ApiError('INVALID_REQUEST',400);
    const sessionId=integer(raw.sessionId);
    if (raw.reason!==undefined && (typeof raw.reason!=='string'||raw.reason.length>255)) throw new ApiError('INVALID_REQUEST',400);
    return this.transactions.write(async tx=>{
      const {roomId}=await this.owner(tx,credentials);await this.session(tx,sessionId);await this.repository.lockPrimary(tx);
      const service=new SongRequestService(tx.prisma,roomId);
      return kind==='next'?service.playNext(sessionId):service.skipCurrent(sessionId,raw.reason as string|undefined);
    });
  }

  playNow(credentials:WriteCredentials,requestId:number) {
    return this.transactions.write(async tx=>{
      const {roomId}=await this.owner(tx,credentials);await this.repository.lockPrimary(tx);
      return new SongRequestService(tx.prisma,roomId).playNow(requestId);
    });
  }

  clear(credentials:WriteCredentials,raw:Record<string,unknown>) {
    if (Object.keys(raw).some(key=>key!=='sessionId')) throw new ApiError('INVALID_REQUEST',400);
    const sessionId=integer(raw.sessionId);
    return this.transactions.write(async tx=>{
      const {roomId}=await this.owner(tx,credentials);await this.session(tx,sessionId);await this.repository.lockPrimary(tx);
      return new SongRequestService(tx.prisma,roomId).clearQueue(sessionId);
    });
  }

  operator(credentials:SessionCredentials,raw:Record<string,unknown>) {
    if (raw.channelId!=='1'||Object.keys(raw).some(key=>key!=='channelId')) throw new ApiError('NOT_FOUND',404);
    return this.transactions.read(async tx=>{
      const channel=await this.repository.primary(tx);
      if (!credentials.token) return {isOperator:false};
      const actor=await this.auth.require(tx,credentials,true);
      return {isOperator:actor.userId===channel.ownerId};
    });
  }

  requestedIds(credentials:SessionCredentials,raw:Record<string,unknown>) {
    if (Object.keys(raw).some(key=>key!=='sessionId')) throw new ApiError('INVALID_REQUEST',400);
    const sessionId=integer(raw.sessionId);
    return this.transactions.read(async tx=>{
      const channel=await this.session(tx,sessionId,credentials);
      return new SongRequestService(tx.prisma,channel.roomId).getRequestedSongIds(sessionId);
    });
  }

  stats(raw:Record<string,unknown>) {
    if (raw.channelId!=='1'||Object.keys(raw).some(key=>!['channelId','songId'].includes(key))) throw new ApiError('NOT_FOUND',404);
    const songId=integer(raw.songId);
    return this.transactions.read(async tx=>{
      const channel=await this.repository.primary(tx);
      const song=await tx.prisma.song.findFirst({where:{id:songId,channelId:channel.roomId},select:{id:true}});
      if (!song) throw new ApiError('NOT_FOUND',404);
      return new SongRequestService(tx.prisma,channel.roomId).getSongRequestStats(songId);
    });
  }

  history(raw:Record<string,unknown>) {
    if (raw.channelId!=='1'||Object.keys(raw).some(key=>!['channelId','songId','page','limit'].includes(key))) throw new ApiError('NOT_FOUND',404);
    const songId=integer(raw.songId);
    const page=raw.page===undefined?1:integer(raw.page),limit=raw.limit===undefined?20:integer(raw.limit);
    if (limit>50||page>1000) throw new ApiError('INVALID_REQUEST',400);
    return this.transactions.read(async tx=>{
      const channel=await this.repository.primary(tx);
      const song=await tx.prisma.song.findFirst({where:{id:songId,channelId:channel.roomId},select:{id:true}});
      if (!song) throw new ApiError('NOT_FOUND',404);
      return new SongRequestService(tx.prisma,channel.roomId).getSongRequestHistory(songId,page,limit);
    });
  }
}
