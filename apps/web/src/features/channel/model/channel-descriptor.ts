/**
 * Public channel descriptor. This is the reviewed configuration for the only channel the site serves
 * (후로기). It carries public presentation data only: no room identifiers, no permissions, no session
 * facts. Default room binding and the viewer's capabilities come from the server bootstrap contract
 * (W01/W02) and are never derived from this file.
 */
export type ChannelFeatureKey = 'home' | 'chat' | 'rules' | 'schedule' | 'wardrobe' | 'songbook' | 'setlist' | 'settings';

export interface ChannelOfficialLink {
  label: string;
  href: string;
}

export interface ChannelDescriptor {
  /** Internal channel key. Never shown to users and never used as an API identifier. */
  key: string;
  displayName: string;
  /** Approved public introduction. `null` until confirmed content exists; the UI omits the section. */
  intro: string | null;
  /** Approved public links only. Empty until confirmed. */
  officialLinks: readonly ChannelOfficialLink[];
  /** Approved public artwork. `null` renders the neutral placeholder avatar. */
  avatarSrc: string | null;
  /** Features in menu order. */
  features: readonly ChannelFeatureKey[];
}

export const hurogiChannel: ChannelDescriptor = {
  key: 'hurogi',
  displayName: '후로기',
  intro: null,
  officialLinks: [],
  // SOOP's current h66rogi profile image, confirmed from the official station and VVAVE channel page.
  avatarSrc: '/images/hurogi-profile.png',
  features: ['home', 'chat', 'rules', 'schedule', 'wardrobe', 'songbook', 'setlist', 'settings'],
};

/** Resolves the channel that owns the site root. There is exactly one in the MVP. */
export function resolveDefaultChannel(): ChannelDescriptor {
  return hurogiChannel;
}
