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
import { AdminNormTitleDupsService } from './admin-norm-title-dups.service';
import {
  NormTitleDupListQueryDto,
  NormTitleDupMergeRequestDto,
} from './dto/admin-norm-title-dups.dto';

@ApiTags('Admin Global Songs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/global-songs/norm-title-dups')
export class AdminNormTitleDupsController {
  constructor(private readonly service: AdminNormTitleDupsService) {}

  @Get()
  list(@Query() query: NormTitleDupListQueryDto) {
    return this.service.list(query);
  }

  @Get(':normTitle')
  detail(@Param('normTitle') normTitle: string) {
    return this.service.detail(decodeURIComponent(normTitle));
  }

  @Post(':normTitle/llm-judge')
  llmJudge(@Param('normTitle') normTitle: string) {
    return this.service.llmJudge(decodeURIComponent(normTitle));
  }

  @Post(':normTitle/merge')
  merge(
    @Param('normTitle') normTitle: string,
    @Body() body: NormTitleDupMergeRequestDto,
  ) {
    return this.service.mergeBatches(decodeURIComponent(normTitle), body);
  }
}
