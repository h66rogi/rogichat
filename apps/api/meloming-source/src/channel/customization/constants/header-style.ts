import { ChannelHeaderStyle } from '@prisma/client';

export const CHANNEL_HEADER_STYLE_VALUES = ['wide', 'separated'] as const;

export type ChannelHeaderStyleValue =
  (typeof CHANNEL_HEADER_STYLE_VALUES)[number];

export const DEFAULT_CHANNEL_HEADER_STYLE: ChannelHeaderStyleValue = 'wide';

const TO_PRISMA_HEADER_STYLE: Record<
  ChannelHeaderStyleValue,
  ChannelHeaderStyle
> = {
  wide: ChannelHeaderStyle.WIDE,
  separated: ChannelHeaderStyle.SEPARATED,
};

const FROM_PRISMA_HEADER_STYLE: Record<
  ChannelHeaderStyle,
  ChannelHeaderStyleValue
> = {
  [ChannelHeaderStyle.WIDE]: 'wide',
  [ChannelHeaderStyle.SEPARATED]: 'separated',
};

export const toPrismaChannelHeaderStyle = (
  value: ChannelHeaderStyleValue,
): ChannelHeaderStyle => TO_PRISMA_HEADER_STYLE[value];

export const toChannelHeaderStyleValue = (
  value?: ChannelHeaderStyle | null,
): ChannelHeaderStyleValue =>
  value ? FROM_PRISMA_HEADER_STYLE[value] : DEFAULT_CHANNEL_HEADER_STYLE;
