"use client";

import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { cn } from "@/meloming/shared/lib/utils";
import {
  SectionErrorBoundary,
} from "@/meloming/shared/components/common/error-boundary";
import ScheduleSection from "@/meloming/domains/channel/components/section/schedule";

export function ChannelScheduleContent({ user }: { user: string }) {
  const { data: channel } = useChannel(user);
  const isWide = channel?.layoutWidth === "wide";
  // 신규 레이아웃은 ChannelNewLayoutHeader 가 탭 제목을 제공하므로 섹션 내부 중복 제목을 숨긴다.
  // 기존 분기: (channel?.layoutType ?? "new") === "new".
  const isNewLayout = true;

  return (
    <SectionErrorBoundary section="일정">
      <section
        id="schedule-section"
        className={cn(
          "mx-auto",
          isNewLayout
            ? "mt-0 min-h-0 px-0"
            : cn(!isWide && "container", "mt-8 px-4 md:px-6")
        )}
      >
        <ScheduleSection
          hideHeading={isNewLayout}
          fitCalendarToViewport={isNewLayout}
        />
      </section>
    </SectionErrorBoundary>
  );
}
