const CORS_MEDIA_HOSTS = new Set(['media-cache.meloming.com']);
const GATEWAY_HOST_PATTERN = /^media-gateway-cdn(?:-[a-z0-9-]+)?\.meloming\.com$/;

/**
 * Media hosts whose final response guarantees CORS + Range for Web Audio.
 * Keep this allowlist narrow: createMediaElementSource() cannot use a tainted
 * media element, even when ordinary video playback itself succeeds.
 */
export function isCorsMediaPlaybackUrl(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (CORS_MEDIA_HOSTS.has(url.hostname) ||
        GATEWAY_HOST_PATTERN.test(url.hostname))
    );
  } catch {
    return false;
  }
}
