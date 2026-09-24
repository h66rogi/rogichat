import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MelomingOverlayLyricsService } from './meloming-overlay-lyrics.service.js';

/**
 * Overlay 앱(OBS embed) 가사 조회 (Phase C Step 2).
 *
 * - overlay token query (`?token=...`) 로 owner channel resolve
 * - songId 가 해당 channel 의 Song 이어야 함 (cross-channel enumeration 차단,
 *   LyricsRetrievalService 의 findFirst 격리 그대로 재사용)
 * - Cache-Control: no-store (오버레이는 항상 최신, ETag 미사용)
 * - tracking.script: null 강제 (콘솔과 동일)
 *
 * spec: docs/superpowers/specs/2026-04-30-lyrics-playback-state-sync-design.md §5
 */
@ApiTags('Overlay - Lyrics')
@Controller('v1/overlay-api/songs')
export class MelomingOverlayLyricsController {
  constructor(@Inject(MelomingOverlayLyricsService) private readonly service: MelomingOverlayLyricsService) {}

  @Get(':songId/lyrics')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '오버레이 widget Musixmatch 가사 조회', description: '후로기 OBS 오버레이의 현재 곡 가사를 조회합니다.' })
  @ApiParam({ name: 'songId', type: Number })
  @ApiQuery({ name: 'token', description: 'Overlay token', required: true })
  @ApiQuery({
    name: 'liveSessionId',
    type: Number,
    required: false,
    description: '구버전 클라이언트는 현재 ACTIVE 세션으로 자동 보완',
  })
  @ApiQuery({
    name: 'songRequestId',
    type: Number,
    required: false,
    description: '구버전 클라이언트는 현재 PLAYING 신청곡으로 자동 보완',
  })
  @ApiQuery({
    name: 'include',
    required: false,
    description: '`richsync` 지정 시 word-level sync 포함',
  })
  @ApiResponse({ status: 200, description: 'Overlay lyrics response' })
  @ApiResponse({ status: 404, description: 'token/song 미존재' })
  async getLyrics(
    @Param('songId', ParseIntPipe) songId: number,
    @Query('token') token: string | undefined,
    @Query('liveSessionId', new ParseIntPipe({ optional: true }))
    liveSessionId: number | undefined,
    @Query('songRequestId', new ParseIntPipe({ optional: true }))
    songRequestId: number | undefined,
    @Query('include') include: string | undefined,
  ) {
    if (!token) {
      throw new BadRequestException('token query is required');
    }
    return this.service.getLyrics({
      overlayToken: token,
      songId,
      ...(liveSessionId !== undefined ? { liveSessionId } : {}),
      ...(songRequestId !== undefined ? { songRequestId } : {}),
      includeRichsync: parseIncludeRichsync(include),
    });
  }
}

function parseIncludeRichsync(include: string | undefined): boolean {
  if (!include) return false;
  return include === 'richsync' || include === 'true';
}
