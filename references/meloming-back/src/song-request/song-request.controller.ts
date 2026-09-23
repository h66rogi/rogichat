import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SongRequestUserBlockScope } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SongRequestService } from './song-request.service';
import { CreateSongRequestDto } from './dto/request/create-request.dto';
import { UpdateSongRequestStatusDto } from './dto/request/update-status.dto';
import { SongRequestHistoryQueryDto } from './dto/request/song-request-history-query.dto';
import {
  SongRequestResponseDto,
  SongRequestQueueResponseDto,
} from './dto/response/song-request.response.dto';
import { SongRequestHistoryResponseDto } from './dto/response/song-request-history.response.dto';
import { getAnonymousClientIp } from '../common/utils/ip.utils';
import { AnonymousSongRequestThrottlerGuard } from './guards/anonymous-song-request-throttler.guard';
import { SongRequestUserBlockService } from './song-request-user-block.service';
import {
  CreateChannelUserBlockDto,
  CreateSongRequestUserBlockDto,
  SongRequestUserBlockTargetBasis,
} from './dto/request/song-request-user-block.dto';
import {
  CreateSongRequestUserBlockResponseDto,
  SongRequestUserBlockResponseDto,
} from './dto/response/song-request-user-block.response.dto';

@ApiTags('Song Requests')
@Controller('song-requests')
export class SongRequestController {
  constructor(
    private readonly songRequestService: SongRequestService,
    private readonly userBlockService: SongRequestUserBlockService,
  ) {}

  private getOperatorAuth(req: { user?: { id?: number; isAdmin?: boolean } }) {
    return {
      userId: Number(req.user?.id),
      isAdmin: Boolean(req.user?.isAdmin),
    };
  }

  @Get()
  @ApiOperation({
    summary: '신청곡 대기열 조회',
    description: '라이브 세션의 신청곡 대기열을 조회합니다.',
  })
  @ApiQuery({
    name: 'sessionId',
    description: '라이브 세션 ID',
    type: Number,
    required: true,
  })
  @ApiQuery({
    name: 'includeCompleted',
    description: '완료된 신청곡 포함 여부',
    type: Boolean,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: '대기열 조회 성공',
    type: SongRequestQueueResponseDto,
  })
  async getQueue(
    @Query('sessionId', ParseIntPipe) sessionId: number,
    @Query('includeCompleted') includeCompleted?: string,
  ): Promise<SongRequestQueueResponseDto> {
    const shouldIncludeCompleted = includeCompleted === 'true';
    return this.songRequestService.getQueueBySessionId(
      sessionId,
      shouldIncludeCompleted,
    );
  }

  @Get('stats')
  @ApiOperation({
    summary: '곡별 신청 통계',
    description:
      '해당 채널에서 특정 곡이 몇 번 신청되었는지 통계를 조회합니다.',
  })
  @ApiQuery({ name: 'songId', type: Number, required: true })
  @ApiQuery({ name: 'channelId', type: Number, required: true })
  async getSongRequestStats(
    @Query('songId', ParseIntPipe) songId: number,
    @Query('channelId', ParseIntPipe) channelId: number,
  ) {
    return this.songRequestService.getSongRequestStats(songId, channelId);
  }

  @Get('history')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: '채널×곡 단위 신청 이력 (시간 역순, 페이지네이션)',
    description:
      'REJECTED 상태 제외. 익명 신청은 "익명", 탈퇴 사용자는 "(탈퇴한 사용자)" 로 닉네임 마스킹.',
  })
  @ApiResponse({ status: 200, type: SongRequestHistoryResponseDto })
  async getSongRequestHistory(
    @Query() query: SongRequestHistoryQueryDto,
  ): Promise<SongRequestHistoryResponseDto> {
    return this.songRequestService.getSongRequestHistory({
      songId: query.songId,
      channelId: query.channelId,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('requested-song-ids')
  @ApiOperation({
    summary: '세션의 신청된 곡 ID 목록',
    description: '현재 세션에서 이미 신청된 곡의 ID 목록을 조회합니다.',
  })
  @ApiQuery({ name: 'sessionId', type: Number, required: true })
  async getRequestedSongIds(
    @Query('sessionId', ParseIntPipe) sessionId: number,
  ) {
    return this.songRequestService.getRequestedSongIds(sessionId);
  }

  @Get('operator-status')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '신청곡 운영자 권한 조회',
    description:
      '현재 사용자가 해당 채널의 신청곡 운영자(소유자/활성 매니저/사이트 관리자)인지 반환합니다. 비로그인 시 false.',
  })
  @ApiQuery({ name: 'channelId', type: Number, required: true })
  async getOperatorStatus(
    @Request() req,
    @Query('channelId', ParseIntPipe) channelId: number,
  ): Promise<{ isOperator: boolean }> {
    const userId: number | undefined = req.user?.id;
    if (typeof userId !== 'number') return { isOperator: false };
    const isOperator = await this.songRequestService.isChannelOperator(
      channelId,
      userId,
      Boolean(req.user?.isAdmin),
    );
    return { isOperator };
  }

  @Get('user-blocks')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '신청곡 신청자 차단 목록 조회',
    description:
      '채널 차단 목록을 조회합니다. 사이트 관리자는 글로벌 차단 목록도 함께 조회할 수 있습니다.',
  })
  @ApiQuery({ name: 'channelId', type: Number, required: true })
  @ApiQuery({
    name: 'includeGlobal',
    type: Boolean,
    required: false,
    description: '글로벌 차단 포함 여부. 기본값 true.',
  })
  @ApiResponse({
    status: 200,
    type: [SongRequestUserBlockResponseDto],
  })
  async listUserBlocks(
    @Request() req,
    @Query('channelId', ParseIntPipe) channelId: number,
    @Query('includeGlobal') includeGlobal?: string,
  ): Promise<SongRequestUserBlockResponseDto[]> {
    const { userId, isAdmin } = this.getOperatorAuth(req);
    await this.songRequestService.assertCanOperateChannel(
      channelId,
      userId,
      isAdmin,
    );
    return this.userBlockService.listBlocks(
      channelId,
      isAdmin && includeGlobal !== 'false',
    );
  }

  @Post('user-blocks')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '채널 유저 차단 직접 생성',
    description:
      '외부 플랫폼 유저 ID 또는 멜로밍 유저 ID 기준으로 기능별 채널 차단을 생성합니다. 멜로밍 유저 ID 기준은 해당 유저의 DI 해시를 함께 차단합니다.',
  })
  @ApiResponse({
    status: 201,
    type: CreateSongRequestUserBlockResponseDto,
  })
  async createUserBlock(
    @Request() req,
    @Body() dto: CreateChannelUserBlockDto,
  ): Promise<CreateSongRequestUserBlockResponseDto> {
    const { userId, isAdmin } = this.getOperatorAuth(req);
    const scope = dto.scope ?? SongRequestUserBlockScope.CHANNEL;

    if (scope === SongRequestUserBlockScope.GLOBAL) {
      if (!isAdmin) {
        throw new ForbiddenException(
          '글로벌 차단은 관리자만 설정할 수 있습니다.',
        );
      }
    } else {
      if (!dto.channelId) {
        throw new ForbiddenException('채널 ID가 필요합니다.');
      }
      await this.songRequestService.assertCanOperateChannel(
        dto.channelId,
        userId,
        isAdmin,
      );
    }

    return this.userBlockService.createBlockFromTarget({
      scope,
      channelId: dto.channelId,
      features: dto.features,
      targetBasis:
        dto.targetBasis ?? SongRequestUserBlockTargetBasis.MELOMING_USER,
      platform: dto.platform,
      platformUserId: dto.platformUserId,
      melomingUserId: dto.melomingUserId,
      displayName: dto.displayName,
      reason: dto.reason,
      createdByUserId: userId,
    });
  }

  @Get('my-history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '내 신청곡 히스토리 조회',
    description: '로그인한 유저의 신청곡 히스토리를 조회합니다.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({
    name: 'status',
    required: false,
    example: 'COMPLETED',
    description:
      'PENDING,ACCEPTED,REJECTED,PLAYING,COMPLETED (콤마 구분 복수 가능)',
  })
  @ApiQuery({
    name: 'source',
    required: false,
    example: 'CHAT',
    description: 'CHAT,DONATION,MANUAL (콤마 구분 복수 가능)',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    example: '2025-01-01',
    description: '조회 시작일 (ISO/yyyy-MM-dd)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    example: '2025-12-31',
    description: '조회 종료일 (ISO/yyyy-MM-dd)',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: '곡명/아티스트 검색',
  })
  async getMyHistory(
    @Request() req,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
  ) {
    const VALID_STATUS = [
      'PENDING',
      'ACCEPTED',
      'REJECTED',
      'PLAYING',
      'COMPLETED',
    ];
    const VALID_SOURCE = ['CHAT', 'DONATION', 'MANUAL'];

    const normalizeList = (
      raw: string | string[] | undefined,
      allowed: string[],
    ): string[] | undefined => {
      if (!raw) return undefined;
      const tokens = Array.isArray(raw) ? raw : raw.split(',');
      const filtered = tokens
        .map((t) => t.trim().toUpperCase())
        .filter((t) => allowed.includes(t));
      return filtered.length > 0 ? filtered : undefined;
    };

    return this.songRequestService.getMyHistory(req.user.id, {
      page,
      limit,
      status: normalizeList(status, VALID_STATUS),
      source: normalizeList(source, VALID_SOURCE),
      startDate,
      endDate,
      search,
    });
  }

  @Post()
  @UseGuards(OptionalJwtAuthGuard, AnonymousSongRequestThrottlerGuard)
  // 로그인 유저는 guard가 shouldSkip으로 throttle 건너뛰고, 익명(비로그인) 유저만
  // IP당 1분 10건 제한을 받는다. 429 응답은 ANONYMOUS_RATE_LIMIT 구조화 페이로드.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: '신청곡 수동 추가',
    description:
      '신청곡을 수동으로 대기열에 추가합니다. 채널 운영자(소유자/활성 매니저/사이트 관리자)는 모든 제한을 우회합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '신청곡 추가 성공',
    type: SongRequestResponseDto,
  })
  async createRequest(
    @Request() req,
    @Body() createDto: CreateSongRequestDto,
  ): Promise<SongRequestResponseDto> {
    let allowManualBypass = false;
    const userId: number | undefined = req.user?.id;
    if (typeof userId === 'number') {
      allowManualBypass =
        await this.songRequestService.canBypassSongRequestLimits(
          createDto.liveSessionId,
          userId,
          Boolean(req.user?.isAdmin),
        );
    }
    // 익명 신청의 중복 방지/1인당 제한 키 생성 + rate limit 스코프 식별에 사용.
    // getAnonymousClientIp는 req.ip만 신뢰(trust proxy 설정 따름) — 헤더 직접 read X.
    const clientIp = getAnonymousClientIp(req);
    return this.songRequestService.createRequest(
      createDto,
      userId,
      false,
      allowManualBypass,
      clientIp,
    );
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '신청곡 상태 변경',
    description:
      '신청곡의 상태를 변경합니다 (ACCEPTED, REJECTED, PLAYING, COMPLETED).',
  })
  @ApiParam({
    name: 'id',
    description: '신청곡 ID',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: '상태 변경 성공',
    type: SongRequestResponseDto,
  })
  async updateStatus(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateSongRequestStatusDto,
  ): Promise<SongRequestResponseDto> {
    const { userId, isAdmin } = this.getOperatorAuth(req);
    await this.songRequestService.assertCanOperateRequest(id, userId, isAdmin);
    return this.songRequestService.updateStatus(id, updateDto);
  }

  @Delete('queue')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '대기열 초기화',
    description: '라이브 세션의 모든 PENDING 상태 신청곡을 삭제합니다.',
  })
  @ApiQuery({
    name: 'sessionId',
    description: '라이브 세션 ID',
    type: Number,
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: '대기열 초기화 성공',
  })
  async clearQueue(
    @Request() req,
    @Query('sessionId', ParseIntPipe) sessionId: number,
  ): Promise<{ deletedCount: number; message: string }> {
    const { userId, isAdmin } = this.getOperatorAuth(req);
    await this.songRequestService.assertCanOperateSession(
      sessionId,
      userId,
      isAdmin,
    );
    const deletedCount = await this.songRequestService.clearQueue(sessionId);
    return {
      deletedCount,
      message: `${deletedCount}개의 신청곡이 삭제되었습니다.`,
    };
  }

  @Post(':id/user-blocks')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '신청곡 신청자 차단',
    description:
      '기존 신청곡의 신청자를 기준으로 채널 또는 글로벌 차단 키를 생성합니다. GLOBAL은 사이트 관리자만 사용할 수 있습니다.',
  })
  @ApiParam({ name: 'id', description: '신청곡 ID', type: Number })
  @ApiResponse({
    status: 201,
    type: CreateSongRequestUserBlockResponseDto,
  })
  async blockRequester(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSongRequestUserBlockDto,
  ): Promise<CreateSongRequestUserBlockResponseDto> {
    const { userId, isAdmin } = this.getOperatorAuth(req);
    const scope = dto.scope ?? SongRequestUserBlockScope.CHANNEL;

    if (scope === SongRequestUserBlockScope.GLOBAL) {
      if (!isAdmin) {
        throw new ForbiddenException(
          '글로벌 차단은 관리자만 설정할 수 있습니다.',
        );
      }
    } else {
      await this.songRequestService.assertCanOperateRequest(
        id,
        userId,
        isAdmin,
      );
    }

    return this.userBlockService.createBlocksFromRequest(id, {
      scope,
      features: dto.features,
      targetBasis: dto.targetBasis,
      reason: dto.reason,
      createdByUserId: userId,
    });
  }

  @Delete('user-blocks/:blockId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '신청곡 신청자 차단 해제',
  })
  @ApiParam({ name: 'blockId', description: '차단 ID', type: Number })
  async unblockRequester(
    @Request() req,
    @Param('blockId', ParseIntPipe) blockId: number,
  ): Promise<void> {
    const block = await this.userBlockService.findBlockById(blockId);
    if (!block) {
      throw new NotFoundException('차단 항목을 찾을 수 없습니다.');
    }

    const { userId, isAdmin } = this.getOperatorAuth(req);
    if (block.scope === SongRequestUserBlockScope.GLOBAL) {
      if (!isAdmin) {
        throw new ForbiddenException(
          '글로벌 차단은 관리자만 해제할 수 있습니다.',
        );
      }
    } else if (block.channelId) {
      await this.songRequestService.assertCanOperateChannel(
        block.channelId,
        userId,
        isAdmin,
      );
    } else {
      throw new ForbiddenException('차단 해제 권한이 없습니다.');
    }

    await this.userBlockService.deleteBlock(blockId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '신청곡 삭제',
    description: '신청곡을 대기열에서 삭제합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '신청곡 ID',
    type: Number,
  })
  @ApiResponse({
    status: 204,
    description: '삭제 성공',
  })
  async deleteRequest(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    const { userId, isAdmin } = this.getOperatorAuth(req);
    await this.songRequestService.assertCanOperateRequest(id, userId, isAdmin);
    await this.songRequestService.deleteRequest(id);
  }

  @Delete(':id/mine')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '내 신청곡 취소',
    description:
      '로그인한 본인이 신청한 PENDING 상태의 신청곡만 취소할 수 있습니다.',
  })
  @ApiParam({
    name: 'id',
    description: '신청곡 ID',
    type: Number,
  })
  @ApiResponse({
    status: 204,
    description: '취소 성공',
  })
  async cancelMyRequest(
    @Param('id', ParseIntPipe) id: number,
    @Request() req,
  ): Promise<void> {
    await this.songRequestService.cancelMyRequest(id, req.user.id);
  }

  @Patch(':id/order')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '대기열 순서 변경',
    description: '신청곡의 대기열 순서를 변경합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '신청곡 ID',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: '순서 변경 성공',
  })
  async updateQueueOrder(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body('newOrder', ParseIntPipe) newOrder: number,
  ): Promise<{ message: string }> {
    const { userId, isAdmin } = this.getOperatorAuth(req);
    await this.songRequestService.assertCanOperateRequest(id, userId, isAdmin);
    await this.songRequestService.updateQueueOrder(id, newOrder);
    return { message: '대기열 순서가 변경되었습니다.' };
  }

  @Get('now-playing')
  @ApiOperation({
    summary: '현재 재생 중인 곡 조회',
    description: '라이브 세션에서 현재 재생 중인 곡을 조회합니다.',
  })
  @ApiQuery({
    name: 'sessionId',
    description: '라이브 세션 ID',
    type: Number,
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: '현재 재생 중인 곡 조회 성공',
    type: SongRequestResponseDto,
  })
  async getNowPlaying(
    @Query('sessionId', ParseIntPipe) sessionId: number,
  ): Promise<SongRequestResponseDto | null> {
    return this.songRequestService.getNowPlaying(sessionId);
  }

  @Post('play-next')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '다음 곡 재생',
    description: '현재 곡을 완료 처리하고 다음 대기열 곡을 재생합니다.',
  })
  @ApiQuery({
    name: 'sessionId',
    description: '라이브 세션 ID',
    type: Number,
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: '다음 곡 재생 성공 (또는 대기열 없음 시 null)',
    type: SongRequestResponseDto,
  })
  async playNext(
    @Request() req,
    @Query('sessionId', ParseIntPipe) sessionId: number,
  ): Promise<SongRequestResponseDto | null> {
    const { userId, isAdmin } = this.getOperatorAuth(req);
    await this.songRequestService.assertCanOperateSession(
      sessionId,
      userId,
      isAdmin,
    );
    return this.songRequestService.playNext(sessionId);
  }

  @Post('skip-current')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '현재 곡 스킵',
    description: '현재 재생 중인 곡을 거절 처리하고 다음 곡을 재생합니다.',
  })
  @ApiQuery({
    name: 'sessionId',
    description: '라이브 세션 ID',
    type: Number,
    required: true,
  })
  @ApiQuery({
    name: 'reason',
    description: '스킵 사유',
    type: String,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: '스킵 성공',
    type: SongRequestResponseDto,
  })
  async skipCurrent(
    @Request() req,
    @Query('sessionId', ParseIntPipe) sessionId: number,
    @Query('reason') reason?: string,
  ): Promise<SongRequestResponseDto | null> {
    const { userId, isAdmin } = this.getOperatorAuth(req);
    await this.songRequestService.assertCanOperateSession(
      sessionId,
      userId,
      isAdmin,
    );
    return this.songRequestService.skipCurrent(sessionId, reason);
  }

  @Post(':id/play-now')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '특정 곡 즉시 재생',
    description:
      '대기열에서 특정 곡을 선택해 즉시 재생합니다. 현재 곡은 완료 처리됩니다.',
  })
  @ApiParam({
    name: 'id',
    description: '신청곡 ID',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: '즉시 재생 성공',
    type: SongRequestResponseDto,
  })
  async playNow(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SongRequestResponseDto> {
    const { userId, isAdmin } = this.getOperatorAuth(req);
    await this.songRequestService.assertCanOperateRequest(id, userId, isAdmin);
    return this.songRequestService.playNow(id);
  }
}
