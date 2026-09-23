import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { WardrobeService } from './wardrobe.service.js';
import { channelDoc } from './channel-content.openapi.js';

// Route contract: meloming-back/src/channel/channel-wardrobe.controller.ts.
// Rogichat's sole public channel maps to its owner-bound primary room.
function channel(identifier: string): void {
  if (identifier !== 'hurogi') throw new ApiError('NOT_FOUND', 404);
}

function itemId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(id)) throw new ApiError('INVALID_REQUEST', 400);
  return id;
}

@ApiTags('Channel/Wardrobe')
@Controller('v1/channel/:identifier/wardrobe')
export class MelomingWardrobeController {
  constructor(
    @Inject(WardrobeService) private readonly wardrobeService: WardrobeService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get() @channelDoc('melomingWardrobePublic', '채널 옷장 공개 조회')
  getWardrobe(@Param('identifier') identifier: string) {
    channel(identifier);
    return this.wardrobeService.public();
  }

  @Get('manage') @channelDoc('melomingWardrobeManage', '채널 옷장 관리 조회', 'read')
  getManageWardrobe(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.wardrobeService.manage(readSessionCredentials(request, this.config));
  }

  @Post('categories') @HttpCode(200) @channelDoc('melomingWardrobeCategoryCreate', '채널 옷장 분류 생성', 'write', 200)
  createCategory(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.wardrobeService.createCategory(readCommandCredentials(request, this.config), request.body);
  }

  @Patch('categories/:categoryId') @channelDoc('melomingWardrobeCategoryUpdate', '채널 옷장 분류 수정', 'write', 200, true)
  updateCategory(@Param('identifier') identifier: string, @Param('categoryId') value: string, @Req() request: Request) {
    channel(identifier);
    return this.wardrobeService.updateCategory(readCommandCredentials(request, this.config), itemId(value), request.body);
  }

  @Delete('categories/:categoryId') @channelDoc('melomingWardrobeCategoryDelete', '채널 옷장 분류 삭제', 'write', 200, true)
  deleteCategory(@Param('identifier') identifier: string, @Param('categoryId') value: string, @Req() request: Request) {
    channel(identifier);
    return this.wardrobeService.deleteCategory(readCommandCredentials(request, this.config), itemId(value));
  }

  @Post('items') @HttpCode(200) @channelDoc('melomingWardrobeItemCreate', '채널 옷장 항목 생성', 'write', 200)
  createItem(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.wardrobeService.createItem(readCommandCredentials(request, this.config), request.body);
  }

  @Patch('items/:itemId') @channelDoc('melomingWardrobeItemUpdate', '채널 옷장 항목 수정', 'write', 200, true)
  updateItem(@Param('identifier') identifier: string, @Param('itemId') value: string, @Req() request: Request) {
    channel(identifier);
    return this.wardrobeService.updateItem(readCommandCredentials(request, this.config), itemId(value), request.body);
  }

  @Delete('items/:itemId') @channelDoc('melomingWardrobeItemDelete', '채널 옷장 항목 삭제', 'write', 200, true)
  deleteItem(@Param('identifier') identifier: string, @Param('itemId') value: string, @Req() request: Request) {
    channel(identifier);
    return this.wardrobeService.deleteItem(readCommandCredentials(request, this.config), itemId(value));
  }
}
