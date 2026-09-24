import type { LayoutType } from '../constants/layout-types';
import type { OverlayWidgetType } from '../hooks/use-widget-custom-css';

// Re-export layout types
export type { LayoutType } from '../constants/layout-types';

// Preset info from API
export interface OverlayPreset {
  id: number;
  name: string;
  layoutType: LayoutType;
  options: Record<string, unknown>;
  isDefault: boolean;
}

// Widget configuration from API
export interface OverlayWidgetConfig {
  widgetType: string;
  layoutType: LayoutType;
  presetId?: number | null;
  preset?: OverlayPreset | null;
  themeKey?: string | null; // legacy
}

// 위젯 표시 설정 (로컬 클라이언트용)
export interface OverlayWidgetSettings {
  widgets: {
    queue: { enabled: boolean; opacity: number };
    nowPlaying: { enabled: boolean; opacity: number };
  };
}

export interface SongRequest {
  id: number;
  rawArtist: string;
  rawTitle: string;
  requesterNickname: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'PLAYING' | 'COMPLETED';
  donationAmount?: number;
  isHomework?: boolean;
  /** 랜덤 신청 (백엔드가 노래책에서 1곡 자동 추출). */
  isRandom?: boolean;
  /** NORMAL | RANDOM — backend snapshot. isRandom 의 원천. */
  requestType?: 'NORMAL' | 'RANDOM';
  queueOrder: number;
  song?: { id: number; title: string; artist: { name: string }; albumArt?: string };
  // 가격 정보
  calculatedPrice?: number | null;
  priceSource?: 'SONG' | 'CATEGORY' | 'DIFFICULTY' | 'DEFAULT' | 'FREE' | null;
  formattedPrice?: string;
  availableChannels?: SyncRequestAvailableChannel[];
}

export interface SyncRequestAvailableChannel {
  channelId: number;
  channelName: string;
  webPath: string;
  profileImageUrl?: string | null;
  themeColor?: string | null;
}

export interface OverlayOmakase {
  enabled: boolean;
  displayName: string;
  count: number;
}

// 세션 설정 (백엔드 응답)
export interface SessionSettings {
  requestEnabled: boolean;
  paused: boolean;
  requestCommand: string;
  maxQueueSize: number;
  donationPriorityEnabled: boolean;
  karaokePlaybackMode?: 'DIRECT' | 'YOUTUBE';
  karaokeVideoType?: 'KARAOKE' | 'ORIGINAL';
  showRequesterName?: boolean;
}

export interface OverlayData {
  sessionId: number | null;
  channel: { id: number; name: string; webPath: string; profileImageUrl?: string | null; themeColor: string };
  settings: SessionSettings | null;
  queue: SongRequest[];
  setlist?: SongRequest[];  // 전체 세트리스트 (COMPLETED + PLAYING + PENDING + ACCEPTED)
  nowPlaying?: SongRequest | null;
  omakase?: OverlayOmakase | null;
  themes?: Record<string, string>; // deprecated: use widgetConfigs
  widgetConfigs?: OverlayWidgetConfig[];
  /**
   * Channel's unified theme id (Phase 1.4). When the channel hasn't migrated to
   * the new theme system, the backend resolves this via lazy-create — see
   * `DEFAULT_OVERLAY_THEME_ID` (currently "apple") on the backend.
   */
  themeId?: string;
  /**
   * Per-widget effective theme id (Phase 1.4). Keys are widget types
   * ('now-playing' | 'queue' | 'chatbox') and values are theme ids that may belong to
   * either the new theme registry or the legacy layout set.
   */
  resolvedThemes?: Record<string, string>;
  /**
   * Per-widget resolved options (catalog defaults + channel customizations
   * + widget overrides merged on the backend).
   */
  resolvedOptions?: Record<string, Record<string, unknown>>;
  /**
   * Per-widget user-authored custom CSS. Keys are hyphenated widget types
   * and values are the raw CSS string (or `null` when the channel has
   * disabled the override). Injected into the overlay document by the
   * `CustomCssInjector` component on each widget page.
   */
  widgetCustomCss?: Partial<Record<OverlayWidgetType, string | null>>;
  totalLayout?: Record<string, unknown>;
  totalLayoutVersion?: number | null;
  totalLayoutUpdatedAt?: string | null;
  startedAt: string | null;
  isLive: boolean;
}
