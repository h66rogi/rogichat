import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readSessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { channelDoc } from './channel-content.openapi.js';
import { SongAlbumArtService } from './upstream/song-album-art.service.js';

function text(value:unknown):string {
  if(typeof value!=='string'||!value.trim()||value.length>255)throw new ApiError('INVALID_REQUEST',400);
  return value.trim();
}

@ApiTags('Song album art/Meloming compatibility')
@Controller('v1/songs/album-art')
export class MelomingAlbumArtController {
  constructor(@Inject(Transactions) private readonly transactions:Transactions,
    @Inject(AuthService) private readonly auth:AuthService,
    @Inject(AUTH_CONFIG) private readonly config:AuthConfig) {}

  @Get('search') @channelDoc('melomingAlbumArtSearch','원본 DB 앨범아트 검색','read')
  search(@Query('title') title:unknown,@Query('artist') artist:unknown,@Req() request:Request) {
    const query={title:text(title),artist:text(artist)};
    return this.transactions.read(async tx=>{
      await this.auth.require(tx,readSessionCredentials(request,this.config),true);
      return new SongAlbumArtService(tx.prisma).searchAlbumArtFromDB(query.title,query.artist);
    });
  }

  @Post('bulk-search') @channelDoc('melomingAlbumArtBulkSearch','원본 DB 앨범아트 일괄 검색','read',201)
  bulk(@Req() request:Request) {
    const value=request.body as unknown;
    if(!value||typeof value!=='object'||Array.isArray(value)||
      Object.keys(value).some(key=>key!=='songs'))throw new ApiError('INVALID_REQUEST',400);
    const songs=(value as {songs?:unknown}).songs;
    if(!Array.isArray(songs)||songs.length>500)throw new ApiError('INVALID_REQUEST',400);
    const parsed=songs.map(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item)||
        Object.keys(item).some(key=>!['title','artist'].includes(key)))throw new ApiError('INVALID_REQUEST',400);
      const song=item as {title?:unknown;artist?:unknown};
      return {title:text(song.title),artist:text(song.artist)};
    });
    return this.transactions.read(async tx=>{
      await this.auth.require(tx,readSessionCredentials(request,this.config),true);
      return new SongAlbumArtService(tx.prisma).bulkSearchAlbumArtFromDB(parsed);
    });
  }
}
