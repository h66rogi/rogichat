import { useState } from "react";
import {
  Check,
  ExternalLink,
  FileText,
  Loader2,
  RotateCcw,
} from "lucide-react";

import { cn } from "@/meloming/shared/lib/utils";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { useDebounce } from "@/meloming/shared/hooks/use-debounce";
import { useSerperSearchWeb } from "@/meloming/domains/channel/hooks/use-songs";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";

interface InlineWebSearchProps {
  query: string;
  currentUrl?: string;
  onSelect: (url: string) => void;
  maxItems?: number;
  debounceMs?: number;
  emptyHint?: string;
}

export default function InlineWebSearch({
  query,
  currentUrl,
  onSelect,
  maxItems = 6,
  debounceMs = 500,
  emptyHint = "제목과 가수명을 입력하면 자동으로 검색돼요.",
}: InlineWebSearchProps) {
  const [userEditedQuery, setUserEditedQuery] = useState<string | null>(null);
  const effectiveQuery = userEditedQuery ?? query;
  const effectiveNormalized = effectiveQuery.trim();
  const debounced = useDebounce(effectiveNormalized, debounceMs);

  const { data, isFetching, isError, error } = useSerperSearchWeb(
    debounced ? { query: debounced, num: maxItems + 4 } : undefined
  );

  const items = (data?.organic ?? []).slice(0, maxItems);
  const isInitialLoading = isFetching && !data;
  const isEdited = userEditedQuery !== null;

  return (
    <div className="mt-2 rounded-md border bg-muted/20 p-2">
      <div className="mb-2 flex items-center gap-1">
        <FileText className="size-3.5 shrink-0 text-blue-500" aria-hidden />
        <Input
          value={effectiveQuery}
          onChange={(e) => setUserEditedQuery(e.target.value)}
          placeholder="검색어를 입력하세요"
          aria-label="웹 검색어"
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
          className="flex flex-col gap-1"
          aria-busy="true"
          aria-label="검색 결과 로딩 중"
        >
          {Array.from({ length: Math.min(maxItems, 4) }).map((_, i) => (
            <li
              key={i}
              className="flex flex-col gap-1 rounded-md p-2"
            >
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
              <div className="h-2 w-full animate-pulse rounded bg-muted" />
              <div className="h-2 w-1/3 animate-pulse rounded bg-muted" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 && !isFetching ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">
          결과가 없어요. 검색어를 확인해주세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((r, idx) => {
            const isSelected = Boolean(currentUrl && currentUrl === r.link);
            const displayDomain = r.domain ?? safeHost(r.link);
            return (
              <li key={`${r.link}-${idx}`} className="relative">
                <button
                  type="button"
                  onClick={() => onSelect(r.link)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md p-2 pr-9 text-left transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    isSelected && "bg-primary/10 ring-1 ring-primary"
                  )}
                  title={r.title}
                >
                  <div className="flex items-start gap-1.5">
                    <p className="line-clamp-1 flex-1 text-xs font-medium">
                      {r.title}
                    </p>
                    {isSelected && (
                      <Check className="size-3.5 shrink-0 text-primary" />
                    )}
                  </div>
                  {r.snippet && (
                    <p className="line-clamp-2 text-[10px] text-muted-foreground">
                      {r.snippet}
                    </p>
                  )}
                  <p className="truncate text-[10px] text-muted-foreground/70">
                    {displayDomain}
                  </p>
                </button>
                <a
                  href={r.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  title="새 창에서 열기"
                  aria-label="새 창에서 열기"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function safeHost(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return "";
  }
}
