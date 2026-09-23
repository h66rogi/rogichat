import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { AdminFuzzyClustersService } from './admin-fuzzy-clusters.service';
import {
  FuzzyClusterAutoMergeRequestDto,
  FuzzyClusterBulkAutoMergeRequestDto,
  FuzzyClusterDetailRequestDto,
  FuzzyClusterListQueryDto,
  FuzzyClusterLlmJudgeRequestDto,
} from './dto/admin-fuzzy-clusters.dto';

@ApiTags('Admin Global Songs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/global-songs/fuzzy-clusters')
export class AdminFuzzyClustersController {
  constructor(private readonly service: AdminFuzzyClustersService) {}

  @Get()
  list(@Query() query: FuzzyClusterListQueryDto) {
    return this.service.list(query);
  }

  /** memberIds 기반 cluster 상세 (POST: list 가 길 수 있어 body 사용) */
  @Post('detail')
  detail(@Body() body: FuzzyClusterDetailRequestDto) {
    return this.service.detail(body.memberIds);
  }

  @Post('llm-judge')
  llmJudge(@Body() body: FuzzyClusterLlmJudgeRequestDto) {
    return this.service.llmJudge(body.memberIds, body.anchor);
  }

  /**
   * 1-click "AI 추천대로 자동 머지" — runs llmJudge then merges per the
   * verdict. Single cluster.
   */
  @Post('auto-merge')
  autoMerge(@Body() body: FuzzyClusterAutoMergeRequestDto) {
    return this.service.autoMerge({
      memberIds: body.memberIds,
      reason: body.reason,
      dryRun: body.dryRun,
      maxClusterSize: body.maxClusterSize,
      allowSplit: body.allowSplit,
    });
  }

  /**
   * Bulk "이 페이지 일괄" auto-merge — sequential autoMerge across multiple
   * clusters. LLM cost: ~one judge call per cluster.
   */
  @Post('bulk-auto-merge')
  bulkAutoMerge(@Body() body: FuzzyClusterBulkAutoMergeRequestDto) {
    return this.service.bulkAutoMerge({
      clusters: body.clusters,
      reason: body.reason,
      dryRun: body.dryRun,
      maxClusterSize: body.maxClusterSize,
      allowSplit: body.allowSplit,
    });
  }
}
