import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { ChannelService } from './channel.service';

/**
 * 내부 서비스가 호출하는 channel membership lookup.
 *
 * - 인증: `X-Internal-Api-Key` 헤더 (`INTERNAL_API_KEY` env)
 * - admin 토큰을 forwarding 하던 기존 `/v1/admin/users/by-platform` 과 달리
 *   배치 파이프라인에서 직접 호출 가능하도록 service-to-service auth 사용.
 */
@ApiTags('Channel Membership (Internal)')
@UseGuards(InternalApiKeyGuard)
@Controller({ path: 'internal/channels', version: '1' })
export class InternalChannelMembershipController {
  constructor(private readonly channelService: ChannelService) {}

  @Get('membership-by-platform')
  @ApiOperation({
    summary: '플랫폼 채널 ID 일괄 조회 → 멜로밍 회원 + 마케팅 동의 + userType',
    description:
      'channelIds 50개 batch 제한. 회원 매칭은 ChannelVerification(APPROVED) 우선, platformUrl fallback.',
  })
  @ApiHeader({
    name: 'X-Internal-Api-Key',
    description: '내부 API 키',
    required: true,
  })
  @ApiResponse({ status: 200, description: '플랫폼 채널 ID → membership map' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  async getMembership(
    @Query('platform') platform: string,
    @Query('channelIds') channelIds: string,
  ): Promise<{
    results: Record<
      string,
      | {
          isMember: true;
          userId: number;
          channelId: number;
          channelName: string;
          webPath: string;
          marketingConsent: boolean;
          userType: string | null;
        }
      | { isMember: false }
    >;
  }> {
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

    const results =
      await this.channelService.getMembershipWithUserMetaByPlatformIds(
        parsedPlatform,
        ids,
      );

    return { results };
  }

  /**
   * webPath 로 channel 단건 조회. meloming-live-service 가
   * /channel/:webpath/live 진입 시 호출한다. 동일 lookup 을 공개 API
   * (/v1/channels/by-webpath) 와 분리해 service-to-service 인증 + 응답
   * 표면 최소화 (live-service 가 필요한 4 필드만) 한 별도 entry.
   */
  @Get('by-webpath/:webPath')
  @ApiOperation({ summary: 'webPath 로 channel 단건 조회 (internal)' })
  @ApiHeader({
    name: 'X-Internal-Api-Key',
    description: '내부 API 키',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'channel summary' })
  @ApiResponse({ status: 404, description: 'channel not found' })
  async getByWebPath(
    @Param('webPath') webPath: string,
  ): Promise<{
    id: number;
    userId: number;
    name: string;
    webPath: string;
  }> {
    const channel = await this.channelService.findByWebPath(webPath);
    return {
      id: channel.id,
      userId: channel.userId,
      name: channel.name,
      webPath: channel.webPath,
    };
  }

  /**
   * channelId 로 channel 단건 조회. meloming-live-service 가 라이브
   * 생성/조회 시 ownership 검증을 위해 호출한다.
   */
  @Get(':id')
  @ApiOperation({ summary: 'channelId 로 channel 단건 조회 (internal)' })
  @ApiHeader({
    name: 'X-Internal-Api-Key',
    description: '내부 API 키',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'channel summary' })
  @ApiResponse({ status: 404, description: 'channel not found' })
  async getById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{
    id: number;
    userId: number;
    name: string;
    webPath: string;
  }> {
    const channel = await this.channelService.findById(id);
    return {
      id: channel.id,
      userId: channel.userId,
      name: channel.name,
      webPath: channel.webPath,
    };
  }
}
