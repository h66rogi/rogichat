export const CHANNEL_WARDROBE_MAX_CATEGORIES = 20;
export const CHANNEL_WARDROBE_MAX_ITEMS = 200;
export const CHANNEL_WARDROBE_LABEL_MAX_LENGTH = 40;
export const CHANNEL_WARDROBE_DESCRIPTION_MAX_LENGTH = 5000;
export const CHANNEL_WARDROBE_TAG_MAX_COUNT = 12;
export const CHANNEL_WARDROBE_TAG_MAX_LENGTH = 24;
export const CHANNEL_WARDROBE_ASPECT_RATIOS = [
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:4',
] as const;
export const DEFAULT_CHANNEL_WARDROBE_ASPECT_RATIO = '1:1';

export type ChannelWardrobeAspectRatio =
  (typeof CHANNEL_WARDROBE_ASPECT_RATIOS)[number];

export const DEFAULT_CHANNEL_WARDROBE_CATEGORIES = [
  {
    name: '의상',
    isEnabled: true,
    order: 0,
    defaultAspectRatio: DEFAULT_CHANNEL_WARDROBE_ASPECT_RATIO,
  },
  {
    name: '헤어',
    isEnabled: true,
    order: 1,
    defaultAspectRatio: DEFAULT_CHANNEL_WARDROBE_ASPECT_RATIO,
  },
] as const;
