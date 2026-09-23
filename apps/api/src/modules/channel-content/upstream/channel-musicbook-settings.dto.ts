// The response fields are copied from meloming-back
// src/channel/dto/channel-musicbook-settings.dto.ts. Transport validation lives
// at the Rogichat controller boundary rather than class-validator decorators.
export interface UpdateChannelMusicbookSettingsDto {
  useProficiencyAsPrimary: boolean;
}

export interface ChannelMusicbookSettingsResponseDto {
  useProficiencyAsPrimary: boolean;
  hasExplicitUseProficiencyAsPrimary: boolean;
  canEnableProficiencyAsPrimary: boolean;
  totalSongs: number;
  songsMissingProficiency: number;
}

export interface CopyDifficultyToProficiencyResponseDto extends ChannelMusicbookSettingsResponseDto {
  updatedCount: number;
}
