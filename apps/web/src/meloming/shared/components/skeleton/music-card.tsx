import { Skeleton } from "@/meloming/shared/components/ui/skeleton";

function SkeletonMusicCard() {
  return (
    <div className="max-w-72">
      {/* 앨범 아트 영역 */}
      <div className="aspect-square">
        <Skeleton className="w-full h-full rounded-lg" />
      </div>

      {/* 정보 영역 */}
      <div className="mt-2 space-y-2">
        {/* 제목 */}
        <Skeleton className="h-5 w-full" />

        {/* 아티스트 */}
        <Skeleton className="h-4 w-3/4" />

        {/* 카테고리와 별점 영역 */}
        <div className="flex flex-row justify-between items-center mt-2">
          {/* 카테고리 배지들 */}
          <div className="flex flex-row flex-wrap gap-x-1">
            <Skeleton size="badge" className="mt-1.5" />
            <Skeleton size="badge" className="mt-1.5 w-12" />
          </div>

          {/* 별점 */}
          <div className="flex flex-row gap-0.5">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="w-3 h-3 rounded-sm" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonMusicCardGrid({ count = 20 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 mt-4">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonMusicCard key={index} />
      ))}
    </div>
  );
}

export { SkeletonMusicCard, SkeletonMusicCardGrid };
