import { Injectable, NotFoundException } from '@nestjs/common';
import { ChannelGlobalProfile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelGlobalProfileUpsertRequestDto } from './dto/channel-global-profile.dto';

/**
 * 채널의 글로벌(meloming.gg) 노출 설정을 관리한다.
 *
 * 정책 (opt-out 모델):
 * - 1 채널당 1 row (channelId unique).
 * - row 가 없는 채널은 default 가 true (모든 채널이 자동으로 글로벌에 노출).
 * - 채널 owner 가 manage 페이지에서 토글로 끌 수 있다.
 * - PATCH: 보낸 필드만 업데이트. null = override 해제 (원본 Channel 값 fallback).
 * - PUT: 모든 필드 덮어쓰기 (보내지 않은 optional 필드는 null/true reset).
 */
@Injectable()
export class ChannelGlobalProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getByChannelId(channelId: number): Promise<ChannelGlobalProfile | null> {
    return this.prisma.channelGlobalProfile.findUnique({
      where: { channelId },
    });
  }

  /**
   * 채널 존재 여부를 검증한다. 존재하지 않으면 404.
   */
  private async assertChannelExists(channelId: number): Promise<void> {
    const exists = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Channel ${channelId} not found`);
    }
  }

  /**
   * PUT — 전체 덮어쓰기. 누락된 optional 필드는 null/false 로 reset.
   */
  async put(
    channelId: number,
    body: ChannelGlobalProfileUpsertRequestDto,
  ): Promise<ChannelGlobalProfile> {
    await this.assertChannelExists(channelId);

    const data = {
      globalEnabled: body.globalEnabled ?? true,
      globalName: body.globalName ?? null,
      globalDescription: body.globalDescription ?? null,
      globalProfileImageUrl: body.globalProfileImageUrl ?? null,
      primaryLocale: body.primaryLocale ?? null,
    };

    return this.prisma.channelGlobalProfile.upsert({
      where: { channelId },
      create: { channelId, ...data },
      update: data,
    });
  }

  /**
   * PATCH — 보낸 필드만 업데이트. 미전송 필드는 그대로 유지.
   * null 을 명시적으로 보내면 해당 override 를 해제한다.
   */
  async patch(
    channelId: number,
    body: ChannelGlobalProfileUpsertRequestDto,
  ): Promise<ChannelGlobalProfile> {
    await this.assertChannelExists(channelId);

    const update: Record<string, unknown> = {};
    if (body.globalEnabled !== undefined) update.globalEnabled = body.globalEnabled;
    if (body.globalName !== undefined) update.globalName = body.globalName;
    if (body.globalDescription !== undefined) update.globalDescription = body.globalDescription;
    if (body.globalProfileImageUrl !== undefined) {
      update.globalProfileImageUrl = body.globalProfileImageUrl;
    }
    if (body.primaryLocale !== undefined) update.primaryLocale = body.primaryLocale;

    return this.prisma.channelGlobalProfile.upsert({
      where: { channelId },
      create: {
        channelId,
        globalEnabled: body.globalEnabled ?? true,
        globalName: body.globalName ?? null,
        globalDescription: body.globalDescription ?? null,
        globalProfileImageUrl: body.globalProfileImageUrl ?? null,
        primaryLocale: body.primaryLocale ?? null,
      },
      update,
    });
  }
}
