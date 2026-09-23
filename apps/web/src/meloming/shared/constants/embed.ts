import embedDomains from "./embed-domains.json";

export const ALLOWED_EMBED_DOMAINS: readonly string[] = embedDomains;

export function isAllowedEmbedDomain(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== "https:") return false;
    return ALLOWED_EMBED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}
