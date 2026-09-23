const embedDomains = [
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "vimeo.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "soundcloud.com",
  "spotify.com",
  "twitch.tv",
  "sooplive.co.kr",
  "sooplive.com",
  "chzzk.naver.com",
  "tv.naver.com"
] as const;

export const ALLOWED_EMBED_DOMAINS: readonly string[] = embedDomains;

export function isAllowedEmbedDomain(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'https:') return false;
    return ALLOWED_EMBED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}
