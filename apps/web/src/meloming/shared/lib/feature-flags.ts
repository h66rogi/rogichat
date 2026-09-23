export const FeatureFlags = {
  smartSongAddition: { key: 'smart-song-addition', default: true },
  songbookSheetMusic: { key: 'songbook-sheet-music', default: true },
  channelCalendarV2: { key: 'channel-calendar-v2', default: true },
  setlistClipLink: { key: 'setlist-clip-link', default: true },
} as const

export type FeatureFlagName = keyof typeof FeatureFlags
