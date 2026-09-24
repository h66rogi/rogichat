"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import {
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/meloming/shared/components/ui/table";
import { useChannelIdentifier } from "@/meloming/domains/channel/hooks/channel-identifier-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FilterX } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { cn } from "@/meloming/shared/lib/utils";

import type { Song } from "@/meloming/domains/channel/types/song";
import type { LiveSongRequestState } from "@/meloming/domains/channel/types/live-song-request";
import type { PricingSettings } from "@/meloming/domains/channel/types/pricing";
import { useClipboard } from "@/meloming/shared/hooks/use-clipboard";
import MusicModal from "./music-modal";
import { createMusicSheetColumns } from "./music-sheet-columns";

interface MusicSheetProps {
  songs: Song[];
  liveRequestState?: LiveSongRequestState;
  pricingSettings?: PricingSettings;
  openSongId?: number;
  editSongId?: number;
  consumedOpenSongId?: number;
  onAutoOpenConsumed?: (songId: number) => void;
  /**
   * 정렬 상태를 채널별로 영속화할 localStorage 키. 미지정 시(테스트 등) 세션
   * 한정 정렬만 유지한다.
   */
  persistSortKey?: string;
}

// 영속화된 정렬 상태가 현재 컬럼 구성과 맞는지 검증 (Key/메모 제거 등으로
// stale 해진 값이 들어와도 무시).
const SORTABLE_COLUMN_IDS = new Set([
  "index",
  "categories",
  "artist",
  "title",
  "difficulty",
  "proficiency",
]);

function parseStoredSorting(raw: string | null): SortingState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.every(
      (s): s is { id: string; desc: boolean } =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as { id?: unknown }).id === "string" &&
        SORTABLE_COLUMN_IDS.has((s as { id: string }).id) &&
        typeof (s as { desc?: unknown }).desc === "boolean"
    );
    return valid ? (parsed as SortingState) : null;
  } catch {
    return null;
  }
}

export default function MusicSheet({
  songs,
  liveRequestState,
  pricingSettings,
  openSongId,
  editSongId,
  consumedOpenSongId,
  onAutoOpenConsumed,
  persistSortKey,
}: MusicSheetProps) {
  const showLiveAction = Boolean(liveRequestState?.showRequestUI);

  // 현재 로드된 전체 노래에서 필터 선택지(faceted)를 도출.
  const { artistOptions, categoryOptions, difficultyOptions, proficiencyOptions } = useMemo(() => {
    const artistMap = new Map<number, string>();
    const categoryMap = new Map<number, { name: string; color: string }>();
    const difficulties = new Set<number>();
    const proficiencies = new Set<number>();
    for (const song of songs) {
      artistMap.set(song.artist.id, song.artist.name);
      for (const c of song.categories) {
        categoryMap.set(c.id, { name: c.name, color: c.color });
      }
      difficulties.add(song.difficulty ?? 0);
      proficiencies.add(song.proficiency ?? 0);
    }
    return {
      artistOptions: Array.from(artistMap, ([id, name]) => ({ id, name })).sort(
        (a, b) => a.name.localeCompare(b.name, "ko")
      ),
      categoryOptions: Array.from(categoryMap, ([id, v]) => ({
        id,
        name: v.name,
        color: v.color,
      })).sort((a, b) => a.name.localeCompare(b.name, "ko")),
      difficultyOptions: Array.from(difficulties).sort((a, b) => a - b),
      proficiencyOptions: Array.from(proficiencies).sort((a, b) => a - b),
    };
  }, [songs]);

  const columns = useMemo(
    () =>
      createMusicSheetColumns({
        showLiveAction,
        liveRequestState,
        artistOptions,
        categoryOptions,
        difficultyOptions,
        proficiencyOptions,
      }),
    [
      showLiveAction,
      liveRequestState,
      artistOptions,
      categoryOptions,
      difficultyOptions,
      proficiencyOptions,
    ]
  );

  // 정렬 상태 (채널별 영속). SSR/첫 CSR 은 빈 정렬(=서버 정렬 순서)로 시작해
  // hydration mismatch 를 피하고, mount 후 localStorage 에서 복원한다.
  const [sorting, setSorting] = useState<SortingState>([]);

  useEffect(() => {
    if (!persistSortKey) return;
    try {
      const stored = parseStoredSorting(localStorage.getItem(persistSortKey));
      if (stored) setSorting(stored);
    } catch {
      // ignore
    }
  }, [persistSortKey]);

  const handleSortingChange = useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      setSorting((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (persistSortKey) {
          try {
            if (next.length > 0) {
              localStorage.setItem(persistSortKey, JSON.stringify(next));
            } else {
              localStorage.removeItem(persistSortKey);
            }
          } catch {
            // ignore
          }
        }
        return next;
      });
    },
    [persistSortKey]
  );

  // 컬럼 필터는 탐색용이라 세션 한정(영속화하지 않음).
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data: songs,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (song) => String(song.id),
  });

  const rows = table.getRowModel().rows;
  const hasActiveFilters = columnFilters.length > 0;
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  // 외부 wrapper: grid grid-cols-[minmax(0,1fr)] 로 부모 flex-1 의 intrinsic
  // min-width 가 0 이 되도록 contain → 좌측 필터 폭 보존.
  // 중간 wrapper: 2xl 미만에서 overflow-x-auto. 2xl+ 에서만 overflow-visible
  // 로 풀어 thead sticky 를 viewport 기준으로 동작시킨다.
  //   - xl (1280-1535px) 구간에선 좌측 필터(288) + gap(24) + section/카드
  //     padding 까지 빼면 우측 메인 가용폭이 ~886px 로 1060px 테이블보다 작음.
  //     이 구간에서 visible 로 풀면 테이블이 카드 우측으로 시각적 돌출.
  //   - 2xl+ 에선 가용폭이 1060px 를 넉넉히 넘어 visible 로 풀어도 안전.
  //   - overflow-x:auto 는 스펙상 overflow-y 도 auto 로 승격해 sticky
  //     containing block 을 가로채므로 가용폭 부족 구간에선 sticky 포기.
  // thead: 2xl+ 에서만 sticky 활성. 그 미만은 컨테이너가 좁거나 FilterBar
  // (z-30) 와 위치 충돌하므로 비활성화.
  return (
    <>
      {hasActiveFilters && (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            필터 결과{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {rows.length}
            </span>
            곡 / 전체{" "}
            <span className="tabular-nums">{songs.length}</span>곡
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => table.resetColumnFilters()}
          >
            <FilterX className="size-3.5" />
            필터 모두 해제
          </Button>
        </div>
      )}
      <div
        data-testid="music-sheet-wrapper"
        className="mt-4 grid grid-cols-[minmax(0,1fr)]"
      >
        <div className="rounded-lg border border-border bg-background overflow-x-auto 2xl:overflow-visible">
          {/* table-fixed: 컬럼 width 명시값으로 강제 → 긴 제목/가수가 들어와도
              td 가 늘어나 섹션을 넘지 않음. 컬럼 합 = 1180px (live mode 기준) 으로
              min-w-[1180px] 와 일치시켜 항상 일관된 너비 유지. */}
          <table
            data-slot="table"
            className="w-full min-w-[1180px] caption-bottom text-sm table-fixed"
          >
            <TableHeader
              data-testid="music-sheet-thead"
              className="bg-muted/95 backdrop-blur-sm 2xl:sticky 2xl:top-[var(--channel-sticky-top)] 2xl:z-20"
            >
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    // 액션 컬럼 헤더는 sticky right 회귀 가드 testid 부여
                    const testId =
                      header.column.id === "actions"
                        ? "music-sheet-action-head"
                        : undefined;
                    return (
                      <TableHead
                        key={header.id}
                        data-testid={testId}
                        className={meta?.headClassName}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumnCount}
                    className="h-24 text-center text-sm text-muted-foreground"
                  >
                    조건에 맞는 노래가 없습니다
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, visualIndex) => {
                  const shouldAutoOpen = Boolean(
                    openSongId &&
                      row.original.id === openSongId &&
                      consumedOpenSongId !== openSongId
                  );

                  return (
                    <MusicSheetRow
                      key={row.id}
                      row={row}
                      displayNumber={visualIndex + 1}
                      pricingSettings={pricingSettings}
                      liveRequestState={liveRequestState}
                      autoOpen={shouldAutoOpen}
                      autoOpenEdit={
                        shouldAutoOpen && editSongId === row.original.id
                      }
                      onAutoOpenConsumed={() =>
                        onAutoOpenConsumed?.(row.original.id)
                      }
                    />
                  );
                })
              )}
            </TableBody>
          </table>
        </div>
      </div>
    </>
  );
}

interface MusicSheetRowProps {
  row: Row<Song>;
  displayNumber: number;
  pricingSettings?: PricingSettings;
  liveRequestState?: LiveSongRequestState;
  autoOpen: boolean;
  autoOpenEdit: boolean;
  onAutoOpenConsumed: () => void;
}

function MusicSheetRow({
  row,
  displayNumber,
  pricingSettings,
  liveRequestState,
  autoOpen,
  autoOpenEdit,
  onAutoOpenConsumed,
}: MusicSheetRowProps) {
  const username = useChannelIdentifier();
  const song = row.original;
  const [open, setOpen] = useState(false);
  const hasAutoOpenedRef = useRef(false);
  const { copy } = useClipboard();

  const handleOpen = useCallback(async () => {
    setOpen(true);
    const text = `${song.artist.name} - ${song.title}`;
    const ok = await copy(text);
    if (ok) {
      toast.success("클립보드에 복사되었습니다", { description: text });
    } else {
      toast.error("복사에 실패했습니다. 다시 시도해주세요.");
    }
  }, [copy, song.artist.name, song.title]);

  useEffect(() => {
    if (autoOpen && !hasAutoOpenedRef.current) {
      hasAutoOpenedRef.current = true;
      // URL ?songId 진입 시 1회 모달 자동 오픈. MusicCard 동일 패턴.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
      onAutoOpenConsumed();
    }
  }, [autoOpen, onAutoOpenConsumed]);

  return (
    <>
      <TableRow
        id={`channel-song-row-${song.id}`}
        className="cursor-pointer channel-song-card"
        onClick={handleOpen}
      >
        {row.getVisibleCells().map((cell) => {
          const meta = cell.column.columnDef.meta;
          // 액션 컬럼 셀은 sticky right 회귀 가드 testid 부여
          const testId =
            cell.column.id === "actions" ? "music-sheet-action-cell" : undefined;
          // # 컬럼은 현재 보이는 순서(정렬/필터 반영) 기준 번호를 직접 표시.
          const content =
            cell.column.id === "index"
              ? displayNumber
              : flexRender(cell.column.columnDef.cell, cell.getContext());
          return (
            <TableCell
              key={cell.id}
              data-testid={testId}
              className={cn(meta?.cellClassName)}
            >
              {content}
            </TableCell>
          );
        })}
      </TableRow>

      <MusicModal
        open={open}
        setOpen={setOpen}
        song={song}
        user={username}
        liveRequestState={liveRequestState}
        pricingSettings={pricingSettings}
        initialMode={autoOpenEdit ? "edit" : "detail"}
      />
    </>
  );
}
