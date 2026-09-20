/**
 * Presentation-only view model for the settings screen.
 *
 * The harness decides what is possible and why. Every action carries an explicit
 * enabled/disabled state with a user-facing reason so the UI never guesses at
 * permissions, session state or browser capabilities.
 */

export type SettingsActionState = { enabled: true } | { enabled: false; reason: string };

export interface SettingsBirthday {
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
}

export interface SettingsProfileModel {
  nickname: string;
  avatarUrl: string | null;
  /** Optional; private by default. */
  birthday: SettingsBirthday | null;
  /** One global switch: when true, streamers of rooms the user joins can see the birthday. */
  birthdayVisibleToStreamers: boolean;
  edit: SettingsActionState;
}

export interface SettingsSoopModel {
  status: 'linked' | 'unlinked' | 'unknown';
  /** Display name of the linked account, when the harness chooses to show it. */
  linkedName?: string;
  link: SettingsActionState;
}

export interface SettingsNotificationsModel {
  support: 'supported' | 'unsupported' | 'install-required' | 'unknown';
  permission: 'granted' | 'denied' | 'not-asked' | 'unknown';
  enabled: boolean;
  toggle: SettingsActionState;
}

export interface SettingsRoomModel {
  roomName: string;
  membership: 'joined' | 'left' | 'unknown' | 'unavailable';
  isOwner: boolean;
  leave: SettingsActionState;
}

export interface SettingsSessionModel {
  logout: SettingsActionState;
  /** True while a logout was requested but the server has not confirmed it. */
  logoutPending?: boolean;
}

export interface SettingsAccountModel {
  deletion: SettingsActionState;
}

export interface SettingsViewModel {
  profile: SettingsProfileModel;
  soop: SettingsSoopModel;
  notifications: SettingsNotificationsModel;
  room: SettingsRoomModel;
  session: SettingsSessionModel;
  account: SettingsAccountModel;
}

export interface SettingsProfilePatch {
  nickname?: string;
  birthday?: SettingsBirthday | null;
  birthdayVisibleToStreamers?: boolean;
}
