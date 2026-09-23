import type {
  ChannelSongRequestSettings,
  LiveSessionSettings,
} from '@prisma/client';
import {
  KaraokePlaybackMode,
  KaraokeVideoType,
  SongRequestMode,
} from '@prisma/client';

/**
 * 신청곡 설정의 effective view.
 *
 * 2026-05-14 P0 재설계 결과 settings 의 single source of truth 는 두 군데로 분리:
 *  - 라이브 한정 일시 상태 (requestEnabled / paused) -> LiveSessionSettings
 *  - 채널 영구 설정 (requestCommand / 토글 / 한도 / blockedCategoryIds 등) -> ChannelSongRequestSettings
 *
 * 호출자(queue.service / dispatcher / overlay events / front 응답)는 두 모델을 합친
 * 단일 객체를 사용하므로 본 타입과 merge helper 를 거쳐 일관된 view 를 노출한다.
 *
 * LiveSessionSettings 의 채널-scope 컬럼은 backfill 후 cleanup 단계까지 잔류하지만
 * 본 view 는 *항상* ChannelSongRequestSettings 를 source of truth 로 사용한다.
 */
export type EffectiveSongRequestSettings = {
  // LiveSession 한정 일시 상태
  requestEnabled: boolean;
  paused: boolean;
  // 채널 영구 설정
  requestCommand: string;
  maxQueueSize: number;
  donationPriorityEnabled: boolean;
  enforceDonationMinimumPrice: boolean;
  karaokePlaybackMode: KaraokePlaybackMode;
  karaokeVideoType: KaraokeVideoType;
  donationOnlyEnabled: boolean;
  requestMode: SongRequestMode;
  chatRequestEnabled: boolean;
  donationRequestEnabled: boolean;
  allowAnonymous: boolean;
  requireSongMatch: boolean;
  randomRequestEnabled: boolean;
  syncChatRequestsEnabled: boolean;
  syncRandomSongCommand: string;
  syncRandomSongMinDonation: number;
  syncRandomStreamerCommand: string;
  syncRandomStreamerMinDonation: number;
  preventDuplicateSongs: boolean;
  blockedCategoryIds: number[];
  maxRequestsPerUser: number;
  maxTotalRequests: number;
  showRequesterName: boolean;
};

export type LiveSessionScopedSettings = Partial<Pick<
  LiveSessionSettings,
  | 'requestEnabled'
  | 'paused'
  | 'syncChatRequestsEnabled'
  | 'syncRandomSongCommand'
  | 'syncRandomSongMinDonation'
  | 'syncRandomStreamerCommand'
  | 'syncRandomStreamerMinDonation'
>>;

function normalizeBlockedCategoryIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is number => typeof v === 'number');
}

export function mergeEffectiveSongRequestSettings(
  liveSettings: LiveSessionScopedSettings | null | undefined,
  channelSettings: ChannelSongRequestSettings,
): EffectiveSongRequestSettings {
  return {
    requestEnabled: liveSettings?.requestEnabled ?? true,
    paused: liveSettings?.paused ?? false,
    requestCommand: channelSettings.requestCommand,
    maxQueueSize: channelSettings.maxQueueSize,
    donationPriorityEnabled: channelSettings.donationPriorityEnabled,
    enforceDonationMinimumPrice: channelSettings.enforceDonationMinimumPrice,
    karaokePlaybackMode: channelSettings.karaokePlaybackMode,
    karaokeVideoType: channelSettings.karaokeVideoType,
    donationOnlyEnabled: channelSettings.donationOnlyEnabled,
    requestMode: channelSettings.requestMode,
    chatRequestEnabled: channelSettings.chatRequestEnabled,
    donationRequestEnabled: channelSettings.donationRequestEnabled,
    allowAnonymous: channelSettings.allowAnonymous,
    requireSongMatch: channelSettings.requireSongMatch,
    randomRequestEnabled: channelSettings.randomRequestEnabled,
    syncChatRequestsEnabled: liveSettings?.syncChatRequestsEnabled ?? true,
    syncRandomSongCommand:
      liveSettings?.syncRandomSongCommand ?? '!노래랜덤',
    syncRandomSongMinDonation:
      liveSettings?.syncRandomSongMinDonation ?? 100,
    syncRandomStreamerCommand:
      liveSettings?.syncRandomStreamerCommand ?? '!스트리머랜덤',
    syncRandomStreamerMinDonation:
      liveSettings?.syncRandomStreamerMinDonation ?? 100,
    preventDuplicateSongs: channelSettings.preventDuplicateSongs,
    blockedCategoryIds: normalizeBlockedCategoryIds(
      channelSettings.blockedCategoryIds,
    ),
    maxRequestsPerUser: channelSettings.maxRequestsPerUser,
    maxTotalRequests: channelSettings.maxTotalRequests,
    showRequesterName: channelSettings.showRequesterName,
  };
}
