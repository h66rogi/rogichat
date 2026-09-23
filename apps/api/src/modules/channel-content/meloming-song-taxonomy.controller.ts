import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { SongbookService } from './songbook.service.js';
import { MelomingCategoryService } from './meloming-category.service.js';

function channel(value: string): void {
  if (value !== '1' && value !== 'hurogi') throw new ApiError('NOT_FOUND', 404);
}
function id(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST', 400);
  return Number(value);
}

@ApiTags('Categories/Meloming compatibility')
@Controller('v1/categories')
export class MelomingCategoriesController {
  constructor(@Inject(SongbookService) private readonly songs: SongbookService,
    @Inject(MelomingCategoryService) private readonly categories: MelomingCategoryService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Get('public/:webPath') @channelDoc('melomingCategoriesPublic', '원본 노래 분류 공개 조회')
  public(@Param('webPath') webPath: string) {
    channel(webPath);
    return this.songs.categories();
  }

  @Get('channel/:channelId/categories') @channelDoc('melomingCategoriesChannel', '원본 노래 분류 관리 조회', 'read')
  async manage(@Param('channelId') channelId: string, @Req() request: Request) {
    channel(channelId);
    await this.songs.manage(readSessionCredentials(request, this.config));
    return this.songs.categories();
  }

  @Post('channel/:channelId/categories') @channelDoc('melomingCategoryCreate', '원본 노래 분류 등록', 'write', 201)
  create(@Param('channelId') channelId: string, @Req() request: Request) {
    channel(channelId);
    return this.categories.create(readCommandCredentials(request, this.config), request.body);
  }

  @Post('channel/:channelId/categories/swap-order') @channelDoc('melomingCategorySwap', '원본 노래 분류 순서 교환', 'write')
  swap(@Param('channelId') channelId: string, @Req() request: Request) {
    channel(channelId);
    return this.categories.swap(readCommandCredentials(request, this.config), request.body);
  }

  @Put('channel/:channelId/categories/:categoryId') @channelDoc('melomingCategoryUpdate', '원본 노래 분류 수정', 'write')
  update(@Param('channelId') channelId: string, @Param('categoryId') categoryId: string, @Req() request: Request) {
    channel(channelId);
    return this.categories.update(readCommandCredentials(request, this.config), id(categoryId), request.body);
  }

  @Delete('channel/:channelId/categories/:categoryId') @channelDoc('melomingCategoryDelete', '원본 노래 분류 삭제', 'write')
  remove(@Param('channelId') channelId: string, @Param('categoryId') categoryId: string, @Req() request: Request) {
    channel(channelId);
    return this.categories.remove(readCommandCredentials(request, this.config), id(categoryId));
  }
}

@ApiTags('Artists/Meloming compatibility')
@Controller('v1/artists')
export class MelomingArtistsController {
  constructor(@Inject(SongbookService) private readonly songs: SongbookService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Get('public/:webPath') @channelDoc('melomingArtistsPublic', '원본 가수 공개 조회')
  public(@Param('webPath') webPath: string) {
    channel(webPath);
    return this.songs.artists();
  }

  @Get('channel/:channelId/artists') @channelDoc('melomingArtistsChannel', '원본 가수 관리 조회', 'read')
  async manage(@Param('channelId') channelId: string, @Req() request: Request) {
    channel(channelId);
    await this.songs.manage(readSessionCredentials(request, this.config));
    return this.songs.artists();
  }
}
