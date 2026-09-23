import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { SessionService } from './session.service';
import { ForceEndSessionsDto } from './dto/request/force-end-sessions.dto';

@ApiTags('Song Live Sessions (Internal)')
@UseGuards(InternalApiKeyGuard)
@Controller({ path: 'internal/song-live/sessions', version: '1' })
export class InternalSessionController {
  constructor(private readonly sessionService: SessionService) {}

  /**
   * 자동 생성 신청곡 세션 강제종료 (discover → 방송 종료 감지)
   * POST /v1/internal/song-live/sessions/force-end
   */
  @Post('force-end')
  @HttpCode(200)
  @ApiOperation({
    summary: '자동 생성 세션 강제종료 (내부 API)',
    description:
      'discover가 방송 종료를 감지하면 해당 플랫폼/채널의 자동 생성 ACTIVE 세션만 종료합니다. 사용자가 직접 시작한 세션은 유지됩니다.',
  })
  @ApiHeader({
    name: 'X-Internal-Api-Key',
    description: '내부 API 키',
    required: true,
  })
  @ApiResponse({ status: 200, description: '처리 완료' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  async forceEnd(@Body() dto: ForceEndSessionsDto): Promise<void> {
    await this.sessionService.forceEndByPlatforms(dto.channels);
  }
}
