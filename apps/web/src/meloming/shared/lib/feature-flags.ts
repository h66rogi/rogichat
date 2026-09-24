export const FeatureFlags = {
  smartSongAddition: { key: 'smart-song-addition', default: true },
  songbookSheetMusic: { key: 'songbook-sheet-music', default: true },
  channelCalendarV2: { key: 'channel-calendar-v2', default: true },
  setlistClipLink: { key: 'setlist-clip-link', default: true },
  overlaySetlist: { key: 'overlay-setlist', default: true },
  overlayPlaybackV1: { key: 'overlay-playback-v1', default: false },
  musixmatchLyricsConsole: { key: 'musixmatch-lyrics-console', default: true },
  consolePitchShift: { key: 'console-pitch-shift', default: false },
} as const

export type FeatureFlagName = keyof typeof FeatureFlags
