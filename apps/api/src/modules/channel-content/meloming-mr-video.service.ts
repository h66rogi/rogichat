import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { mediaKey } from '../media/adapters/media-store.js';
import type { MultipartMediaStore } from '../media/adapters/media-store.js';
import { MEDIA_PREFIX, MEDIA_STORE } from '../media/media.tokens.js';
import { ChannelContentRepository } from './channel-content.repository.js';

// The upload sizes and four-step workflow are copied from SongMrVideoService.
const MAX_BYTES=5*1024*1024*1024;
const PART_BYTES=64*1024*1024;
const CONCURRENCY=4;
type Part={partNumber:number;etag:string};

@Injectable()
export class MelomingMrVideoService {
  private readonly logger=new Logger(MelomingMrVideoService.name);
  constructor(@Inject(Transactions) private readonly transactions:Transactions,
    @Inject(AuthService) private readonly auth:AuthService,
    @Inject(ChannelContentRepository) private readonly repository:ChannelContentRepository,
    @Inject(MEDIA_STORE) private readonly store:MultipartMediaStore,
    @Inject(MEDIA_PREFIX) private readonly prefix:string) {}

  private scope(roomId:string,songId:number) {
    const raw=createHash('sha256').update(`rogichat-mr:${roomId}:${songId}`).digest().subarray(0,16);
    raw[6]=(raw[6]!&0x0f)|0x50;raw[8]=(raw[8]!&0x3f)|0x80;
    const hex=raw.toString('hex');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  private origin() {return this.prefix==='qa'?'https://api.qa.rogi.chat':this.prefix==='production'?'https://api.rogi.chat':'http://localhost:3000';}
  private key(roomId:string,songId:number,uploadUuid:string){return mediaKey(this.prefix,this.scope(roomId,songId),uploadUuid,'mr');}
  private verifyKey(key:string,roomId:string,songId:number) {
    const parts=key.split('/');
    if(parts.length!==4 || !/^[a-f0-9-]{36}$/.test(parts[2]??'') || key!==this.key(roomId,songId,parts[2]!)) throw new ApiError('INVALID_REQUEST',400);
  }
  private async ownerSong(credentials:CommandCredentials,songId:number) {
    return this.transactions.read(async tx=>{
      const actor=await this.auth.require(tx,credentials,true);
      const roomId=await this.repository.requireOwner(tx,actor.userId);
      const song=await tx.prisma.song.findFirst({where:{id:songId,channelId:roomId},select:{id:true,mrVideoKey:true}});
      if(!song)throw new ApiError('NOT_FOUND',404);
      return {roomId,song};
    });
  }
  private validUploadId(value:unknown):string {
    if(typeof value!=='string'||!value||value.length>512||[...value].some(char=>char.charCodeAt(0)<32))throw new ApiError('INVALID_REQUEST',400);
    return value;
  }
  private validKey(value:unknown):string {
    if(typeof value!=='string'||value.length>200)throw new ApiError('INVALID_REQUEST',400);
    return value;
  }
  private validSize(value:unknown):number {
    if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>MAX_BYTES)throw new ApiError('INVALID_REQUEST',400);
    return Number(value);
  }
  async initiate(credentials:CommandCredentials,songId:number,value:unknown) {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError('INVALID_REQUEST',400);
    const input=value as Record<string,unknown>;
    if(Object.keys(input).some(key=>!['fileName','contentType','fileSizeBytes'].includes(key))||typeof input.fileName!=='string'||!input.fileName||input.fileName.length>255||
      typeof input.contentType!=='string'||!/^video\/[a-z0-9.+-]{1,80}$/.test(input.contentType.toLowerCase()))throw new ApiError('INVALID_REQUEST',400);
    this.validSize(input.fileSizeBytes);
    const {roomId}=await this.ownerSong(credentials,songId);
    const key=this.key(roomId,songId,randomUUID());
    const {uploadId}=await this.store.beginMultipart(key,input.contentType.toLowerCase());
    return {key,uploadId,partSizeBytes:PART_BYTES,maxSizeBytes:MAX_BYTES,concurrency:CONCURRENCY};
  }
  async signPart(credentials:CommandCredentials,songId:number,value:unknown) {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError('INVALID_REQUEST',400);
    const input=value as Record<string,unknown>;
    if(Object.keys(input).some(key=>!['key','uploadId','partNumber'].includes(key))||!Number.isSafeInteger(input.partNumber)||Number(input.partNumber)<1||Number(input.partNumber)>10000)throw new ApiError('INVALID_REQUEST',400);
    const {roomId}=await this.ownerSong(credentials,songId);
    const key=this.validKey(input.key);this.verifyKey(key,roomId,songId);
    const partNumber=Number(input.partNumber);
    return {partNumber,url:await this.store.signMultipartPart(key,this.validUploadId(input.uploadId),partNumber)};
  }
  async complete(credentials:CommandCredentials,songId:number,value:unknown) {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError('INVALID_REQUEST',400);
    const input=value as Record<string,unknown>;
    if(Object.keys(input).some(key=>!['key','uploadId','fileSizeBytes','parts'].includes(key))||!Array.isArray(input.parts))throw new ApiError('INVALID_REQUEST',400);
    const size=this.validSize(input.fileSizeBytes);
    const count=Math.ceil(size/PART_BYTES);
    const parts=input.parts as Part[];
    if(parts.length!==count||parts.some(part=>!part||!Number.isSafeInteger(part.partNumber)||part.partNumber<1||part.partNumber>count||
      typeof part.etag!=='string'||!part.etag||part.etag.length>200)||new Set(parts.map(part=>part.partNumber)).size!==count)throw new ApiError('INVALID_REQUEST',400);
    const {roomId}=await this.ownerSong(credentials,songId);
    const key=this.validKey(input.key);this.verifyKey(key,roomId,songId);
    const bytes=await this.store.finishMultipart(key,this.validUploadId(input.uploadId),[...parts].sort((a,b)=>a.partNumber-b.partNumber));
    if(bytes!==size){await this.tryRemove(key);throw new ApiError('INVALID_REQUEST',400);}
    const uploadUuid=key.split('/')[2]!;
    const url=`${this.origin()}/v1/upload/mr-video/${songId}/${uploadUuid}`;
    let previous:string|null=null;
    try{
      await this.transactions.write(async tx=>{
        const actor=await this.auth.require(tx,credentials,true);
        const currentRoomId=await this.repository.requireOwner(tx,actor.userId);
        await this.repository.lockPrimary(tx);
        const song=await tx.prisma.song.findFirst({where:{id:songId,channelId:currentRoomId},select:{mrVideoKey:true}});
        if(!song||currentRoomId!==roomId)throw new ApiError('NOT_FOUND',404);
        previous=song.mrVideoKey;
        await tx.prisma.song.update({where:{id:songId},data:{mrVideoUrl:url,mrVideoKey:key}});
      });
    }catch(error){await this.tryRemove(key);throw error;}
    if(previous&&previous!==key)await this.tryRemove(previous);
    return {id:songId,mrVideoUrl:url,mrVideoKey:key,fileSizeBytes:bytes};
  }
  async abort(credentials:CommandCredentials,songId:number,value:unknown) {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError('INVALID_REQUEST',400);
    const input=value as Record<string,unknown>;
    if(Object.keys(input).some(key=>!['key','uploadId'].includes(key)))throw new ApiError('INVALID_REQUEST',400);
    const {roomId}=await this.ownerSong(credentials,songId);
    const key=this.validKey(input.key);this.verifyKey(key,roomId,songId);
    await this.store.abortMultipart(key,this.validUploadId(input.uploadId));
    return {aborted:true};
  }
  async remove(credentials:CommandCredentials,songId:number) {
    const {roomId}=await this.ownerSong(credentials,songId);
    let key:string|null=null;
    await this.transactions.write(async tx=>{
      const actor=await this.auth.require(tx,credentials,true);
      const currentRoomId=await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      const song=await tx.prisma.song.findFirst({where:{id:songId,channelId:currentRoomId},select:{mrVideoKey:true}});
      if(!song||currentRoomId!==roomId)throw new ApiError('NOT_FOUND',404);
      key=song.mrVideoKey;
      await tx.prisma.song.update({where:{id:songId},data:{mrVideoUrl:null,mrVideoKey:null}});
    });
    if(key)await this.tryRemove(key);
    return {id:songId,mrVideoUrl:null,mrVideoKey:null};
  }
  private async tryRemove(key:string){
    try{await this.store.remove(key,AbortSignal.timeout(30_000));}
    catch(error){this.logger.warn(`MR object cleanup failed: ${error instanceof Error?error.message:String(error)}`);}
  }
  async read(songId:number,uploadUuid:string,range?:string) {
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(uploadUuid)||
      (range!==undefined&&!/^bytes=\d+-\d*$/.test(range)))throw new ApiError('INVALID_REQUEST',400);
    const key=await this.transactions.read(async tx=>{
      const {roomId}=await this.repository.primary(tx);
      const expected=this.key(roomId,songId,uploadUuid);
      const song=await tx.prisma.song.findFirst({where:{id:songId,channelId:roomId,mrVideoKey:expected},select:{id:true}});
      if(!song)throw new ApiError('NOT_FOUND',404);
      return expected;
    });
    return this.store.readRange(key,range);
  }
}
