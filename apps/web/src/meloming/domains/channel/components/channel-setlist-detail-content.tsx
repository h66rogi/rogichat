"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Clock, Music } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import { usePublicSetlistDetail } from "@/meloming/domains/song-live/hooks/use-setlists";
import {
  SetlistSongRow,
  formatDuration,
  formatSessionDateTime,
} from "./setlist-shared";

interface ChannelSetlistDetailContentProps {
  user: string;
  sessionId: number;
}

export function ChannelSetlistDetailContent({
  user,
  sessionId,
}: ChannelSetlistDetailContentProps) {
  const router = useRouter();
  const { data, isLoading, isError } = usePublicSetlistDetail(
    user,
    sessionId,
    true
  );

  return (
    <section className="container mx-auto px-4 md:px-6 py-6">
      <div className="mb-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => router.push('/setlist')}
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          셋리스트 목록
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-5 w-40" />
          <div className="space-y-2 pt-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </div>
      )}

      {isError && !isLoading && (
        <div className="py-12 text-center text-muted-foreground">
          셋리스트를 불러오지 못했습니다.
        </div>
      )}

      {!isLoading && !isError && data && (
        <>
          <header className="mb-6 pb-4 border-b">
            <h1 className="text-2xl font-bold paperlogy">
              {formatSessionDateTime(data.summary.startedAt)}
            </h1>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5 text-foreground font-semibold">
                <Music className="w-4 h-4" />
                {data.summary.completedCount}곡
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                {formatDuration(data.summary.durationMinutes)}
              </span>
            </div>
          </header>

          <h2 className="text-base font-semibold mb-3">곡 목록</h2>
          {data.songs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              재생된 곡이 없습니다.
            </div>
          ) : (
            <ul className="divide-y">
              {data.songs.map((song) => (
                <SetlistSongRow key={song.id} song={song} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
