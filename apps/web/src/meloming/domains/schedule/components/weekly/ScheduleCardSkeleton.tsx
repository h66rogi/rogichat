import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import { cn } from "@/meloming/shared/lib/utils";

export function ScheduleCardDesktopSkeleton() {
  return (
    <div className="border rounded-lg p-3 bg-muted/30">
      <div className="space-y-2">
        {/* 시간 & 뱃지 */}
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-12" />
        </div>
        {/* 제목 */}
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        {/* 작성자 */}
        <div className="flex items-center gap-2 pt-1 border-t border-border/50">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  );
}

export function ScheduleCardMobileSkeleton() {
  return (
    <div className="border-l-4 border-muted rounded-md p-3 bg-muted/30">
      <div className="flex items-start gap-2.5">
        <Skeleton className="size-8 rounded-full flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-12" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}

interface WeeklyGridSkeletonProps {
  className?: string;
}

export function DesktopWeeklyGridSkeleton({ className }: WeeklyGridSkeletonProps) {
  return (
    <div className={cn("grid grid-cols-7 gap-3", className)}>
      {Array.from({ length: 7 }).map((_, dayIndex) => (
        <div key={dayIndex} className="flex flex-col">
          {/* 날짜 헤더 */}
          <div className="text-center pb-2 border-b mb-3 rounded-t-lg pt-2.5">
            <Skeleton className="h-4 w-8 mx-auto mb-1" />
            <Skeleton className="h-3 w-12 mx-auto" />
          </div>
          {/* 일정 카드들 */}
          <div className="space-y-2.5 flex-1">
            {Array.from({ length: Math.floor(Math.random() * 3) + 1 }).map((_, cardIndex) => (
              <ScheduleCardDesktopSkeleton key={cardIndex} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MobileDaySelectorSkeleton({ className }: WeeklyGridSkeletonProps) {
  return (
    <div className={className}>
      {/* 날짜 선택 탭 */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-4 border-b">
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className="flex-shrink-0 min-w-[60px] py-3 px-2 rounded-lg border-2"
          >
            <Skeleton className="h-3 w-8 mx-auto mb-2" />
            <Skeleton className="h-6 w-6 mx-auto mb-1" />
            <Skeleton className="h-3 w-8 mx-auto" />
          </div>
        ))}
      </div>
      {/* 일정 리스트 */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <ScheduleCardMobileSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

