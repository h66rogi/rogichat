import { ChannelLayoutType } from '@prisma/client';

export const CHANNEL_LAYOUT_TYPE_VALUES = ['legacy', 'new'] as const;

export type ChannelLayoutTypeValue =
  (typeof CHANNEL_LAYOUT_TYPE_VALUES)[number];

/**
 * 별도 설정이 없는 채널의 기본 레이아웃.
 * 신규 레이아웃(메뉴 사이드바형)을 전체 채널 기본으로 한다.
 * 기존 커스텀 CSS를 켠 채널만 마이그레이션에서 'legacy'로 고정됨.
 */
export const DEFAULT_CHANNEL_LAYOUT_TYPE: ChannelLayoutTypeValue = 'new';

const TO_PRISMA_LAYOUT_TYPE: Record<
  ChannelLayoutTypeValue,
  ChannelLayoutType
> = {
  legacy: ChannelLayoutType.LEGACY,
  new: ChannelLayoutType.NEW,
};

const FROM_PRISMA_LAYOUT_TYPE: Record<
  ChannelLayoutType,
  ChannelLayoutTypeValue
> = {
  [ChannelLayoutType.LEGACY]: 'legacy',
  [ChannelLayoutType.NEW]: 'new',
};

export const toPrismaChannelLayoutType = (
  value: ChannelLayoutTypeValue,
): ChannelLayoutType => TO_PRISMA_LAYOUT_TYPE[value];

export const toChannelLayoutTypeValue = (
  value?: ChannelLayoutType | null,
): ChannelLayoutTypeValue =>
  value ? FROM_PRISMA_LAYOUT_TYPE[value] : DEFAULT_CHANNEL_LAYOUT_TYPE;
