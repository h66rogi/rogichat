"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { authKeys } from "@/meloming/domains/auth/hooks/use-auth";
import { queryClient } from "@/meloming/shared/providers/query-provider";

function resolveCookieDomain(hostname: string): string | null {
  if (hostname === "localhost" || hostname === "127.0.0.1") return null;
  if (hostname.endsWith("meloming.pri.sbalyd.com"))
    return ".meloming.pri.sbalyd.com";
  if (hostname.endsWith("meloming.com")) return ".meloming.com";
  return null;
}

function setAuthCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  hostname: string
) {
  const domain = resolveCookieDomain(hostname);
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:";
  const attributes = [
    `path=/`,
    `max-age=${maxAgeSeconds}`,
    `SameSite=Lax`,
    ...(domain ? [`domain=${domain}`] : []),
    ...(secure ? ["Secure"] : []),
  ].join("; ");

  document.cookie = `${name}=${value}; ${attributes}`;
}

/**
 * Handles auth token injection from mobile app URL parameters.
 * When the app passes authToken and refreshToken via URL, this component
 * sets them as cookies for API authentication.
 */
export function InAppAuthHandler() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const authToken = searchParams.get("authToken");
    const refreshToken = searchParams.get("refreshToken");
    const hostname =
      typeof window !== "undefined" ? window.location.hostname : undefined;

    if (!hostname) return;

    if (authToken) {
      setAuthCookie(
        "accessToken",
        authToken,
        60 * 60 * 24 * 7, // 7 days
        hostname
      );
      console.log("[InAppAuthHandler] accessToken cookie set");
    }

    if (refreshToken) {
      setAuthCookie(
        "refreshToken",
        refreshToken,
        60 * 60 * 24 * 30, // 30 days
        hostname
      );
      console.log("[InAppAuthHandler] refreshToken cookie set");
    }

    // Force auth state revalidation after cookies are injected
    if (authToken || refreshToken) {
      queryClient.invalidateQueries({ queryKey: authKeys.me() }).catch(() => {
        // ignore
      });
    }

    // Remove tokens from URL for cleaner display (optional)
    if (authToken || refreshToken) {
      const url = new URL(window.location.href);
      url.searchParams.delete("authToken");
      url.searchParams.delete("refreshToken");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);

  return null;
}
