import { ChannelColorMode } from '@prisma/client';

export const CHANNEL_COLOR_MODE_VALUES = ['system', 'light', 'dark'] as const;

export type ChannelColorModeValue = (typeof CHANNEL_COLOR_MODE_VALUES)[number];

export const DEFAULT_CHANNEL_COLOR_MODE: ChannelColorModeValue = 'light';

const TO_PRISMA_COLOR_MODE: Record<ChannelColorModeValue, ChannelColorMode> = {
  system: ChannelColorMode.SYSTEM,
  light: ChannelColorMode.LIGHT,
  dark: ChannelColorMode.DARK,
};

const FROM_PRISMA_COLOR_MODE: Record<ChannelColorMode, ChannelColorModeValue> =
  {
    [ChannelColorMode.SYSTEM]: 'system',
    [ChannelColorMode.LIGHT]: 'light',
    [ChannelColorMode.DARK]: 'dark',
  };

export const toPrismaChannelColorMode = (
  value: ChannelColorModeValue,
): ChannelColorMode => TO_PRISMA_COLOR_MODE[value];

export const toChannelColorModeValue = (
  value?: ChannelColorMode | null,
): ChannelColorModeValue =>
  value ? FROM_PRISMA_COLOR_MODE[value] : DEFAULT_CHANNEL_COLOR_MODE;
