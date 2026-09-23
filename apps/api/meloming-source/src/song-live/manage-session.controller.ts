import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionService } from './session.service';
import { ManageSetlistsQueryDto } from './dto/request/manage-setlists.query.dto';
import { UpdateSetlistVisibilityDto } from './dto/request/update-setlist-visibility.dto';
import { ManageSetlistsResponseDto } from './dto/response/manage-setlist.response.dto';

/**
 * 채널 owner / canManageContent 매니저용 셋리스트 관리 컨트롤러.
 *
 * 공개 컨트롤러 (`PublicSessionController`) 와 분리한 이유는 (1) 인증 정책이 다르고
 * (JwtAuthGuard 필수), (2) `SongRequestOverlayFeatureGuard` 를 적용하지 않기 위함이다.
 * 신청곡/오버레이 기능이 비활성화된 채널에서도 과거 셋리스트는 관리할 수 있어야 한다.
 */
@ApiTags('Song Live Manage')
@ApiBearerAuth()
@Controller('song-live/manage')
@UseGuards(JwtAuthGuard)
export class ManageSessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Get('setlists')
  @ApiOperation({
    summary:
      '관리용 셋리스트 목록 (PUBLIC + PRIVATE 모두 포함, 최신순). owner/매니저 전용.',
  })
  @ApiQuery({
    name: 'identifier',
    description: '채널 ID(숫자) 또는 채널 주소(문자)',
    required: true,
    type: String,
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, type: ManageSetlistsResponseDto })
  async getManageSetlists(
    @Request() req,
    @Query() query: ManageSetlistsQueryDto,
  ): Promise<ManageSetlistsResponseDto> {
    const userId = req.user.id;
    const parsedPage = Math.max(1, query.page ?? 1);
    const parsedLimit = Math.min(100, Math.max(1, query.limit ?? 20));
    return this.sessionService.getManageSetlists(
      userId,
      query.identifier,
      parsedPage,
      parsedLimit,
    );
  }

  @Patch('setlists/:sessionId/visibility')
  @ApiOperation({
    summary: '셋리스트 (LiveSession) 가시성 토글. owner/매니저 전용.',
  })
  @ApiParam({ name: 'sessionId', description: '라이브 세션 ID', type: Number })
  @ApiQuery({
    name: 'identifier',
    description: '채널 ID(숫자) 또는 채널 주소(문자) — 다른 채널 세션 접근 차단',
    required: true,
    type: String,
  })
  async updateSetlistVisibility(
    @Request() req,
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Query('identifier') identifier: string,
    @Body() dto: UpdateSetlistVisibilityDto,
  ) {
    const userId = req.user.id;
    return this.sessionService.updateSetlistVisibility(
      userId,
      identifier,
      sessionId,
      dto.visibility,
    );
  }
}
