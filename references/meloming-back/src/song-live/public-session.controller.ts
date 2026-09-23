import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt.guard';
import { SessionService } from './session.service';
import { PublicActiveSessionResponseDto } from './dto/response/public-session.response.dto';
import {
  PublicSetlistAvailabilityResponseDto,
  PublicSetlistDetailResponseDto,
  PublicSetlistsResponseDto,
} from './dto/response/public-setlist.response.dto';
import { PublicSetlistsQueryDto } from './dto/request/public-setlists.query.dto';

type OptionalAuthRequest = Request & {
  user?: {
    id?: number;
    isAdmin?: boolean;
  };
};

@ApiTags('Song Live Public')
@Controller('song-live/public')
export class PublicSessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Get('active')
  @ApiOperation({ summary: '공개용 활성 세션 조회' })
  @ApiQuery({
    name: 'identifier',
    description: '채널 ID(숫자) 또는 채널 주소(문자)',
    required: true,
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: '활성 세션 조회 성공',
    type: PublicActiveSessionResponseDto,
  })
  @UseGuards(OptionalJwtAuthGuard)
  async getPublicActiveSession(
    @Req() req: OptionalAuthRequest,
    @Query('identifier') identifier: string,
  ): Promise<PublicActiveSessionResponseDto> {
    return this.sessionService.getPublicActiveSession(
      identifier,
      req.user?.id,
      Boolean(req.user?.isAdmin),
    );
  }

  @Get('setlists')
  @ApiOperation({
    summary: '공개 셋리스트 목록 (재생 완료된 곡이 있는 종료 세션만, 최신순)',
  })
  @ApiQuery({
    name: 'identifier',
    description: '채널 ID(숫자) 또는 채널 주소(문자)',
    required: true,
    type: String,
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    description:
      '조회 범위 시작 (RFC 3339, inclusive). to 와 함께. 둘 다 있을 때만 startedAt 필터 활성화. 90일 상한.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: String,
    description:
      '조회 범위 끝 (RFC 3339, exclusive). from 과 함께. half-open `[from, to)`.',
  })
  @ApiResponse({ status: 200, type: PublicSetlistsResponseDto })
  async getPublicSetlists(
    @Query() query: PublicSetlistsQueryDto,
  ): Promise<PublicSetlistsResponseDto> {
    const parsedPage = Math.max(1, query.page ?? 1);
    const parsedLimit = Math.min(50, Math.max(1, query.limit ?? 20));
    return this.sessionService.getPublicSetlists(
      query.identifier,
      parsedPage,
      parsedLimit,
      { from: query.from, to: query.to },
    );
  }

  // NOTE: 'setlists/availability'는 정적 경로이므로 'setlists/:sessionId' 보다 먼저 등록.
  @Get('setlists/availability')
  @ApiOperation({
    summary: '셋리스트 탭 노출 여부 (가용성 체크용, 가벼운 COUNT 쿼리)',
  })
  @ApiQuery({
    name: 'identifier',
    description: '채널 ID(숫자) 또는 채널 주소(문자)',
    required: true,
    type: String,
  })
  @ApiResponse({ status: 200, type: PublicSetlistAvailabilityResponseDto })
  async getPublicSetlistAvailability(
    @Query('identifier') identifier: string,
  ): Promise<PublicSetlistAvailabilityResponseDto> {
    return this.sessionService.getPublicSetlistAvailability(identifier);
  }

  @Get('setlists/:sessionId')
  @ApiOperation({
    summary: '특정 종료 세션의 셋리스트 상세 (재생 완료된 곡 + 시간순)',
  })
  @ApiQuery({
    name: 'identifier',
    description:
      '채널 ID(숫자) 또는 채널 주소(문자) — 다른 채널 세션 접근 차단',
    required: true,
    type: String,
  })
  @ApiResponse({ status: 200, type: PublicSetlistDetailResponseDto })
  async getPublicSetlistDetail(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Query('identifier') identifier: string,
  ): Promise<PublicSetlistDetailResponseDto> {
    return this.sessionService.getPublicSetlistDetail(identifier, sessionId);
  }
}
