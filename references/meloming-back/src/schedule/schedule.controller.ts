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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ScheduleService } from './schedule.service';
import {
  CreateScheduleDto,
  ScheduleListQueryDto,
  UpdateScheduleDto,
} from './dto/schedule.request.dto';
import {
  ScheduleListResponseDto,
  ScheduleResponseDto,
} from './dto/schedule.response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt.guard';
import { toScheduleResponse } from './mappers/schedule.mapper';
import { Request } from 'express';

type AuthenticatedRequest = Request & {
  user?: {
    id: number;
    nickname: string;
    profileImageUrl: string | null;
    isAdmin?: boolean;
  };
};

type RequiredAuthRequest = Request & {
  user: {
    id: number;
    nickname: string;
    profileImageUrl: string | null;
    isAdmin?: boolean;
  };
};

@ApiTags('Schedules')
@Controller('schedules')
export class ScheduleController {
  constructor(private readonly service: ScheduleService) {}

  @Post('/channel/:channelId')
  @ApiOperation({ summary: '채널 일정 생성(소유자/매니저)' })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBody({ type: CreateScheduleDto })
  @ApiResponse({ status: 201, type: ScheduleResponseDto })
  async create(
    @Param('channelId') channelIdParam: string,
    @Body() dto: CreateScheduleDto,
    @Req() req: RequiredAuthRequest,
  ): Promise<ScheduleResponseDto> {
    const channelId = Number(channelIdParam);
    const row = await this.service.create(channelId, Number(req.user.id), dto);
    return toScheduleResponse(row, {
      id: Number(req.user.id),
      nickname: req.user.nickname,
      profileImageUrl: req.user.profileImageUrl,
    });
  }

  @Get('/channel/:channelId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 일정 목록(공개, 권한자면 비공개 포함)' })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({
    name: 'ym',
    required: false,
    description: '월 단위 조회(KST). YYYY-MM. 제공 시 from/to 무시',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: ScheduleListResponseDto })
  @UseGuards(OptionalJwtAuthGuard)
  async listChannel(
    @Param('channelId') channelIdParam: string,
    @Query() query: ScheduleListQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ScheduleListResponseDto> {
    const channelId = Number(channelIdParam);
    const me = req.user ? Number(req.user.id) : undefined;
    const { rows, total, page, limit } = await this.service.listChannelPublic(
      channelId,
      query,
      me,
    );
    return {
      items: rows.map((r) => toScheduleResponse(r)),
      page,
      limit,
      total,
    };
  }

  @Get('/favorites')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '즐겨찾기 채널 일정 목록(기본 공개만, 내 채널만 보기 옵션 시 비공개 포함)',
  })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({
    name: 'ym',
    required: false,
    description: '월 단위 조회(KST). YYYY-MM. 제공 시 from/to 무시',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'channelIds',
    required: false,
    description: '필터 채널 ID 배열',
  })
  @ApiResponse({ status: 200, type: ScheduleListResponseDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async listFavorites(
    @Query() query: ScheduleListQueryDto,
    @Req() req: RequiredAuthRequest,
  ): Promise<ScheduleListResponseDto> {
    const { rows, total, page, limit } = await this.service.listFavorites(
      Number(req.user.id),
      query,
      false,
    );
    return {
      items: rows.map((r) => toScheduleResponse(r)),
      page,
      limit,
      total,
    };
  }

  @Get('/mine')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '내 채널 + 내가 매니저인 채널의 일정 목록(비공개 포함)',
  })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({
    name: 'ym',
    required: false,
    description: '월 단위 조회(KST). YYYY-MM. 제공 시 from/to 무시',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: ScheduleListResponseDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async listMine(
    @Query() query: ScheduleListQueryDto,
    @Req() req: RequiredAuthRequest,
  ): Promise<ScheduleListResponseDto> {
    const { rows, total, page, limit } = await this.service.listMine(
      Number(req.user.id),
      query,
    );
    return {
      items: rows.map((r) => toScheduleResponse(r)),
      page,
      limit,
      total,
    };
  }

  @Get('upcoming-highlights')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '홈 화면용 다가오는 주요 일정 (랜덤 7일 이내, LIVE/COLLAB)',
  })
  @ApiResponse({ status: 200, type: [ScheduleResponseDto] })
  @UseGuards(OptionalJwtAuthGuard)
  async getUpcomingHighlights(): Promise<ScheduleResponseDto[]> {
    const rows = await this.service.getUpcomingHighlights(10);
    return rows.map((r) => toScheduleResponse(r));
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '일정 단건 조회(공개/권한자)' })
  @ApiParam({ name: 'id', type: 'number' })
  @ApiResponse({ status: 200, type: ScheduleResponseDto })
  async getOne(
    @Param('id') idParam: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ScheduleResponseDto> {
    const row = await this.service.getPublicOrAuthorized(
      Number(idParam),
      req.user?.id ? Number(req.user.id) : undefined,
      req.user?.isAdmin ?? false,
    );
    return toScheduleResponse(row);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '일정 수정(소유자/매니저)' })
  @ApiParam({ name: 'id', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBody({ type: UpdateScheduleDto })
  async update(
    @Param('id') idParam: string,
    @Body() dto: UpdateScheduleDto,
    @Req() req: RequiredAuthRequest,
  ): Promise<ScheduleResponseDto> {
    const row = await this.service.update(
      Number(idParam),
      Number(req.user.id),
      dto,
    );
    const author = await this.service['prisma'].user.findUnique({
      where: { id: row.authorUserId },
      select: { id: true, nickname: true, profileImageUrl: true },
    });
    return toScheduleResponse(row, author ?? undefined);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '일정 삭제(소유자/매니저, soft delete)' })
  @ApiParam({ name: 'id', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async remove(
    @Param('id') idParam: string,
    @Req() req: RequiredAuthRequest,
  ): Promise<{ success: true }> {
    await this.service.remove(Number(idParam), Number(req.user.id));
    return { success: true };
  }
}
