import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChannelAnniversaryHighlightsService } from './channel-anniversary-highlights.service';
import { UpcomingAnniversaryHighlightsQueryDto } from './dto/upcoming-anniversary-highlights.query.dto';
import { UpcomingAnniversaryHighlightsResponseDto } from './dto/upcoming-anniversary-highlights.response.dto';

@ApiTags('Channel/Anniversaries')
@Controller(['channels', 'channel'])
export class ChannelAnniversaryHighlightsController {
  constructor(private readonly service: ChannelAnniversaryHighlightsService) {}

  @Get('anniversaries/upcoming-highlights')
  @Header(
    'Cache-Control',
    'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
  )
  @ApiOperation({
    summary: '다가오는 기념일 하이라이트(공개)',
    description:
      '홈 메인 등에서 사용하기 위한 비개인화(비인증) 기념일(생일/방송 마일스톤) 집계 API입니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: UpcomingAnniversaryHighlightsResponseDto,
  })
  async getUpcomingHighlights(
    @Query() query: UpcomingAnniversaryHighlightsQueryDto,
  ): Promise<UpcomingAnniversaryHighlightsResponseDto> {
    const days = query.days ?? 7;
    const limit = query.limit ?? 10;
    const order = query.order ?? 'date';

    return this.service.getUpcomingHighlights({
      days,
      limit,
      order,
      seed: query.seed,
    });
  }
}
