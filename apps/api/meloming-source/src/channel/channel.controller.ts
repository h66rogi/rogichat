import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Query,
  Req,
  BadRequestException,
  Patch,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ChannelService } from './channel.service';
import {
  CreateChannelDto,
  UpdateChannelDto,
  ChannelQueryDto,
  ChannelSearchQueryDto,
} from './dto/channel.request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelPermission } from './guards/channel-permission.decorator';
import { ChannelPermissionGuard } from './guards/channel-permission.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt.guard';
import { SongRequestOverlayFeatureGuard } from '../common/guards/song-request-overlay-feature.guard';
import { PrismaService } from '../prisma/prisma.service';
import { isProSubscriberActive } from './customization/utils/pro-subscription.util';
import { ChannelVerificationStatus } from '@prisma/client';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
  ApiExtraModels,
  ApiOkResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ChannelMyResponseDto,
  ChannelSearchResponseDto,
  ChannelDetailWithStatsDto,
  ChannelDetailDto,
  ChannelWithCountsDto,
  MessageResponseDto,
  ChannelPermissionResponseDto,
} from './dto/channel.response.dto';
import {
  toChannelMyResponseDto,
  toChannelDetailDto,
  toChannelSearchItemDto,
  toChannelWithCountsDto,
} from './mappers/channel.mapper';
import {
  buildChannelCreateInput,
  buildChannelUpdateInput,
} from './builders/channel.input';
import { BroadcastHistoryQueryDto } from './dto/broadcast-history.dto';

@ApiTags('Channel')
@Controller('channel')
@ApiExtraModels(ChannelDetailDto, ChannelDetailWithStatsDto)
export class ChannelController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ summary: '사용자의 채널 목록 조회' })
  @ApiResponse({
    status: 200,
    description: '채널 목록 조회 성공',
    type: ChannelMyResponseDto,
    isArray: true,
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('my')
  async getMyChannels(@Request() req) {
    const userId: number = Number(req.user.id);
    const channels: ChannelMyResponseDto[] = [];

    try {
      const [myChannels, managerChannels] = await Promise.all([
        await this.channelService.findByUserId(userId),
        await this.channelService.findManagerChannelByUserId(userId),
      ]);

      const newMyChannels = myChannels.map((channel) =>
        toChannelMyResponseDto({ ...channel, isOwner: true }),
      );

      const newManagerChannels = managerChannels.map((channel) =>
        toChannelMyResponseDto({ ...channel, isOwner: false }),
      );

      channels.push(...newMyChannels, ...newManagerChannels);
    } catch (error) {
      console.error(error);
      throw new BadRequestException('채널 목록 조회 실패');
    }

    return channels;
  }

  @ApiOperation({ summary: '채널 생성' })
  @ApiResponse({
    status: 201,
    description: '뮤직북 생성 성공',
    type: ChannelWithCountsDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 409, description: '중복된 채널 주소 또는 플랫폼 URL' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createChannel(
    @Body() createData: CreateChannelDto,
    @Request() req,
  ): Promise<ChannelWithCountsDto> {
    const userId: number = Number(req.user.id);
    const data = buildChannelCreateInput(userId, createData);
    const created = await this.channelService.create(userId, data);
    return toChannelWithCountsDto(created);
  }

  @ApiOperation({ summary: '채널 업데이트' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 수정' },
      webPath: { value: 'my_channel', description: 'webPath로 수정' },
    },
  })
  @ApiResponse({
    status: 200,
    description: '채널 업데이트 성공',
    type: ChannelWithCountsDto,
  })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('settings')
  @Put(':identifier')
  async updateChannel(
    @Param('identifier') identifier: string,
    @Body() updateDto: UpdateChannelDto,
    @Request() req,
  ): Promise<ChannelWithCountsDto> {
    const userId: number = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    const data = buildChannelUpdateInput(updateDto);
    const updated = await this.channelService.update(channel.id, userId, data);
    return toChannelWithCountsDto(updated);
  }

  @ApiOperation({ summary: '채널 삭제' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 삭제' },
      webPath: { value: 'my_channel', description: 'webPath로 삭제' },
    },
  })
  @ApiResponse({
    status: 200,
    description: '채널 삭제 성공',
    type: MessageResponseDto,
  })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('settings')
  @Delete(':identifier')
  async deleteChannel(
    @Param('identifier') identifier: string,
    @Request() req,
  ): Promise<MessageResponseDto> {
    const userId: number = Number(req.user.id);
    const isAdmin = Boolean(req.user?.isAdmin);
    const channel = await this.channelService.findByIdentifier(identifier);
    const result = await this.channelService.delete(channel.id, userId, {
      actorIsAdmin: isAdmin,
    });
    return { message: result.message };
  }

  @ApiOperation({ summary: '채널 검색' })
  @ApiQuery({
    name: 'keyword',
    description: '검색 키워드 (채널명, webPath, 플랫폼 URL)',
    example: '멜로밍',
  })
  @ApiResponse({
    status: 200,
    description: '채널 검색 결과',
    type: ChannelSearchResponseDto,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: '페이지 번호',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '페이지당 항목 수',
    example: 20,
  })
  @ApiResponse({ status: 400, description: '잘못된 검색 파라미터' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('search')
  async searchChannels(@Query() query: ChannelSearchQueryDto, @Req() req) {
    const userId: number | undefined = req?.user?.id
      ? Number(req.user.id)
      : undefined;
    const result = await this.channelService.searchChannels(
      query.keyword,
      query.page || 1,
      query.limit || 20,
      userId,
    );
    const response = {
      channels: result.channels.map((c) =>
        toChannelSearchItemDto({
          id: c.id,
          name: c.name,
          webPath: c.webPath,
          platformUrl: c.platformUrl,
          topBannerUrl: c.topBannerUrl,
          leftBannerUrl: undefined,
          rightBannerUrl: undefined,
          profileImageUrl: c.profileImageUrl,
          themeColor: c.themeColor,
          channelDescription: c.channelDescription,
          user: c.user ?? undefined,
          relevanceScore: c.relevanceScore,
          isFavorite: c.isFavorite,
          verifications: c.isVerified
            ? [{ status: ChannelVerificationStatus.APPROVED }]
            : [],
        }),
      ),
      pagination: result.pagination,
    };

    // JSON-safe 변환 (BigInt/Date 방지)
    type JsonPrimitive = string | number | boolean | null;
    type Json = JsonPrimitive | Json[] | { [key: string]: Json };
    const toJsonSafe = (value: unknown): Json => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'bigint') return Number(value);
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      )
        return value as JsonPrimitive;
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) {
        return (value as unknown[]).map((v) => toJsonSafe(v));
      }
      if (typeof value === 'object') {
        const out: { [key: string]: Json } = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          out[k] = toJsonSafe(v);
        }
        return out;
      }
      return null;
    };

    return toJsonSafe(response);
  }

  @Get(':identifier/permission')
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '해당 채널에 대한 권한 조회' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 권한 조회' },
      webPath: { value: 'meloming_user', description: 'webPath로 권한 조회' },
    },
  })
  @ApiResponse({
    status: 200,
    description: '공개 사용자 프로필 반환',
    type: ChannelPermissionResponseDto,
  })
  @ApiResponse({ status: 404, description: '사용자를 찾을 수 없음' })
  async getPublicUserPermission(
    @Param('identifier') identifier: string,
    @Req() req,
  ) {
    const channel = await this.channelService.findByIdentifier(identifier);

    const canView = true;
    let canManageContent = false;
    let canManageSettings = false;
    let canManageProfile = false;
    let canManageGuestbook = false;
    let canManageCustomization = false;
    let canManageEmoticons = false;
    let canManageHuyeorChat = false;
    let isOwner = false;

    // 채널 소유자의 프로 구독 상태 확인
    const isOwnerProSubscriber = await isProSubscriberActive(
      this.prisma,
      channel.user.id,
    );

    if (req.user) {
      const userId: number = Number(req.user.id);

      const isUserOwner = channel.user.id === userId;
      const isUserAdmin = req.user.isAdmin;
      const managerChannels =
        await this.channelService.findChannelManagerByUserId(userId);

      const isUserManager = managerChannels.find(
        (manager) => manager.channel.id === channel.id,
      );

      isOwner = isUserOwner;
      if (isUserOwner || isUserAdmin) {
        canManageContent = true;
        canManageSettings = true;
        canManageProfile = true;
        canManageGuestbook = true;
        canManageCustomization = true;
        canManageEmoticons = true;
        canManageHuyeorChat = true;
      } else if (isUserManager) {
        canManageContent = isUserManager.canManageContent ?? false;
        canManageSettings = isUserManager.canManageSettings ?? false;
        canManageProfile = isUserManager.canManageProfile ?? false;
        canManageGuestbook = isUserManager.canManageGuestbook ?? false;
        canManageCustomization = isUserManager.canManageCustomization ?? false;
        canManageEmoticons = isUserManager.canManageEmoticons ?? false;
        canManageHuyeorChat = isUserManager.canManageHuyeorChat ?? false;
      }
    }

    return {
      view: canView,
      manageContent: canManageContent,
      manageSettings: canManageSettings,
      manageProfile: canManageProfile,
      manageGuestbook: canManageGuestbook,
      manageCustomization: canManageCustomization,
      manageEmoticons: canManageEmoticons,
      manageHuyeorChat: canManageHuyeorChat,
      isOwner: isOwner,
      isOwnerProSubscriber: isOwnerProSubscriber,
    };
  }

  @ApiOperation({ summary: '채널의 오버레이 토큰 조회' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiResponse({
    status: 200,
    description: '오버레이 토큰 조회 성공',
  })
  @ApiBearerAuth()
  @UseGuards(
    JwtAuthGuard,
    SongRequestOverlayFeatureGuard,
    ChannelPermissionGuard,
  )
  @ChannelPermission('overlay')
  @Get(':identifier/overlay-token')
  async getOverlayToken(
    @Param('identifier') identifier: string,
    @Request() req,
  ) {
    const channel = await this.channelService.findByIdentifier(identifier);

    // overlayToken만 별도로 조회
    const channelWithToken = await this.prisma.channel.findUnique({
      where: { id: channel.id },
      select: { overlayToken: true },
    });

    // 토큰이 없으면 새로 생성
    if (!channelWithToken?.overlayToken) {
      const newToken = randomBytes(32).toString('hex');
      await this.prisma.channel.update({
        where: { id: channel.id },
        data: { overlayToken: newToken },
      });
      return { overlayToken: newToken };
    }

    return { overlayToken: channelWithToken.overlayToken };
  }

  @ApiOperation({ summary: '채널의 오버레이 토큰 재생성' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiResponse({
    status: 200,
    description: '오버레이 토큰 재생성 성공',
  })
  @ApiBearerAuth()
  @UseGuards(
    JwtAuthGuard,
    SongRequestOverlayFeatureGuard,
    ChannelPermissionGuard,
  )
  @ChannelPermission('settings')
  @Patch(':identifier/overlay-token/regenerate')
  async regenerateOverlayToken(
    @Param('identifier') identifier: string,
    @Request() req,
  ) {
    const channel = await this.channelService.findByIdentifier(identifier);
    const newToken = randomBytes(32).toString('hex');

    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { overlayToken: newToken },
    });

    return { overlayToken: newToken };
  }

  // --- Console Token Management ---

  @ApiOperation({ summary: '채널의 콘솔 토큰 조회' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('settings')
  @Get(':identifier/console-token')
  async getConsoleToken(@Param('identifier') identifier: string) {
    const channel = await this.channelService.findByIdentifier(identifier);
    const channelWithToken = await this.prisma.channel.findUnique({
      where: { id: channel.id },
      select: { consoleToken: true },
    });

    if (!channelWithToken?.consoleToken) {
      const newToken = randomBytes(32).toString('hex');
      await this.prisma.channel.update({
        where: { id: channel.id },
        data: { consoleToken: newToken },
      });
      return { consoleToken: newToken };
    }

    return { consoleToken: channelWithToken.consoleToken };
  }

  @ApiOperation({ summary: '채널의 콘솔 토큰 재생성' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('settings')
  @Patch(':identifier/console-token/regenerate')
  async regenerateConsoleToken(@Param('identifier') identifier: string) {
    const channel = await this.channelService.findByIdentifier(identifier);
    const newToken = randomBytes(32).toString('hex');

    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { consoleToken: newToken },
    });

    return { consoleToken: newToken };
  }

  @ApiOperation({ summary: '채널의 콘솔 토큰 삭제' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('settings')
  @Delete(':identifier/console-token')
  async deleteConsoleToken(@Param('identifier') identifier: string) {
    const channel = await this.channelService.findByIdentifier(identifier);
    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { consoleToken: null },
    });

    return { message: '콘솔 토큰이 삭제되었습니다.' };
  }

  @ApiOperation({ summary: '채널의 일정 공지 업데이트' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiResponse({
    status: 200,
    description: '일정 공지 업데이트 성공',
    type: ChannelWithCountsDto,
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Patch(':identifier/schedule-notice')
  async updateScheduleNotice(
    @Param('identifier') identifier: string,
    @Body() body: { scheduleNotice: string | null },
    @Request() req,
  ): Promise<ChannelWithCountsDto> {
    const channel = await this.channelService.findByIdentifier(identifier);

    const updated = await this.prisma.channel.update({
      where: { id: channel.id },
      data: { scheduleNotice: body.scheduleNotice },
      include: {
        _count: {
          select: { songs: true, artists: true, categories: true },
        },
        verifications: {
          select: { status: true, platform: true, platformChannelId: true },
          where: { status: { not: ChannelVerificationStatus.REVOKED } },
        },
        channelBadges: {
          select: { type: true },
          where: { revokedAt: null },
        },
      },
    });

    return toChannelWithCountsDto(updated);
  }

  @ApiOperation({ summary: '채널의 방명록 설정 조회' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiResponse({
    status: 200,
    description: '방명록 설정 조회 성공',
  })
  @Get(':identifier/guestbook-settings')
  async getGuestbookSettings(@Param('identifier') identifier: string) {
    const channel = await this.channelService.findByIdentifier(identifier);

    const channelSettings = await this.prisma.channel.findUnique({
      where: { id: channel.id },
      select: { guestbookEnabled: true },
    });

    return {
      guestbookEnabled: channelSettings?.guestbookEnabled ?? true,
    };
  }

  @ApiOperation({ summary: '채널의 방명록 설정 업데이트' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiResponse({
    status: 200,
    description: '방명록 설정 업데이트 성공',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('guestbook')
  @Patch(':identifier/guestbook-settings')
  async updateGuestbookSettings(
    @Param('identifier') identifier: string,
    @Body() body: { guestbookEnabled: boolean },
    @Request() req,
  ) {
    const channel = await this.channelService.findByIdentifier(identifier);

    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { guestbookEnabled: body.guestbookEnabled },
    });

    return {
      guestbookEnabled: body.guestbookEnabled,
      message: body.guestbookEnabled
        ? '방명록 기능이 활성화되었습니다.'
        : '방명록 기능이 비활성화되었습니다.',
    };
  }

  @ApiOperation({
    summary: '플랫폼 채널 ID로 멜로밍 채널 조회',
    description:
      '플랫폼(chzzk, soop, cime)과 플랫폼 채널 ID로 연결된 멜로밍 채널 기본 정보를 조회합니다.',
  })
  @Get('by-platform/:platform/:platformChannelId')
  async getByPlatform(
    @Param('platform') platform: string,
    @Param('platformChannelId') platformChannelId: string,
  ) {
    const parsedPlatform = ChannelService.parseStreamPlatformOrThrow(platform);
    return this.channelService.getByPlatform(parsedPlatform, platformChannelId);
  }

  @ApiOperation({
    summary: '플랫폼 채널 ID로 방송 히스토리 조회',
    description:
      '플랫폼(chzzk, soop, cime)과 플랫폼 채널 ID로 연결된 멜로밍 채널의 방송 히스토리를 조회합니다.',
  })
  @Get('by-platform/:platform/:platformChannelId/broadcast-history')
  async getBroadcastHistory(
    @Param('platform') platform: string,
    @Param('platformChannelId') platformChannelId: string,
    @Query() query: BroadcastHistoryQueryDto,
  ) {
    const parsedPlatform = ChannelService.parseStreamPlatformOrThrow(platform);
    return this.channelService.getBroadcastHistory(
      parsedPlatform,
      platformChannelId,
      query.days,
      query.limit,
    );
  }

  // 주의: 이 라우트는 :identifier가 와일드카드이므로 반드시 마지막에 위치해야 함
  @ApiOperation({
    summary: '채널 조회',
    description:
      '숫자면 채널 ID로, 문자면 webPath로 자동 인식하여 채널 조회. expand=true 시 통계 포함',
  })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 조회' },
      webPath: { value: 'my_channel', description: 'webPath로 조회' },
    },
  })
  @ApiQuery({
    name: 'expand',
    required: false,
    description: '통계 포함 여부 (true/false)',
    example: true,
    type: Boolean,
  })
  @ApiOkResponse({
    description: '채널 조회 성공',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ChannelDetailDto) },
        { $ref: getSchemaPath(ChannelDetailWithStatsDto) },
      ],
    },
  })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':identifier')
  async getChannel(
    @Param('identifier') identifier: string,
    @Query() query: ChannelQueryDto,
    @Req() req,
  ) {
    const channel = await this.channelService.findByIdentifier(identifier);
    const currentUserId =
      req.user && typeof req.user.id === 'number'
        ? Number(req.user.id)
        : undefined;
    const detail = toChannelDetailDto(channel, currentUserId);
    if (query.expand) {
      const stats = await this.channelService.getStats(channel.id);
      return { ...detail, stats } as ChannelDetailWithStatsDto;
    }
    return detail;
  }
}
