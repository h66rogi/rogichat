"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useFeatureFlag } from "@/meloming/shared/hooks/use-feature-flag";

/**
 * `channel-calendar-v2` PostHog feature flag 의 enabled 여부를 반환.
 *
 * Local override 지원:
 *   `?ff_channel_calendar_v2=true`  → 강제 enable
 *   `?ff_channel_calendar_v2=false` → 강제 disable
 *
 * URL 쿼리는 PostHog 응답보다 우선한다. PR 리뷰/QA에서 flag rollout 비율과
 * 무관하게 v2 트리를 강제로 띄워 보기 위한 escape hatch.
 */
export function useChannelCalendarV2Flag(): boolean {
  const searchParams = useSearchParams();
  const remote = useFeatureFlag("channelCalendarV2");

  return useMemo(() => {
    const override = searchParams?.get("ff_channel_calendar_v2");
    if (override === "true" || override === "1") return true;
    if (override === "false" || override === "0") return false;
    return remote;
  }, [searchParams, remote]);
}
