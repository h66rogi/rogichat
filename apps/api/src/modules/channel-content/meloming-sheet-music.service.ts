import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import type { MediaStore } from '../media/adapters/media-store.js';
import { mediaKey } from '../media/adapters/media-store.js';
import { MEDIA_PREFIX, MEDIA_STORE } from '../media/media.tokens.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { detectSheetMusicType } from './upstream/sheet-music/sheet-music-mime.js';
import { extractMxlToMusicXml, MxlExtractError } from './upstream/sheet-music/mxl-extractor.js';

const CAP = 10;
const MAX_BYTES = 30 * 1024 * 1024;
const IMAGE_EXTENSION: Record<string,string> = {'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png','image/webp':'webp'};
const EXTENSION_MIME: Record<string,string> = {pdf:'application/pdf',musicxml:'application/vnd.recordare.musicxml+xml',jpg:'image/jpeg',png:'image/png',webp:'image/webp'};
const slotSelect = {id:true,url:true,type:true,fileName:true,fileSize:true,sortOrder:true} as const;
type UploadFile = {buffer:Buffer;size:number;mimetype:string;originalname:string};

/** Port of qa:SongSheetMusicService; owner UUID, transaction and object-store boundaries are adapted. */
@Injectable()
export class MelomingSheetMusicService {
  private readonly logger = new Logger(MelomingSheetMusicService.name);
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
    @Inject(MEDIA_STORE) private readonly store: MediaStore,
    @Inject(MEDIA_PREFIX) private readonly prefix: string) {}

  private origin() {
    return this.prefix === 'qa' ? 'https://api.qa.rogi.chat' : this.prefix === 'production' ? 'https://api.rogi.chat' : 'http://localhost:3000';
  }
  private parseUrl(url: string) {
    const prefix = `${this.origin()}/v1/upload/sheet-music/`;
    if (!url.startsWith(prefix)) return null;
    const match = /^([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(pdf|musicxml|jpg|png|webp)$/.exec(url.slice(prefix.length));
    return match ? mediaKey(this.prefix,match[1]!,match[1]!,'sheet') : null;
  }
  private async removeObject(url: string) {
    const key = this.parseUrl(url);
    if (!key) return;
    try { await this.store.remove(key,AbortSignal.timeout(30_000)); }
    catch (error) { this.logger.warn(`Sheet music cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  private async requireOwnerSong(credentials: SessionCredentials, songId: number) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      const row = await tx.prisma.song.findFirst({where:{id:songId,channelId:roomId},select:{id:true}});
      if (!row) throw new ApiError('NOT_FOUND',404);
      return roomId;
    });
  }
  private async upload(file: UploadFile) {
    if (!file || !Buffer.isBuffer(file.buffer) || !Number.isSafeInteger(file.size) || file.size !== file.buffer.length || file.size <= 0 || file.size > MAX_BYTES ||
      typeof file.mimetype !== 'string' || typeof file.originalname !== 'string' || file.originalname.length > 255) throw new ApiError('INVALID_REQUEST',400);
    const type = detectSheetMusicType(file.mimetype,file.originalname,file.buffer.subarray(0,256));
    if (!type) throw new ApiError('INVALID_REQUEST',400);
    let body = file.buffer;
    if (type === 'MUSICXML' && (file.originalname.toLowerCase().endsWith('.mxl') || file.mimetype.toLowerCase() === 'application/zip')) {
      try { body = await extractMxlToMusicXml(body); }
      catch (error) { if (error instanceof MxlExtractError) throw new ApiError('INVALID_REQUEST',400); throw error; }
    }
    const extension = type === 'PDF' ? 'pdf' : type === 'MUSICXML' ? 'musicxml' : IMAGE_EXTENSION[file.mimetype.toLowerCase()] ?? 'png';
    const contentType = EXTENSION_MIME[extension]!;
    const id = randomUUID();
    const key = mediaKey(this.prefix,id,id,'sheet');
    const name = `${id}.${extension}`;
    const directory = await mkdtemp(join(tmpdir(),'rogichat-sheet-music-'));
    try {
      const path = join(directory,name);
      await writeFile(path,body,{flag:'wx',mode:0o600});
      await this.store.put(key,path,body.length,contentType,AbortSignal.timeout(60_000));
    } finally { await rm(directory,{recursive:true,force:true}); }
    return {url:`${this.origin()}/v1/upload/sheet-music/${name}`,type,fileName:file.originalname,fileSize:body.length};
  }

  async replace(credentials: CommandCredentials, songId: number, file: UploadFile) {
    await this.requireOwnerSong(credentials,songId);
    const uploaded = await this.upload(file);
    let previous: string[] = [];
    try {
      await this.transactions.write(async tx => {
        const actor = await this.auth.require(tx,credentials,true);
        const roomId = await this.repository.requireOwner(tx,actor.userId);
        await this.repository.lockPrimary(tx);
        if (!await tx.prisma.song.findFirst({where:{id:songId,channelId:roomId},select:{id:true}})) throw new ApiError('NOT_FOUND',404);
        previous = (await tx.prisma.songSheetMusic.findMany({where:{songId},select:{url:true}})).map(row=>row.url);
        await tx.prisma.songSheetMusic.deleteMany({where:{songId}});
        await tx.prisma.songSheetMusic.create({data:{songId,...uploaded,sortOrder:0,isPrimary:true}});
      });
    } catch (error) { await this.removeObject(uploaded.url); throw error; }
    for (const url of previous) if (url !== uploaded.url) await this.removeObject(url);
    return uploaded;
  }

  async append(credentials: CommandCredentials, songId: number, file: UploadFile) {
    await this.requireOwnerSong(credentials,songId);
    const uploaded = await this.upload(file);
    let replaced: string[] = [];
    try {
      const slot = await this.transactions.write(async tx => {
        const actor = await this.auth.require(tx,credentials,true);
        const roomId = await this.repository.requireOwner(tx,actor.userId);
        await this.repository.lockPrimary(tx);
        if (!await tx.prisma.song.findFirst({where:{id:songId,channelId:roomId},select:{id:true}})) throw new ApiError('NOT_FOUND',404);
        const existing = await tx.prisma.songSheetMusic.findMany({where:{songId},select:{id:true,url:true,type:true,sortOrder:true}});
        if (existing.length >= CAP) throw new ApiError('INVALID_REQUEST',400);
        if (uploaded.type === 'MUSICXML') {
          const old = existing.filter(slot=>slot.type === 'MUSICXML');
          replaced = old.map(slot=>slot.url);
          if (old.length) await tx.prisma.songSheetMusic.deleteMany({where:{id:{in:old.map(slot=>slot.id)}}});
        }
        const remaining = existing.filter(slot=>uploaded.type !== 'MUSICXML' || slot.type !== 'MUSICXML');
        const sortOrder = remaining.length ? Math.max(...remaining.map(slot=>slot.sortOrder))+1 : 0;
        return tx.prisma.songSheetMusic.create({data:{songId,...uploaded,sortOrder,isPrimary:sortOrder===0},select:slotSelect});
      });
      for (const url of replaced) if (url !== uploaded.url) await this.removeObject(url);
      return slot;
    } catch (error) { await this.removeObject(uploaded.url); throw error; }
  }

  async list(credentials: SessionCredentials, songId: number) {
    await this.requireOwnerSong(credentials,songId);
    return this.transactions.read(tx=>tx.prisma.songSheetMusic.findMany({where:{songId},select:slotSelect,orderBy:[{sortOrder:'asc'},{createdAt:'asc'},{id:'asc'}]}));
  }
  async remove(credentials: CommandCredentials, songId: number, slotId?: number) {
    let removed: string[] = [];
    await this.transactions.write(async tx=>{
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      if (!await tx.prisma.song.findFirst({where:{id:songId,channelId:roomId},select:{id:true}})) throw new ApiError('NOT_FOUND',404);
      const slots = await tx.prisma.songSheetMusic.findMany({where:{songId,...(slotId?{id:slotId}:{})},select:{id:true,url:true}});
      if (slotId && !slots.length) throw new ApiError('NOT_FOUND',404);
      removed = slots.map(slot=>slot.url);
      await tx.prisma.songSheetMusic.deleteMany({where:{songId,...(slotId?{id:slotId}:{})}});
    });
    for (const url of removed) await this.removeObject(url);
    return {deleted:true};
  }
  async reorder(credentials: CommandCredentials, songId: number, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'orderedIds') throw new ApiError('INVALID_REQUEST',400);
    const ids = (value as {orderedIds?:unknown}).orderedIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > CAP || new Set(ids).size !== ids.length || ids.some(id=>!Number.isSafeInteger(id)||id<1)) throw new ApiError('INVALID_REQUEST',400);
    return this.transactions.write(async tx=>{
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      if (!await tx.prisma.song.findFirst({where:{id:songId,channelId:roomId},select:{id:true}})) throw new ApiError('NOT_FOUND',404);
      const existing = await tx.prisma.songSheetMusic.findMany({where:{songId},select:{id:true}});
      if (existing.length !== ids.length || ids.some(id=>!existing.some(slot=>slot.id===id))) throw new ApiError('FORBIDDEN',403);
      for (const [index,id] of ids.entries()) await tx.prisma.songSheetMusic.update({where:{id},data:{sortOrder:index,isPrimary:index===0}});
      return tx.prisma.songSheetMusic.findMany({where:{songId},select:slotSelect,orderBy:{sortOrder:'asc'}});
    });
  }
  async stream(fileName: string) {
    const match = /^([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(pdf|musicxml|jpg|png|webp)$/.exec(fileName);
    if (!match) throw new ApiError('NOT_FOUND',404);
    try {
      const key = mediaKey(this.prefix,match[1]!,match[1]!,'sheet');
      const result = await this.store.read(key,AbortSignal.timeout(30_000));
      if (result.bytes > MAX_BYTES * 2) { result.stream.destroy(); throw new Error('too_large'); }
      return {...result,contentType:EXTENSION_MIME[match[2]!]!};
    } catch { throw new ApiError('NOT_FOUND',404); }
  }
}
