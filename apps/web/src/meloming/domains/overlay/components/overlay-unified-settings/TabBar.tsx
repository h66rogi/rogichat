"use client";

import { useFeatureFlag } from "@/meloming/shared/hooks/use-feature-flag";
import { cn } from "@/meloming/shared/lib/utils";
import {
  OVERLAY_TAB_IDS,
  OVERLAY_TAB_LABELS,
  isPrimaryTab,
  type OverlayTabId,
} from "./tabs";

interface TabBarProps {
  activeTab: OverlayTabId;
  onChange: (tab: OverlayTabId) => void;
}

export function TabBar({ activeTab, onChange }: TabBarProps) {
  const overlaySetlistEnabled = useFeatureFlag("overlaySetlist");

  const visibleTabs = OVERLAY_TAB_IDS.filter((tab) => {
    if (tab === "setlist" && !overlaySetlistEnabled) return false;
    return true;
  });

  // Find the index where the per-widget tabs begin (the divider goes BEFORE
  // that index). If every tab is primary or every tab is per-widget, we
  // skip the divider entirely.
  const firstNonPrimaryIndex = visibleTabs.findIndex((tab) => !isPrimaryTab(tab));
  const showDivider =
    firstNonPrimaryIndex > 0 && firstNonPrimaryIndex < visibleTabs.length;

  return (
    <nav
      role="tablist"
      aria-label="오버레이 설정 탭"
      className="flex flex-wrap items-center gap-2"
    >
      {visibleTabs.map((tab, idx) => {
        const isActive = activeTab === tab;
        return (
          <div key={tab} className="contents">
            {showDivider && idx === firstNonPrimaryIndex && (
              <span
                aria-hidden="true"
                className="mx-1 hidden h-6 w-px bg-border sm:inline-block"
              />
            )}
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab)}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-indigo-600 text-white dark:bg-indigo-500"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {OVERLAY_TAB_LABELS[tab]}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
