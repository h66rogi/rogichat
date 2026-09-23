import type { ChannelDescriptor, ChannelFeatureKey } from './channel-descriptor';

/**
 * Feature (menu) definitions and path generation.
 *
 * Adapted from meloming-front f8907f37e73d0b760eac3c5af2beb48714331c83
 * `src/domains/channel/types/channel-tab.ts` (TabConfig / TAB_CONFIG / getPathFromTab / getTabFromPath).
 * Rogichat changes: paths are generated from the site root through a single prefix, the feature set is the
 * MVP menu only, and the per-channel feature-settings normalisation is dropped.
 */
export interface ChannelFeatureConfig {
  key: ChannelFeatureKey;
  label: string;
  /** Route below the channel prefix. Empty string is the channel home. */
  segment: string;
  description: string;
}

export const CHANNEL_FEATURES: Record<ChannelFeatureKey, ChannelFeatureConfig> = {
  home: { key: 'home', label: '프로필', segment: '', description: '후로기 채널 홈' },
  chat: { key: 'chat', label: '채팅', segment: 'chat', description: '후로기의 채팅방' },
  rules: { key: 'rules', label: '규칙·이용 안내', segment: 'rules', description: '채팅 이용 안내와 개인답장 공개 범위' },
  settings: { key: 'settings', label: '내 설정', segment: 'settings', description: '내 프로필, 연결, 알림, 계정' },
  schedule: { key: 'schedule', label: '일정', segment: 'channel/hurogi/schedule', description: '후로기의 방송 일정과 기념일' },
  wardrobe: { key: 'wardrobe', label: '옷장', segment: 'channel/hurogi/wardrobe', description: '후로기의 의상과 헤어' },
  songbook: { key: 'songbook', label: '노래책', segment: 'channel/hurogi/musicbook', description: '후로기의 노래책' },
};

/**
 * The channel home, chat, and rules live at the site root. The copied Meloming
 * content routes retain their original /channel/hurogi paths.
 */
const CHANNEL_PATH_PREFIX: string = '';

export function channelHref(feature: ChannelFeatureKey): string {
  const segment = CHANNEL_FEATURES[feature].segment;
  return segment ? `${CHANNEL_PATH_PREFIX}/${segment}` : `${CHANNEL_PATH_PREFIX}/`;
}

/** Maps a pathname to the feature it belongs to, or `null` when the path is outside the channel. */
export function featureFromPath(pathname: string): ChannelFeatureKey | null {
  const relative = CHANNEL_PATH_PREFIX.length > 0 && pathname.startsWith(CHANNEL_PATH_PREFIX)
    ? pathname.slice(CHANNEL_PATH_PREFIX.length)
    : pathname;
  const [first] = relative.split('/').filter(Boolean);
  if (first === undefined) return 'home';
  const match = (Object.values(CHANNEL_FEATURES) as ChannelFeatureConfig[]).find((feature) => feature.segment === first);
  return match?.key ?? null;
}

export function menuItemsFor(channel: ChannelDescriptor): ChannelFeatureConfig[] {
  return channel.features.map((key) => CHANNEL_FEATURES[key]);
}
