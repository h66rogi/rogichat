import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { SongbookService } from './songbook.service.js';

function channel(value: string): void {
  if (value !== '1' && value !== 'hurogi') throw new ApiError('NOT_FOUND', 404);
}

@ApiTags('Categories/Meloming compatibility')
@Controller('v1/categories')
export class MelomingCategoriesController {
  constructor(@Inject(SongbookService) private readonly songs: SongbookService,
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
