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

  return (
    <SectionErrorBoundary section="일정">
      <section
        id="schedule-section"
        className={cn(!isWide && "container", "mx-auto mt-6 px-4 md:px-6")}
      >
        <ScheduleSection hideHeading />
      </section>
    </SectionErrorBoundary>
  );
}
