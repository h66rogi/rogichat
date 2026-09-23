import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ChannelCalendarService } from './channel-calendar.service';
import { ChannelCalendarQueryDto } from './dto/channel-calendar.query.dto';
import { ChannelCalendarResponseDto } from './dto/channel-calendar.response.dto';
import { CalendarSearchQueryDto } from './dto/channel-calendar-search.query.dto';
import { CalendarSearchResponseDto } from './dto/channel-calendar-search.response.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt.guard';

type AuthenticatedRequest = Request & {
  user?: {
    id: number;
    nickname: string;
    profileImageUrl: string | null;
    isAdmin?: boolean;
  };
};

/**
 * 채널 통합 캘린더 (Task 1.7) — `GET /v1/channels/:identifier/calendar`.
 *
 * 4 종 데이터 소스 (schedules / broadcasts / setlists / anniversaries) 를
 * 한 응답에 묶어 반환. 인증은 optional — 인증된 경우 본인 / 매니저 채널의
 * PRIVATE schedule 도 포함된다.
 *
 * 라우트 충돌 주의: 기존 `ChannelController.getChannel` 이 `/channel/:identifier`
 * (단수) 에 등록되어 있고, 이 컨트롤러는 `/channels/:identifier/calendar` (복수
 * + sub-path) 이므로 경로상 충돌 없음. 그럼에도 같은 `:identifier` 와일드카드를
 * 별도 controller 로 격리하여 향후 `/channels/:identifier/...` 가 늘어나도
 * 라우트 등록 순서에 영향받지 않도록 했다.
 */
@ApiTags('Channel/Calendar')
@Controller({ path: 'channels', version: '1' })
export class ChannelCalendarController {
  constructor(private readonly svc: ChannelCalendarService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':identifier/calendar')
  @ApiOperation({
    summary: '채널 통합 캘린더 (일정 + 방송기록 + 노래방송 + 기념일)',
    description:
      'half-open `[from, to)` 범위의 4 종 데이터를 한 응답에 담는다. ' +
      '13 개월 상한. 인증된 경우 본인/매니저 채널의 PRIVATE 일정도 포함.',
  })
  @ApiParam({
    name: 'identifier',
    description: '채널 ID (숫자) 또는 채널 주소 (webPath)',
    example: 'dokdo2013',
  })
  @ApiOkResponse({ type: ChannelCalendarResponseDto })
  async getCalendar(
    @Param('identifier') identifier: string,
    @Query() query: ChannelCalendarQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelCalendarResponseDto> {
    const currentUserId =
      req.user && typeof req.user.id === 'number'
        ? Number(req.user.id)
        : undefined;
    return this.svc.getCalendar(identifier, query, currentUserId);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':identifier/calendar/search')
  @ApiOperation({
    summary: '채널 캘린더 통합 검색 (일정 + 방송기록 + 노래방송 + 클립 + 기념일)',
    description:
      '키워드 `q` 로 5 종 데이터를 검색해 하나의 flat 리스트로 병합한다. ' +
      'half-open `[from, to)` 범위 (13 개월 상한) 내에서 매칭. date DESC 정렬 + ' +
      'limit (default 50) 상한. 인증된 경우 본인/매니저 채널의 PRIVATE 일정도 검색 대상.',
  })
  @ApiParam({
    name: 'identifier',
    description: '채널 ID (숫자) 또는 채널 주소 (webPath)',
    example: 'dokdo2013',
  })
  @ApiOkResponse({ type: CalendarSearchResponseDto })
  async searchCalendar(
    @Param('identifier') identifier: string,
    @Query() query: CalendarSearchQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CalendarSearchResponseDto> {
    const currentUserId =
      req.user && typeof req.user.id === 'number'
        ? Number(req.user.id)
        : undefined;
    return this.svc.searchCalendar(identifier, query, currentUserId);
  }
}
