import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SongLiveAdminService } from './song-live-admin.service';

@ApiTags('Admin Song Live')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/song-live')
export class SongLiveAdminController {
  constructor(private readonly service: SongLiveAdminService) {}

  @Get('sessions')
  @ApiOperation({ summary: '라이브 세션 목록 (전체 채널)' })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'ENDED'] })
  @ApiQuery({ name: 'channelId', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  async getSessions(
    @Query('status') status?: string,
    @Query(
      'channelId',
      new DefaultValuePipe(undefined),
      new ParseIntPipe({ optional: true }),
    )
    channelId?: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('size', new DefaultValuePipe(20), ParseIntPipe) size = 20,
  ) {
    return this.service.getSessions({
      status,
      channelId,
      page: Math.max(1, page),
      size: Math.min(100, Math.max(1, size)),
    });
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: '라이브 세션 상세 (신청곡 포함)' })
  async getSessionDetail(@Param('id', ParseIntPipe) id: number) {
    return this.service.getSessionDetail(id);
  }

  @Get('stats')
  @ApiOperation({ summary: '신청곡 세션 통계 요약' })
  async getStats() {
    return this.service.getStats();
  }
}
