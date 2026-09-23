import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelProfileUpsertRequestDto } from './dto/channel-profile.dto';

@Injectable()
export class ChannelProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureChannelExists(channelId: number) {
    const ch = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });
    if (!ch) throw new NotFoundException('Channel not found');
  }

  async getPublic(channelId: number) {
    await this.ensureChannelExists(channelId);
    const prof = await this.prisma.channelProfile.findUnique({
      where: { channelId },
    });
    return prof;
  }

  private normalize(dto: ChannelProfileUpsertRequestDto) {
    const copy: any = { ...dto };
    if (copy.symbolColor && !copy.symbolColor.startsWith('#'))
      copy.symbolColor = `#${copy.symbolColor}`;
    // normalize date fields: convert ISO string to Date, drop invalids
    const toDate = (v?: string) => {
      if (!v || typeof v !== 'string') return undefined;
      const t = Date.parse(v);
      return Number.isNaN(t) ? undefined : new Date(t);
    };
    if (typeof copy.birthday === 'string') {
      const d = toDate(copy.birthday);
      if (d) copy.birthday = d;
      else delete copy.birthday;
    }
    if (typeof copy.debutDate === 'string') {
      const d = toDate(copy.debutDate);
      if (d) copy.debutDate = d;
      else delete copy.debutDate;
    }
    return copy;
  }

  async put(channelId: number, dto: ChannelProfileUpsertRequestDto) {
    await this.ensureChannelExists(channelId);
    const data = this.normalize(dto);
    return this.prisma.channelProfile.upsert({
      where: { channelId },
      update: data,
      create: { channelId, ...data },
    });
  }

  async patch(channelId: number, dto: ChannelProfileUpsertRequestDto) {
    await this.ensureChannelExists(channelId);
    const data = this.normalize(dto);
    return this.prisma.channelProfile.upsert({
      where: { channelId },
      update: data,
      create: { channelId, ...data },
    });
  }
}
