"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, X } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import { useChannelCalendarSearch } from "@/meloming/domains/calendar/hooks/use-channel-calendar";
import type {
  CalendarSearchItem,
  CalendarSearchItemType,
} from "@/meloming/domains/calendar/types/channel-calendar";

/**
 * 통합 캘린더 검색 — 캘린더 헤더의 날짜 선택 아이콘 버튼과 동일한 패턴
 * (아이콘 버튼 → Popover)으로 통합한다. Radix Popover 라 portal 로 떠서
 * 부모의 overflow-hidden(뷰포트 고정 레이아웃)에 잘리지 않는다.
 *
 * 결과 클릭:
 *   - 노래방송(SETLIST) / 클립(CLIP): 전용 상세 페이지로 이동 (router)
 *   - 그 외(일정/방송기록/기념일): `onSelectDate` 로 캘린더를 해당 날짜로 이동
 *
 * 색상 컨벤션은 캘린더 안내와 일치:
 *   일정=blue / 방송기록=slate / 노래방송=rose / 클립=emerald / 기념일=amber
 */
const TYPE_META: Record<
  CalendarSearchItemType,
  { label: string; dot: string; text: string }
> = {
  SCHEDULE: { label: "방송 일정", dot: "bg-blue-500", text: "text-blue-600" },
  BROADCAST: { label: "방송 기록", dot: "bg-slate-400", text: "text-slate-600" },
  SETLIST: { label: "노래 방송", dot: "bg-rose-500", text: "text-rose-600" },
  CLIP: { label: "노래 클립", dot: "bg-emerald-500", text: "text-emerald-600" },
  ANNIVERSARY: { label: "기념일", dot: "bg-amber-500", text: "text-amber-600" },
};

/** 결과 그룹 표시 순서 (예정 일정 먼저, 그다음 기록류, 기념일 마지막). */
const TYPE_ORDER: CalendarSearchItemType[] = [
  "SCHEDULE",
  "CLIP",
  "BROADCAST",
  "ANNIVERSARY",
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function itemKey(item: CalendarSearchItem, idx: number): string {
  const id =
    item.scheduleId ??
    item.sessionId ??
    item.clipId ??
    item.sessionKey ??
    item.anniversaryType ??
    idx;
  return `${item.type}-${id}-${item.date}`;
}

const ICON_BUTTON_CLASS =
  "inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

export function CalendarSearchButton({
  identifier,
  onSelectDate,
  align = "end",
  triggerClassName,
}: {
  /** 채널 식별자 (webPath 또는 numeric id). 검색 API + setlist URL 에 사용. */
  identifier: string;
  /** 일정/방송기록/기념일 결과 클릭 시 캘린더를 해당 날짜로 이동시키는 콜백. */
  onSelectDate: (date: Date) => void;
  align?: "start" | "center" | "end";
  /** 트리거 버튼에 덧입힐 클래스 (헤더별 스타일 보정용). */
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [debounced, setDebounced] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 300ms debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword.trim()), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  // 닫을 때 검색어 초기화 (다음 열 때 깨끗한 상태)
  useEffect(() => {
    if (!open) {
      setKeyword("");
      setDebounced("");
    }
  }, [open]);

  const { data, isFetching } = useChannelCalendarSearch(identifier, debounced, {
    enabled: open,
  });

  const items = data?.items.filter((item) => item.type !== "SETLIST") ?? [];
  const hasQuery = debounced.length >= 1;

  const handleSelect = (item: CalendarSearchItem) => {
    setOpen(false);
    if (item.type === "CLIP" && item.clipId != null) {
      router.push(`/clip/${item.clipId}`);
      return;
    }
    const d = new Date(item.date);
    if (!Number.isNaN(d.getTime())) onSelectDate(d);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && items.length > 0) {
      e.preventDefault();
      handleSelect(items[0]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="캘린더 검색"
          className={cn(ICON_BUTTON_CLASS, triggerClassName)}
        >
          <Search className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[min(92vw,380px)] overflow-hidden p-0"
        onOpenAutoFocus={(e) => {
          // 컨테이너가 아니라 입력창에 포커스
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="일정 · 방송 · 클립 · 기념일 검색"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {isFetching && hasQuery ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : keyword ? (
            <button
              type="button"
              aria-label="검색어 지우기"
              onClick={() => setKeyword("")}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {hasQuery ? (
          items.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {isFetching
                ? "검색 중..."
                : `'${debounced}' 검색 결과가 없습니다.`}
            </div>
          ) : (
            <div className="max-h-[min(60vh,360px)] overflow-y-auto py-1">
              {TYPE_ORDER.map((type) => {
                const group = items.filter((it) => it.type === type);
                if (group.length === 0) return null;
                const meta = TYPE_META[type];
                return (
                  <div key={type}>
                    <div className="flex items-center gap-1.5 px-3 pb-1 pt-2">
                      <span
                        className={cn("size-1.5 shrink-0 rounded-full", meta.dot)}
                      />
                      <span
                        className={cn("text-[11px] font-semibold", meta.text)}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {group.length}
                      </span>
                    </div>
                    <ul>
                      {group.map((item, idx) => (
                        <li key={itemKey(item, idx)}>
                          <button
                            type="button"
                            onClick={() => handleSelect(item)}
                            className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {item.title}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="shrink-0">
                                  {formatDate(item.date)}
                                </span>
                                {item.subtitle ? (
                                  <>
                                    <span aria-hidden>·</span>
                                    <span className="truncate">
                                      {item.subtitle}
                                    </span>
                                  </>
                                ) : null}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            키워드를 입력하면 일정 · 방송 기록 · 클립 · 기념일을
            한번에 찾습니다.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
