/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import {
  Check,
  ExternalLink,
  Loader2,
  RotateCcw,
  Youtube,
} from "lucide-react";

import { cn } from "@/meloming/shared/lib/utils";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { useDebounce } from "@/meloming/shared/hooks/use-debounce";
import { useSerperSearchVideo } from "@/meloming/domains/channel/hooks/use-songs";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";

interface InlineYoutubeSearchProps {
  /** 완성된 검색어. 비어 있으면 안내만 표시하고 fetch 하지 않음. */
  query: string;
  /** 현재 폼에 저장된 URL. 매칭되는 결과에 "선택됨" 표시. */
  currentUrl?: string;
  /** 결과 선택 시 호출. 부모에서 form.setValue 로 반영. */
  onSelect: (url: string) => void;
  /** 기본 6개. 카드 grid는 데스크톱 3열 / 모바일 2열. */
  maxItems?: number;
  /** 타이핑 중 과도한 호출 방지. 기본 500ms. */
  debounceMs?: number;
  /** query가 비어 있을 때 보여줄 안내 문구. */
  emptyHint?: string;
}

export default function InlineYoutubeSearch({
  query,
  currentUrl,
  onSelect,
  maxItems = 6,
  debounceMs = 500,
  emptyHint = "제목과 가수명을 입력하면 자동으로 검색돼요.",
}: InlineYoutubeSearchProps) {
  // null = 사용자가 아직 편집하지 않음 (부모 query 자동 추적)
  // string = 사용자가 편집함 → 그 값 유지
  const [userEditedQuery, setUserEditedQuery] = useState<string | null>(null);
  const effectiveQuery = userEditedQuery ?? query;
  const effectiveNormalized = effectiveQuery.trim();
  const debounced = useDebounce(effectiveNormalized, debounceMs);

  const { data, isFetching, isError, error } = useSerperSearchVideo(
    debounced ? { query: debounced, num: maxItems + 4 } : undefined
  );

  const videos = (data?.videos ?? []).slice(0, maxItems);
  const isInitialLoading = isFetching && !data;
  const isEdited = userEditedQuery !== null;

  return (
    <div className="mt-2 rounded-md border bg-muted/20 p-2">
      <div className="mb-2 flex items-center gap-1">
        <Youtube className="size-3.5 shrink-0 text-red-500" aria-hidden />
        <Input
          value={effectiveQuery}
          onChange={(e) => setUserEditedQuery(e.target.value)}
          placeholder="검색어를 입력하세요"
          aria-label="YouTube 검색어"
          className="h-7 flex-1 border-none bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-1"
        />
        {isEdited && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setUserEditedQuery(null)}
            title="기본 검색어로 초기화"
            aria-label="기본 검색어로 초기화"
            className="size-6 shrink-0"
          >
            <RotateCcw className="size-3" />
          </Button>
        )}
        {isFetching && (
          <Loader2
            className="size-3 shrink-0 animate-spin text-muted-foreground"
            aria-hidden
          />
        )}
      </div>

      {!effectiveNormalized ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">
          {emptyHint}
        </p>
      ) : isError ? (
        <p className="py-3 text-center text-xs text-destructive">
          검색 오류: {extractApiErrorMessage(error, "잠시 후 다시 시도해주세요")}
        </p>
      ) : isInitialLoading ? (
        <ul
          className="grid grid-cols-2 gap-1.5 md:grid-cols-3"
          aria-busy="true"
          aria-label="검색 결과 로딩 중"
        >
          {Array.from({ length: maxItems }).map((_, i) => (
            <li key={i}>
              <div className="flex w-full flex-col gap-1 p-1">
                <div className="aspect-video w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-2 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            </li>
          ))}
        </ul>
      ) : videos.length === 0 && !isFetching ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">
          결과가 없어요. 검색어를 확인해주세요.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
          {videos.map((v, idx) => {
            const isSelected = Boolean(currentUrl && currentUrl === v.link);
            return (
              <li key={`${v.link}-${idx}`} className="relative">
                <button
                  type="button"
                  onClick={() => onSelect(v.link)}
                  className={cn(
                    "group flex w-full flex-col gap-1 rounded-md p-1 text-left transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    isSelected && "bg-primary/10 ring-1 ring-primary"
                  )}
                  title={v.title}
                >
                  <div className="relative aspect-video w-full overflow-hidden rounded bg-muted">
                    {v.imageUrl ? (
                      <img
                        src={v.imageUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Youtube className="size-5 text-muted-foreground" />
                      </div>
                    )}
                    {v.duration && (
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 py-px text-[9px] font-medium text-white">
                        {v.duration}
                      </span>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                        <div className="rounded-full bg-primary p-1 text-primary-foreground">
                          <Check className="size-3" />
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="line-clamp-2 text-[11px] font-medium leading-tight">
                    {v.title}
                  </p>
                  {v.channel && (
                    <p className="truncate text-[10px] text-muted-foreground">
                      {v.channel}
                    </p>
                  )}
                </button>
                <a
                  href={v.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/70 p-1 text-white opacity-80 transition-opacity hover:bg-black/90 hover:opacity-100"
                  title="새 창에서 열기"
                  aria-label="새 창에서 열기"
                >
                  <ExternalLink className="size-3" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
