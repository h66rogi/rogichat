import { ChannelLayoutWidth } from '@prisma/client';

export const CHANNEL_LAYOUT_WIDTH_VALUES = ['default', 'wide'] as const;

export type ChannelLayoutWidthValue =
  (typeof CHANNEL_LAYOUT_WIDTH_VALUES)[number];

export const DEFAULT_CHANNEL_LAYOUT_WIDTH: ChannelLayoutWidthValue = 'default';

const TO_PRISMA_LAYOUT_WIDTH: Record<
  ChannelLayoutWidthValue,
  ChannelLayoutWidth
> = {
  default: ChannelLayoutWidth.DEFAULT,
  wide: ChannelLayoutWidth.WIDE,
};

const FROM_PRISMA_LAYOUT_WIDTH: Record<
  ChannelLayoutWidth,
  ChannelLayoutWidthValue
> = {
  [ChannelLayoutWidth.DEFAULT]: 'default',
  [ChannelLayoutWidth.WIDE]: 'wide',
};

export const toPrismaChannelLayoutWidth = (
  value: ChannelLayoutWidthValue,
): ChannelLayoutWidth => TO_PRISMA_LAYOUT_WIDTH[value];

export const toChannelLayoutWidthValue = (
  value?: ChannelLayoutWidth | null,
): ChannelLayoutWidthValue =>
  value ? FROM_PRISMA_LAYOUT_WIDTH[value] : DEFAULT_CHANNEL_LAYOUT_WIDTH;
