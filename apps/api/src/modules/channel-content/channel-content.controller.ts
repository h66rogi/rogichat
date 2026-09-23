import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelScheduleService } from './schedule.service.js';
import { WardrobeService } from './wardrobe.service.js';
import { SongbookService } from './songbook.service.js';
import { RecurringScheduleService } from './recurring-schedule.service.js';
import { channelDoc } from './channel-content.openapi.js';

function id(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST',400);
  return Number(value);
}
function positive(value: unknown, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{1,8}$/.test(value) || Number(value) < 1 || Number(value) > max) throw new ApiError('INVALID_REQUEST',400);
  return Number(value);
}
function list(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{1,9}(,\d{1,9}){0,49}$/.test(value)) throw new ApiError('INVALID_REQUEST',400);
  return [...new Set(value.split(',').map(Number))];
}
function query(request: Request) {
  const q = request.query as Record<string,unknown>;
  const allowed = ['ym','from','to','page','limit','search','sortBy','categoryIds','artistIds','difficulties','proficiencies'];
  if (Object.keys(q).some(key => !allowed.includes(key))) throw new ApiError('INVALID_REQUEST',400);
  for (const key of ['ym','from','to','search','sortBy']) if (q[key] !== undefined && (typeof q[key] !== 'string' || (q[key] as string).length > 255)) throw new ApiError('INVALID_REQUEST',400);
  const ym = q.ym as string | undefined;
  if (ym && !/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new ApiError('INVALID_REQUEST',400);
  for (const key of ['from','to']) if (q[key] !== undefined && !Number.isFinite(new Date(q[key] as string).valueOf())) throw new ApiError('INVALID_REQUEST',400);
  const sortBy = q.sortBy as string | undefined;
  if (sortBy && !['newest','oldest','title','artist','likes_desc'].includes(sortBy)) throw new ApiError('INVALID_REQUEST',400);
  return { ...(ym ? {ym} : {}), ...(q.from ? {from:q.from as string} : {}), ...(q.to ? {to:q.to as string} : {}),
    ...(q.search ? {search:q.search as string} : {}), ...(sortBy ? {sortBy} : {}),
    ...(q.page ? {page:positive(q.page,100000)!} : {}), ...(q.limit ? {limit:positive(q.limit,100)!} : {}),
    ...(q.categoryIds ? {categoryIds:list(q.categoryIds)!} : {}), ...(q.artistIds ? {artistIds:list(q.artistIds)!} : {}),
    ...(q.difficulties ? {difficulties:list(q.difficulties)!} : {}), ...(q.proficiencies ? {proficiencies:list(q.proficiencies)!} : {}) };
}

@ApiTags('Channel content')
@Controller('v1/channel')
export class ChannelContentController {
  constructor(@Inject(ChannelScheduleService) private readonly schedule: ChannelScheduleService,
    @Inject(WardrobeService) private readonly wardrobe: WardrobeService,
    @Inject(SongbookService) private readonly songbook: SongbookService,
    @Inject(RecurringScheduleService) private readonly recurring: RecurringScheduleService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Get('schedule') @channelDoc('channelScheduleList','공개 일정 조회') scheduleList(@Req() req: Request) { return this.schedule.list(query(req)); }
  @Get('schedule/manage') @channelDoc('channelScheduleManage','관리 일정 조회','read') scheduleManage(@Req() req: Request) { return this.schedule.manage(readSessionCredentials(req,this.config),query(req)); }
  @Post('schedule') @channelDoc('channelScheduleCreate','일정 등록','write',201) scheduleCreate(@Req() req: Request) { return this.schedule.create(readCommandCredentials(req,this.config),req.body); }
  @Patch('schedule/:id') @channelDoc('channelScheduleUpdate','일정 수정','write',200,true) scheduleUpdate(@Req() req: Request,@Param('id') value: string) { return this.schedule.update(readCommandCredentials(req,this.config),id(value),req.body); }
  @Delete('schedule/:id') @HttpCode(204) @channelDoc('channelScheduleDelete','일정 삭제','write',204,true) scheduleDelete(@Req() req: Request,@Param('id') value: string) { return this.schedule.remove(readCommandCredentials(req,this.config),id(value)); }
  @Get('schedule/recurring') @channelDoc('channelRecurringList','반복 일정 조회') recurringList() { return this.recurring.list(); }
  @Put('schedule/recurring') @channelDoc('channelRecurringSave','반복 일정 저장','write') recurringSave(@Req() req: Request) { return this.recurring.save(readCommandCredentials(req,this.config),req.body); }

  @Get('wardrobe') @channelDoc('channelWardrobeList','공개 옷장 조회') wardrobeList() { return this.wardrobe.public(); }
  @Get('wardrobe/manage') @channelDoc('channelWardrobeManage','옷장 관리 조회','read') wardrobeManage(@Req() req: Request) { return this.wardrobe.manage(readSessionCredentials(req,this.config)); }
  @Post('wardrobe/categories') @channelDoc('channelWardrobeCategoryCreate','옷장 분류 등록','write',201) wardrobeCategoryCreate(@Req() req: Request) { return this.wardrobe.createCategory(readCommandCredentials(req,this.config),req.body); }
  @Patch('wardrobe/categories/:id') @channelDoc('channelWardrobeCategoryUpdate','옷장 분류 수정','write',200,true) wardrobeCategoryUpdate(@Req() req: Request,@Param('id') value: string) { return this.wardrobe.updateCategory(readCommandCredentials(req,this.config),id(value),req.body); }
  @Delete('wardrobe/categories/:id') @channelDoc('channelWardrobeCategoryDelete','옷장 분류 삭제','write',200,true) wardrobeCategoryDelete(@Req() req: Request,@Param('id') value: string) { return this.wardrobe.deleteCategory(readCommandCredentials(req,this.config),id(value)); }
  @Post('wardrobe/items') @channelDoc('channelWardrobeItemCreate','옷장 항목 등록','write',201) wardrobeItemCreate(@Req() req: Request) { return this.wardrobe.createItem(readCommandCredentials(req,this.config),req.body); }
  @Patch('wardrobe/items/:id') @channelDoc('channelWardrobeItemUpdate','옷장 항목 수정','write',200,true) wardrobeItemUpdate(@Req() req: Request,@Param('id') value: string) { return this.wardrobe.updateItem(readCommandCredentials(req,this.config),id(value),req.body); }
  @Delete('wardrobe/items/:id') @channelDoc('channelWardrobeItemDelete','옷장 항목 삭제','write',200,true) wardrobeItemDelete(@Req() req: Request,@Param('id') value: string) { return this.wardrobe.deleteItem(readCommandCredentials(req,this.config),id(value)); }

  @Get('songbook') @channelDoc('channelSongbookList','노래책 조회') songs(@Req() req: Request) { return this.songbook.list(query(req)); }
  @Get('songbook/manage') @channelDoc('channelSongbookManage','노래책 관리 권한 조회','read') songManage(@Req() req: Request) { return this.songbook.manage(readSessionCredentials(req,this.config)); }
  @Get('songbook/filters') @channelDoc('channelSongbookFilters','노래책 필터 조회') songFilters() { return this.songbook.filters(); }
  @Post('songbook/categories') @channelDoc('channelSongbookCategoryCreate','노래책 분류 등록','write',201) songCategoryCreate(@Req() req: Request) { return this.songbook.createCategory(readCommandCredentials(req,this.config),req.body); }
  @Post('songbook') @channelDoc('channelSongbookCreate','노래 등록','write',201) songCreate(@Req() req: Request) { return this.songbook.create(readCommandCredentials(req,this.config),req.body); }
  @Patch('songbook/:id') @channelDoc('channelSongbookUpdate','노래 수정','write',200,true) songUpdate(@Req() req: Request,@Param('id') value: string) { return this.songbook.update(readCommandCredentials(req,this.config),id(value),req.body); }
  @Delete('songbook/:id') @HttpCode(204) @channelDoc('channelSongbookDelete','노래 삭제','write',204,true) songDelete(@Req() req: Request,@Param('id') value: string) { return this.songbook.remove(readCommandCredentials(req,this.config),id(value)); }
  @Get('songbook/favorites') @channelDoc('channelSongbookFavorites','즐겨찾기 조회','read') songFavorites(@Req() req: Request) { return this.songbook.favorites(readSessionCredentials(req,this.config)); }
  @Post('songbook/:id/favorite') @channelDoc('channelSongbookFavorite','즐겨찾기 등록','write',201,true) songFavorite(@Req() req: Request,@Param('id') value: string) { return this.songbook.favorite(readCommandCredentials(req,this.config),id(value),true); }
  @Delete('songbook/:id/favorite') @channelDoc('channelSongbookUnfavorite','즐겨찾기 해제','write',200,true) songUnfavorite(@Req() req: Request,@Param('id') value: string) { return this.songbook.favorite(readCommandCredentials(req,this.config),id(value),false); }
}
