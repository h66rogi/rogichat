import {
  Controller,
  Post,
  Get,
  Patch,
  HttpCode,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SongRequestOverlayFeatureGuard } from '../common/guards/song-request-overlay-feature.guard';
import { SessionService } from './session.service';
import { StartSessionDto } from './dto/request/start-session.dto';
import { UpdateSettingsDto } from './dto/request/update-settings.dto';
import { LyricsPlaybackStateDto } from './dto/request/lyrics-playback-state.dto';
import { CreateManualRequestDto } from './dto/request/create-manual-request.dto';
import { SessionResponseDto } from './dto/response/session.response.dto';
import { SongRequestResponseDto } from '../song-request/dto/response/song-request.response.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { ResourceNotFoundException } from '../common/exceptions/custom.exception';

/**
 * 신청곡 라이브 세션 컨트롤러
 */
@ApiTags('Song Live Sessions')
@ApiBearerAuth()
@Controller('song-live/sessions')
@UseGuards(JwtAuthGuard, SongRequestOverlayFeatureGuard)
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  /**
   * 라이브 세션 시작
   * POST /v1/song-live/sessions
   */
  @Post()
  @ApiQuery({
    name: 'identifier',
    required: false,
    type: String,
    description: '채널 ID(숫자) 또는 채널 주소(문자). 매니저 접근 시 필수',
  })
  async startSession(
    @Request() req,
    @Body() dto: StartSessionDto,
    @Query('identifier') identifier?: string,
  ): Promise<SessionResponseDto> {
    const userId = req.user.id;
    const channelId = await this.sessionService.resolveAccessibleChannelId(
      userId,
      identifier,
      '세션을 시작할 권한이 없습니다.',
    );

    if (!channelId) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    return this.sessionService.startSession(userId, channelId, dto);
  }

  /**
   * 활성 세션 조회
   * GET /v1/song-live/sessions/active
   */
  @Get('active')
  @ApiQuery({
    name: 'identifier',
    required: false,
    type: String,
    description: '채널 ID(숫자) 또는 채널 주소(문자). 매니저 접근 시 권장',
  })
  async getActiveSession(
    @Request() req,
    @Query('identifier') identifier?: string,
  ): Promise<SessionResponseDto | null> {
    const userId = req.user.id;
    const channelId = await this.sessionService.resolveAccessibleChannelId(
      userId,
      identifier,
      '세션을 조회할 권한이 없습니다.',
    );

    if (!channelId) {
      return null;
    }

    return this.sessionService.getActiveSession(channelId, userId);
  }

  /**
   * 세션 설정 업데이트
   * PATCH /v1/song-live/sessions/:id
   */
  @Patch(':id')
  async updateSettings(
    @Param('id', ParseIntPipe) sessionId: number,
    @Request() req,
    @Body() dto: UpdateSettingsDto,
  ) {
    const userId = req.user.id;
    return this.sessionService.updateSettings(sessionId, userId, dto);
  }

  /**
   * 수동 신청곡 추가
   * POST /v1/song-live/sessions/:id/manual-requests
   */
  @Post(':id/manual-requests')
  @ApiOperation({
    summary: '수동 신청곡 추가',
    description:
      '스트리머/매니저가 리모컨 (신청곡 콘솔)에서 수동으로 신청곡을 추가합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '라이브 세션 ID',
    type: Number,
  })
  @ApiResponse({
    status: 201,
    description: '수동 신청곡 추가 성공',
    type: SongRequestResponseDto,
  })
  async createManualRequest(
    @Param('id', ParseIntPipe) sessionId: number,
    @Request() req,
    @Body() dto: CreateManualRequestDto,
  ): Promise<SongRequestResponseDto> {
    const userId = req.user.id;
    return this.sessionService.createManualRequest(sessionId, userId, dto);
  }

  /**
   * 세션 종료
   * POST /v1/song-live/sessions/:id/end
   */
  @Post(':id/end')
  async endSession(
    @Param('id', ParseIntPipe) sessionId: number,
    @Request() req,
  ): Promise<SessionResponseDto> {
    const userId = req.user.id;
    return this.sessionService.endSession(sessionId, userId);
  }

  /**
   * 가사/재생 통합 anchor sync (콘솔 ↔ 콘솔 ↔ 오버레이)
   * POST /v1/song-live/sessions/:id/lyrics-playback-state
   *
   * 모든 playback 진행 상태(라인 sync + nowsong progress bar)를 하나의 anchor 기반
   * 이벤트로 발행. 평상시 publish 0회, intent change(play/pause/seek/song change/
   * rate change) 시에만 anchor 재발행. legacy POST /playback-progress 는 폐기됨.
   */
  @Post(':id/lyrics-playback-state')
  @HttpCode(204)
  @ApiOperation({ summary: '가사 재생 상태 sync broadcast' })
  async publishLyricsPlaybackState(
    @Param('id', ParseIntPipe) sessionId: number,
    @Request() req,
    @Body() dto: LyricsPlaybackStateDto,
  ): Promise<void> {
    const userId = req.user.id;
    await this.sessionService.publishLyricsPlaybackState(
      sessionId,
      userId,
      dto,
    );
  }

  /**
   * 세션 히스토리 목록 조회
   * GET /v1/song-live/sessions/history
   */
  @Get('history')
  @ApiOperation({ summary: '이전 라이브 세션 목록 조회' })
  @ApiQuery({
    name: 'identifier',
    required: false,
    type: String,
    description: '채널 ID(숫자) 또는 채널 주소(문자). 매니저 접근 시 권장',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: '페이지 번호 (기본: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '페이지당 항목 수 (기본: 10)',
  })
  @ApiResponse({ status: 200, description: '세션 히스토리 목록' })
  async getSessionHistory(
    @Request() req,
    @Query('identifier') identifier?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user.id;
    const channelId = await this.sessionService.resolveAccessibleChannelId(
      userId,
      identifier,
      '세션을 조회할 권한이 없습니다.',
    );

    if (!channelId) {
      return {
        sessions: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      };
    }

    return this.sessionService.getSessionHistory(
      channelId,
      userId,
      parseInt(page || '1', 10),
      parseInt(limit || '10', 10),
    );
  }

  /**
   * 세션 상세 조회 (신청곡 포함)
   * GET /v1/song-live/sessions/:id/detail
   */
  @Get(':id/detail')
  @ApiOperation({ summary: '라이브 세션 상세 조회 (신청곡 목록 포함)' })
  @ApiParam({ name: 'id', type: Number, description: '세션 ID' })
  @ApiResponse({ status: 200, description: '세션 상세 정보' })
  async getSessionDetail(
    @Param('id', ParseIntPipe) sessionId: number,
    @Request() req,
  ) {
    const userId = req.user.id;
    return this.sessionService.getSessionDetail(sessionId, userId);
  }

  /**
   * 세션 복제 (설정 + 신청곡 전체 복원)
   * POST /v1/song-live/sessions/:id/clone
   */
  @Post(':id/clone')
  @ApiOperation({
    summary: '이전 세션 복제',
    description:
      '이전 세션의 설정과 신청곡 대기열을 그대로 복원하여 새 세션을 시작합니다.',
  })
  @ApiParam({ name: 'id', type: Number, description: '복제할 원본 세션 ID' })
  @ApiQuery({
    name: 'identifier',
    required: false,
    type: String,
    description: '채널 ID(숫자) 또는 채널 주소(문자). 매니저 접근 시 필수',
  })
  @ApiResponse({ status: 201, description: '세션 복제 성공' })
  async cloneSession(
    @Param('id', ParseIntPipe) sourceSessionId: number,
    @Request() req,
    @Query('identifier') identifier?: string,
  ): Promise<SessionResponseDto> {
    const userId = req.user.id;
    return this.sessionService.cloneSession(
      sourceSessionId,
      userId,
      identifier,
    );
  }
}
