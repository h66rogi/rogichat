import { Prisma } from '@prisma/client';

export const liveSessionBaseSelect = {
  id: true,
  channelId: true,
  userId: true,
  platform: true,
  platformChannelId: true,
  status: true,
  sessionType: true,
  syncRoomId: true,
  visibility: true,
  overlayToken: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LiveSessionSelect;

export const liveSessionWithSettingsSelect = {
  ...liveSessionBaseSelect,
  settings: {
    select: {
      id: true,
      requestEnabled: true,
      paused: true,
      requestCommand: true,
      maxQueueSize: true,
      donationPriorityEnabled: true,
      enforceDonationMinimumPrice: true,
      requireSongMatch: true,
      randomRequestEnabled: true,
      syncChatRequestsEnabled: true,
      syncRandomSongCommand: true,
      syncRandomSongMinDonation: true,
      syncRandomStreamerCommand: true,
      syncRandomStreamerMinDonation: true,
      preventDuplicateSongs: true,
      blockedCategoryIds: true,
      maxRequestsPerUser: true,
      maxTotalRequests: true,
      chatRequestEnabled: true,
      donationOnlyEnabled: true,
      donationRequestEnabled: true,
      requestMode: true,
      allowAnonymous: true,
      karaokePlaybackMode: true,
      karaokeVideoType: true,
      showRequesterName: true,
    },
  },
} satisfies Prisma.LiveSessionSelect;

export const liveSessionWithChannelSelect = {
  ...liveSessionWithSettingsSelect,
  channel: {
    select: {
      id: true,
      name: true,
      webPath: true,
      platformUrl: true,
    },
  },
} satisfies Prisma.LiveSessionSelect;

export type LiveSessionBase = Prisma.LiveSessionGetPayload<{
  select: typeof liveSessionBaseSelect;
}>;

export type LiveSessionWithSettings = Prisma.LiveSessionGetPayload<{
  select: typeof liveSessionWithSettingsSelect;
}>;

export type LiveSessionWithChannel = Prisma.LiveSessionGetPayload<{
  select: typeof liveSessionWithChannelSelect;
}>;
