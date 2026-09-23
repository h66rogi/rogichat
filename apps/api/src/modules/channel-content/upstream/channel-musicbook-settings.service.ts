// Adapted from meloming-back a91393b2 src/channel/channel-musicbook-settings.service.ts.
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { nextChannelContentId } from '../channel-content-id.js';
import {
  CHANNEL_MUSICBOOK_SETTINGS_LAYOUT_TYPE,
  CHANNEL_MUSICBOOK_SETTINGS_VERSION,
  type ChannelMusicbookSettingsStats,
} from './channel-musicbook-settings.constants.js';
import {
  type ChannelMusicbookSettingsResponseDto,
  type CopyDifficultyToProficiencyResponseDto,
  type UpdateChannelMusicbookSettingsDto,
} from './channel-musicbook-settings.dto.js';

type StoredMusicbookSettingsLayout = {
  version?: number;
  useProficiencyAsPrimary?: unknown;
};

export class ChannelMusicbookSettingsService {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async getSettings(
    channelId: string,
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

  async usesProficiencyAsPrimary(channelId: string): Promise<boolean> {
    const settings = await this.getSettings(channelId);
    return settings.useProficiencyAsPrimary;
  }

  async updateSettings(
    channelId: string,
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
        id: await nextChannelContentId(this.prisma),
        channelId,
        layoutType: CHANNEL_MUSICBOOK_SETTINGS_LAYOUT_TYPE,
        layout,
      },
      select: { layout: true },
    });

    return this.toResponse(saved.layout, stats);
  }

  async copyDifficultyToProficiency(
    channelId: string,
  ): Promise<CopyDifficultyToProficiencyResponseDto> {
    const songs = await this.prisma.song.findMany({
      where: { channelId },
      select: { id: true, difficulty: true },
    });

    const chunkSize = 100;
    for (let i = 0; i < songs.length; i += chunkSize) {
      const chunk = songs.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((song) =>
          this.prisma.song.update({
            where: { id: song.id },
            data: { proficiency: song.difficulty ?? 1 },
          }),
        ),
      );
    }

    const settings = await this.getSettings(channelId);
    return {
      ...settings,
      updatedCount: songs.length,
    };
  }

  private async getStats(
    channelId: string,
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

}
