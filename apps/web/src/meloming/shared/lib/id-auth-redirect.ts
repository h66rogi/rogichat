import { resolveRedirectTarget } from "./safe-redirect";

export type AuthSearchParams = Record<
  string,
  string | string[] | undefined
>;

const RETURN_PARAM_KEYS = [
  "from",
  "returnTo",
  "redirect",
  "to",
  "next",
] as const;

function getPortalOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (configured) return new URL(configured).origin;
  if (typeof window !== "undefined") return window.location.origin;
  return "https://meloming.com";
}

function getIdentityOrigin(portalOrigin: string): string {
  const host = new URL(portalOrigin).hostname;
  const isQa =
    host.endsWith(".meloming.pri.sbalyd.com") ||
    host.endsWith(".pri.sbalyd.com") ||
    host.endsWith(".meloming.int.sbalyd.com") ||
    host.endsWith(".int.sbalyd.com");
  return isQa
    ? "https://id.meloming.pri.sbalyd.com"
    : "https://id.meloming.com";
}

function appendSearchParam(
  target: URLSearchParams,
  key: string,
  value: string | string[]
) {
  if (Array.isArray(value)) {
    value.forEach((item) => target.append(key, item));
    return;
  }
  target.append(key, value);
}

function getFirstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function buildIdAuthRedirectUrl(
  authPath: string,
  searchParams: AuthSearchParams
): string {
  const portalOrigin = getPortalOrigin();
  const targetUrl = new URL(authPath, getIdentityOrigin(portalOrigin));

  let rawReturnTo: string | null = null;
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    if (RETURN_PARAM_KEYS.includes(key as (typeof RETURN_PARAM_KEYS)[number])) {
      if (rawReturnTo === null) rawReturnTo = getFirstValue(value);
      continue;
    }
    appendSearchParam(targetUrl.searchParams, key, value);
  }

  const returnTarget = resolveRedirectTarget(rawReturnTo, portalOrigin);
  const absoluteReturnTo =
    returnTarget.kind === "internal"
      ? new URL(returnTarget.path, portalOrigin).toString()
      : returnTarget.href;

  targetUrl.searchParams.set("from", absoluteReturnTo);
  if (!targetUrl.searchParams.has("service")) {
    targetUrl.searchParams.set("service", "meloming");
  }

  return targetUrl.toString();
}
