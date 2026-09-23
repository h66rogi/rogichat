import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { RecurringScheduleService } from './recurring-schedule.service';
import { SaveRecurringSchedulesDto } from './dto/recurring-schedule.request.dto';
import {
  RecurringScheduleResponseDto,
  RecurringSchedulesListResponseDto,
} from './dto/recurring-schedule.response.dto';

type RequiredAuthRequest = Request & {
  user: {
    id: number;
    nickname: string;
    profileImageUrl: string | null;
    isAdmin?: boolean;
  };
};

@ApiTags('Schedules - Recurring')
@Controller('schedules/recurring')
export class RecurringScheduleController {
  constructor(private readonly service: RecurringScheduleService) {}

  @Get('/channel/:channelId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 반복 일정 조회' })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiResponse({ status: 200, type: RecurringSchedulesListResponseDto })
  async getRecurringSchedules(
    @Param('channelId') channelIdParam: string,
  ): Promise<RecurringSchedulesListResponseDto> {
    const channelId = Number(channelIdParam);
    const rows = await this.service.getChannelRecurringSchedules(channelId);
    return {
      items: rows.map((r) => ({
        id: r.id,
        channelId: r.channelId,
        dayOfWeek: r.dayOfWeek,
        title: r.title,
        startTime: r.startTime,
        status: r.status,
        isActive: r.isActive,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  @Put('/channel/:channelId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 반복 일정 저장 (일괄)' })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiBody({ type: SaveRecurringSchedulesDto })
  @ApiResponse({ status: 200, type: RecurringSchedulesListResponseDto })
  async saveRecurringSchedules(
    @Param('channelId') channelIdParam: string,
    @Body() dto: SaveRecurringSchedulesDto,
    @Req() req: RequiredAuthRequest,
  ): Promise<RecurringSchedulesListResponseDto> {
    const channelId = Number(channelIdParam);
    const rows = await this.service.saveRecurringSchedules(
      channelId,
      Number(req.user.id),
      dto,
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        channelId: r.channelId,
        dayOfWeek: r.dayOfWeek,
        title: r.title,
        startTime: r.startTime,
        status: r.status,
        isActive: r.isActive,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }
}
