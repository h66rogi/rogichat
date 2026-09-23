import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChannelMembershipCatalogService } from '../channel-membership/channel-membership-catalog.service';
import { AuthUser } from '../common/decorators/auth-user.decorator';
import { AuthUserDto } from '../common/dto/auth-user.dto';
import {
  CreateChannelMembershipPlanDto,
  ReplaceChannelMembershipPlanEmoticonsDto,
  UpdateChannelMembershipPlanDto,
} from './dto/channel-membership-settings.dto';
import { ChannelPermission } from './guards/channel-permission.decorator';
import { ChannelPermissionGuard } from './guards/channel-permission.guard';

/** Native channel-membership catalog and creator-only emote assignment. */
@ApiTags('Channel/Membership')
@Controller({ path: 'channel', version: '1' })
export class ChannelMembershipSettingsController {
  constructor(private readonly memberships: ChannelMembershipCatalogService) {}

  @Get(':channelId/membership')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 멤버십 등급 및 전용 이모티콘 조회' })
  listPlans(@Param('channelId', ParseIntPipe) channelId: number) {
    return this.memberships.listPublicPlans(channelId);
  }

  @Get(':channelId/membership/me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: '내 채널 멤버십 권한 조회' })
  getMyMembership(
    @Param('channelId', ParseIntPipe) channelId: number,
    @AuthUser() user: AuthUserDto,
  ) {
    return this.memberships.getMyMembership(channelId, user.id);
  }

  @Get(':channelId/membership/manage')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('emoticons')
  @ApiOperation({ summary: '채널 멤버십 이모티콘 관리 정보 조회' })
  getManagement(@Param('channelId', ParseIntPipe) channelId: number) {
    return this.memberships.getManagement(channelId);
  }

  @Post(':channelId/membership/plans')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('settings')
  @ApiOperation({ summary: '채널 멤버십 등급 생성' })
  createPlan(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() dto: CreateChannelMembershipPlanDto,
  ) {
    return this.memberships.createPlan(channelId, dto);
  }

  @Patch(':channelId/membership/plans/:planId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('settings')
  @ApiOperation({ summary: '채널 멤버십 등급 표시 및 웹 가격 수정' })
  updatePlan(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('planId') planId: string,
    @Body() dto: UpdateChannelMembershipPlanDto,
  ) {
    return this.memberships.updatePlan(channelId, planId, dto);
  }

  @Put(':channelId/membership/plans/:planId/emoticons')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('emoticons')
  @ApiOperation({ summary: '멤버십 등급 전용 이모티콘 교체' })
  replacePlanEmoticons(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('planId') planId: string,
    @Body() dto: ReplaceChannelMembershipPlanEmoticonsDto,
  ) {
    return this.memberships.replacePlanEmoticons(
      channelId,
      planId,
      dto.emoticonIds,
    );
  }
}
