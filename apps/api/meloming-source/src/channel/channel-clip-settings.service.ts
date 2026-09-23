import { Injectable } from '@nestjs/common';
import type { ChannelClipSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChannelClipSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getByChannelId(
    channelId: number,
  ): Promise<ChannelClipSettings | null> {
    return this.prisma.channelClipSettings.findUnique({
      where: { channelId },
    });
  }

  async upsert(
    channelId: number,
    autoClipEnabled: boolean,
  ): Promise<ChannelClipSettings> {
    return this.prisma.channelClipSettings.upsert({
      where: { channelId },
      update: { autoClipEnabled },
      create: { channelId, autoClipEnabled },
    });
  }
}
