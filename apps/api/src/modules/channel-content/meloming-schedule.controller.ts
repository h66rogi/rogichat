import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelScheduleService } from './schedule.service.js';
import { RecurringScheduleService } from './recurring-schedule.service.js';
import { channelDoc } from './channel-content.openapi.js';

function channel(value: string): void {
  if (value !== '1') throw new ApiError('NOT_FOUND', 404);
}

function id(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST', 400);
  return Number(value);
}

function query(request: Request) {
  const raw = request.query as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['ym', 'from', 'to', 'page', 'limit'].includes(key))) throw new ApiError('INVALID_REQUEST', 400);
  const result: { ym?: string; from?: string; to?: string; page?: number; limit?: number } = {};
  if (raw.ym !== undefined) {
    if (typeof raw.ym !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw.ym)) throw new ApiError('INVALID_REQUEST', 400);
    result.ym = raw.ym;
  }
  for (const key of ['from', 'to'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(new Date(value).valueOf())) throw new ApiError('INVALID_REQUEST', 400);
    result[key] = value;
  }
  for (const key of ['page', 'limit'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value) || Number(value) > (key === 'page' ? 100000 : 100)) throw new ApiError('INVALID_REQUEST', 400);
    result[key] = Number(value);
  }
  return result;
}

@ApiTags('Schedules/Meloming compatibility')
@Controller('v1/schedules')
export class MelomingScheduleController {
  constructor(
    @Inject(ChannelScheduleService) private readonly schedules: ChannelScheduleService,
    @Inject(RecurringScheduleService) private readonly recurring: RecurringScheduleService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get('channel/:channelId') @channelDoc('melomingChannelScheduleList', '원본 채널 일정 조회')
  list(@Param('channelId') channelId: string, @Req() request: Request) {
    channel(channelId);
    return this.schedules.listForViewer(readSessionCredentials(request, this.config), query(request));
  }

  @Post('channel/:channelId') @channelDoc('melomingChannelScheduleCreate', '원본 채널 일정 생성', 'write', 201)
  create(@Param('channelId') channelId: string, @Req() request: Request) {
    channel(channelId);
    return this.schedules.create(readCommandCredentials(request, this.config), request.body);
  }

  @Get('recurring/channel/:channelId') @channelDoc('melomingRecurringScheduleList', '원본 반복 일정 조회')
  recurringList(@Param('channelId') channelId: string) {
    channel(channelId);
    return this.recurring.list();
  }

  @Put('recurring/channel/:channelId') @channelDoc('melomingRecurringScheduleSave', '원본 반복 일정 저장', 'write')
  recurringSave(@Param('channelId') channelId: string, @Req() request: Request) {
    channel(channelId);
    return this.recurring.save(readCommandCredentials(request, this.config), request.body);
  }

  @Get(':id') @channelDoc('melomingScheduleDetail', '원본 일정 단건 조회', 'read', 200, true)
  detail(@Param('id') value: string, @Req() request: Request) {
    return this.schedules.getOne(readSessionCredentials(request, this.config), id(value));
  }

  @Patch(':id') @channelDoc('melomingScheduleUpdate', '원본 일정 수정', 'write', 200, true)
  update(@Param('id') value: string, @Req() request: Request) {
    return this.schedules.update(readCommandCredentials(request, this.config), id(value), request.body);
  }

  @Delete(':id') @channelDoc('melomingScheduleDelete', '원본 일정 삭제', 'write', 200, true)
  async remove(@Param('id') value: string, @Req() request: Request) {
    await this.schedules.remove(readCommandCredentials(request, this.config), id(value));
    return { success: true };
  }
}
