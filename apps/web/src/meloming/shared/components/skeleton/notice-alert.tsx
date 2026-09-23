import { Skeleton } from "@/meloming/shared/components/ui/skeleton";

function SkeletonNoticeAlert() {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start gap-3">
        {/* 아이콘 영역 */}
        <Skeleton className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5" />

        {/* 텍스트 영역 */}
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
    </div>
  );
}

export { SkeletonNoticeAlert };
