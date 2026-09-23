import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, Inject, Param, Patch, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingFavoritesService } from './meloming-favorites.service.js';

function id(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST', 400);
  return Number(value);
}
function page(request: Request) {
  const raw = request.query as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['page','limit'].includes(key))) throw new ApiError('INVALID_REQUEST', 400);
  const page = raw.page === undefined ? undefined : id(String(raw.page));
  const limit = raw.limit === undefined ? undefined : id(String(raw.limit));
  if ((page && page > 100000) || (limit && limit > 100)) throw new ApiError('INVALID_REQUEST', 400);
  return { page, limit };
}

@ApiTags('Favorites/Meloming compatibility')
@Controller('v1/favorites')
export class MelomingFavoritesController {
  constructor(@Inject(MelomingFavoritesService) private readonly favorites: MelomingFavoritesService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Put('channels/:channelId/add') @channelDoc('melomingFavoriteChannelAdd', '원본 채널 즐겨찾기 추가', 'write')
  addChannel(@Param('channelId') value: string, @Req() request: Request) {
    return this.favorites.toggleChannel(readCommandCredentials(request,this.config),id(value),true);
  }
  @Put('channels/:channelId') @channelDoc('melomingFavoriteChannelToggle', '원본 채널 즐겨찾기 토글', 'write')
  toggleChannel(@Param('channelId') value: string, @Req() request: Request) {
    return this.favorites.toggleChannel(readCommandCredentials(request,this.config),id(value));
  }
  @Delete('channels/:channelId') @channelDoc('melomingFavoriteChannelRemove', '원본 채널 즐겨찾기 해제', 'write')
  removeChannel(@Param('channelId') value: string, @Req() request: Request) {
    return this.favorites.removeChannel(readCommandCredentials(request,this.config),id(value));
  }
  @Put('songs/:songId') @channelDoc('melomingFavoriteSongToggle', '원본 노래 즐겨찾기 토글', 'write')
  toggleSong(@Param('songId') value: string, @Req() request: Request) {
    return this.favorites.toggleSong(readCommandCredentials(request,this.config),id(value));
  }
  @Delete('songs/:songId') @channelDoc('melomingFavoriteSongRemove', '원본 노래 즐겨찾기 해제', 'write')
  removeSong(@Param('songId') value: string, @Req() request: Request) {
    return this.favorites.removeSong(readCommandCredentials(request,this.config),id(value));
  }
  @Get('channels') @channelDoc('melomingFavoriteChannels', '원본 내 즐겨찾기 채널', 'read')
  channels(@Req() request: Request) { return this.favorites.channels(readSessionCredentials(request,this.config),page(request)); }
  @Get('songs') @channelDoc('melomingFavoriteSongs', '원본 내 즐겨찾기 노래', 'read')
  songs(@Req() request: Request) { return this.favorites.songs(readSessionCredentials(request,this.config),page(request)); }
  @Get('stats') @channelDoc('melomingFavoriteStats', '원본 즐겨찾기 통계', 'read')
  stats(@Req() request: Request) { return this.favorites.stats(readSessionCredentials(request,this.config)); }
  @Get('channels/anniversaries') @channelDoc('melomingFavoriteAnniversaries', '원본 즐겨찾기 채널 기념일', 'read')
  anniversaries(@Req() request: Request) { return this.favorites.anniversaries(readSessionCredentials(request,this.config)); }
  @Patch('channels/reorder') @channelDoc('melomingFavoriteReorder', '원본 즐겨찾기 채널 정렬', 'write')
  reorder(@Req() request: Request) {
    const ids = (request.body as { channelIds?: unknown } | undefined)?.channelIds;
    if (!Array.isArray(ids) || ids.some(item => !Number.isSafeInteger(item))) throw new ApiError('INVALID_REQUEST',400);
    return this.favorites.reorder(readCommandCredentials(request,this.config),ids as number[]);
  }
  @Get('channels/:channelId/status') @channelDoc('melomingFavoriteChannelStatus', '원본 채널 즐겨찾기 상태', 'read')
  channelStatus(@Param('channelId') value: string, @Req() request: Request) {
    return this.favorites.channelStatus(readSessionCredentials(request,this.config),id(value));
  }
  @Get('songs/:songId/status') @channelDoc('melomingFavoriteSongStatus', '원본 노래 즐겨찾기 상태', 'read')
  songStatus(@Param('songId') value: string, @Req() request: Request) {
    return this.favorites.songStatus(readSessionCredentials(request,this.config),id(value));
  }
  @Get('channels/:channelId/count') @channelDoc('melomingFavoriteChannelCount', '원본 채널 즐겨찾기 수')
  channelCount(@Param('channelId') value: string) { return this.favorites.channelCount(id(value)); }
  @Get('songs/:songId/count') @channelDoc('melomingFavoriteSongCount', '원본 노래 즐겨찾기 수')
  songCount(@Param('songId') value: string) { return this.favorites.songCount(id(value)); }
  @Get('channels/:channelId/users') @channelDoc('melomingFavoriteChannelUsers', '원본 채널 즐겨찾기 사용자', 'read')
  users(@Param('channelId') value: string, @Req() request: Request) {
    return this.favorites.users(readSessionCredentials(request,this.config),id(value),page(request));
  }
}
