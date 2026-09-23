import { Prisma } from '@prisma/client';

export const channelCustomizationSelect = {
  id: true,
  channelId: true,
  customCss: true,
  isEnabled: true,
  customCssNew: true,
  isEnabledNew: true,
  layoutType: true,
  forcedColorMode: true,
  layoutWidth: true,
  headerStyle: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChannelCustomizationSelect;

export type ChannelCustomization = Prisma.ChannelCustomizationGetPayload<{
  select: typeof channelCustomizationSelect;
}>;
