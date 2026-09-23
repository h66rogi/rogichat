export const channelFavoriteListInclude = {
  channel: {
    select: {
      name: true,
      channelDescription: true,
      webPath: true,
      themeColor: true,
      profileImageUrl: true,
      user: {
        select: {
          nickname: true,
          isProSubscriber: true,
          proSubscriptionEndAt: true,
          isAmbassador: true,
        },
      },
      _count: { select: { songs: true, artists: true, userFavorites: true } },
    },
  },
} as const;

export const songFavoriteListInclude = {
  song: {
    include: {
      artist: { select: { name: true } },
      channel: { select: { name: true, webPath: true, profileImageUrl: true } },
    },
  },
} as const;
