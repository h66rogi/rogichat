export const CHANNEL_MUSICBOOK_SETTINGS_LAYOUT_TYPE = 'musicbook-settings';
export const CHANNEL_MUSICBOOK_SETTINGS_VERSION = 1;

export interface ChannelMusicbookSettings {
  useProficiencyAsPrimary: boolean;
  hasExplicitUseProficiencyAsPrimary: boolean;
}

export interface ChannelMusicbookSettingsStats {
  totalSongs: number;
  songsMissingProficiency: number;
}
