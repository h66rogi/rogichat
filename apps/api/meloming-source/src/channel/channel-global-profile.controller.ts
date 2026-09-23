import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ChannelGlobalProfileService } from './channel-global-profile.service';
import {
  ChannelGlobalProfileResponseDto,
  ChannelGlobalProfileUpsertRequestDto,
} from './dto/channel-global-profile.dto';
import { ChannelPermission } from './guards/channel-permission.decorator';
import { ChannelPermissionGuard } from './guards/channel-permission.guard';
import { toGlobalProfileResponseDto } from './mappers/channel-global-profile.mapper';

/**
 * 채널의 meloming.gg 노출 설정 관리 endpoint.
 *
 * - GET: 누구나 조회 가능 (글로벌 노출 여부는 공개 정보).
 * - PUT/PATCH: ChannelPermissionGuard('settings') — 소유자/매니저(권한 있을 때).
 */
@ApiTags('Channel/GlobalProfile')
@Controller('channel')
export class ChannelGlobalProfileController {
  constructor(private readonly service: ChannelGlobalProfileService) {}

  @Get(':channelId/global-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 글로벌 노출 설정 조회 (공개)' })
  @ApiParam({ name: 'channelId', type: 'number', description: '멜로밍 채널 ID' })
  @ApiResponse({ status: 200, type: ChannelGlobalProfileResponseDto })
  async get(
    @Param('channelId') channelIdParam: string,
  ): Promise<ChannelGlobalProfileResponseDto> {
    const channelId = Number(channelIdParam);
    const row = await this.service.getByChannelId(channelId);
    return toGlobalProfileResponseDto(row, channelId);
  }

  @Put(':channelId/global-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 글로벌 노출 설정 전체 덮어쓰기 (소유자/매니저)' })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('settings')
  @ApiResponse({ status: 200, type: ChannelGlobalProfileResponseDto })
  async put(
    @Param('channelId') channelIdParam: string,
    @Body() body: ChannelGlobalProfileUpsertRequestDto,
  ): Promise<ChannelGlobalProfileResponseDto> {
    const channelId = Number(channelIdParam);
    const saved = await this.service.put(channelId, body);
    return toGlobalProfileResponseDto(saved, channelId);
  }

  @Patch(':channelId/global-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 글로벌 노출 설정 부분 업데이트 (소유자/매니저)' })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('settings')
  @ApiResponse({ status: 200, type: ChannelGlobalProfileResponseDto })
  async patch(
    @Param('channelId') channelIdParam: string,
    @Body() body: ChannelGlobalProfileUpsertRequestDto,
  ): Promise<ChannelGlobalProfileResponseDto> {
    const channelId = Number(channelIdParam);
    const saved = await this.service.patch(channelId, body);
    return toGlobalProfileResponseDto(saved, channelId);
  }
}
