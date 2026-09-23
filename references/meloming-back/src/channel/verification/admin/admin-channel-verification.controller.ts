import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../../../auth/guards/optional-jwt.guard';
import { AdminUserAccessGuard } from '../../../user/admin/admin-user-access.guard';
import { ChannelVerificationService } from '../channel-verification.service';
import {
  AdminChannelVerificationListQueryDto,
  AdminChannelVerificationListResponseDto,
  AdminChannelVerificationDetailDto,
  AdminReviewChannelVerificationDto,
} from './dto/admin-channel-verification.dto';
import { ChannelVerificationDto } from '../dto/channel-verification.response.dto';
import {
  toAdminChannelVerificationListItemDto,
  toAdminChannelVerificationDetailDto,
  toChannelVerificationDto,
} from '../mappers/channel-verification.mapper';

@ApiTags('Admin - ChannelVerification')
@ApiBearerAuth()
@UseGuards(OptionalJwtAuthGuard, AdminUserAccessGuard)
@Controller('admin/channel-verifications')
export class AdminChannelVerificationController {
  constructor(
    private readonly channelVerificationService: ChannelVerificationService,
  ) {}

  @ApiOperation({
    summary: '채널 인증 목록 조회 (관리자)',
    description:
      '채널 인증 신청 목록을 조회합니다. 상태 및 플랫폼 필터링이 가능합니다.',
  })
  @ApiOkResponse({ type: AdminChannelVerificationListResponseDto })
  @Get()
  @HttpCode(HttpStatus.OK)
  async listVerifications(
    @Query() query: AdminChannelVerificationListQueryDto,
  ): Promise<AdminChannelVerificationListResponseDto> {
    const result =
      await this.channelVerificationService.listVerificationsAdmin(query);
    return {
      items: result.items.map(toAdminChannelVerificationListItemDto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    };
  }

  @ApiOperation({
    summary: '채널 인증 상세 조회 (관리자)',
    description: '채널 인증 신청의 상세 정보와 로그를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '인증 신청 ID' })
  @ApiOkResponse({ type: AdminChannelVerificationDetailDto })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getVerificationDetail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdminChannelVerificationDetailDto> {
    const result =
      await this.channelVerificationService.getVerificationDetailAdmin(id);
    return toAdminChannelVerificationDetailDto(result);
  }

  @ApiOperation({
    summary: '채널 인증 심사 (관리자)',
    description: '채널 인증 신청을 승인하거나 거절합니다.',
  })
  @ApiParam({ name: 'id', description: '인증 신청 ID' })
  @ApiOkResponse({ type: ChannelVerificationDto })
  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  async reviewVerification(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminReviewChannelVerificationDto,
    @Request() req,
  ): Promise<ChannelVerificationDto> {
    const adminUserId: number = Number(req.user.id);
    const result =
      await this.channelVerificationService.reviewVerificationAdmin(
        id,
        adminUserId,
        dto.decision,
        dto.rejectionReason,
        dto.platformUrl,
      );
    return toChannelVerificationDto(result);
  }

  @ApiOperation({
    summary: '채널 인증 로그 조회 (관리자)',
    description: '채널 인증 신청의 상태 변경 로그를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '인증 신청 ID' })
  @Get(':id/logs')
  @HttpCode(HttpStatus.OK)
  async getVerificationLogs(@Param('id', ParseIntPipe) id: number) {
    const logs =
      await this.channelVerificationService.getVerificationLogsAdmin(id);
    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      previousStatus: log.previousStatus,
      newStatus: log.newStatus,
      actorUserId: log.actorUserId,
      actorType: log.actorType,
      reason: log.reason,
      createdAt: log.createdAt,
      actorUser: log.actorUser
        ? { id: log.actorUser.id, nickname: log.actorUser.nickname }
        : null,
    }));
  }
}
