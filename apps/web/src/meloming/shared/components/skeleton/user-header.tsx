import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";
import clsx from "clsx";

function SkeletonUserHeader() {
  const isMobile = useIsMobile();

  return (
    <>
      {/* 헤더 배경 스켈레톤 */}
      <section>
        <Skeleton className={clsx("w-full", isMobile ? "h-24" : "h-32")} />
      </section>

      {/* 메인 콘텐츠 스켈레톤 */}
      <section className="container mx-auto px-4 md:px-6">
        <div className={`flex gap-4 ${isMobile ? "flex-col" : "flex-row"}`}>
          {/* 아바타 영역 */}
          <div
            className={`flex items-end gap-4 ${
              isMobile ? "mt-[-3rem] justify-center" : "mt-[-2.5rem]"
            }`}
          >
            <Skeleton
              className={clsx(
                "border-4 sm:border-6 border-background rounded-full flex-shrink-0",
                isMobile ? "w-24 h-24" : "w-30 h-30"
              )}
            />
          </div>

          {/* 사용자 정보 및 버튼 영역 */}
          <div
            className={`flex w-full ${
              isMobile ? "flex-col gap-4" : "flex-row justify-between"
            }`}
          >
            {/* 사용자 정보 */}
            <div
              className={`flex flex-col gap-3 ${
                isMobile ? "items-center text-center mt-1" : "mt-6"
              }`}
            >
              {/* 닉네임 */}
              <Skeleton className="h-8 w-32" />

              {/* 플랫폼 배지들 */}
              <div className="flex flex-row gap-2 flex-wrap justify-center">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            </div>

            {/* 버튼 영역 */}
            <div
              className={`flex gap-2 ${
                isMobile ? "justify-center mt-2" : "flex-row mt-6"
              }`}
            >
              <Skeleton className="h-10 w-20 rounded-md" />
              <Skeleton className="h-10 w-24 rounded-md" />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export { SkeletonUserHeader };
