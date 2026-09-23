"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { useMyChannel } from "@/meloming/domains/channel/hooks/use-my-channel";
import { useMarketingPopups } from "../hooks/use-marketing-popups";
import { usePopupDismissal } from "../hooks/use-popup-dismissal";
import { matchesTargetPath } from "../lib/popup-path-matcher";
import { MarketingPopupRenderer } from "./marketing-popup-renderer";
import type { MarketingPopup } from "../types/marketing-popup";

function matchesTargetAudience(
  popup: MarketingPopup,
  isAuthenticated: boolean,
  hasChannel?: boolean,
  isIdentityVerified?: boolean
) {
  switch (popup.targetAudience) {
    case "ALL":
      return true;
    case "LOGGED_IN":
      return isAuthenticated;
    case "LOGGED_OUT":
      return !isAuthenticated;
    case "CHANNEL_OWNER":
      if (typeof hasChannel === "boolean") return isAuthenticated && hasChannel;
      return isAuthenticated;
    case "NON_CHANNEL_OWNER":
      if (typeof hasChannel === "boolean") return !isAuthenticated || !hasChannel;
      return true;
    case "IDENTITY_VERIFIED":
      if (typeof isIdentityVerified === "boolean") {
        return isAuthenticated && isIdentityVerified;
      }
      return isAuthenticated;
    case "IDENTITY_UNVERIFIED":
      if (typeof isIdentityVerified === "boolean") {
        return !isAuthenticated || !isIdentityVerified;
      }
      return !isAuthenticated;
    default:
      return true;
  }
}

export function MarketingPopupProvider() {
  const pathname = usePathname();
  const { user, isLoading: isAuthLoading } = useAuth();
  const isAuthenticated = !!user;
  const { data: myChannels, isLoading: isChannelLoading } = useMyChannel({ enabled: isAuthenticated });
  const hasChannel =
    isAuthenticated && Array.isArray(myChannels) ? myChannels.length > 0 : undefined;
  const isIdentityVerified = user?.isIdentityVerified;

  const isTargetLoading = isAuthLoading || (isAuthenticated && isChannelLoading);

  const { data: popups } = useMarketingPopups(
    pathname,
    isAuthenticated,
    hasChannel,
    isIdentityVerified,
    { enabled: !isTargetLoading }
  );
  const { filterDismissed, handleDismiss, handleImpression } =
    usePopupDismissal();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [closedIds, setClosedIds] = useState<Set<number>>(new Set());
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filter: client-side path matching + dismissal check + group dedup
  const availablePopups = useMemo(() => {
    if (!popups || popups.length === 0) return [];

    // Filter by path (client-side double check)
    let filtered = popups.filter((p) =>
      matchesTargetPath(p.targetPages, pathname)
    );

    filtered = filtered.filter((p) =>
      matchesTargetAudience(p, isAuthenticated, hasChannel, isIdentityVerified)
    );

    // Filter dismissed
    filtered = filterDismissed(filtered);

    // Filter closed in this session
    filtered = filtered.filter((p) => !closedIds.has(p.id));

    // Sort by priority (lower = higher priority)
    filtered = [...filtered].sort((a, b) => a.priority - b.priority);

    // Group dedup: show only one popup per groupKey
    const seenGroups = new Set<string>();
    filtered = filtered.filter((p) => {
      if (!p.groupKey) return true;
      if (seenGroups.has(p.groupKey)) return false;
      seenGroups.add(p.groupKey);
      return true;
    });

    return filtered;
  }, [
    popups,
    pathname,
    filterDismissed,
    closedIds,
    isAuthenticated,
    hasChannel,
    isIdentityVerified,
  ]);

  const currentPopup: MarketingPopup | undefined =
    availablePopups[currentIndex];

  // Handle delay — also depends on pathname to re-evaluate on navigation
  useEffect(() => {
    // Clear any pending timer
    if (delayTimerRef.current) {
      clearTimeout(delayTimerRef.current);
      delayTimerRef.current = null;
    }

    if (!currentPopup) {
      setIsVisible(false);
      return;
    }

    if (currentPopup.delaySeconds > 0) {
      setIsVisible(false);
      delayTimerRef.current = setTimeout(() => {
        setIsVisible(true);
      }, currentPopup.delaySeconds * 1000);
    } else {
      setIsVisible(true);
    }

    return () => {
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current);
        delayTimerRef.current = null;
      }
    };
  }, [currentPopup, pathname]);

  // Record impression when popup becomes visible
  useEffect(() => {
    if (isVisible && currentPopup) {
      handleImpression(currentPopup);
    }
  }, [isVisible, currentPopup, handleImpression]);

  // Reset index when path changes (visibility is handled by the effect above)
  useEffect(() => {
    setCurrentIndex(0);
  }, [pathname]);

  const handleClose = useCallback(() => {
    if (!currentPopup) return;
    setClosedIds((prev) => new Set(prev).add(currentPopup.id));
    setIsVisible(false);
  }, [currentPopup]);

  const handleDismissPopup = useCallback(() => {
    if (!currentPopup) return;
    handleDismiss(currentPopup);
    setClosedIds((prev) => new Set(prev).add(currentPopup.id));
    setIsVisible(false);
  }, [currentPopup, handleDismiss]);

  // Track last popup for exit animation — keep Renderer mounted during exit
  const lastPopupRef = useRef<MarketingPopup | undefined>(undefined);
  if (currentPopup) {
    lastPopupRef.current = currentPopup;
  }

  const popupToRender = currentPopup ?? lastPopupRef.current;

  const handleExitComplete = useCallback(() => {
    lastPopupRef.current = undefined;
  }, []);

  if (!popupToRender) return null;

  return (
    <MarketingPopupRenderer
      popup={popupToRender}
      isVisible={isVisible && !!currentPopup}
      onClose={handleClose}
      onDismiss={handleDismissPopup}
      onExitComplete={handleExitComplete}
    />
  );
}
