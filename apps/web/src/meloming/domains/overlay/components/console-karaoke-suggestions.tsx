"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkCheck, ChevronDown, Loader2, Play, Youtube } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/meloming/shared/lib/utils";
import { useConsoleSerperSearchVideo } from "@/meloming/domains/channel/hooks/use-songs";
import { patchConsoleSongMetadata } from "@/meloming/domains/channel/apis/songs";
import { songRequestKeys } from "@/meloming/domains/overlay/hooks/use-song-requests";
import type { SerperVideoItem } from "@/meloming/domains/channel/types/serper";

type SourceTag = 'karaoke' | 'mr' | 'inst';
type TaggedVideo = SerperVideoItem & { sources: SourceTag[] };

const FILTER_OPTIONS: { tag: SourceTag; label: string }[] = [
  { tag: 'karaoke', label: '노래방만' },
  { tag: 'mr', label: 'MR만' },
  { tag: 'inst', label: 'Inst만' },
];

interface ConsoleKaraokeSuggestionsProps {
  /** 경로 identifier (webPath 또는 channelId) — 기존 리모콘의 `user` prop 그대로 전달 */
  channelIdentifier: string;
  /** PATCH 대상 Song.id */
  songId: number;
  /** 현재 재생 중 SongRequest.id — 저장 완료 race 가드에 사용 */
  songRequestId: number;
  title: string;
  artist: string;
  /** React Query 캐시 invalidate 용. null 이면 invalidate 스킵. */
  sessionId: number | null;
  /** karaokeVideoType === 'ORIGINAL' 이면 저장은 되지만 이번 재생 URL 은 바뀌지 않음 */
  isOriginalMode: boolean;
  /** 현재 Song.karaokeUrl (저장된 URL). 매칭 카드에 "저장됨" 표시. 토글 기본 상태에도 영향. */
  currentKaraokeUrl?: string | null;
  /** 현재 이번-재생(ephemeral) 로 덮어쓴 URL */
  ephemeralUrl: string | null;
  /** 카드 우상단 ▶ 클릭 시 호출. DB 업데이트 없음. */
  onEphemeralPlay: (url: string) => void;
  /** 저장 성공 시 호출 (race 가드 통과한 경우에만) */
  onSaved?: (url: string) => void;
  /** true면 헤더 토글 없이 항상 펼친 상태로 렌더 (탭 안에서 사용 시) */
  alwaysOpen?: boolean;
}

/**
 * 현재 재생 중 곡의 노래방/MR 주소가 비어있을 때 추천 영상을 제시하는 리모콘 섹션.
 *
 * - 제목+아티스트로 두 쿼리("... 노래방", "... MR(Inst)") 를 병렬 호출하고 URL 기준 dedupe
 * - 4열 그리드 + 1.5행 정도만 보이게(세로 스크롤), 최대 20개
 * - 카드 클릭 = 저장(주 액션), 카드 우상단 ▶ = 이번 재생에만 사용(보조 액션)
 * - 저장 시점 `{songId, songRequestId}` 캡처 후 응답 시 현재 재생 곡과 다르면 UI 갱신 스킵(race 가드)
 */
export function ConsoleKaraokeSuggestions({
  channelIdentifier,
  songId,
  songRequestId,
  title,
  artist,
  sessionId,
  isOriginalMode,
  currentKaraokeUrl,
  ephemeralUrl,
  onEphemeralPlay,
  onSaved,
  alwaysOpen = false,
}: ConsoleKaraokeSuggestionsProps) {
  const queryClient = useQueryClient();

  // 토글: 저장된 URL 이 없으면 기본 펼침, 있으면 기본 접힘.
  // 곡이 바뀌면 부모에서 key 로 이 컴포넌트를 재마운트하여 초기값 정책을 재적용.
  const [isOpen, setIsOpen] = useState<boolean>(!currentKaraokeUrl);
  const expanded = alwaysOpen || isOpen;

  const hasSearchInput = Boolean(title.trim() && artist.trim());
  const karaokeQuery = useConsoleSerperSearchVideo(
    hasSearchInput
      ? { query: `${artist} - ${title} 노래방`, num: 12 }
      : undefined,
  );
  const mrQuery = useConsoleSerperSearchVideo(
    hasSearchInput
      ? { query: `${artist} - ${title} MR`, num: 12 }
      : undefined,
  );
  const instQuery = useConsoleSerperSearchVideo(
    hasSearchInput
      ? { query: `${artist} - ${title} Inst`, num: 12 }
      : undefined,
  );

  // URL 기준 dedupe + 최대 30개. 같은 URL 이 여러 쿼리에서 나오면 sources 누적
  // 으로 다중 태깅 → 우측 필터 버튼으로 카테고리별 좁혀보기. 우선순위는 노래방 →
  // MR → Inst 순(insertion order).
  const videos = useMemo(() => {
    const byLink = new Map<string, TaggedVideo>();
    const ingest = (items: SerperVideoItem[] | undefined, tag: SourceTag) => {
      if (!items) return;
      for (const v of items) {
        if (!v.link) continue;
        const existing = byLink.get(v.link);
        if (existing) {
          if (!existing.sources.includes(tag)) existing.sources.push(tag);
        } else {
          byLink.set(v.link, { ...v, sources: [tag] });
        }
      }
    };
    ingest(karaokeQuery.data?.videos, 'karaoke');
    ingest(mrQuery.data?.videos, 'mr');
    ingest(instQuery.data?.videos, 'inst');
    return Array.from(byLink.values()).slice(0, 30);
  }, [karaokeQuery.data, mrQuery.data, instQuery.data]);

  const [filter, setFilter] = useState<SourceTag | null>(null);
  const filteredVideos = useMemo(
    () => (filter ? videos.filter((v) => v.sources.includes(filter)) : videos),
    [videos, filter],
  );

  const isFetching =
    karaokeQuery.isFetching || mrQuery.isFetching || instQuery.isFetching;
  const isInitialLoading =
    (karaokeQuery.isFetching && !karaokeQuery.data) ||
    (mrQuery.isFetching && !mrQuery.data) ||
    (instQuery.isFetching && !instQuery.data);
  // 3개 모두 실패해야 에러 — 부분 실패는 가용 결과로 진행
  const isError =
    karaokeQuery.isError && mrQuery.isError && instQuery.isError;

  const saveMutation = useMutation({
    mutationFn: async (args: {
      url: string;
      capturedSongId: number;
      capturedRequestId: number;
    }) => {
      const result = await patchConsoleSongMetadata(
        channelIdentifier,
        args.capturedSongId,
        { karaokeUrl: args.url },
      );
      return {
        ...result,
        capturedRequestId: args.capturedRequestId,
        url: args.url,
      };
    },
    onSuccess: (data) => {
      // race 가드: 저장 중 곡이 바뀐 경우 UI 업데이트/invalidate 는 스킵.
      if (data.capturedRequestId !== songRequestId) {
        return;
      }
      if (sessionId !== null) {
        queryClient.invalidateQueries({
          queryKey: songRequestKeys.nowPlaying(sessionId),
        });
        queryClient.invalidateQueries({
          queryKey: songRequestKeys.queue(sessionId),
        });
      }
      toast.success("노래방 주소를 저장했어요");
      onSaved?.(data.url);
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "저장에 실패했어요";
      toast.error(message);
    },
  });

  // saveMutation 자체가 in-flight 상태를 관리하므로 별도 useState로 추적하지 않는다
  // (이전 useState 방식은 fetch hang 시 onSettled가 호출되지 않으면 stuck → 모든 카드 disabled 영구 잠금 위험).
  const savingUrl: string | null = saveMutation.isPending
    ? saveMutation.variables?.url ?? null
    : null;

  const handleSave = (url: string) => {
    if (saveMutation.isPending) return;
    saveMutation.mutate({
      url,
      capturedSongId: songId,
      capturedRequestId: songRequestId,
    });
  };

  return (
    <div className="space-y-2">
      {!alwaysOpen && (
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-md text-left transition-colors hover:bg-background/50"
          aria-expanded={isOpen}
        >
          <div className="flex items-center gap-1.5">
            <h4 className="text-xs font-semibold text-foreground">
              추천 노래방/MR 영상
            </h4>
            {currentKaraokeUrl && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
                <BookmarkCheck className="size-2.5" />
                저장됨
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isFetching && !isInitialLoading && (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            )}
            <ChevronDown
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                isOpen && "rotate-180",
              )}
            />
          </div>
        </button>
      )}

      {expanded && (
        <>
          {isOriginalMode && (
            <p className="text-[11px] text-muted-foreground">
              원곡 재생 모드라 저장은 되지만 이번 재생 URL 은 바뀌지 않아요.
            </p>
          )}

          {/* 필터: 노래방만 / MR만 / Inst만 — 다시 누르면 해제 */}
          {!isError && !isInitialLoading && videos.length > 0 && (
            <div className="flex items-center justify-end gap-1">
              {FILTER_OPTIONS.map((opt) => {
                const active = filter === opt.tag;
                const count = videos.filter((v) => v.sources.includes(opt.tag)).length;
                return (
                  <button
                    key={opt.tag}
                    type="button"
                    onClick={() => setFilter(active ? null : opt.tag)}
                    className={cn(
                      "h-5 rounded-full border px-2 text-[10px] font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background/60 text-muted-foreground hover:bg-background",
                      count === 0 && !active && "opacity-50",
                    )}
                  >
                    {opt.label}
                    <span className={cn("ml-1 text-[9px]", active ? "text-primary-foreground/80" : "text-muted-foreground/70")}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {isError ? (
            <p className="py-4 text-center text-[11px] text-destructive">
              검색에 실패했어요. 잠시 후 다시 시도해주세요.
            </p>
          ) : isInitialLoading ? (
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1 p-1">
                  <div className="aspect-video w-full animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-full animate-pulse rounded bg-muted" />
                  <div className="h-2 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : videos.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-muted-foreground">
              매칭되는 영상을 찾지 못했어요.
            </p>
          ) : filteredVideos.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-muted-foreground">
              해당 카테고리에 매칭되는 영상이 없어요.
            </p>
          ) : (
            <div className="grid max-h-[200px] grid-cols-4 gap-1.5 overflow-y-auto pr-1">
              {filteredVideos.map((video) => (
                <SuggestionCard
                  key={video.link}
                  video={video}
                  isCurrentlySaved={currentKaraokeUrl === video.link}
                  isEphemeralActive={ephemeralUrl === video.link}
                  isSaving={savingUrl === video.link}
                  onSave={() => handleSave(video.link)}
                  onEphemeralPlay={() => onEphemeralPlay(video.link)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SuggestionCard({
  video,
  isCurrentlySaved,
  isEphemeralActive,
  isSaving,
  onSave,
  onEphemeralPlay,
}: {
  video: SerperVideoItem;
  isCurrentlySaved: boolean;
  isEphemeralActive: boolean;
  isSaving: boolean;
  onSave: () => void;
  onEphemeralPlay: () => void;
}) {
  const saveTitle = isCurrentlySaved
    ? `${video.title} — 이미 저장됨`
    : `${video.title} — 클릭해서 저장`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSave}
        disabled={isSaving}
        title={saveTitle}
        className={cn(
          "group flex w-full flex-col gap-1 rounded-md p-1 text-left transition-colors",
          "hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          "disabled:cursor-default",
          isCurrentlySaved && "bg-emerald-500/5 ring-1 ring-emerald-500/60",
          !isCurrentlySaved &&
            isEphemeralActive &&
            "bg-primary/5 ring-1 ring-primary",
          isSaving && "opacity-70",
        )}
      >
        <div className="relative aspect-video w-full overflow-hidden rounded bg-muted">
          {video.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Youtube className="size-4 text-muted-foreground" />
            </div>
          )}
          {video.duration && (
            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 py-px text-[9px] font-medium text-white">
              {video.duration}
            </span>
          )}
          {isCurrentlySaved && !isSaving && (
            <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/20">
              <div className="rounded-full bg-emerald-500 p-1 text-white shadow">
                <BookmarkCheck className="size-3" />
              </div>
            </div>
          )}
          {!isCurrentlySaved && isEphemeralActive && !isSaving && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/25">
              <div className="rounded-full bg-primary p-1 text-primary-foreground shadow">
                <Play className="size-3 fill-current" />
              </div>
            </div>
          )}
          {isSaving && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80">
              <Loader2 className="size-3.5 animate-spin text-primary" />
            </div>
          )}
        </div>
        <p className="line-clamp-2 text-[10px] font-medium leading-tight">
          {video.title}
        </p>
        {video.channel && (
          <p className="truncate text-[9px] text-muted-foreground">
            {video.channel}
          </p>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEphemeralPlay();
        }}
        title="이번 재생에만 적용 (저장 안 함)"
        aria-label="이번만 재생"
        className={cn(
          "absolute right-1 top-1 flex size-5 items-center justify-center rounded-full transition-colors",
          "bg-black/70 text-white hover:bg-black/85",
          isEphemeralActive && "bg-primary text-primary-foreground",
        )}
      >
        <Play className="size-2.5 fill-current" />
      </button>
    </div>
  );
}
