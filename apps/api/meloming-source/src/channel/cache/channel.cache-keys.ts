export const channelCacheKeys = {
  // v2: 2026-05-12 verification fanout 버그 fix 동반 — 이전 cache 무력화 위해 prefix 변경.
  search: (normalizedKeyword: string, page: number, limit: number) =>
    `channel:search:v2:${normalizedKeyword}:${page}:${limit}`,
  byId: (channelId: number) => `channel:${channelId}`,
  byWebPath: (webPath: string) => `channel:webPath:${webPath.toLowerCase()}`,
  byUser: (userId: number) => `channel:user:${userId}`,
  publicStats: () => 'public:stats',
  popular: (key: {
    since?: string | null;
    wF: number;
    wL: number;
    wS: number;
    limit: number;
  }) =>
    `channel:popular:${key.since || 'all'}:${key.wF}-${key.wL}-${key.wS}:limit:${key.limit}`,
};
