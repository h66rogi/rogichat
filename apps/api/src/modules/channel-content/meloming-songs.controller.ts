import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { SongbookService } from './songbook.service.js';

function channel(identifier: string): void {
  if (identifier !== 'hurogi') throw new ApiError('NOT_FOUND', 404);
}
function id(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST', 400);
  return Number(value);
}
function numbers(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}(,[1-9]\d{0,9}){0,49}$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
  const result = [...new Set(value.split(',').map(Number))];
  if (result.some(item => !Number.isSafeInteger(item))) throw new ApiError('INVALID_REQUEST', 400);
  return result;
}
function query(request: Request) {
  const raw = request.query as Record<string, unknown>;
  const allowed = new Set(['page', 'limit', 'sortBy', 'search', 'version', 'categoryId', 'artistId',
    'difficulty', 'proficiency', 'categoryIds', 'artistIds', 'difficulties', 'proficiencies']);
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new ApiError('INVALID_REQUEST', 400);
  if (raw.version !== undefined && raw.version !== 'v2') throw new ApiError('INVALID_REQUEST', 400);
  if (raw.search !== undefined && (typeof raw.search !== 'string' || raw.search.length > 255)) throw new ApiError('INVALID_REQUEST', 400);
  if (raw.sortBy !== undefined && !['newest', 'oldest', 'title', 'artist', 'likes_desc'].includes(String(raw.sortBy))) throw new ApiError('INVALID_REQUEST', 400);
  const page = raw.page === undefined ? undefined : id(String(raw.page));
  const limit = raw.limit === undefined ? undefined : id(String(raw.limit));
  if ((page && page > 100000) || (limit && limit > 100)) throw new ApiError('INVALID_REQUEST', 400);
  const categoryIds = numbers(raw.categoryIds ?? raw.categoryId);
  const artistIds = numbers(raw.artistIds ?? raw.artistId);
  const difficulties = numbers(raw.difficulties ?? raw.difficulty);
  const proficiencies = numbers(raw.proficiencies ?? raw.proficiency);
  return { ...(page ? { page } : {}), ...(limit ? { limit } : {}),
    ...(raw.search ? { search: raw.search as string } : {}),
    ...(raw.sortBy ? { sortBy: raw.sortBy as string } : {}),
    ...(categoryIds ? { categoryIds } : {}), ...(artistIds ? { artistIds } : {}),
    ...(difficulties ? { difficulties } : {}), ...(proficiencies ? { proficiencies } : {}) };
}

@ApiTags('Songs/Meloming compatibility')
@Controller('v1/songs/channel/:identifier')
export class MelomingSongsController {
  constructor(
    @Inject(SongbookService) private readonly songs: SongbookService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get() @channelDoc('melomingSongsList', '원본 채널 노래 목록')
  list(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.songs.list(query(request));
  }

  @Get(':songId') @channelDoc('melomingSongDetail', '원본 채널 노래 상세')
  detail(@Param('identifier') identifier: string, @Param('songId') songId: string) {
    channel(identifier);
    return this.songs.detail(id(songId));
  }

  @Post() @channelDoc('melomingSongCreate', '원본 채널 노래 등록', 'write', 201)
  create(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.songs.create(readCommandCredentials(request, this.config), request.body);
  }

  @Patch(':songId') @channelDoc('melomingSongUpdate', '원본 채널 노래 수정', 'write')
  update(@Param('identifier') identifier: string, @Param('songId') songId: string, @Req() request: Request) {
    channel(identifier);
    return this.songs.update(readCommandCredentials(request, this.config), id(songId), request.body);
  }

  @Delete(':songId') @channelDoc('melomingSongDelete', '원본 채널 노래 삭제', 'write')
  async remove(@Param('identifier') identifier: string, @Param('songId') songId: string, @Req() request: Request) {
    channel(identifier);
    await this.songs.remove(readCommandCredentials(request, this.config), id(songId));
    return { success: true };
  }
}
