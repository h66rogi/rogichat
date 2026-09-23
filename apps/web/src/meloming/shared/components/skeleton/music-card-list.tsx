import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";

function SkeletonMusicCardList() {
  const isMobile = useIsMobile();

  return (
    <div className="flex bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      {isMobile ? (
        // 모바일: 세로 레이아웃
        <div className="flex flex-col w-full p-3 gap-3">
          {/* 상단: 앨범 아트 + 기본 정보 */}
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <Skeleton className="w-12 h-12 rounded-lg" />
            </div>

            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>

            {/* 별점 스켈레톤 */}
            <div className="flex-shrink-0 flex gap-0.5">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="w-3 h-3 rounded-sm" />
              ))}
            </div>
          </div>

          {/* 하단: 카테고리 스켈레톤 */}
          <div className="flex gap-1">
            <Skeleton size="badge" />
            <Skeleton size="badge" className="w-12" />
          </div>
        </div>
      ) : (
        // 데스크톱: 가로 레이아웃 (기존 방식)
        <div className="flex items-center gap-4 p-3 w-full">
          {/* 앨범 아트 스켈레톤 */}
          <div className="flex-shrink-0">
            <Skeleton className="w-14 h-14 rounded-lg" />
          </div>

          {/* 곡 정보 스켈레톤 */}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>

          {/* 카테고리 스켈레톤 */}
          <div className="flex gap-1">
            <Skeleton size="badge" />
            <Skeleton size="badge" className="w-12" />
          </div>

          {/* 별점 스켈레톤 */}
          <div className="flex-shrink-0 flex gap-0.5">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="w-3 h-3 rounded-sm" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SkeletonMusicCardListGrid({ count = 20 }: { count?: number }) {
  return (
    <div className="space-y-3 mt-4">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonMusicCardList key={index} />
      ))}
    </div>
  );
}

export { SkeletonMusicCardList, SkeletonMusicCardListGrid };
