import { isChannelIdentifier } from './channel-identity.js';
import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingCalendarService } from './meloming-calendar.service.js';

function query(request: Request, search: boolean) {
  const raw = request.query as Record<string, unknown>;
  const flags = ['includeSchedules', 'includeBroadcasts', 'includeAnniversaries', 'includeClips'] as const;
  const allowed = ['from', 'to', ...flags, ...(search ? ['q', 'limit'] : [])];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new ApiError('INVALID_REQUEST', 400);
  if (typeof raw.from !== 'string' || raw.from.length > 40 || typeof raw.to !== 'string' || raw.to.length > 40) throw new ApiError('INVALID_REQUEST', 400);
  const result: { from: string; to: string; q?: string; limit?: number; includeSchedules?: boolean; includeBroadcasts?: boolean; includeAnniversaries?: boolean; includeClips?: boolean } = { from: raw.from, to: raw.to };
  for (const flag of flags) {
    const value = raw[flag];
    if (value === undefined) continue;
    if (value !== 'true' && value !== 'false' && value !== '1' && value !== '0') throw new ApiError('INVALID_REQUEST', 400);
    result[flag] = value === 'true' || value === '1';
  }
  if (search) {
    if (typeof raw.q !== 'string' || !raw.q.trim() || raw.q.length > 100) throw new ApiError('INVALID_REQUEST', 400);
    result.q = raw.q.trim();
    if (raw.limit !== undefined) {
      if (typeof raw.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(raw.limit) || Number(raw.limit) > 100) throw new ApiError('INVALID_REQUEST', 400);
      result.limit = Number(raw.limit);
    }
  }
  return result;
}

@ApiTags('Channel/Calendar')
@Controller('v1/channels/:identifier/calendar')
export class MelomingCalendarController {
  constructor(
    @Inject(MelomingCalendarService) private readonly calendar: MelomingCalendarService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get() @channelDoc('melomingChannelCalendar', '원본 채널 일정 및 기념일 캘린더', 'read')
  getCalendar(@Param('identifier') identifier: string, @Req() request: Request) {
    if (!isChannelIdentifier(identifier, true)) throw new ApiError('NOT_FOUND', 404);
    return this.calendar.getCalendar(query(request, false), readSessionCredentials(request, this.config));
  }

  @Get('search') @channelDoc('melomingChannelCalendarSearch', '원본 채널 캘린더 검색', 'read')
  searchCalendar(@Param('identifier') identifier: string, @Req() request: Request) {
    if (!isChannelIdentifier(identifier, true)) throw new ApiError('NOT_FOUND', 404);
    return this.calendar.searchCalendar(query(request, true), readSessionCredentials(request, this.config));
  }
}
