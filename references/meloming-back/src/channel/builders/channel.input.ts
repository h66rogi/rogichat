import { Prisma } from '@prisma/client';
import { CreateChannelDto, UpdateChannelDto } from '../dto/channel.request.dto';

export function buildChannelCreateInput(
  userId: number,
  dto: CreateChannelDto,
): Prisma.ChannelCreateInput {
  return {
    user: { connect: { id: userId } },
    name: dto.name,
    webPath: dto.webPath.toLowerCase(),
    platformUrl: dto.platformUrl || null,
    topBannerUrl: dto.topBannerUrl ?? null,
    leftBannerUrl: dto.leftBannerUrl ?? null,
    leftBannerLink: dto.leftBannerLink || null,
    rightBannerUrl: dto.rightBannerUrl ?? null,
    rightBannerLink: dto.rightBannerLink || null,
    profileImageUrl: dto.profileImageUrl ?? null,
    themeColor: dto.themeColor ?? '#ff6b35',
    channelDescription: dto.channelDescription ?? null,
    additionalLinks: (dto.additionalLinks ?? []) as unknown as Prisma.JsonValue,
  };
}

export function buildChannelUpdateInput(
  dto: UpdateChannelDto,
): Prisma.ChannelUpdateInput {
  const data: Prisma.ChannelUpdateInput = {};
  if (dto.name !== undefined) data.name = dto.name;
  if (dto.webPath !== undefined) data.webPath = dto.webPath.toLowerCase();
  if (dto.platformUrl !== undefined) data.platformUrl = dto.platformUrl ?? null;
  if (dto.topBannerUrl !== undefined)
    data.topBannerUrl = dto.topBannerUrl ?? null;
  if (dto.leftBannerUrl !== undefined)
    data.leftBannerUrl = dto.leftBannerUrl ?? null;
  if (dto.leftBannerLink !== undefined)
    data.leftBannerLink = dto.leftBannerLink || null;
  if (dto.rightBannerUrl !== undefined)
    data.rightBannerUrl = dto.rightBannerUrl ?? null;
  if (dto.rightBannerLink !== undefined)
    data.rightBannerLink = dto.rightBannerLink || null;
  if (dto.profileImageUrl !== undefined)
    data.profileImageUrl = dto.profileImageUrl ?? null;
  if (dto.additionalLinks !== undefined)
    data.additionalLinks = (dto.additionalLinks ??
      []) as unknown as Prisma.JsonValue;
  if (dto.themeColor !== undefined) data.themeColor = dto.themeColor;
  if (dto.channelDescription !== undefined)
    data.channelDescription = dto.channelDescription ?? null;
  if (dto.visibility !== undefined) data.visibility = dto.visibility;
  return data;
}
