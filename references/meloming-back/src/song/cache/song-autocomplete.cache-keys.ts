const scopeKey = (channelId?: number) =>
  typeof channelId === 'number' ? channelId : 'global';

export const songAutocompleteCacheKeys = {
  popular: (channelId?: number) =>
    `song_autocomplete:popular:${scopeKey(channelId)}`,
  query: (channelId: number | undefined, queryKey: string) =>
    `song_autocomplete:query:${scopeKey(channelId)}:${queryKey}`,
  queryPattern: (channelId?: number) =>
    `song_autocomplete:query:${scopeKey(channelId)}:*`,
  artist: (channelId: number | undefined, titleKey: string) =>
    `song_autocomplete:artists:${scopeKey(channelId)}:${titleKey}`,
  artistPattern: (channelId?: number) =>
    `song_autocomplete:artists:${scopeKey(channelId)}:*`,
};
