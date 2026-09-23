import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { AdminCanonicalNameDupsService } from './admin-canonical-name-dups.service';
import {
  CanonicalNameDupDetailResponseDto,
  CanonicalNameDupListQueryDto,
  CanonicalNameDupListResponseDto,
  CanonicalNameDupMergeRequestDto,
  CanonicalNameDupMergeResponseDto,
  LlmJudgeResponseDto,
} from './dto/admin-canonical-name-dups.dto';

/**
 * Admin endpoints for reviewing + merging GlobalArtist rows that share a
 * canonical_name. Used by meloming-admin's `/global-songs/duplicates` UI to
 * mop up the long-tail dup groups that batch tooling left behind (LLM
 * ABSTAIN/PARSE_ERROR cases + new dups created by ongoing registration).
 */
@ApiTags('Admin Global Songs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/global-songs/canonical-name-dups')
export class AdminCanonicalNameDupsController {
  constructor(private readonly service: AdminCanonicalNameDupsService) {}

  @Get()
  list(
    @Query() query: CanonicalNameDupListQueryDto,
  ): Promise<CanonicalNameDupListResponseDto> {
    return this.service.list(query);
  }

  @Get(':name')
  detail(
    @Param('name') name: string,
  ): Promise<CanonicalNameDupDetailResponseDto> {
    return this.service.detail(decodeURIComponent(name));
  }

  @Post(':name/llm-judge')
  llmJudge(@Param('name') name: string): Promise<LlmJudgeResponseDto> {
    return this.service.llmJudge(decodeURIComponent(name));
  }

  @Post(':name/merge')
  merge(
    @Param('name') name: string,
    @Body() body: CanonicalNameDupMergeRequestDto,
  ): Promise<CanonicalNameDupMergeResponseDto> {
    return this.service.mergeBatches(decodeURIComponent(name), body);
  }
}
