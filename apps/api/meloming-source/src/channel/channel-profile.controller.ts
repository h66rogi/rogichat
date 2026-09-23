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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ChannelProfileService } from './channel-profile.service';
import {
  ChannelProfileResponseDto,
  ChannelProfileUpsertRequestDto,
} from './dto/channel-profile.dto';
import { toResponseDto } from './mappers/channel-profile.mapper';
import { ChannelPermission } from './guards/channel-permission.decorator';
import { ChannelPermissionGuard } from './guards/channel-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Channel/Profile')
@Controller('channel')
export class ChannelProfileController {
  constructor(private readonly service: ChannelProfileService) {}

  @Get(':channelId/profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 프로필 조회 (공개)' })
  @ApiParam({
    name: 'channelId',
    type: 'number',
    description: '멜로밍 채널 ID',
  })
  @ApiResponse({ status: 200, type: ChannelProfileResponseDto })
  async getPublic(
    @Param('channelId') channelIdParam: string,
  ): Promise<ChannelProfileResponseDto> {
    const channelId = Number(channelIdParam);
    const prof = await this.service.getPublic(channelId);
    if (!prof) {
      return { channelId } as ChannelProfileResponseDto;
    }
    return toResponseDto(prof, channelId);
  }

  @Put(':channelId/profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 프로필 전체 업데이트 (소유자/관리자)' })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('profile')
  @ApiBody({
    type: ChannelProfileUpsertRequestDto,
    examples: {
      valid: {
        summary: '유효 예시',
        value: {
          birthday: '2002-09-25',
          residence: 'Seoul, KR',
          heightCm: 178,
          weightKg: 72,
          nationality: 'KOR',
          gender: 'MALE',
          symbolColor: '#008080',
          agency: 'DYLabs',
          nickname: '초뜨',
          description: '초뜨는 초뜨입니다.',
          affiliatedGroups: ['멜로밍'],
          fandomName: 'Melonians',
          religion: 'None',
          education: ['Hanyang Cyber University (B.S.)'],
          mbti: 'ENTJ',
          alias: ['퇴띵근', '초띵근'],
          debutDate: '2022-02-22T00:00:00Z',
          broadcastingPlatforms: ['CHZZK', 'YOUTUBE'],
          bio: '스트리머/개발자. 음악과 코드 좋아합니다.',
          links: [
            {
              label: 'YouTube',
              url: 'https://youtube.com/@melo',
              icon: 'youtube',
            },
          ],
        },
      },
      minimal: {
        summary: '최소 예시',
        value: {
          nickname: '초뜨',
          symbolColor: '#008080',
        },
      },
    },
  })
  @ApiResponse({ status: 200, type: ChannelProfileResponseDto })
  async putProfile(
    @Param('channelId') channelIdParam: string,
    @Body() body: ChannelProfileUpsertRequestDto,
  ): Promise<ChannelProfileResponseDto> {
    const channelId = Number(channelIdParam);
    const saved = await this.service.put(channelId, body);
    return toResponseDto(saved, channelId);
  }

  @Patch(':channelId/profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 프로필 부분 업데이트 (소유자/관리자)' })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('profile')
  @ApiBody({
    type: ChannelProfileUpsertRequestDto,
    examples: {
      patchSome: {
        summary: '일부 필드만 수정',
        value: {
          nickname: '초뜨',
          bio: '소개 업데이트',
          broadcastingPlatforms: ['CHZZK'],
        },
      },
    },
  })
  @ApiResponse({ status: 200, type: ChannelProfileResponseDto })
  async patchProfile(
    @Param('channelId') channelIdParam: string,
    @Body() body: ChannelProfileUpsertRequestDto,
  ): Promise<ChannelProfileResponseDto> {
    const channelId = Number(channelIdParam);
    const saved = await this.service.patch(channelId, body);
    return toResponseDto(saved, channelId);
  }
}
