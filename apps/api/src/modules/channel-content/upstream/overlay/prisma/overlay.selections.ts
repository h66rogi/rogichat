import type { Prisma } from '../../../../../generated/prisma/client.js';

export const overlaySessionSelect = {
  id: true,
  channelId: true,
  userId: true,
  platform: true,
  platformChannelId: true,
  status: true,
  sessionType: true,
  overlayToken: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  updatedAt: true,
  // GATE 0: 오버레이 스냅샷의 단조 증가 revision source. (sessionEpoch = id, revision)
  playbackRevision: true,
  settings: {
    select: {
      id: true,
      requestEnabled: true,
      paused: true,
      requestCommand: true,
      maxQueueSize: true,
      donationPriorityEnabled: true,
      karaokePlaybackMode: true,
      karaokeVideoType: true,
      showRequesterName: true,
      chatRequestEnabled: true,
      donationRequestEnabled: true,
      donationOnlyEnabled: true,
      randomRequestEnabled: true,
      syncChatRequestsEnabled: true,
      syncRandomSongCommand: true,
      syncRandomSongMinDonation: true,
      syncRandomStreamerCommand: true,
      syncRandomStreamerMinDonation: true,
    },
  },
} satisfies Prisma.LiveSessionSelect;

export const overlaySongRequestSelect = {
  id: true,
  liveSessionId: true,
  songId: true,
  sourceChannelId: true,
  rawArtist: true,
  rawTitle: true,
  rawMessage: true,
  requesterPlatformId: true,
  requesterNickname: true,
  status: true,
  source: true,
  requestType: true,
  donationAmount: true,
  donationNativeAmount: true,
  donationCurrency: true,
  priority: true,
  queueOrder: true,
  calculatedPrice: true,
  priceSource: true,
  playedAt: true,
  completedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  song: {
    select: {
      id: true,
      title: true,
      albumArt: true,
      karaokeUrl: true,
      coverUrl: true,
      originalUrl: true,
      mrVideoUrl: true,
      lyricsLink: true,
      // lyricsText: 작가 비공개 메모이므로 overlay public 응답에서 제외 (보안 정책).
      // Musixmatch 가사는 별도 /v1/overlay-api/songs/:id/lyrics 로 fetch.
      description: true,
      difficulty: true,
      proficiency: true,
      songKey: true,
      bpm: true,
      preferredPitchSemitones: true,
      preferredLyricsOffsetMs: true,
      artist: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.SongRequestSelect;

export type OverlaySession = Prisma.LiveSessionGetPayload<{
  select: typeof overlaySessionSelect;
}>;

export type OverlaySongRequest = Prisma.SongRequestGetPayload<{
  select: typeof overlaySongRequestSelect;
}>;
