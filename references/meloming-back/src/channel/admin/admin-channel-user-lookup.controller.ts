import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { ChannelService } from '../channel.service';

@ApiTags('Admin - Channel User Lookup')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/users/by-platform')
export class AdminChannelUserLookupController {
  constructor(private readonly channelService: ChannelService) {}

  @Get()
  @ApiOperation({
    summary: '플랫폼 채널 ID로 멜로밍 회원 여부 batch 조회 (관리자)',
    description:
      'platform과 channelIds를 받아 각 채널의 멜로밍 회원 여부를 반환합니다.',
  })
  async getMembershipByPlatform(
    @Query('platform') platform: string,
    @Query('channelIds') channelIds: string,
  ) {
    if (!platform) {
      throw new BadRequestException('platform is required');
    }
    if (!channelIds) {
      throw new BadRequestException('channelIds is required');
    }

    const parsedPlatform = ChannelService.parseStreamPlatformOrThrow(platform);

    const ids = channelIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      throw new BadRequestException('channelIds must not be empty');
    }
    if (ids.length > 50) {
      throw new BadRequestException('channelIds must not exceed 50 items');
    }

    const results = await this.channelService.getMembershipByPlatformIds(
      parsedPlatform,
      ids,
    );

    return { results };
  }
}
