import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt.guard';
import { UserScopedThrottlerGuard } from '../common/guards/user-scoped-throttler.guard';
import { ChannelPermission } from './guards/channel-permission.decorator';
import { ChannelPermissionGuard } from './guards/channel-permission.guard';
import { ChannelService } from './channel.service';
import { ChannelFeatureSettingsService } from './channel-feature-settings.service';
import {
  ChannelFeatureSettingsResponseDto,
  ChannelCustomPageCommentDto,
  ChannelCustomPageCommentsResponseDto,
  CreateChannelCustomPageCommentDto,
  UpdateChannelCustomPageCommentDto,
  UpdateChannelFeatureSettingsDto,
} from './dto/channel-feature-settings.dto';

type RequestWithOptionalUser = Request & { user?: { id: number } };
type RequestWithUser = Request & { user: { id: number } };

@ApiTags('Channel/FeatureSettings')
@Controller('channel')
export class ChannelFeatureSettingsController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly featureSettingsService: ChannelFeatureSettingsService,
  ) {}

  @ApiOperation({ summary: '채널 기능 노출 설정 조회' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiResponse({
    status: 200,
    description: '채널 기능 노출 설정 조회 성공',
    type: ChannelFeatureSettingsResponseDto,
  })
  @Get(':identifier/feature-settings')
  @HttpCode(HttpStatus.OK)
  async getFeatureSettings(
    @Param('identifier') identifier: string,
  ): Promise<ChannelFeatureSettingsResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.featureSettingsService.getSettings(channel.id);
  }

  @ApiOperation({ summary: '채널 기능 노출 설정 업데이트' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiResponse({
    status: 200,
    description: '채널 기능 노출 설정 업데이트 성공',
    type: ChannelFeatureSettingsResponseDto,
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('settings')
  @Put(':identifier/feature-settings')
  @HttpCode(HttpStatus.OK)
  async updateFeatureSettings(
    @Param('identifier') identifier: string,
    @Body() body: UpdateChannelFeatureSettingsDto,
  ): Promise<ChannelFeatureSettingsResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.featureSettingsService.updateSettings(channel.id, body);
  }

  @ApiOperation({ summary: '커스텀 페이지 댓글 목록 조회' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiParam({ name: 'pageId', type: 'string', description: '커스텀 페이지 ID' })
  @ApiResponse({
    status: 200,
    description: '커스텀 페이지 댓글 목록 조회 성공',
    type: ChannelCustomPageCommentsResponseDto,
  })
  @UseGuards(OptionalJwtAuthGuard, UserScopedThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':identifier/custom-pages/:pageId/comments')
  @HttpCode(HttpStatus.OK)
  async getCustomPageComments(
    @Param('identifier') identifier: string,
    @Param('pageId') pageId: string,
    @Req() req: RequestWithOptionalUser,
  ): Promise<ChannelCustomPageCommentsResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.featureSettingsService.getCustomPageComments(
      channel.id,
      pageId,
      req.user?.id,
    );
  }

  @ApiOperation({ summary: '커스텀 페이지 댓글 작성' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiParam({ name: 'pageId', type: 'string', description: '커스텀 페이지 ID' })
  @ApiResponse({
    status: 201,
    description: '커스텀 페이지 댓글 작성 성공',
    type: ChannelCustomPageCommentDto,
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, UserScopedThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':identifier/custom-pages/:pageId/comments')
  async createCustomPageComment(
    @Param('identifier') identifier: string,
    @Param('pageId') pageId: string,
    @Body() body: CreateChannelCustomPageCommentDto,
    @Req() req: RequestWithUser,
  ): Promise<ChannelCustomPageCommentDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.featureSettingsService.createCustomPageComment(
      channel.id,
      pageId,
      req.user.id,
      body.content,
    );
  }

  @ApiOperation({ summary: '커스텀 페이지 댓글 수정' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiParam({ name: 'pageId', type: 'string', description: '커스텀 페이지 ID' })
  @ApiParam({ name: 'commentId', type: 'string', description: '댓글 ID' })
  @ApiResponse({
    status: 200,
    description: '커스텀 페이지 댓글 수정 성공',
    type: ChannelCustomPageCommentDto,
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, UserScopedThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Patch(':identifier/custom-pages/:pageId/comments/:commentId')
  @HttpCode(HttpStatus.OK)
  async updateCustomPageComment(
    @Param('identifier') identifier: string,
    @Param('pageId') pageId: string,
    @Param('commentId') commentId: string,
    @Body() body: UpdateChannelCustomPageCommentDto,
    @Req() req: RequestWithUser,
  ): Promise<ChannelCustomPageCommentDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.featureSettingsService.updateCustomPageComment(
      channel.id,
      pageId,
      commentId,
      req.user.id,
      body.content,
    );
  }

  @ApiOperation({ summary: '커스텀 페이지 댓글 삭제' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiParam({ name: 'pageId', type: 'string', description: '커스텀 페이지 ID' })
  @ApiParam({ name: 'commentId', type: 'string', description: '댓글 ID' })
  @ApiResponse({
    status: 204,
    description: '커스텀 페이지 댓글 삭제 성공',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, UserScopedThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Delete(':identifier/custom-pages/:pageId/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCustomPageComment(
    @Param('identifier') identifier: string,
    @Param('pageId') pageId: string,
    @Param('commentId') commentId: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    const channel = await this.channelService.findByIdentifier(identifier);
    const [isOwner, manager] = await Promise.all([
      this.channelService.validateChannelOwnership(channel.id, req.user.id),
      this.channelService.getManagerPermissions(channel.id, req.user.id),
    ]);
    await this.featureSettingsService.deleteCustomPageComment(
      channel.id,
      pageId,
      commentId,
      req.user.id,
      Boolean(isOwner || (manager?.isActive && manager.canManageSettings)),
    );
  }
}
