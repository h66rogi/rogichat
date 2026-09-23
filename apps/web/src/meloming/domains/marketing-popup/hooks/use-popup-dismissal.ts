"use client";

import { useCallback, useMemo } from "react";
import type {
  MarketingPopup,
  MarketingPopupDismissType,
  MarketingPopupFrequency,
} from "../types/marketing-popup";
import { recordPopupImpression } from "../apis/marketing-popups";

const DISMISS_KEY_PREFIX = "MELOMING_POPUP_DISMISS_";
const SESSION_KEY_PREFIX = "MELOMING_POPUP_SESSION_";
const IMPRESSIONS_KEY_PREFIX = "MELOMING_POPUP_IMPRESSIONS_";

function getDismissKey(id: number) {
  return `${DISMISS_KEY_PREFIX}${id}`;
}
function getSessionKey(id: number) {
  return `${SESSION_KEY_PREFIX}${id}`;
}
function getImpressionsKey(id: number) {
  return `${IMPRESSIONS_KEY_PREFIX}${id}`;
}

function getTodayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isDismissed(popup: MarketingPopup): boolean {
  if (typeof window === "undefined") return false;

  // Check permanent/period dismiss (localStorage)
  const dismissValue = localStorage.getItem(getDismissKey(popup.id));
  if (dismissValue) {
    if (dismissValue === "forever") return true;

    // Date-based dismiss (TODAY or PERIOD)
    const dismissDate = new Date(dismissValue);
    if (!isNaN(dismissDate.getTime()) && new Date() < dismissDate) {
      return true;
    }

    // Expired dismiss, clean up
    localStorage.removeItem(getDismissKey(popup.id));
  }

  // Check session dismiss (sessionStorage)
  if (popup.frequency === "ONCE_PER_SESSION") {
    const sessionValue = sessionStorage.getItem(getSessionKey(popup.id));
    if (sessionValue === "1") return true;
  }

  // Check daily frequency
  if (popup.frequency === "ONCE_PER_DAY") {
    const impressionsData = localStorage.getItem(getImpressionsKey(popup.id));
    if (impressionsData) {
      try {
        const data = JSON.parse(impressionsData);
        if (data.date === getTodayString() && data.count > 0) return true;
      } catch {
        // ignore
      }
    }
  }

  // Check once ever
  if (popup.frequency === "ONCE_EVER") {
    const impressionsData = localStorage.getItem(getImpressionsKey(popup.id));
    if (impressionsData) {
      try {
        const data = JSON.parse(impressionsData);
        if (data.count > 0) return true;
      } catch {
        // ignore
      }
    }
  }

  // Check max impressions
  if (popup.maxImpressions) {
    const impressionsData = localStorage.getItem(getImpressionsKey(popup.id));
    if (impressionsData) {
      try {
        const data = JSON.parse(impressionsData);
        if (data.totalCount >= popup.maxImpressions) return true;
      } catch {
        // ignore
      }
    }
  }

  return false;
}

function recordImpression(popup: MarketingPopup): void {
  if (typeof window === "undefined") return;

  // Update session storage
  if (popup.frequency === "ONCE_PER_SESSION") {
    sessionStorage.setItem(getSessionKey(popup.id), "1");
  }

  // Update impression count
  const key = getImpressionsKey(popup.id);
  const today = getTodayString();
  let data = { date: today, count: 0, totalCount: 0 };

  try {
    const existing = localStorage.getItem(key);
    if (existing) {
      const parsed = JSON.parse(existing);
      data = {
        date: today,
        count: parsed.date === today ? (parsed.count || 0) : 0,
        totalCount: parsed.totalCount || 0,
      };
    }
  } catch {
    // ignore
  }

  data.count += 1;
  data.totalCount += 1;
  localStorage.setItem(key, JSON.stringify(data));

  // Record impression on server (fire-and-forget)
  recordPopupImpression(popup.id).catch(() => {});
}

function dismissPopup(
  popupId: number,
  dismissType: MarketingPopupDismissType,
  dismissPeriodDays?: number | null
): void {
  if (typeof window === "undefined") return;

  switch (dismissType) {
    case "FOREVER":
      localStorage.setItem(getDismissKey(popupId), "forever");
      break;
    case "TODAY": {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      localStorage.setItem(getDismissKey(popupId), tomorrow.toISOString());
      break;
    }
    case "PERIOD": {
      if (dismissPeriodDays) {
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + dismissPeriodDays);
        localStorage.setItem(getDismissKey(popupId), expiry.toISOString());
      }
      break;
    }
    case "CLOSE_ONLY":
    default:
      // No persistence for CLOSE_ONLY
      break;
  }
}

export function usePopupDismissal() {
  const filterDismissed = useCallback(
    (popups: MarketingPopup[]): MarketingPopup[] => {
      return popups.filter((popup) => !isDismissed(popup));
    },
    []
  );

  const handleDismiss = useCallback(
    (popup: MarketingPopup) => {
      dismissPopup(popup.id, popup.dismissType, popup.dismissPeriodDays);
    },
    []
  );

  const handleImpression = useCallback((popup: MarketingPopup) => {
    recordImpression(popup);
  }, []);

  return { filterDismissed, handleDismiss, handleImpression };
}
