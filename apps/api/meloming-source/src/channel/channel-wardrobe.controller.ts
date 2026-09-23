import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelService } from './channel.service';
import { ChannelWardrobeService } from './channel-wardrobe.service';
import { ChannelPermission } from './guards/channel-permission.decorator';
import { ChannelPermissionGuard } from './guards/channel-permission.guard';
import {
  ChannelWardrobeResponseDto,
  CreateChannelWardrobeCategoryDto,
  CreateChannelWardrobeItemDto,
  UpdateChannelWardrobeCategoryDto,
  UpdateChannelWardrobeItemDto,
} from './dto/channel-wardrobe.dto';

@ApiTags('Channel/Wardrobe')
@Controller('channel')
export class ChannelWardrobeController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly wardrobeService: ChannelWardrobeService,
  ) {}

  @ApiOperation({ summary: '채널 옷장 공개 조회' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiResponse({
    status: 200,
    description: '채널 옷장 조회 성공',
    type: ChannelWardrobeResponseDto,
  })
  @Get(':identifier/wardrobe')
  @HttpCode(HttpStatus.OK)
  async getWardrobe(
    @Param('identifier') identifier: string,
  ): Promise<ChannelWardrobeResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.wardrobeService.getPublicWardrobe(channel.id);
  }

  @ApiOperation({ summary: '채널 옷장 관리 조회' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Get(':identifier/wardrobe/manage')
  @HttpCode(HttpStatus.OK)
  async getManageWardrobe(
    @Param('identifier') identifier: string,
  ): Promise<ChannelWardrobeResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.wardrobeService.getManageWardrobe(channel.id);
  }

  @ApiOperation({ summary: '채널 옷장 분류 생성' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Post(':identifier/wardrobe/categories')
  @HttpCode(HttpStatus.OK)
  async createCategory(
    @Param('identifier') identifier: string,
    @Body() body: CreateChannelWardrobeCategoryDto,
  ): Promise<ChannelWardrobeResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.wardrobeService.createCategory(channel.id, body);
  }

  @ApiOperation({ summary: '채널 옷장 분류 수정' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Patch(':identifier/wardrobe/categories/:categoryId')
  @HttpCode(HttpStatus.OK)
  async updateCategory(
    @Param('identifier') identifier: string,
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Body() body: UpdateChannelWardrobeCategoryDto,
  ): Promise<ChannelWardrobeResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.wardrobeService.updateCategory(channel.id, categoryId, body);
  }

  @ApiOperation({ summary: '채널 옷장 분류 삭제' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Delete(':identifier/wardrobe/categories/:categoryId')
  @HttpCode(HttpStatus.OK)
  async deleteCategory(
    @Param('identifier') identifier: string,
    @Param('categoryId', ParseIntPipe) categoryId: number,
  ): Promise<ChannelWardrobeResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.wardrobeService.deleteCategory(channel.id, categoryId);
  }

  @ApiOperation({ summary: '채널 옷장 항목 생성' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Post(':identifier/wardrobe/items')
  @HttpCode(HttpStatus.OK)
  async createItem(
    @Param('identifier') identifier: string,
    @Body() body: CreateChannelWardrobeItemDto,
  ): Promise<ChannelWardrobeResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.wardrobeService.createItem(channel.id, body);
  }

  @ApiOperation({ summary: '채널 옷장 항목 수정' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Patch(':identifier/wardrobe/items/:itemId')
  @HttpCode(HttpStatus.OK)
  async updateItem(
    @Param('identifier') identifier: string,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() body: UpdateChannelWardrobeItemDto,
  ): Promise<ChannelWardrobeResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.wardrobeService.updateItem(channel.id, itemId, body);
  }

  @ApiOperation({ summary: '채널 옷장 항목 삭제' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Delete(':identifier/wardrobe/items/:itemId')
  @HttpCode(HttpStatus.OK)
  async deleteItem(
    @Param('identifier') identifier: string,
    @Param('itemId', ParseIntPipe) itemId: number,
  ): Promise<ChannelWardrobeResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.wardrobeService.deleteItem(channel.id, itemId);
  }
}
