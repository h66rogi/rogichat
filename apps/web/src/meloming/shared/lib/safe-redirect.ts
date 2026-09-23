export type RedirectTarget =
  | { kind: "internal"; path: string }
  | { kind: "external"; href: string };

const DEFAULT_ORIGIN = "https://meloming.com";
const DEFAULT_ALLOWED_HOSTS = ["meloming.com", "meloming.pri.sbalyd.com"];
const DEFAULT_ALLOWED_HOST_PATTERNS = [
  "*.meloming.com",
  "*.meloming.pri.sbalyd.com",
];
const DEFAULT_ALLOWED_PROTOCOLS = ["http", "https"];

function parseCsvEnv(
  value: string | undefined,
  fallback: readonly string[]
): string[] {
  if (!value) return [...fallback];
  const parsed = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : [...fallback];
}

function normalizeOrigin(currentOrigin: string): string {
  try {
    return new URL(currentOrigin).origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function toInternalPath(url: URL): string {
  const normalized = `${url.pathname}${url.search}${url.hash}`;
  return normalized.length > 0 ? normalized : "/";
}

function matchesHostPattern(hostname: string, pattern: string): boolean {
  if (!pattern.startsWith("*.")) {
    return hostname === pattern;
  }

  const suffix = pattern.slice(2);
  if (!suffix) return false;
  if (!hostname.endsWith(`.${suffix}`)) return false;

  const subdomain = hostname.slice(0, hostname.length - suffix.length - 1);
  return subdomain.length > 0;
}

function isAllowedExternalUrl(url: URL): boolean {
  const allowedProtocols = new Set(
    parseCsvEnv(
      process.env.NEXT_PUBLIC_ALLOWED_REDIRECT_PROTOCOLS,
      DEFAULT_ALLOWED_PROTOCOLS
    )
  );
  const protocol = url.protocol.replace(/:$/, "").toLowerCase();
  if (!allowedProtocols.has(protocol)) return false;

  const hostname = url.hostname.toLowerCase();
  const allowedHosts = new Set(
    parseCsvEnv(
      process.env.NEXT_PUBLIC_ALLOWED_REDIRECT_HOSTS,
      DEFAULT_ALLOWED_HOSTS
    )
  );
  if (allowedHosts.has(hostname)) return true;

  const allowedPatterns = parseCsvEnv(
    process.env.NEXT_PUBLIC_ALLOWED_REDIRECT_HOST_PATTERNS,
    DEFAULT_ALLOWED_HOST_PATTERNS
  );
  return allowedPatterns.some((pattern) => matchesHostPattern(hostname, pattern));
}

function tryResolveRedirectTarget(
  raw: string | null | undefined,
  currentOrigin: string
): RedirectTarget | null {
  if (raw == null) return null;

  const value = raw.trim();
  if (!value) return null;

  if (value.startsWith("//")) return null;
  if (value.startsWith("/")) {
    return { kind: "internal", path: value };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const normalizedOrigin = normalizeOrigin(currentOrigin);
  if (url.origin === normalizedOrigin) {
    return { kind: "internal", path: toInternalPath(url) };
  }

  if (!isAllowedExternalUrl(url)) return null;
  return { kind: "external", href: url.toString() };
}

export function resolveRedirectTarget(
  raw: string | null | undefined,
  currentOrigin: string
): RedirectTarget {
  return (
    tryResolveRedirectTarget(raw, currentOrigin) ?? {
      kind: "internal",
      path: "/",
    }
  );
}

export function serializeRedirectForStorage(
  raw: string | null | undefined,
  currentOrigin: string
): string | null {
  const target = tryResolveRedirectTarget(raw, currentOrigin);
  if (!target) return null;
  return target.kind === "internal" ? target.path : target.href;
}
