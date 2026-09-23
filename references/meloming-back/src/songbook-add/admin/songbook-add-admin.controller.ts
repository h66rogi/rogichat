import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SongbookAddService } from '../songbook-add.service';

class SongbookAddPreviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  channelId: number;

  @IsString()
  @MaxLength(200)
  query: string;
}

/**
 * Admin dry-run for `!노래책추가`. Runs the matcher + LLM judge but does NOT
 * insert any Song / SongCategory rows. Lets QA inspect confidence, jamo trace,
 * judge reasoning, and "already in songbook" detection on a real channel.
 *
 * Cost: each call invokes both matcher LLM (if reaches step 4) and judge LLM.
 * Use sparingly — there's no per-channel rate limit here.
 */
@ApiTags('Admin Songbook Add (Dry-run preview)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, ThrottlerGuard)
@Controller('admin/songbook-add')
export class SongbookAddAdminController {
  constructor(private readonly songbookAddService: SongbookAddService) {}

  /**
   * preview 한 번 호출이 matcher LLM + judge LLM 모두 트리거할 수 있다 (dry-run
   * 이지만 비용 동일). 실수로 admin이 마우스 더블클릭하거나 자동 retry 도구로
   * 폭주하는 케이스 차단 — 분당 10회 throttle. ThrottlerGuard 가 IP+route 기준
   * 으로 카운트해 같은 어드민이라도 빠른 연타는 자연 차단.
   */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @ApiOperation({
    summary: 'GlobalSong 매칭 + 카테고리/난이도 LLM judge 결과 미리보기 (DB 변경 없음)',
  })
  async preview(@Body() dto: SongbookAddPreviewDto) {
    return this.songbookAddService.preview({
      channelId: dto.channelId,
      query: dto.query,
    });
  }
}
