"use client";

import {
  type Column,
  type ColumnDef,
  type FilterFn,
  type SortingFn,
} from "@tanstack/react-table";
import Link from "next/link";
import {
  Heart,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ListFilter,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useParams } from "next/navigation";

import type { Song, SongCategory } from "@/meloming/domains/channel/types/song";
import type { LiveSongRequestState } from "@/meloming/domains/channel/types/live-song-request";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import { Checkbox } from "@/meloming/shared/components/ui/checkbox";
import { Input } from "@/meloming/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/meloming/shared/components/ui/command";
import StarList from "@/meloming/domains/channel/components/musicbook/star-list";
import { cn, getContrastingTextColor } from "@/meloming/shared/lib/utils";
import { LiveSongRequestButton } from "@/meloming/domains/channel/components/live-song-request-button";
import LoginRequiredDialog from "@/meloming/shared/components/common/login-required-dialog";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import {
  useToggleFavoriteSong,
  useUnfavoriteSong,
  favoritesKeys,
} from "@/meloming/domains/channel/hooks/use-favorites";
import { songsKeys } from "@/meloming/domains/channel/hooks/use-songs";

// 컬럼별 className 을 ColumnDef.meta 에 실어 useReactTable 의 flexRender 사용처
// (헤더/셀)에서 그대로 적용. Tailwind shadcn TableHead/TableCell 의 className
// prop 으로 전달하기 위함.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    headClassName?: string;
    cellClassName?: string;
  }
}

// --- 정렬/필터용 비교기 (모두 클라이언트 사이드) ---------------------------
// 노래책(시트) 뷰는 채널의 전체 노래를 한 번에 로드하므로(엑셀 모드) 정렬·필터를
// 클라이언트에서 수행한다. 백엔드는 카테고리(M2M)·난이도 정렬을 지원하지 않고
// 한글 가나다 정렬도 로케일 인지가 필요하므로, 5개 컬럼 모두 동일하게
// 클라이언트에서 처리해 일관성을 보장한다.
const koCompare = (a: string, b: string) => a.localeCompare(b, "ko");

const primaryCategoryName = (song: Song): string =>
  // categories 는 백엔드 sortSongCategories 순서를 그대로 받으므로 [0] 이 대표.
  song.categories[0]?.name ?? "";

const sortByCategory: SortingFn<Song> = (a, b) =>
  koCompare(primaryCategoryName(a.original), primaryCategoryName(b.original));

const sortByArtist: SortingFn<Song> = (a, b) =>
  koCompare(a.original.artist.name, b.original.artist.name);

const sortByTitle: SortingFn<Song> = (a, b) =>
  koCompare(a.original.title, b.original.title);

const filterByCategory: FilterFn<Song> = (row, _columnId, value) => {
  const ids = value as number[] | undefined;
  if (!ids || ids.length === 0) return true;
  return row.original.categories.some((c) => ids.includes(c.id));
};

const filterByArtist: FilterFn<Song> = (row, _columnId, value) => {
  const ids = value as number[] | undefined;
  if (!ids || ids.length === 0) return true;
  return ids.includes(row.original.artist.id);
};

const filterByDifficulty: FilterFn<Song> = (row, _columnId, value) => {
  const levels = value as number[] | undefined;
  if (!levels || levels.length === 0) return true;
  return levels.includes(row.original.difficulty);
};

const filterByProficiency: FilterFn<Song> = (row, _columnId, value) => {
  const levels = value as number[] | undefined;
  if (!levels || levels.length === 0) return true;
  return levels.includes(row.original.proficiency ?? 0);
};

const filterByTitle: FilterFn<Song> = (row, _columnId, value) => {
  const q = (value as string | undefined)?.trim().toLowerCase();
  if (!q) return true;
  return row.original.title.toLowerCase().includes(q);
};

// --- 헤더 빌딩 블록 --------------------------------------------------------

function SortToggle({
  column,
  label,
}: {
  column: Column<Song>;
  label: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className="inline-flex items-center gap-1 font-medium hover:text-foreground transition-colors"
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="size-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

function FilterTrigger({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} 필터`}
          className={cn(
            "rounded p-0.5 transition-colors hover:bg-muted-foreground/10",
            active
              ? "text-indigo-500"
              : "text-muted-foreground/50 hover:text-muted-foreground"
          )}
        >
          <ListFilter className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        {children}
      </PopoverContent>
    </Popover>
  );
}

interface MultiSelectOption<T extends number> {
  value: T;
  label: string;
  color?: string;
  node?: React.ReactNode;
}

function MultiSelectFilter<T extends number>({
  options,
  selected,
  onChange,
  searchPlaceholder,
}: {
  options: MultiSelectOption<T>[];
  selected: T[];
  onChange: (next: T[] | undefined) => void;
  searchPlaceholder?: string;
}) {
  const toggle = (v: T) => {
    const next = selected.includes(v)
      ? selected.filter((x) => x !== v)
      : [...selected, v];
    onChange(next.length > 0 ? next : undefined);
  };
  return (
    <Command>
      {searchPlaceholder && (
        <CommandInput placeholder={searchPlaceholder} className="h-9" />
      )}
      <CommandList>
        <CommandEmpty>결과가 없습니다</CommandEmpty>
        <CommandGroup>
          {options.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <CommandItem
                key={opt.value}
                value={opt.label}
                onSelect={() => toggle(opt.value)}
                className="gap-2"
              >
                <Checkbox checked={checked} className="pointer-events-none" />
                {opt.color && (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: opt.color }}
                  />
                )}
                <span className="truncate">{opt.node ?? opt.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
      {selected.length > 0 && (
        <div className="border-t p-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-center text-xs"
            onClick={() => onChange(undefined)}
          >
            <X className="size-3" />
            필터 해제
          </Button>
        </div>
      )}
    </Command>
  );
}

function TextFilter({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string | undefined) => void;
  placeholder: string;
}) {
  return (
    <div className="p-2">
      <Input
        autoFocus
        value={value}
        placeholder={placeholder}
        className="h-8"
        onChange={(e) => onChange(e.target.value || undefined)}
      />
      {value && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-7 w-full justify-center text-xs"
          onClick={() => onChange(undefined)}
        >
          <X className="size-3" />
          필터 해제
        </Button>
      )}
    </div>
  );
}

// --- 컬럼 정의 -------------------------------------------------------------

export interface ArtistFilterOption {
  id: number;
  name: string;
}
export interface CategoryFilterOption {
  id: number;
  name: string;
  color: string;
}

export interface CreateMusicSheetColumnsContext {
  showLiveAction: boolean;
  liveRequestState?: LiveSongRequestState;
  // 현재 로드된 노래들에서 도출한 필터 선택지 (faceted)
  artistOptions: ArtistFilterOption[];
  categoryOptions: CategoryFilterOption[];
  difficultyOptions: number[]; // 존재하는 난이도 값 (0 = 미설정 포함)
  proficiencyOptions: number[]; // 존재하는 숙련도 값 (0 = 미설정 포함)
}

export function createMusicSheetColumns(
  ctx: CreateMusicSheetColumnsContext
): ColumnDef<Song>[] {
  const {
    showLiveAction,
    liveRequestState,
    artistOptions,
    categoryOptions,
    difficultyOptions,
    proficiencyOptions,
  } = ctx;

  const createRatingColumn = ({
    id,
    label,
    options,
    tone,
    filterFn,
  }: {
    id: "difficulty" | "proficiency";
    label: string;
    options: number[];
    tone: "yellow" | "green";
    filterFn: FilterFn<Song>;
  }): ColumnDef<Song> => ({
    id,
    accessorKey: id,
    sortingFn: "basic",
    filterFn,
    header: ({ column }) => {
      const selected = (column.getFilterValue() as number[]) ?? [];
      return (
        <div className="flex items-center justify-between gap-1">
          <SortToggle column={column} label={label} />
          <FilterTrigger label={label} active={selected.length > 0}>
            <MultiSelectFilter
              options={options.map((level) => ({
                value: level,
                label: level === 0 ? "미설정" : `${label} ${level}`,
                node:
                  level === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      미설정
                    </span>
                  ) : (
                    <StarList star={level} size={12} tone={tone} />
                  ),
              }))}
              selected={selected}
              onChange={(v) => column.setFilterValue(v)}
            />
          </FilterTrigger>
        </div>
      );
    },
    cell: ({ getValue }) => {
      const level = getValue<number | null>();
      return level && level > 0 ? (
        <StarList star={level} size={12} tone={tone} />
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      );
    },
    meta: { headClassName: "w-[120px] text-xs" },
  });

  // 컬럼 width 합 = 1180px, min-w-[1180px] 와 일치.
  // table-fixed 와 결합해 컨텐츠 길이로 td 가 늘어나 섹션을 넘는 현상 방지.
  // - live   : 48 + 150 + 150 + 448 + 120 + 120 + 144 = 1180
  // - no-live: 48 + 150 + 150 + 532 + 120 + 120 +  60 = 1180 (제목 + 액션 차이 흡수)
  const titleWidth = showLiveAction ? "w-[448px]" : "w-[532px]";
  const actionWidth = showLiveAction ? "w-[144px]" : "w-[60px]";

  return [
    {
      id: "index",
      // 표시 번호는 현재 보이는 순서(정렬/필터 반영)대로 music-sheet 의 row
      // 매핑에서 직접 주입한다(displayNumber). 정렬/필터 대상 아님.
      enableSorting: false,
      enableColumnFilter: false,
      header: "#",
      cell: ({ row }) => row.index + 1,
      meta: {
        headClassName: "w-[48px] text-xs text-muted-foreground",
        cellClassName:
          "text-center text-xs text-muted-foreground tabular-nums",
      },
    },
    {
      id: "categories",
      // accessorFn 이 있어야 TanStack 이 정렬 가능(getCanSort 는 sortingFn 이
      // 아니라 accessorFn 유무로 판단). 대표 카테고리명을 정렬 키로 노출.
      accessorFn: (song) => primaryCategoryName(song),
      sortingFn: sortByCategory,
      filterFn: filterByCategory,
      header: ({ column }) => {
        const selected = (column.getFilterValue() as number[]) ?? [];
        return (
          <div className="flex items-center justify-between gap-1">
            <SortToggle column={column} label="카테고리" />
            <FilterTrigger label="카테고리" active={selected.length > 0}>
              <MultiSelectFilter
                options={categoryOptions.map((c) => ({
                  value: c.id,
                  label: c.name,
                  color: c.color,
                }))}
                selected={selected}
                onChange={(v) => column.setFilterValue(v)}
                searchPlaceholder="카테고리 검색"
              />
            </FilterTrigger>
          </div>
        );
      },
      cell: ({ row }) => <CategoryCell song={row.original} />,
      meta: { headClassName: "w-[150px] text-xs" },
    },
    {
      id: "artist",
      accessorFn: (song) => song.artist.name,
      sortingFn: sortByArtist,
      filterFn: filterByArtist,
      header: ({ column }) => {
        const selected = (column.getFilterValue() as number[]) ?? [];
        return (
          <div className="flex items-center justify-between gap-1">
            <SortToggle column={column} label="가수" />
            <FilterTrigger label="가수" active={selected.length > 0}>
              <MultiSelectFilter
                options={artistOptions.map((a) => ({
                  value: a.id,
                  label: a.name,
                }))}
                selected={selected}
                onChange={(v) => column.setFilterValue(v)}
                searchPlaceholder="가수 검색"
              />
            </FilterTrigger>
          </div>
        );
      },
      cell: ({ getValue }) => {
        const name = getValue<string>();
        return (
          <div className="truncate" title={name}>
            {name}
          </div>
        );
      },
      meta: {
        headClassName: "w-[150px] text-xs",
        cellClassName: "text-sm channel-song-artist",
      },
    },
    {
      id: "title",
      accessorKey: "title",
      sortingFn: sortByTitle,
      filterFn: filterByTitle,
      header: ({ column }) => {
        const value = (column.getFilterValue() as string) ?? "";
        return (
          <div className="flex items-center justify-between gap-1">
            <SortToggle column={column} label="제목" />
            <FilterTrigger label="제목" active={Boolean(value)}>
              <TextFilter
                value={value}
                onChange={(v) => column.setFilterValue(v)}
                placeholder="제목 검색"
              />
            </FilterTrigger>
          </div>
        );
      },
      cell: ({ row }) => <TitleCell song={row.original} />,
      meta: {
        headClassName: clsx(titleWidth, "text-xs"),
        cellClassName: "font-medium channel-song-title",
      },
    },
    createRatingColumn({
      id: "difficulty",
      label: "난이도",
      options: difficultyOptions,
      tone: "yellow",
      filterFn: filterByDifficulty,
    }),
    createRatingColumn({
      id: "proficiency",
      label: "숙련도",
      options: proficiencyOptions,
      tone: "green",
      filterFn: filterByProficiency,
    }),
    {
      id: "actions",
      header: "액션",
      enableSorting: false,
      enableColumnFilter: false,
      cell: ({ row }) => (
        <ActionCell
          song={row.original}
          showLiveAction={showLiveAction}
          liveRequestState={liveRequestState}
        />
      ),
      meta: {
        headClassName: clsx(
          actionWidth,
          "text-xs text-right sticky right-0 z-20 bg-muted/95 backdrop-blur-sm shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]"
        ),
        cellClassName:
          "text-right sticky right-0 z-10 bg-background shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)] [tr:hover>&]:bg-muted/50",
      },
    },
  ];
}

// --- Sub-cells ----------------------------------------------------------

function CategoryCell({ song }: { song: Song }) {
  const visible = song.categories.slice(0, 2);
  const remaining = song.categories.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1 max-w-36">
      {visible.map((c: SongCategory) => (
        <Badge
          key={c.id}
          variant="default"
          className="text-[10px] px-1.5 py-0 select-none channel-song-category"
          style={{
            backgroundColor: c.color,
            color: getContrastingTextColor(c.color),
          }}
        >
          {c.name}
        </Badge>
      ))}
      {remaining > 0 && (
        <span className="text-[10px] text-muted-foreground">+{remaining}</span>
      )}
    </div>
  );
}

function TitleCell({ song }: { song: Song }) {
  const href =
    typeof song.globalSongId === "number" ? `/song/${song.globalSongId}` : null;
  if (href) {
    return (
      <Link
        href={href}
        onClick={(e) => e.stopPropagation()}
        className="hover:underline truncate block"
        title={song.title}
      >
        {song.title}
      </Link>
    );
  }
  return (
    <div className="truncate" title={song.title}>
      {song.title}
    </div>
  );
}

function ActionCell({
  song,
  showLiveAction,
  liveRequestState,
}: {
  song: Song;
  showLiveAction: boolean;
  liveRequestState?: LiveSongRequestState;
}) {
  const queryClient = useQueryClient();
  const { user } = useParams();
  const userParam = Array.isArray(user) ? user[0] : user;
  const username = userParam || "";
  const { isAuthenticated } = useAuth();
  const toggleFavoriteSong = useToggleFavoriteSong();
  const unFavoriteSong = useUnfavoriteSong();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [isFavoriteLocal, setIsFavoriteLocal] = useState<boolean>(
    Boolean(song.isFavorite)
  );

  useEffect(() => {
    // 부모 prop 변경(refetch) 을 optimistic 로컬 상태에 동기화. MusicCard 동일 패턴.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsFavoriteLocal(Boolean(song.isFavorite));
  }, [song.isFavorite]);

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      setLoginDialogOpen(true);
      return;
    }
    const isUnfavorite = Boolean(isFavoriteLocal);
    try {
      setIsFavoriteLocal(!isUnfavorite);
      if (isUnfavorite) {
        await unFavoriteSong.mutateAsync({ songId: song.id });
      } else {
        await toggleFavoriteSong.mutateAsync({ songId: song.id });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: favoritesKeys.songs() }),
        queryClient.invalidateQueries({
          queryKey: favoritesKeys.songStatus(song.id),
        }),
        queryClient.invalidateQueries({
          queryKey: favoritesKeys.songCount(song.id),
        }),
        queryClient.invalidateQueries({ queryKey: favoritesKeys.stats() }),
        ...(username
          ? [
              queryClient.invalidateQueries({
                queryKey: songsKeys.publicUser(username),
              }),
            ]
          : []),
      ]);
    } catch (error) {
      console.error("favorite toggle failed:", error);
      toast.error("즐겨찾기 처리에 실패했습니다. 다시 시도해주세요.");
      setIsFavoriteLocal(Boolean(song.isFavorite));
    }
  };

  return (
    <div
      className="flex items-center justify-end gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      {showLiveAction && liveRequestState && (
        <LiveSongRequestButton
          song={song}
          requestState={liveRequestState}
          size="sm"
          variant="default"
          className="h-7 px-3 text-[11px] font-semibold bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white border-0 shadow-sm shadow-fuchsia-500/25 rounded-full"
        />
      )}
      <button
        type="button"
        aria-label="즐겨찾기"
        onClick={handleToggleFavorite}
        disabled={toggleFavoriteSong.isPending || unFavoriteSong.isPending}
        className="rounded-full p-1.5 hover:bg-muted"
      >
        <Heart
          size={14}
          className={isFavoriteLocal ? "text-red-500" : "text-gray-400"}
          fill={isFavoriteLocal ? "currentColor" : "none"}
        />
      </button>
      <LoginRequiredDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
      />
    </div>
  );
}
