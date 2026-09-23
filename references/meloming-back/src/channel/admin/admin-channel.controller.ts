import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt.guard';
import { AdminUserAccessGuard } from '../../user/admin/admin-user-access.guard';
import { AdminChannelService } from './admin-channel.service';
import { AdminChannelListQueryDto } from './dto/admin-channel.request.dto';
import {
  AdminChannelDetailDto,
  AdminChannelListResponseDto,
} from './dto/admin-channel.response.dto';

@ApiTags('Admin - Channels')
@ApiBearerAuth()
@UseGuards(OptionalJwtAuthGuard, AdminUserAccessGuard)
@Controller('admin/channels')
export class AdminChannelController {
  constructor(private readonly adminChannelService: AdminChannelService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '전체 채널 목록 조회',
    description:
      '채널, 소유자, 인증, 라이브, 커스터마이징, 신청곡 설정 요약을 조회합니다.',
  })
  @ApiOkResponse({ type: AdminChannelListResponseDto })
  async listChannels(
    @Query() query: AdminChannelListQueryDto,
  ): Promise<AdminChannelListResponseDto> {
    return this.adminChannelService.listChannels(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '개별 채널 상세 조회',
    description:
      '채널 본체와 매니저, 인증, 라이브 세션, 이전 요청, 외부 연동 상태를 조회합니다.',
  })
  @ApiParam({ name: 'id', type: Number, description: '채널 ID' })
  @ApiOkResponse({ type: AdminChannelDetailDto })
  async getChannelDetail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdminChannelDetailDto> {
    return this.adminChannelService.getChannelDetail(id);
  }
}
