import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { AdminMusixmatchService } from './admin-musixmatch.service';
import {
  AdminMusixmatchInfoDto,
  AdminMusixmatchLyricsLanguageRequestDto,
  AdminMusixmatchManualNeededQueryDto,
  AdminMusixmatchManualNeededResponseDto,
  AdminMusixmatchMatchRequestDto,
  AdminMusixmatchMatchResponseDto,
  AdminMusixmatchSearchRequestDto,
  AdminMusixmatchSearchResponseDto,
  AdminMusixmatchUsageDto,
} from './dto/admin-musixmatch.dto';

/**
 * Admin endpoints for Musixmatch matching (Phase A1c).
 *
 * Routes:
 *   GET    /admin/global-songs/:id/musixmatch                   info
 *   POST   /admin/global-songs/:id/musixmatch/search            search candidates
 *   POST   /admin/global-songs/:id/musixmatch/match             confirm one
 *   DELETE /admin/global-songs/:id/musixmatch                   clear (=PENDING)
 *   POST   /admin/global-songs/:id/musixmatch/refetch-lyrics    re-fetch
 *   GET    /admin/musixmatch/usage                              usage dashboard
 *   GET    /admin/musixmatch/manual-needed                      manual queue
 *
 * spec: docs/superpowers/specs/2026-04-28-musixmatch-integration-design.md
 *       Section 5.2
 */
@ApiTags('Admin Musixmatch')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller()
export class AdminMusixmatchController {
  constructor(private readonly service: AdminMusixmatchService) {}

  @Get('admin/global-songs/:id/musixmatch')
  getInfo(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdminMusixmatchInfoDto> {
    return this.service.getInfo(id);
  }

  @Post('admin/global-songs/:id/musixmatch/search')
  @HttpCode(HttpStatus.OK)
  search(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AdminMusixmatchSearchRequestDto,
  ): Promise<AdminMusixmatchSearchResponseDto> {
    return this.service.search(id, body.q, body.artist, body.pageSize);
  }

  @Post('admin/global-songs/:id/musixmatch/match')
  @HttpCode(HttpStatus.OK)
  match(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AdminMusixmatchMatchRequestDto,
  ): Promise<AdminMusixmatchMatchResponseDto> {
    return this.service.match(id, body.trackId);
  }

  /**
   * Confirm a MANUAL_NEEDED suggestion — promotes to MATCHED using the
   * mxmTrackId already on the GlobalSong row (no body required).
   */
  @Post('admin/global-songs/:id/musixmatch/confirm')
  @HttpCode(HttpStatus.OK)
  confirmManual(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdminMusixmatchMatchResponseDto> {
    return this.service.confirmManualMatch(id);
  }

  @Delete('admin/global-songs/:id/musixmatch')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.service.clear(id);
  }

  /**
   * Manually override the lyrics language tag (e.g. fix 'en' →
   * 'ko' when admin verifies the body is romanized Korean).
   */
  @Patch('admin/global-songs/:id/musixmatch/lyrics/language')
  @HttpCode(HttpStatus.OK)
  updateLyricsLanguage(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AdminMusixmatchLyricsLanguageRequestDto,
  ): Promise<{ globalSongId: number; language: string | null }> {
    return this.service.updateLyricsLanguage(id, body.language ?? null);
  }

  @Post('admin/global-songs/:id/musixmatch/refetch-lyrics')
  @HttpCode(HttpStatus.OK)
  refetch(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ globalSongId: number; matcherStatus: string }> {
    return this.service.refetchLyrics(id);
  }

  /**
   * Reset matcher state and run the automatic matching pipeline
   * (primary matcher → Serper/LLM alternate fallback if enabled).
   * Returns the new matcherStatus.
   */
  @Post('admin/global-songs/:id/musixmatch/retry-auto')
  @HttpCode(HttpStatus.OK)
  retryAuto(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ globalSongId: number; matcherStatus: string }> {
    return this.service.retryAuto(id);
  }

  @Get('admin/musixmatch/usage')
  getUsage(): Promise<AdminMusixmatchUsageDto> {
    return this.service.getUsage();
  }

  @Get('admin/musixmatch/manual-needed')
  manualNeeded(
    @Query() query: AdminMusixmatchManualNeededQueryDto,
  ): Promise<AdminMusixmatchManualNeededResponseDto> {
    return this.service.manualNeededList(query);
  }
}
