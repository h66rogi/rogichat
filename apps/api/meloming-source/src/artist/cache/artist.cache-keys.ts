export const artistCacheKeys = {
  byChannel: (channelId: number) => `artists_by_channel_${channelId}`,
  byWebPath: (webPath: string) =>
    `artists_by_webpath_${(webPath || '').toLowerCase()}`,
};
