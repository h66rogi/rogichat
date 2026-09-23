import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ChannelSongRequestSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChannelSongRequestSettingsResponseDto,
  UpdateChannelSongRequestSettingsDto,
} from './dto/channel-song-request-settings.dto';

/**
 * 채널 단위 신청곡 설정 CRUD.
 *
 * 2026-05-14 P0 인시던트 후 LiveSessionSettings(라이브 1:1) → ChannelSongRequestSettings(채널 1:1)
 * 재설계. T1 migration 으로 모든 기존 채널은 row backfill 완료. 신규 채널 가입 시점 hook
 * 누락 또는 동시성 race 방어를 위해 read 시점 lazy create 도 유지.
 */
@Injectable()
export class ChannelSongRequestSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getByChannelId(channelId: number): Promise<ChannelSongRequestSettings> {
    const existing = await this.prisma.channelSongRequestSettings.findUnique({
      where: { channelId },
    });
    if (existing) return existing;

    try {
      return await this.prisma.channelSongRequestSettings.create({
        data: { channelId },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const refreshed =
          await this.prisma.channelSongRequestSettings.findUnique({
            where: { channelId },
          });
        if (refreshed) return refreshed;
      }
      throw e;
    }
  }

  async update(
    channelId: number,
    dto: UpdateChannelSongRequestSettingsDto,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<ChannelSongRequestSettings> {
    const data = this.toData(dto);
    return client.channelSongRequestSettings.upsert({
      where: { channelId },
      create: { channelId, ...data },
      update: data,
    });
  }

  toResponseDto(
    settings: ChannelSongRequestSettings,
  ): ChannelSongRequestSettingsResponseDto {
    const blocked = settings.blockedCategoryIds;
    return {
      channelId: settings.channelId,
      requestCommand: settings.requestCommand,
      maxQueueSize: settings.maxQueueSize,
      donationPriorityEnabled: settings.donationPriorityEnabled,
      enforceDonationMinimumPrice: settings.enforceDonationMinimumPrice,
      karaokePlaybackMode: settings.karaokePlaybackMode,
      karaokeVideoType: settings.karaokeVideoType,
      donationOnlyEnabled: settings.donationOnlyEnabled,
      requestMode: settings.requestMode,
      chatRequestEnabled: settings.chatRequestEnabled,
      donationRequestEnabled: settings.donationRequestEnabled,
      allowAnonymous: settings.allowAnonymous,
      requireSongMatch: settings.requireSongMatch,
      randomRequestEnabled: settings.randomRequestEnabled,
      preventDuplicateSongs: settings.preventDuplicateSongs,
      blockedCategoryIds: Array.isArray(blocked)
        ? (blocked.filter((v) => typeof v === 'number') as number[])
        : [],
      maxRequestsPerUser: settings.maxRequestsPerUser,
      maxTotalRequests: settings.maxTotalRequests,
      showRequesterName: settings.showRequesterName,
    };
  }

  private toData(
    dto: UpdateChannelSongRequestSettingsDto,
  ): Partial<
    Omit<
      Prisma.ChannelSongRequestSettingsUncheckedCreateInput,
      'id' | 'channelId' | 'createdAt' | 'updatedAt'
    >
  > {
    const data: Partial<
      Omit<
        Prisma.ChannelSongRequestSettingsUncheckedCreateInput,
        'id' | 'channelId' | 'createdAt' | 'updatedAt'
      >
    > = {};
    if (dto.requestCommand !== undefined) data.requestCommand = dto.requestCommand;
    if (dto.maxQueueSize !== undefined) data.maxQueueSize = dto.maxQueueSize;
    if (dto.donationPriorityEnabled !== undefined)
      data.donationPriorityEnabled = dto.donationPriorityEnabled;
    if (dto.enforceDonationMinimumPrice !== undefined)
      data.enforceDonationMinimumPrice = dto.enforceDonationMinimumPrice;
    if (dto.karaokePlaybackMode !== undefined)
      data.karaokePlaybackMode = dto.karaokePlaybackMode;
    if (dto.karaokeVideoType !== undefined)
      data.karaokeVideoType = dto.karaokeVideoType;
    if (dto.donationOnlyEnabled !== undefined)
      data.donationOnlyEnabled = dto.donationOnlyEnabled;
    if (dto.requestMode !== undefined) data.requestMode = dto.requestMode;
    if (dto.chatRequestEnabled !== undefined)
      data.chatRequestEnabled = dto.chatRequestEnabled;
    if (dto.donationRequestEnabled !== undefined)
      data.donationRequestEnabled = dto.donationRequestEnabled;
    if (dto.allowAnonymous !== undefined) data.allowAnonymous = dto.allowAnonymous;
    if (dto.requireSongMatch !== undefined)
      data.requireSongMatch = dto.requireSongMatch;
    if (dto.randomRequestEnabled !== undefined)
      data.randomRequestEnabled = dto.randomRequestEnabled;
    if (dto.preventDuplicateSongs !== undefined)
      data.preventDuplicateSongs = dto.preventDuplicateSongs;
    if (dto.blockedCategoryIds !== undefined)
      data.blockedCategoryIds = dto.blockedCategoryIds;
    if (dto.maxRequestsPerUser !== undefined)
      data.maxRequestsPerUser = dto.maxRequestsPerUser;
    if (dto.maxTotalRequests !== undefined)
      data.maxTotalRequests = dto.maxTotalRequests;
    if (dto.showRequesterName !== undefined)
      data.showRequesterName = dto.showRequesterName;
    return data;
  }
}
