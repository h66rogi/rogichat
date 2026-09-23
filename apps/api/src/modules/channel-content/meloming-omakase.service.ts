import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { nextChannelContentId } from './channel-content-id.js';
import { OmakaseService } from './upstream/omakase.service.js';

function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST',400);
  return value as Record<string,unknown>;
}
function positive(value:unknown):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>2_147_483_647)throw new ApiError('INVALID_REQUEST',400);
  return value;
}
function whole(value:unknown,min=0,max=1_000_000_000):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new ApiError('INVALID_REQUEST',400);
  return value;
}
function settingsInput(value:unknown) {
  const raw=body(value);
  if(Object.keys(raw).some(key=>!['enabled','displayName','price','currencyPrices'].includes(key))||
    raw.enabled!==undefined&&typeof raw.enabled!=='boolean'||
    raw.displayName!==undefined&&raw.displayName!==null&&(typeof raw.displayName!=='string'||raw.displayName.length>50)||
    raw.price!==undefined&&(typeof raw.price!=='number'||!Number.isSafeInteger(raw.price)||raw.price<0||raw.price>1_000_000_000))
    throw new ApiError('INVALID_REQUEST',400);
  if(raw.currencyPrices!==undefined&&raw.currencyPrices!==null) {
    const prices=body(raw.currencyPrices);
    if(Object.keys(prices).length>10||Object.entries(prices).some(([key,amount])=>
      !/^[A-Z0-9_]{1,50}$/.test(key)||amount!==null&&(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0||amount>1_000_000_000)))
      throw new ApiError('INVALID_REQUEST',400);
  }
  return raw as Partial<{enabled:boolean;displayName:string|null;price:number;currencyPrices:Record<string,number|null>|null}>;
}
function manualInput(value:unknown) {
  const raw=body(value);
  if(Object.keys(raw).some(key=>!['liveSessionId','delta','count','reason'].includes(key))||
    raw.reason!==undefined&&(typeof raw.reason!=='string'||raw.reason.length>255))throw new ApiError('INVALID_REQUEST',400);
  return {liveSessionId:positive(raw.liveSessionId),
    ...(raw.delta!==undefined?{delta:whole(raw.delta,-1_000_000_000,1_000_000_000)}:{}),
    ...(raw.count!==undefined?{count:whole(raw.count)}:{}),
    ...(typeof raw.reason==='string'?{reason:raw.reason}:{})};
}
function consumeInput(value:unknown) {
  const raw=body(value);
  if(Object.keys(raw).some(key=>!['request','playNow'].includes(key))||
    raw.playNow!==undefined&&typeof raw.playNow!=='boolean')throw new ApiError('INVALID_REQUEST',400);
  const request=body(raw.request);
  if(Object.keys(request).some(key=>!['liveSessionId','songId','rawArtist','rawTitle','rawMessage','requestType','position','afterRequestId'].includes(key))||
    typeof request.rawArtist!=='string'||request.rawArtist.length>255||
    typeof request.rawTitle!=='string'||request.rawTitle.length>255||
    request.rawMessage!==undefined&&(typeof request.rawMessage!=='string'||request.rawMessage.length>1000)||
    request.requestType!==undefined&&!['NORMAL','RANDOM'].includes(String(request.requestType))||
    request.position!==undefined&&!['FRONT','BACK','AFTER'].includes(String(request.position)))throw new ApiError('INVALID_REQUEST',400);
  const dto={liveSessionId:positive(request.liveSessionId),rawArtist:request.rawArtist,rawTitle:request.rawTitle,
    ...(request.songId!==undefined?{songId:positive(request.songId)}:{}),
    ...(typeof request.rawMessage==='string'?{rawMessage:request.rawMessage}:{}),
    ...(request.requestType!==undefined?{requestType:request.requestType as 'NORMAL'|'RANDOM'}:{}),
    ...(request.position!==undefined?{position:request.position as 'FRONT'|'BACK'|'AFTER'}:{}),
    ...(request.afterRequestId!==undefined?{afterRequestId:positive(request.afterRequestId)}:{})};
  return {request:dto,playNow:raw.playNow===true};
}

@Injectable()
export class MelomingOmakaseService {
  constructor(@Inject(Transactions) private readonly transactions:Transactions,
    @Inject(AuthService) private readonly auth:AuthService,
    @Inject(ChannelContentRepository) private readonly repository:ChannelContentRepository) {}

  private async owner(tx:Parameters<Parameters<Transactions['write']>[0]>[0],credentials:SessionCredentials) {
    const actor=await this.auth.require(tx,credentials,true);
    const roomId=await this.repository.requireOwner(tx,actor.userId);
    return {roomId,userId:actor.userId};
  }

  get(credentials:SessionCredentials) {return this.transactions.write(async tx=>{
    const {roomId}=await this.owner(tx,credentials);
    return new OmakaseService(tx.prisma,roomId).getStatus(roomId);
  });}

  update(credentials:CommandCredentials,value:unknown) {
    const dto=settingsInput(value);
    return this.transactions.write(async tx=>{
      const {roomId}=await this.owner(tx,credentials);
      await this.repository.lockPrimary(tx);
      return new OmakaseService(tx.prisma,roomId).updateSettings(roomId,dto);
    });
  }

  history(credentials:SessionCredentials,limit:unknown) {
    const take=limit===undefined?50:whole(typeof limit==='string'&&/^\d{1,3}$/.test(limit)?Number(limit):limit,1,200);
    return this.transactions.read(async tx=>{
      const {roomId}=await this.owner(tx,credentials);
      const rows=await new OmakaseService(tx.prisma,roomId).listHistory(roomId,take);
      const actorIds=[...new Set(rows.map(row=>row.actorUserId).filter((id):id is string=>!!id))];
      const aliases=await tx.prisma.melomingUserAlias.findMany({where:{userId:{in:actorIds}},select:{id:true,userId:true}});
      const aliasByUser=new Map(aliases.map(alias=>[alias.userId,alias.id]));
      return rows.map(row=>({...row,actorUserId:row.actorUserId?aliasByUser.get(row.actorUserId)??null:null}));
    });
  }

  adjust(credentials:CommandCredentials,value:unknown) {
    const dto=manualInput(value);
    if(dto.delta===undefined)throw new ApiError('INVALID_REQUEST',400);
    const delta=dto.delta;
    return this.transactions.write(async tx=>{
      const {roomId,userId}=await this.owner(tx,credentials);
      await this.repository.lockPrimary(tx);
      return new OmakaseService(tx.prisma,roomId).manualAdjust({channelId:roomId,
        liveSessionId:dto.liveSessionId,delta,actorUserId:userId,...(dto.reason?{reason:dto.reason}:{})});
    });
  }

  setCount(credentials:CommandCredentials,value:unknown) {
    const dto=manualInput(value);
    if(dto.count===undefined)throw new ApiError('INVALID_REQUEST',400);
    const count=dto.count;
    return this.transactions.write(async tx=>{
      const {roomId,userId}=await this.owner(tx,credentials);
      await this.repository.lockPrimary(tx);
      return new OmakaseService(tx.prisma,roomId).setCount({channelId:roomId,
        liveSessionId:dto.liveSessionId,count,actorUserId:userId,...(dto.reason?{reason:dto.reason}:{})});
    });
  }

  consume(credentials:CommandCredentials,value:unknown) {
    const dto=consumeInput(value);
    return this.transactions.write(async tx=>{
      const {roomId,userId}=await this.owner(tx,credentials);
      await this.repository.lockPrimary(tx);
      const user=await tx.prisma.users.findUnique({where:{id:userId},select:{profile:{select:{nickname:true}}}});
      if(!user?.profile)throw new ApiError('FORBIDDEN',403);
      let alias=await tx.prisma.melomingUserAlias.findUnique({where:{userId},select:{id:true}});
      if(!alias)alias=await tx.prisma.melomingUserAlias.create({data:{id:await nextChannelContentId(tx.prisma),userId},select:{id:true}});
      return new OmakaseService(tx.prisma,roomId).consumeWithSongRequest({channelId:roomId,actorUserId:userId,
        request:dto.request,playNow:dto.playNow,actor:{userId,nickname:user.profile.nickname,alias:alias.id,operator:true}});
    });
  }
}
