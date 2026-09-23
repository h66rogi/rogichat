export const categoryCacheKeys = {
  byChannel: (channelId: number) => `categories_by_channel_${channelId}`,
  byWebPath: (webPath: string) =>
    `categories_by_webpath_${(webPath || '').toLowerCase()}`,
};
