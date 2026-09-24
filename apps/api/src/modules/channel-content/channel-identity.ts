export const CHANNEL_WEB_PATH = 'h66rogi';
export const CHANNEL_PROFILE_IMAGE_URL = '/images/h66rogi-profile.png';

// Accept existing links and cached clients while publishing only the canonical identifier.
const LEGACY_CHANNEL_WEB_PATH = 'hurogi';
const LEGACY_CHANNEL_PROFILE_IMAGE_URL = '/images/hurogi-profile.png';

export function isChannelIdentifier(value: unknown, allowNumericId = false): boolean {
  return value === CHANNEL_WEB_PATH || value === LEGACY_CHANNEL_WEB_PATH ||
    (allowNumericId && value === '1');
}

export function isChannelProfileImageUrl(value: unknown): boolean {
  return value === CHANNEL_PROFILE_IMAGE_URL || value === LEGACY_CHANNEL_PROFILE_IMAGE_URL;
}

export function canonicalProfileImageUrl(value: string | null | undefined): string {
  return !value || value === LEGACY_CHANNEL_PROFILE_IMAGE_URL ? CHANNEL_PROFILE_IMAGE_URL : value;
}

export function profileImageUrlForStorage(value: string | null): string | null {
  return value === LEGACY_CHANNEL_PROFILE_IMAGE_URL ? CHANNEL_PROFILE_IMAGE_URL : value;
}
