"use client";

import Image from "next/image";
import Link from "next/link";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Film, Music } from "lucide-react";
import { useFeatureFlag } from "@/meloming/shared/hooks/use-feature-flag";
import type { PublicSetlistSong } from "@/meloming/domains/song-live/types/setlist";

export function formatSessionDate(iso: string): string {
  return format(new Date(iso), "yyyy.MM.dd (EEE)", { locale: ko });
}

export function formatSessionDateTime(iso: string): string {
  return format(new Date(iso), "yyyy.MM.dd (EEE) HH:mm", { locale: ko });
}

export function formatPlayedAt(iso: string | null): string {
  if (!iso) return "-";
  return format(new Date(iso), "HH:mm", { locale: ko });
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "-";
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

export function SetlistSongRow({ song }: { song: PublicSetlistSong }) {
  const clipLinkEnabled = useFeatureFlag("setlistClipLink");
  const requesterLabel = song.isAnonymous
    ? "익명"
    : song.requesterNickname || "익명";

  return (
    <li className="flex items-center gap-3 py-2 border-b last:border-b-0">
      <div className="shrink-0 w-12 h-12 rounded-md bg-muted overflow-hidden flex items-center justify-center relative">
        {song.albumArt ? (
          <Image
            src={song.albumArt}
            alt=""
            fill
            sizes="48px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <Music className="w-5 h-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{song.title}</div>
        <div className="text-sm text-muted-foreground truncate">
          {song.artist || "-"}
        </div>
      </div>
      {clipLinkEnabled && song.clip && (
        <Link
          href={`/clip/${song.clip.id}`}
          aria-label={`${song.title} 클립 보기`}
          className="shrink-0 relative w-11 md:w-14 min-h-[44px] flex items-center group"
        >
          <div className="relative w-full aspect-video rounded-md overflow-hidden bg-muted">
            {song.clip.thumbnailUrl ? (
              <Image
                src={song.clip.thumbnailUrl}
                alt=""
                fill
                sizes="(max-width: 768px) 44px, 56px"
                className="object-cover transition-transform duration-200 group-hover:scale-105"
                unoptimized
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Film className="w-3 h-3 text-muted-foreground" />
              </div>
            )}
          </div>
        </Link>
      )}
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <div>{formatPlayedAt(song.playedAt)}</div>
        <div className="truncate max-w-[80px] sm:max-w-[100px]">
          {requesterLabel}
        </div>
      </div>
    </li>
  );
}
