import type { Prisma } from '../../../generated/prisma/client.js';

export const songRequestBaseSelect = {
  id: true,
  liveSessionId: true,
  songId: true,
  sourceChannelId: true,
  rawArtist: true,
  rawTitle: true,
  rawMessage: true,
  requesterPlatformId: true,
  requesterNickname: true,
  requestUserId: true,
  isAnonymous: true,
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
} satisfies Prisma.SongRequestSelect;

export const songRequestWithSongSelect = {
  ...songRequestBaseSelect,
  song: {
    select: {
      id: true,
      globalSongId: true,
      title: true,
      albumArt: true,
      karaokeUrl: true,
      coverUrl: true,
      originalUrl: true,
      lyricsLink: true,
      // lyricsText: 작가 비공개 메모 (manager-only). overlay/realtime payload 에
      // 노출되면 안 됨. 매니저용 단일 곡 endpoint 는 song-mappers 의 exposeLyrics
      // 옵션으로 별도 통제. song-request select 에서는 절대 포함 X.
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

export const songRequestHistorySelect = {
  id: true,
  rawArtist: true,
  rawTitle: true,
  rawMessage: true,
  status: true,
  source: true,
  isAnonymous: true,
  donationAmount: true,
  donationNativeAmount: true,
  donationCurrency: true,
  playedAt: true,
  completedAt: true,
  rejectionReason: true,
  createdAt: true,
  song: {
    select: {
      id: true,
      globalSongId: true,
      title: true,
      albumArt: true,
      artist: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  liveSession: {
    select: {
      id: true,
      platform: true,
      startedAt: true,
      endedAt: true,
      channel: {
        select: {
          name: true,
        },
      },
    },
  },
} satisfies Prisma.SongRequestSelect;

export type SongRequestBase = Prisma.SongRequestGetPayload<{
  select: typeof songRequestBaseSelect;
}>;

export type SongRequestWithSong = Prisma.SongRequestGetPayload<{
  select: typeof songRequestWithSongSelect;
}>;
