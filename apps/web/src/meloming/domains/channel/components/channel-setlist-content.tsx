"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Music } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import { cn } from "@/meloming/shared/lib/utils";
import { usePublicSetlists } from "@/meloming/domains/song-live/hooks/use-setlists";
import type { PublicSetlistSummary } from "@/meloming/domains/song-live/types/setlist";
import { formatDuration, formatSessionDate } from "./setlist-shared";

const PAGE_SIZE = 12;

function AlbumArtCollage({ arts }: { arts: string[] }) {
  // 3x2 슬롯 (가로 3 × 세로 2) — 빈 자리는 음표 placeholder
  const slots = Array.from({ length: 6 }, (_, i) => arts[i] ?? null);
  return (
    <div className="grid grid-cols-3 gap-0.5 aspect-[3/2] w-full bg-background">
      {slots.map((art, i) => (
        <div
          key={i}
          className="relative bg-muted overflow-hidden flex items-center justify-center"
        >
          {art ? (
            <Image
              src={art}
              alt=""
              fill
              sizes="(max-width: 640px) 33vw, (max-width: 1024px) 17vw, 12vw"
              className="object-cover"
              unoptimized
            />
          ) : (
            <Music className="w-5 h-5 text-muted-foreground/30" />
          )}
        </div>
      ))}
    </div>
  );
}

interface SetlistCardProps {
  summary: PublicSetlistSummary;
  onClick: () => void;
}

function SetlistCard({ summary, onClick }: SetlistCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col rounded-xl overflow-hidden border bg-card text-left cursor-pointer",
        "transition-all hover:shadow-md hover:-translate-y-0.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <AlbumArtCollage arts={summary.albumArtPreviews} />
      <div className="flex flex-col gap-2 px-4 py-3.5">
        <span className="text-lg font-semibold truncate leading-tight">
          {formatSessionDate(summary.startedAt)}
        </span>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {summary.completedCount}곡
          </span>
          <span aria-hidden>·</span>
          <span>{formatDuration(summary.durationMinutes)}</span>
        </div>
      </div>
    </button>
  );
}

export function ChannelSetlistContent({ user }: { user: string }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = usePublicSetlists(user, page, PAGE_SIZE);
  // 신규 레이아웃은 ChannelNewLayoutHeader 가 탭 제목을 제공하므로 중복 제목을 숨긴다.
  // 기존 분기: (channel?.layoutType ?? "new") === "new".
  const isNewLayout = true;

  const goToDetail = (sessionId: number) => {
    router.push(`/setlist/${sessionId}`);
  };

  return (
    <section className="container mx-auto px-4 md:px-6 py-6">
      {!isNewLayout && (
        <header className="mb-6">
          <h1 className="text-2xl font-bold paperlogy">셋리스트</h1>
          <p className="text-sm text-muted-foreground mt-1">
            방송에서 재생됐던 곡을 세션별로 다시 볼 수 있습니다.
          </p>
        </header>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden border">
              <Skeleton className="aspect-[3/2] w-full rounded-none" />
              <div className="px-4 py-3.5 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <div className="py-12 text-center text-muted-foreground">
          셋리스트를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </div>
      )}

      {!isLoading && !isError && data && data.setlists.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          아직 공개된 셋리스트가 없습니다.
        </div>
      )}

      {!isLoading && !isError && data && data.setlists.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data.setlists.map((summary) => (
              <SetlistCard
                key={summary.sessionId}
                summary={summary}
                onClick={() => goToDetail(summary.sessionId)}
              />
            ))}
          </div>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                이전
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {data.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page >= data.totalPages}
              >
                다음
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
