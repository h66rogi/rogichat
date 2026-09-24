import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../auth/auth-primitives.js';
import { consoleCredentials } from './meloming-console-token.js';
import { MelomingLiveSongRequestService } from './meloming-live-song-request.service.js';
import { MelomingSongLiveGateway } from './meloming-song-live.gateway.js';
import { channelDoc } from './channel-content.openapi.js';

function id(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ApiError('INVALID_REQUEST', 400);
  }
  return Number(value);
}

@ApiTags('Console API - Song Requests')
@Controller('v1/console-api/song-requests')
export class MelomingConsoleSongRequestController {
  constructor(
    @Inject(MelomingLiveSongRequestService) private readonly requests: MelomingLiveSongRequestService,
    @Inject(MelomingSongLiveGateway) private readonly gateway: MelomingSongLiveGateway,
  ) {}

  private async announce<T>(work: Promise<T>, event: 'request.added'|'request.updated'|'request.removed'|'queue.reordered'): Promise<T> {
    const result = await work;
    this.gateway.broadcast(event, {});
    return result;
  }

  @Get() @channelDoc('melomingConsoleQueue', '원본 콘솔 신청곡 대기열 조회')
  getQueue(@Req() request: Request) {
    const { sessionId, includeCompleted } = request.query;
    return this.requests.queue(consoleCredentials(request), { sessionId, ...(includeCompleted !== undefined ? { includeCompleted } : {}) });
  }

  @Post() @channelDoc('melomingConsoleRequestCreate', '원본 콘솔 신청곡 등록', 'none', 201)
  createRequest(@Req() request: Request) {
    return this.announce(this.requests.create(consoleCredentials(request), request.body), 'request.added');
  }

  @Patch(':id/status') @channelDoc('melomingConsoleRequestStatus', '원본 콘솔 신청곡 상태 변경', 'none', 200, true)
  updateStatus(@Param('id') requestId: string, @Req() request: Request) {
    return this.announce(this.requests.status(consoleCredentials(request), id(requestId), request.body), 'request.updated');
  }

  @Delete('queue') @HttpCode(200) @channelDoc('melomingConsoleQueueClear', '원본 콘솔 대기열 비우기')
  async clearQueue(@Req() request: Request) {
    const deletedCount = await this.announce(this.requests.clear(consoleCredentials(request),
      { sessionId: request.query.sessionId }), 'queue.reordered');
    return { deletedCount, message: `${deletedCount}개의 신청곡이 삭제되었습니다.` };
  }

  @Delete(':id') @HttpCode(204) @channelDoc('melomingConsoleRequestDelete', '원본 콘솔 신청곡 삭제', 'none', 204, true)
  async deleteRequest(@Param('id') requestId: string, @Req() request: Request) {
    await this.announce(this.requests.remove(consoleCredentials(request), id(requestId)), 'request.removed');
  }

  @Patch(':id/order') @channelDoc('melomingConsoleRequestOrder', '원본 콘솔 신청곡 순서 변경', 'none', 200, true)
  async updateQueueOrder(@Param('id') requestId: string, @Req() request: Request) {
    await this.announce(this.requests.order(consoleCredentials(request), id(requestId), request.body), 'queue.reordered');
    return { message: '대기열 순서가 변경되었습니다.' };
  }

  @Get('now-playing') @channelDoc('melomingConsoleNowPlaying', '원본 콘솔 재생 중 곡 조회')
  getNowPlaying(@Req() request: Request) {
    return this.requests.nowPlaying(consoleCredentials(request), { sessionId: request.query.sessionId });
  }

  @Post('play-next') @channelDoc('melomingConsolePlayNext', '원본 콘솔 다음 곡 재생', 'none', 201)
  playNext(@Req() request: Request) {
    return this.announce(this.requests.advance(consoleCredentials(request), { sessionId: request.query.sessionId }, 'next'), 'request.updated');
  }

  @Post('skip-current') @channelDoc('melomingConsoleSkipCurrent', '원본 콘솔 현재 곡 건너뛰기', 'none', 201)
  skipCurrent(@Req() request: Request) {
    return this.announce(this.requests.advance(consoleCredentials(request),
      { sessionId: request.query.sessionId, ...(request.query.reason !== undefined ? { reason: request.query.reason } : {}) }, 'skip'), 'request.updated');
  }

  @Post(':id/play-now') @channelDoc('melomingConsolePlayNow', '원본 콘솔 신청곡 즉시 재생', 'none', 201, true)
  playNow(@Param('id') requestId: string, @Req() request: Request) {
    return this.announce(this.requests.playNow(consoleCredentials(request), id(requestId)), 'request.updated');
  }
}
