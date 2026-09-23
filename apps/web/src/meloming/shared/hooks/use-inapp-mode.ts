"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

/**
 * Hook to detect if the app is running in an in-app webview (mobile app embedded mode)
 *
 * Detection methods:
 * 1. URL query parameter: ?inapp=true
 * 2. User-Agent containing "MelomingApp"
 */
export function useInAppMode(): boolean {
  const searchParams = useSearchParams();

  return useMemo(() => {
    // Check URL query parameter
    const inappParam = searchParams.get("inapp");
    if (inappParam === "true") {
      return true;
    }

    // Check User-Agent (client-side only)
    if (typeof window !== "undefined") {
      const userAgent = navigator.userAgent;
      if (
        userAgent.includes("MelomingApp") ||
        userAgent.includes("MelomingCommissionApp")
      ) {
        return true;
      }
    }

    return false;
  }, [searchParams]);
}
