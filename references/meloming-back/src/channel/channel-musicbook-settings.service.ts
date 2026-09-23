import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';
import {
  CHANNEL_MUSICBOOK_SETTINGS_LAYOUT_TYPE,
  CHANNEL_MUSICBOOK_SETTINGS_VERSION,
  type ChannelMusicbookSettingsStats,
} from './channel-musicbook-settings.constants';
import {
  ChannelMusicbookSettingsResponseDto,
  CopyDifficultyToProficiencyResponseDto,
  UpdateChannelMusicbookSettingsDto,
} from './dto/channel-musicbook-settings.dto';

type StoredMusicbookSettingsLayout = {
  version?: number;
  useProficiencyAsPrimary?: unknown;
};

@Injectable()
export class ChannelMusicbookSettingsService {
  private readonly logger = new Logger(ChannelMusicbookSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheTracker: CacheKeyTrackingService,
  ) {}

  async getSettings(
    channelId: number,
  ): Promise<ChannelMusicbookSettingsResponseDto> {
    const [stored, stats] = await Promise.all([
      this.prisma.channelOverlayLayout.findUnique({
        where: {
          channelId_layoutType: {
            channelId,
            layoutType: CHANNEL_MUSICBOOK_SETTINGS_LAYOUT_TYPE,
          },
        },
        select: { layout: true },
      }),
      this.getStats(channelId),
    ]);

    return this.toResponse(stored?.layout, stats);
  }

  async usesProficiencyAsPrimary(channelId: number): Promise<boolean> {
    const settings = await this.getSettings(channelId);
    return settings.useProficiencyAsPrimary;
  }

  async updateSettings(
    channelId: number,
    dto: UpdateChannelMusicbookSettingsDto,
  ): Promise<ChannelMusicbookSettingsResponseDto> {
    const stats = await this.getStats(channelId);
    if (dto.useProficiencyAsPrimary && stats.songsMissingProficiency > 0) {
      throw new BadRequestException(
        '숙련도가 비어있는 곡이 있어 옵션을 켤 수 없습니다. 먼저 난이도를 숙련도로 복사하거나 모든 곡의 숙련도를 입력해주세요.',
      );
    }

    const layout = {
      version: CHANNEL_MUSICBOOK_SETTINGS_VERSION,
      useProficiencyAsPrimary: dto.useProficiencyAsPrimary,
    } satisfies Prisma.InputJsonObject;

    const saved = await this.prisma.channelOverlayLayout.upsert({
      where: {
        channelId_layoutType: {
          channelId,
          layoutType: CHANNEL_MUSICBOOK_SETTINGS_LAYOUT_TYPE,
        },
      },
      update: { layout },
      create: {
        channelId,
        layoutType: CHANNEL_MUSICBOOK_SETTINGS_LAYOUT_TYPE,
        layout,
      },
      select: { layout: true },
    });

    return this.toResponse(saved.layout, stats);
  }

  async copyDifficultyToProficiency(
    channelId: number,
  ): Promise<CopyDifficultyToProficiencyResponseDto> {
    const songs = await this.prisma.song.findMany({
      where: { channelId },
      select: { id: true, difficulty: true },
    });

    const chunkSize = 100;
    for (let i = 0; i < songs.length; i += chunkSize) {
      const chunk = songs.slice(i, i + chunkSize);
      await this.prisma.$transaction(
        chunk.map((song) =>
          this.prisma.song.update({
            where: { id: song.id },
            data: { proficiency: song.difficulty ?? 1 },
          }),
        ),
      );
    }

    await this.clearSongCaches(channelId);

    const settings = await this.getSettings(channelId);
    return {
      ...settings,
      updatedCount: songs.length,
    };
  }

  private async getStats(
    channelId: number,
  ): Promise<ChannelMusicbookSettingsStats> {
    const [totalSongs, songsMissingProficiency] = await Promise.all([
      this.prisma.song.count({ where: { channelId } }),
      this.prisma.song.count({
        where: {
          channelId,
          OR: [
            { proficiency: null },
            { proficiency: { lt: 1 } },
            { proficiency: { gt: 5 } },
          ],
        },
      }),
    ]);

    return { totalSongs, songsMissingProficiency };
  }

  private toResponse(
    rawLayout: unknown,
    stats: ChannelMusicbookSettingsStats,
  ): ChannelMusicbookSettingsResponseDto {
    const layout = rawLayout as StoredMusicbookSettingsLayout | undefined;
    const hasExplicitUseProficiencyAsPrimary =
      typeof layout?.useProficiencyAsPrimary === 'boolean';
    const storedValue =
      hasExplicitUseProficiencyAsPrimary
        ? layout.useProficiencyAsPrimary
        : undefined;
    const canEnableProficiencyAsPrimary = stats.songsMissingProficiency === 0;
    const desiredUseProficiency = storedValue ?? false;

    return {
      useProficiencyAsPrimary:
        desiredUseProficiency && canEnableProficiencyAsPrimary,
      hasExplicitUseProficiencyAsPrimary,
      canEnableProficiencyAsPrimary,
      totalSongs: stats.totalSongs,
      songsMissingProficiency: stats.songsMissingProficiency,
    };
  }

  private async clearSongCaches(channelId: number): Promise<void> {
    try {
      await Promise.all([
        this.cacheTracker.clearChannel(channelId),
        this.cacheTracker.clearGlobal(),
      ]);
    } catch (error) {
      this.logger.warn(
        `Failed to clear song caches after musicbook settings change (channel=${channelId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
