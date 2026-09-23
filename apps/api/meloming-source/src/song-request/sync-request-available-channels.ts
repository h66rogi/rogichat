import { LiveSessionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type SyncRequestAvailableChannel = {
  channelId: number;
  channelName: string;
  webPath: string;
  profileImageUrl: string | null;
  themeColor: string | null;
};

type RequestWithGlobalSong = {
  liveSessionId?: number;
  song?: { globalSongId?: number | null } | null;
};

export type RequestWithAvailableChannels<T> = T & {
  availableChannels: SyncRequestAvailableChannel[];
};

export async function attachSyncRequestAvailableChannels<
  T extends RequestWithGlobalSong,
>(
  prisma: PrismaService,
  liveSessionId: number,
  requests: T[],
): Promise<Array<RequestWithAvailableChannels<T>>> {
  const withEmptyChannels = () =>
    requests.map((request) => ({
      ...request,
      availableChannels: [],
    }));

  if (requests.length === 0) {
    return [];
  }

  const globalSongIds = [
    ...new Set(
      requests
        .map((request) => request.song?.globalSongId ?? null)
        .filter((id): id is number => typeof id === 'number'),
    ),
  ];

  if (globalSongIds.length === 0) {
    return withEmptyChannels();
  }

  const session = await prisma.liveSession.findUnique({
    where: { id: liveSessionId },
    select: {
      sessionType: true,
      syncRoom: {
        select: {
          channels: {
            orderBy: { id: 'asc' },
            select: {
              channel: {
                select: {
                  id: true,
                  name: true,
                  webPath: true,
                  profileImageUrl: true,
                  themeColor: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (session?.sessionType !== LiveSessionType.SYNC || !session.syncRoom) {
    return withEmptyChannels();
  }

  const roomChannels = session.syncRoom.channels.map((entry) => entry.channel);
  const roomChannelIds = roomChannels.map((channel) => channel.id);
  if (roomChannelIds.length === 0) {
    return withEmptyChannels();
  }

  const songMatches = await prisma.song.findMany({
    where: {
      globalSongId: { in: globalSongIds },
      channelId: { in: roomChannelIds },
    },
    select: {
      globalSongId: true,
      channelId: true,
    },
  });

  const channelIdsByGlobalSongId = new Map<number, Set<number>>();
  for (const match of songMatches) {
    if (match.globalSongId == null) continue;
    const channelIds =
      channelIdsByGlobalSongId.get(match.globalSongId) ?? new Set<number>();
    channelIds.add(match.channelId);
    channelIdsByGlobalSongId.set(match.globalSongId, channelIds);
  }

  return requests.map((request) => {
    const globalSongId = request.song?.globalSongId ?? null;
    const availableChannelIds =
      typeof globalSongId === 'number'
        ? channelIdsByGlobalSongId.get(globalSongId)
        : undefined;

    return {
      ...request,
      availableChannels: availableChannelIds
        ? roomChannels
            .filter((channel) => availableChannelIds.has(channel.id))
            .map((channel) => ({
              channelId: channel.id,
              channelName: channel.name,
              webPath: channel.webPath,
              profileImageUrl: channel.profileImageUrl,
              themeColor: channel.themeColor,
            }))
        : [],
    };
  });
}
