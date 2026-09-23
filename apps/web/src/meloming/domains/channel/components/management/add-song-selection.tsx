"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Plus, FileText, Table2Icon, Sparkles } from "lucide-react";
import { ManagementHeader } from "./management-header";
import { Badge } from "@/meloming/shared/components/ui/badge";
import {
  PillTabs,
  type PillTabItem,
} from "@/meloming/shared/components/ui/pill-tabs";
import { AddSongManualContent } from "./add-song-manual-content";
import { AddSongExcelContent } from "./add-song-excel-content";
import { AddSongQuickContent } from "./add-song-quick-content";
import { useFeatureFlag } from "@/meloming/shared/hooks/use-feature-flag";
import { useEffect, useMemo } from "react";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";

type AddSongTab = "manual" | "excel" | "quick";

export function AddSongSelection() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = params?.user as string | undefined;

  const smartAddEnabled = useFeatureFlag("smartSongAddition");

  const tabs = useMemo<PillTabItem<AddSongTab>[]>(
    () => [
      { id: "manual", label: "직접 입력하기", icon: FileText },
      { id: "excel", label: "엑셀로 일괄 등록하기", icon: Table2Icon },
      ...(smartAddEnabled
        ? [
            {
              id: "quick" as const,
              label: "간편 추가",
              icon: Sparkles,
            },
          ]
        : []),
    ],
    [smartAddEnabled],
  );

  const tabParam = searchParams.get("tab");
  const validTabs = useMemo(() => tabs.map((t) => t.id), [tabs]);
  const validTabKey = validTabs.join(",");
  const requestedKnownTab = validTabs.includes(tabParam as AddSongTab);
  const activeTab: AddSongTab = validTabs.includes(tabParam as AddSongTab)
    ? (tabParam as AddSongTab)
    : "manual";

  // URL에 tab이 없거나 무효하면 manual로 리다이렉트
  useEffect(() => {
    if (!tabParam || !requestedKnownTab) {
      captureIntentEvent("channel_songbook_add_song_tab_redirected", {
        requested_tab: tabParam ?? "missing",
        fallback_tab: "manual",
        smart_add_enabled: smartAddEnabled,
        quick_tab_available: validTabs.includes("quick"),
        has_channel_identifier: Boolean(user),
      });
      router.replace(`/channel/${user}/manage/add-song?tab=manual`);
    }
  }, [
    requestedKnownTab,
    smartAddEnabled,
    tabParam,
    user,
    router,
    validTabs,
  ]);

  useEffect(() => {
    captureIntentEvent("channel_songbook_add_song_page_viewed", {
      active_tab: activeTab,
      requested_tab: tabParam ?? "missing",
      requested_known_tab: requestedKnownTab,
      smart_add_enabled: smartAddEnabled,
      quick_tab_available: validTabs.includes("quick"),
      visible_tab_count: validTabs.length,
      visible_tabs: validTabs,
      has_channel_identifier: Boolean(user),
    });
  }, [
    activeTab,
    requestedKnownTab,
    smartAddEnabled,
    tabParam,
    user,
    validTabKey,
    validTabs,
  ]);

  const handleTabChange = (tab: AddSongTab) => {
    captureIntentEvent("channel_songbook_add_song_tab_clicked", {
      from_tab: activeTab,
      to_tab: tab,
      same_tab: activeTab === tab,
      smart_add_enabled: smartAddEnabled,
      quick_tab_available: validTabs.includes("quick"),
      visible_tab_count: validTabs.length,
      has_channel_identifier: Boolean(user),
    });
    router.push(`/channel/${user}/manage/add-song?tab=${tab}`);
  };

  const descriptions: Record<AddSongTab, string> = {
    manual: "노래 정보를 직접 입력해서 노래책에 추가해보세요.",
    excel: "엑셀 형식으로 여러 노래를 한 번에 등록해보세요.",
    quick:
      "다른 채널에서 많이 등록된 곡을 검색해 한 번에 추가하세요.",
  };

  return (
    <div className="p-6">
      <ManagementHeader
        title="노래 추가"
        description={descriptions[activeTab]}
        icon={Plus}
      >
        {activeTab === "quick" && (
          <Badge variant="indigo" className="text-xs">
            NEW
          </Badge>
        )}
      </ManagementHeader>

      <div className="mb-6">
        <PillTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />
      </div>

      {activeTab === "manual" && <AddSongManualContent />}
      {activeTab === "excel" && <AddSongExcelContent />}
      {activeTab === "quick" && <AddSongQuickContent />}
    </div>
  );
}
