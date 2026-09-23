import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { SongMatcherV2Service } from './song-matcher-v2.service';
import { TierClassifierService } from './tier-classifier.service';
import {
  MatcherV2BatchRequestDto,
  MatcherV2PreviewRequestDto,
} from './dto/match-v2.dto';
import { SongMatchResultV2 } from './types';

/**
 * v2 매칭 dry-run API. production DB 변경 없이 단건/배치로 결과 미리보기.
 * Admin UI(`meloming-admin`)에서 v1과 v2 결과를 비교하는 용도.
 */
@ApiTags('Admin Song Matcher V2')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/song-matcher-v2')
export class AdminSongMatcherV2Controller {
  constructor(
    private readonly matcher: SongMatcherV2Service,
    private readonly tierClassifier: TierClassifierService,
  ) {}

  @Post('preview')
  @ApiOperation({
    summary: '단건 매칭 미리보기 (dry-run)',
    description:
      '채팅 메시지 1건을 v2 알고리즘으로 매칭한 결과와 단계별 trace를 반환. DB 변경 없음.',
  })
  preview(@Body() dto: MatcherV2PreviewRequestDto): Promise<SongMatchResultV2> {
    return this.matcher.match({
      channelId: dto.channelId,
      rawMessage: dto.rawMessage,
      requestCommand: dto.requestCommand,
    });
  }

  @Post('classify')
  @ApiOperation({
    summary: 'Tier 분류만 단건 확인',
    description:
      '매칭 비용 없이 Tier 분류기 결과만 빠르게 확인. 룰 디버깅용.',
  })
  classify(@Body() dto: MatcherV2PreviewRequestDto) {
    return this.tierClassifier.classify(dto.rawMessage, dto.requestCommand);
  }

  @Post('batch')
  @ApiOperation({
    summary: '배치 매칭 미리보기 (최대 500건)',
    description:
      'CSV/배열로 여러 채팅을 한 번에 매칭. precision/recall 계산, 회귀 확인용.',
  })
  async batch(@Body() dto: MatcherV2BatchRequestDto): Promise<{
    total: number;
    items: Array<{ id: string; rawMessage: string; result: SongMatchResultV2 }>;
    summary: {
      tierCounts: Record<string, number>;
      autoAcceptable: number;
      matched: number;
    };
  }> {
    const items: Array<{
      id: string;
      rawMessage: string;
      result: SongMatchResultV2;
    }> = [];

    for (const item of dto.items) {
      const result = await this.matcher.match({
        channelId: dto.channelId,
        rawMessage: item.rawMessage,
        requestCommand: dto.requestCommand,
      });
      items.push({ id: item.id, rawMessage: item.rawMessage, result });
    }

    const tierCounts: Record<string, number> = {};
    let autoAcceptable = 0;
    let matched = 0;
    for (const it of items) {
      tierCounts[it.result.tier] = (tierCounts[it.result.tier] ?? 0) + 1;
      if (it.result.autoAcceptable) autoAcceptable += 1;
      if (it.result.matched) matched += 1;
    }

    return {
      total: items.length,
      items,
      summary: { tierCounts, autoAcceptable, matched },
    };
  }
}
