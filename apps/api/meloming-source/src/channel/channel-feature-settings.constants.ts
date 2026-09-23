export const CHANNEL_FEATURE_LAYOUT_TYPE = 'channel-features';

export const CHANNEL_FEATURE_KEYS = [
  'home',
  'board',
  'musicbook',
  'schedule',
  'gift',
  'upbo',
  'clip',
  'ranking',
  'content',
  'setlist',
  'voice',
  'homework-song',
  'guestbook',
  'info',
  'wardrobe',
] as const;

export type ChannelFeatureKey = (typeof CHANNEL_FEATURE_KEYS)[number];

export interface ChannelFeatureSetting {
  key: ChannelFeatureKey;
  label: string;
  defaultLabel: string;
  isEnabled: boolean;
  order: number;
}

export const CHANNEL_CUSTOM_MENU_ITEM_TYPES = ['page', 'board'] as const;

export type ChannelCustomMenuItemType =
  (typeof CHANNEL_CUSTOM_MENU_ITEM_TYPES)[number];

export type ChannelCustomMenuIconName = string;

export interface ChannelCustomMenuItem {
  id: string;
  type: ChannelCustomMenuItemType;
  path: string;
  label: string;
  defaultLabel: string;
  iconName?: ChannelCustomMenuIconName;
  isEnabled: boolean;
  order: number;
  contentHtml?: string;
  commentsEnabled?: boolean;
  boardId?: number;
  boardName?: string | null;
}

export const DEFAULT_CHANNEL_CUSTOM_MENU_ITEMS: ChannelCustomMenuItem[] = [
  {
    id: 'rules',
    type: 'page',
    path: 'rules',
    label: '방송규칙',
    defaultLabel: '방송규칙',
    iconName: 'ShieldCheck',
    isEnabled: true,
    order: 5,
    contentHtml:
      '<h2>방송규칙</h2><p>아직 방송규칙이 작성되지 않았습니다.</p>',
    commentsEnabled: false,
  },
];

export const DEFAULT_CHANNEL_FEATURE_SETTINGS: ChannelFeatureSetting[] = [
  { key: 'home', label: '홈', defaultLabel: '홈', isEnabled: true, order: 0 },
  {
    key: 'board',
    label: '게시판',
    defaultLabel: '게시판',
    isEnabled: true,
    order: 1,
  },
  {
    key: 'musicbook',
    label: '노래책',
    defaultLabel: '노래책',
    isEnabled: true,
    order: 2,
  },
  {
    key: 'schedule',
    label: '캘린더',
    defaultLabel: '캘린더',
    isEnabled: true,
    order: 3,
  },
  {
    key: 'gift',
    label: '선물하기',
    defaultLabel: '선물하기',
    isEnabled: true,
    order: 4,
  },
  {
    key: 'upbo',
    label: '룰렛 업보',
    defaultLabel: '룰렛 업보',
    isEnabled: true,
    order: 7,
  },
  {
    key: 'clip',
    label: '노래클립',
    defaultLabel: '노래클립',
    isEnabled: true,
    order: 6,
  },
  {
    key: 'ranking',
    label: '랭킹',
    defaultLabel: '랭킹',
    isEnabled: true,
    order: 8,
  },
  {
    key: 'content',
    label: '콘텐츠',
    defaultLabel: '콘텐츠',
    isEnabled: true,
    order: 9,
  },
  {
    key: 'setlist',
    label: '셋리스트',
    defaultLabel: '셋리스트',
    isEnabled: true,
    order: 10,
  },
  {
    key: 'voice',
    label: '보이스커미션',
    defaultLabel: '보이스커미션',
    isEnabled: true,
    order: 11,
  },
  {
    key: 'homework-song',
    label: '숙제곡',
    defaultLabel: '숙제곡',
    isEnabled: true,
    order: 12,
  },
  {
    key: 'guestbook',
    label: '방명록',
    defaultLabel: '방명록',
    isEnabled: true,
    order: 13,
  },
  {
    key: 'info',
    label: '정보',
    defaultLabel: '정보',
    isEnabled: true,
    order: 14,
  },
  {
    key: 'wardrobe',
    label: '옷장',
    defaultLabel: '옷장',
    isEnabled: true,
    order: 15,
  },
];

export function isChannelFeatureKey(
  value: unknown,
): value is ChannelFeatureKey {
  return (
    typeof value === 'string' &&
    CHANNEL_FEATURE_KEYS.includes(value as ChannelFeatureKey)
  );
}
