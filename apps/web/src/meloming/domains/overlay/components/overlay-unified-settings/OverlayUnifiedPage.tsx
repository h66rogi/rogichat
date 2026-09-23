"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Layers, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { ManagementHeader } from "@/meloming/domains/channel/components/management/management-header";
import { useOverlayToken } from "@/meloming/domains/channel/hooks/use-overlay-token";
import { useFeatureFlag } from "@/meloming/shared/hooks/use-feature-flag";
import { TotalOverlayLayoutSettings } from "../overlay-settings-content";
import { TabBar } from "./TabBar";
import { StickyUrlCard } from "./StickyUrlCard";
import { OverviewTabContent } from "./OverviewTabContent";
import { ThemeConfigSection, type ThemeConfigSectionHandle } from "./ThemeConfigSection";
import {
  isThemeTab,
  parseTabParam,
  type OverlayTabId,
} from "./tabs";

interface OverlayUnifiedPageProps {
  user: string;
}

/**
 * `/manage/overlay-settings`의 단일 페이지 컴포넌트.
 * URL `?tab=` 쿼리 파라미터로 활성 탭을 결정하고, 탭 전환 시 `router.replace`로 URL 동기화.
 */
export function OverlayUnifiedPage({ user }: OverlayUnifiedPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTabParam = searchParams.get("tab");
  const parsedTab = parseTabParam(rawTabParam);
  const overlaySetlistEnabled = useFeatureFlag("overlaySetlist");

  // feature flag OFF + `?tab=setlist` 직접 진입 방어: overview로 폴백
  const isHiddenSetlist = parsedTab === "setlist" && !overlaySetlistEnabled;
  const activeTab: OverlayTabId =
    isHiddenSetlist ? "overview" : parsedTab;

  // URL 정규화: 잘못된 `?tab=` 값이나 숨겨진 탭을 URL에서도 정리
  useEffect(() => {
    const shouldCleanRawInvalid =
      rawTabParam !== null && rawTabParam !== "" && rawTabParam !== parsedTab;
    const shouldCleanDisabledSetlist =
      rawTabParam === "setlist" && !overlaySetlistEnabled;

    if (!shouldCleanRawInvalid && !shouldCleanDisabledSetlist)
      return;

    const params = new URLSearchParams(searchParams.toString());
    if (activeTab === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", activeTab);
    }
    const query = params.toString();
    router.replace(query ? `?${query}` : window.location.pathname, {
      scroll: false,
    });
  }, [
    rawTabParam,
    parsedTab,
    overlaySetlistEnabled,
    activeTab,
    router,
    searchParams,
  ]);

  const { data: tokenData, isLoading: tokenLoading } = useOverlayToken(user);
  const overlayToken = tokenData?.overlayToken ?? null;

  // theme 탭 전환 시 draft dirty 여부 검사
  const themeSectionRef = useRef<ThemeConfigSectionHandle>(null);

  const handleTabChange = useCallback(
    (nextTab: OverlayTabId) => {
      if (nextTab === activeTab) return;

      const leavingTheme = isThemeTab(activeTab) && !isThemeTab(nextTab);
      if (leavingTheme && themeSectionRef.current?.isDirty()) {
        const confirmed = window.confirm(
          "저장하지 않은 변경사항이 있습니다. 이동할까요?",
        );
        if (!confirmed) return;
      }

      const params = new URLSearchParams(searchParams.toString());
      if (nextTab === "overview") {
        params.delete("tab");
      } else {
        params.set("tab", nextTab);
      }
      const query = params.toString();
      router.replace(query ? `?${query}` : window.location.pathname, {
        scroll: false,
      });
    },
    [activeTab, router, searchParams],
  );

  const pageHeader = (
    <ManagementHeader
      title="오버레이 설정"
      description="OBS에 추가할 오버레이를 선택하고 설정하세요"
      icon={Layers}
    />
  );

  if (tokenLoading) {
    return (
      <div className="p-6 space-y-4">
        {pageHeader}
        <Card className="py-0">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {pageHeader}

      <StickyUrlCard tab={activeTab} overlayToken={overlayToken} />

      <TabBar activeTab={activeTab} onChange={handleTabChange} />

      {/* 탭 컨텐츠 라우터 */}
      {activeTab === "overview" && (
        <OverviewTabContent
          user={user}
          tokenData={tokenData}
          isTokenLoading={tokenLoading}
        />
      )}

      {isThemeTab(activeTab) && (
        <ThemeConfigSection
          ref={themeSectionRef}
          channelIdentifier={user}
          overlayToken={overlayToken}
          activeTab={activeTab}
        />
      )}

      {activeTab === "total" && (
        <TotalOverlayLayoutSettings
          user={user}
          overlayToken={overlayToken}
          isTokenLoading={tokenLoading}
          embedded
        />
      )}
    </div>
  );
}
