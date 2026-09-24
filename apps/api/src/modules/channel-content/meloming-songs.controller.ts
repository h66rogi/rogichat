import { isChannelIdentifier } from './channel-identity.js';
import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { SongbookService } from './songbook.service.js';
import { SongSuggestService } from './upstream/song-suggest.service.js';
import { SongAutocompleteService } from './upstream/song-autocomplete.service.js';

function channel(identifier: string): void {
  if (!isChannelIdentifier(identifier, true)) throw new ApiError('NOT_FOUND', 404);
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
    @Inject(SongSuggestService) private readonly suggestions: SongSuggestService,
    @Inject(SongAutocompleteService) private readonly autocomplete: SongAutocompleteService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get() @channelDoc('melomingSongsList', '원본 채널 노래 목록')
  list(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.songs.list(query(request), readSessionCredentials(request, this.config));
  }

  @Get('random') @channelDoc('melomingSongsRandom','원본 채널 무작위 노래')
  random(@Param('identifier') identifier:string,@Req() request:Request) {
    channel(identifier);
    const raw=request.query as Record<string,unknown>;
    if (Object.keys(raw).some(key=>!['count','categoryIds'].includes(key))) throw new ApiError('INVALID_REQUEST',400);
    const count=raw.count===undefined?5:id(String(raw.count));
    if (count>100) throw new ApiError('INVALID_REQUEST',400);
    return this.songs.random(count,numbers(raw.categoryIds)??[],readSessionCredentials(request,this.config));
  }

  @Get('suggest') @channelDoc('melomingSongsSuggest','원본 클립 제목 노래 추천')
  suggest(@Param('identifier') identifier:string,@Req() request:Request) {
    channel(identifier);
    const raw=request.query as Record<string,unknown>;
    if (Object.keys(raw).some(key=>!['text','limit'].includes(key)) || typeof raw.text!=='string' || !raw.text.trim() || raw.text.length>500) throw new ApiError('INVALID_REQUEST',400);
    const limit=raw.limit===undefined?5:id(String(raw.limit));
    if (limit>20) throw new ApiError('INVALID_REQUEST',400);
    return this.suggestions.suggestSongs(1,raw.text,limit);
  }

  @Get('autocomplete') @channelDoc('melomingSongsAutocomplete','원본 노래 제목 자동완성','read')
  async titleAutocomplete(@Param('identifier') identifier:string,@Req() request:Request) {
    channel(identifier);
    const raw=request.query as Record<string,unknown>;
    if(Object.keys(raw).some(key=>!['query','limit','scope'].includes(key)) ||
      (raw.query!==undefined&&(typeof raw.query!=='string'||raw.query.length>255)) ||
      (raw.scope!==undefined&&!['channel','global'].includes(String(raw.scope)))) throw new ApiError('INVALID_REQUEST',400);
    const limit=raw.limit===undefined?8:id(String(raw.limit));
    if(limit>20) throw new ApiError('INVALID_REQUEST',400);
    await this.songs.manage(readSessionCredentials(request,this.config));
    return this.autocomplete.autocompleteTitles(1,raw.query as string|undefined,limit);
  }

  @Get('artist-suggest') @channelDoc('melomingSongsArtistSuggest','원본 노래 제목 기반 가수 추천','read')
  async artistSuggest(@Param('identifier') identifier:string,@Req() request:Request) {
    channel(identifier);
    const raw=request.query as Record<string,unknown>;
    if(Object.keys(raw).some(key=>!['title','limit','scope'].includes(key)) || typeof raw.title!=='string'||raw.title.length>255||
      (raw.scope!==undefined&&!['channel','global'].includes(String(raw.scope)))) throw new ApiError('INVALID_REQUEST',400);
    const limit=raw.limit===undefined?5:id(String(raw.limit));
    if(limit>20) throw new ApiError('INVALID_REQUEST',400);
    await this.songs.manage(readSessionCredentials(request,this.config));
    return this.autocomplete.suggestArtists(1,raw.title,limit);
  }

  @Post('bulk') @channelDoc('melomingSongsBulkCreate', '원본 노래 엑셀 일괄 등록', 'write', 201)
  bulkCreate(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.songs.bulkCreate(readCommandCredentials(request, this.config), request.body);
  }

  @Patch('bulk') @channelDoc('melomingSongsBulkUpdate', '원본 노래 일괄 수정', 'write')
  bulkUpdate(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.songs.bulkUpdate(readCommandCredentials(request, this.config), request.body);
  }

  @Delete('bulk') @channelDoc('melomingSongsBulkDelete', '원본 노래 일괄 삭제', 'write')
  bulkDelete(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.songs.bulkDelete(readCommandCredentials(request, this.config), request.body);
  }

  @Post('affected-clips') @channelDoc('melomingSongsAffectedClipsBulk', '원본 일괄 삭제 영향 미리보기', 'read')
  affectedClipsBulk(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.songs.affectedClips(readSessionCredentials(request,this.config),request.body);
  }

  @Get(':songId/affected-clips') @channelDoc('melomingSongsAffectedClips', '원본 단일 삭제 영향 미리보기', 'read')
  affectedClips(@Param('identifier') identifier: string, @Param('songId') songId: string, @Req() request: Request) {
    channel(identifier);
    return this.songs.affectedClips(readSessionCredentials(request,this.config),{ids:[id(songId)]});
  }

  @Get('export/csv') @channelDoc('melomingSongsExportCsv', '원본 노래책 CSV 다운로드', 'read')
  async exportCsv(@Param('identifier') identifier: string, @Req() request: Request, @Res() response: Response) {
    channel(identifier);
    const result = await this.songs.exportCsv(readSessionCredentials(request,this.config), request.ip, request.headers['user-agent']);
    const date = new Date().toISOString().split('T')[0];
    const filename = `songs_${result.channelName}_${date}.csv`;
    const encodedFilename = encodeURIComponent(filename);
    response.setHeader('Content-Type','text/csv; charset=utf-8');
    response.setHeader('Content-Disposition',`attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    response.setHeader('X-Song-Count',String(result.songCount));
    response.send('\uFEFF'+result.csv);
  }

  @Get(':songId') @channelDoc('melomingSongDetail', '원본 채널 노래 상세')
  detail(@Param('identifier') identifier: string, @Param('songId') songId: string, @Req() request: Request) {
    channel(identifier);
    return this.songs.detail(id(songId), readSessionCredentials(request, this.config));
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

@ApiTags('Songs/Meloming compatibility')
@Controller('v1/songs/favorites/by-channel')
export class MelomingFavoriteSongsController {
  constructor(@Inject(SongbookService) private readonly songs: SongbookService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Get(':channelId') @channelDoc('melomingFavoriteSongsByChannel', '원본 채널 즐겨찾기 노래 목록', 'read')
  list(@Param('channelId') value: string, @Req() request: Request) {
    if (value !== '1') throw new ApiError('NOT_FOUND', 404);
    return this.songs.favoriteSongsByChannel(readSessionCredentials(request, this.config), query(request));
  }
}
