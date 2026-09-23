"use client";

import { useQuery } from "@tanstack/react-query";
import { getActiveMarketingPopups } from "../apis/marketing-popups";

export const marketingPopupKeys = {
  all: ["marketing-popups"] as const,
  active: (
    isAuthenticated?: boolean,
    hasChannel?: boolean,
    isIdentityVerified?: boolean
  ) =>
    [
      ...marketingPopupKeys.all,
      "active",
      isAuthenticated,
      hasChannel,
      isIdentityVerified,
    ] as const,
};

export function useMarketingPopups(
  path?: string,
  isAuthenticated?: boolean,
  hasChannel?: boolean | undefined,
  isIdentityVerified?: boolean,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: marketingPopupKeys.active(
      isAuthenticated,
      hasChannel,
      isIdentityVerified
    ),
    queryFn: () =>
      getActiveMarketingPopups(
        undefined,
        isAuthenticated,
        hasChannel,
        isIdentityVerified
      ),
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}
