import type { ChannelDescriptor, ChannelFeatureAvailability, ChannelFeatureKey } from './channel-descriptor';

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
  /** Path segment below the channel prefix. Empty string is the channel home. */
  segment: string;
  availability: ChannelFeatureAvailability;
  description: string;
}

export const CHANNEL_FEATURES: Record<ChannelFeatureKey, ChannelFeatureConfig> = {
  home: { key: 'home', label: '프로필', segment: '', availability: 'available', description: '후로기 채널 홈' },
  chat: { key: 'chat', label: '채팅', segment: 'chat', availability: 'available', description: '후로기의 채팅방' },
  rules: { key: 'rules', label: '규칙', segment: 'rules', availability: 'available', description: '채널 규칙과 채팅 이용 안내' },
  settings: { key: 'settings', label: '내 설정', segment: 'settings', availability: 'available', description: '내 프로필, 연결, 알림, 계정' },
  schedule: { key: 'schedule', label: '일정', segment: 'schedule', availability: 'available', description: '후로기의 방송 일정' },
  wardrobe: { key: 'wardrobe', label: '옷장', segment: 'wardrobe', availability: 'available', description: '후로기의 의상과 헤어' },
  songbook: { key: 'songbook', label: '노래책', segment: 'songbook', availability: 'available', description: '후로기의 노래책' },
};

/**
 * The only place that knows where the channel lives in the URL space. The MVP serves 후로기 at the
 * site root; a future channel prefix changes this constant and nothing else.
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
