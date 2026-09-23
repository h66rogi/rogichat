import { createColumnHelper } from "@tanstack/react-table";
import type { Song, SongCategory } from "@/meloming/domains/channel/types/song";
import type { Category } from "@/meloming/domains/channel/types/category";
import type { Artist } from "@/meloming/domains/channel/types/artist";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import { Checkbox } from "@/meloming/shared/components/ui/checkbox";
import {
  Pencil,
  Trash2,
  MusicIcon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  ListFilter,
  FileMusic,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/meloming/shared/components/ui/tooltip";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import StarList from "@/meloming/domains/channel/components/musicbook/star-list";
import dayjs from "dayjs";
import type { Column } from "@tanstack/react-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/meloming/shared/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import { Input } from "@/meloming/shared/components/ui/input";
import { ScrollArea } from "@/meloming/shared/components/ui/scroll-area";
import { useState } from "react";

const columnHelper = createColumnHelper<Song>();

// 정렬 헤더 컴포넌트
function SortableHeader({
  column,
  children,
}: {
  column: Column<Song>;
  children: React.ReactNode;
}) {
  const isSorted = column.getIsSorted();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 hover:bg-transparent"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {children}
      {isSorted === "desc" ? (
        <ArrowDown className="ml-1 h-4 w-4" />
      ) : isSorted === "asc" ? (
        <ArrowUp className="ml-1 h-4 w-4" />
      ) : (
        <ArrowUpDown className="ml-1 h-4 w-4 text-muted-foreground" />
      )}
    </Button>
  );
}

// 기본 앨범아트 컴포넌트
function DefaultAlbumArt() {
  return (
    <div className="w-10 h-10 bg-muted flex items-center justify-center rounded">
      <MusicIcon className="w-5 h-5 text-muted-foreground" />
    </div>
  );
}

// 카테고리 필터 헤더
function CategoryFilterHeader({
  categories,
  selectedCategoryId,
  onSelect,
}: {
  categories: Category[] | undefined;
  selectedCategoryId: string | null;
  onSelect: (id: string | undefined) => void;
}) {
  const [search, setSearch] = useState("");
  const selectedCategory = categories?.find(
    (c) => c.id.toString() === selectedCategoryId
  );

  const filteredCategories = categories?.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 hover:bg-transparent"
        >
          카테고리
          {selectedCategory ? (
            <Badge
              variant="default"
              className="ml-2 text-xs"
              style={{
                backgroundColor: selectedCategory.color,
                color: getContrastingTextColor(selectedCategory.color),
              }}
            >
              {selectedCategory.name}
            </Badge>
          ) : (
            <ListFilter className="ml-1 h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <Input
          placeholder="카테고리 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 mb-2"
        />
        <ScrollArea className="h-48">
          <div className="space-y-1">
            <Button
              variant={!selectedCategoryId ? "secondary" : "ghost"}
              size="sm"
              className="w-full justify-start h-8"
              onClick={() => {
                onSelect(undefined);
                setSearch("");
              }}
            >
              전체
            </Button>
            {filteredCategories?.map((category) => (
              <Button
                key={category.id}
                variant={
                  selectedCategoryId === category.id.toString()
                    ? "secondary"
                    : "ghost"
                }
                size="sm"
                className="w-full justify-start h-8"
                onClick={() => {
                  onSelect(category.id.toString());
                  setSearch("");
                }}
              >
                <span
                  className="w-2 h-2 rounded-full mr-2"
                  style={{ backgroundColor: category.color }}
                />
                {category.name}
                {category.songCount !== undefined && (
                  <span className="ml-auto text-muted-foreground text-xs">
                    {category.songCount}
                  </span>
                )}
              </Button>
            ))}
          </div>
        </ScrollArea>
        {selectedCategoryId && (
          <>
            <DropdownMenuSeparator className="my-2" />
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center h-8 text-muted-foreground"
              onClick={() => {
                onSelect(undefined);
                setSearch("");
              }}
            >
              <X className="w-3 h-3 mr-1" />
              필터 해제
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// 가수 필터 헤더
function ArtistFilterHeader({
  artists,
  selectedArtistId,
  onSelect,
}: {
  artists: Artist[] | undefined;
  selectedArtistId: string | null;
  onSelect: (id: string | undefined) => void;
}) {
  const [search, setSearch] = useState("");
  const selectedArtist = artists?.find(
    (a) => a.id.toString() === selectedArtistId
  );

  const filteredArtists = artists?.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 hover:bg-transparent"
        >
          가수
          {selectedArtist ? (
            <Badge variant="secondary" className="ml-2 text-xs">
              {selectedArtist.name}
            </Badge>
          ) : (
            <ListFilter className="ml-1 h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <Input
          placeholder="가수 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 mb-2"
        />
        <ScrollArea className="h-48">
          <div className="space-y-1">
            <Button
              variant={!selectedArtistId ? "secondary" : "ghost"}
              size="sm"
              className="w-full justify-start h-8"
              onClick={() => {
                onSelect(undefined);
                setSearch("");
              }}
            >
              전체
            </Button>
            {filteredArtists?.map((artist) => (
              <Button
                key={artist.id}
                variant={
                  selectedArtistId === artist.id.toString()
                    ? "secondary"
                    : "ghost"
                }
                size="sm"
                className="w-full justify-start h-8"
                onClick={() => {
                  onSelect(artist.id.toString());
                  setSearch("");
                }}
              >
                {artist.name}
                {artist.songCount !== undefined && (
                  <span className="ml-auto text-muted-foreground text-xs">
                    {artist.songCount}
                  </span>
                )}
              </Button>
            ))}
          </div>
        </ScrollArea>
        {selectedArtistId && (
          <>
            <DropdownMenuSeparator className="my-2" />
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center h-8 text-muted-foreground"
              onClick={() => {
                onSelect(undefined);
                setSearch("");
              }}
            >
              <X className="w-3 h-3 mr-1" />
              필터 해제
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// 난이도 필터 헤더
function DifficultyFilterHeader({
  selectedDifficulty,
  onSelect,
}: {
  selectedDifficulty: string | null;
  onSelect: (difficulty: string | undefined) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 hover:bg-transparent"
        >
          난이도
          {selectedDifficulty ? (
            <Badge variant="secondary" className="ml-2 text-xs">
              {selectedDifficulty}
            </Badge>
          ) : (
            <ListFilter className="ml-1 h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => onSelect(undefined)}>
          전체
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {[1, 2, 3, 4, 5].map((level) => (
          <DropdownMenuItem
            key={level}
            onClick={() => onSelect(level.toString())}
          >
            <StarList star={level} size={12} />
          </DropdownMenuItem>
        ))}
        {selectedDifficulty && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onSelect(undefined)}
              className="text-muted-foreground justify-center"
            >
              <X className="w-3 h-3 mr-1" />
              필터 해제
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ColumnOptions {
  onEdit: (song: Song) => void;
  onDelete: (song: Song) => void;
  // 필터 관련
  categories?: Category[];
  artists?: Artist[];
  selectedCategoryId: string | null;
  selectedArtistId: string | null;
  selectedDifficulty: string | null;
  onCategoryChange: (id: string | undefined) => void;
  onArtistChange: (id: string | undefined) => void;
  onDifficultyChange: (difficulty: string | undefined) => void;
  showPrice: boolean;
  currencyUnit: string;
  currencyConfigs?: Array<{ key: string; unit: string }>;
  showSheetMusic: boolean;
}

function formatSongManualPrice(
  song: Song,
  currencyUnit: string,
  currencyConfigs?: Array<{ key: string; unit: string }>
): string | null {
  const currencyPrices = song.currencyPrices ?? null;
  const configs = currencyConfigs ?? [];

  if (currencyPrices && Object.keys(currencyPrices).length > 0) {
    const byConfigOrder = configs
      .map((config) => {
        const amount = currencyPrices[config.key];
        if (amount == null) {
          return null;
        }
        return `${amount.toLocaleString()} ${config.unit}`;
      })
      .filter((value): value is string => Boolean(value));

    if (byConfigOrder.length > 0) {
      return byConfigOrder.join(" / ");
    }

    const fallback = Object.entries(currencyPrices)
      .map(([key, amount]) => {
        if (amount == null) {
          return null;
        }
        return `${amount.toLocaleString()} ${key}`;
      })
      .filter((value): value is string => Boolean(value));

    if (fallback.length > 0) {
      return fallback.join(" / ");
    }
  }

  if (song.price != null) {
    return `${song.price.toLocaleString()}${currencyUnit ? ` ${currencyUnit}` : ""}`;
  }

  return null;
}

export const createSongsTableColumns = ({
  onEdit,
  onDelete,
  categories,
  artists,
  selectedCategoryId,
  selectedArtistId,
  selectedDifficulty,
  onCategoryChange,
  onArtistChange,
  onDifficultyChange,
  showPrice,
  currencyUnit,
  currencyConfigs,
  showSheetMusic,
}: ColumnOptions) => [
  // 선택 체크박스
  columnHelper.display({
    id: "select",
    size: 40,
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="전체 선택"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="행 선택"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  }),

  // 제목 (앨범아트 + 제목)
  columnHelper.accessor("title", {
    size: 280,
    header: () => <span className="font-medium">제목</span>,
    cell: ({ row }) => {
      const song = row.original;
      return (
        <div className="flex items-center gap-3">
          {song.albumArt ? (
            <img
              src={song.albumArt}
              alt={song.title}
              className="w-10 h-10 rounded object-cover flex-shrink-0"
            />
          ) : (
            <DefaultAlbumArt />
          )}
          <div className="font-medium truncate max-w-[200px]">
            {song.title}
          </div>
        </div>
      );
    },
    enableSorting: false,
  }),

  // 가수 (필터 전용 - 셀에서는 이미 제목에 포함)
  columnHelper.display({
    id: "artist",
    size: 120,
    header: () => (
      <ArtistFilterHeader
        artists={artists}
        selectedArtistId={selectedArtistId}
        onSelect={onArtistChange}
      />
    ),
    cell: ({ row }) => {
      const song = row.original;
      return (
        <span className="text-sm text-muted-foreground">
          {song.artist?.name}
        </span>
      );
    },
    enableSorting: false,
  }),

  // 카테고리
  columnHelper.accessor("categories", {
    size: 180,
    header: () => (
      <CategoryFilterHeader
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        onSelect={onCategoryChange}
      />
    ),
    cell: ({ getValue }) => {
      const categories = getValue() as SongCategory[];
      if (!categories || categories.length === 0) {
        return <span className="text-muted-foreground">-</span>;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {categories.slice(0, 2).map((category) => (
            <Badge
              key={category.id}
              variant="default"
              className="text-xs"
              style={{
                backgroundColor: category.color,
                color: getContrastingTextColor(category.color),
              }}
            >
              {category.name}
            </Badge>
          ))}
          {categories.length > 2 && (
            <Badge variant="secondary" className="text-xs">
              +{categories.length - 2}
            </Badge>
          )}
        </div>
      );
    },
    enableSorting: false,
  }),

  // 난이도
  columnHelper.accessor("difficulty", {
    size: 100,
    header: () => (
      <DifficultyFilterHeader
        selectedDifficulty={selectedDifficulty}
        onSelect={onDifficultyChange}
      />
    ),
    cell: ({ getValue }) => {
      const difficulty = getValue();
      return <StarList star={difficulty} size={14} />;
    },
    enableSorting: false,
  }),

  columnHelper.accessor("proficiency", {
    size: 100,
    header: () => <span className="font-medium">숙련도</span>,
    cell: ({ getValue }) => {
      const proficiency = getValue();
      return proficiency ? (
        <StarList star={proficiency} size={14} />
      ) : (
        <span className="text-muted-foreground">-</span>
      );
    },
    enableSorting: false,
  }),

  // 곡별 가격 (직접 설정값)
  ...(showPrice
    ? [
        columnHelper.display({
          id: "price",
          size: 120,
          header: () => <span className="font-medium">곡 가격</span>,
          cell: ({ row }) => {
            const label = formatSongManualPrice(
              row.original,
              currencyUnit,
              currencyConfigs
            );
            if (!label) {
              return <span className="text-muted-foreground">자동</span>;
            }
            return <span className="text-sm">{label}</span>;
          },
          enableSorting: false,
        }),
      ]
    : []),

  // 악보 (있음 / 없음 시각 표시. 정렬/필터 미적용)
  // feature flag: songbookSheetMusic OFF면 컬럼 자체를 노출하지 않는다.
  ...(showSheetMusic
    ? [
        columnHelper.display({
          id: "sheetMusic",
          size: 56,
          header: () => (
            <span className="font-medium text-xs text-muted-foreground">악보</span>
          ),
          cell: ({ row }) => {
            const hasSheetMusic = Boolean(row.original.sheetMusicUrl);
            if (!hasSheetMusic) {
              return (
                <span aria-label="악보 없음" className="text-muted-foreground/30">
                  <FileMusic className="h-4 w-4" />
                </span>
              );
            }
            return (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span aria-label="악보 있음" className="text-foreground/80 inline-flex">
                      <FileMusic className="h-4 w-4" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>악보 있음</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          },
          enableSorting: false,
        }),
      ]
    : []),

  // 등록일
  columnHelper.accessor("createdAt", {
    size: 100,
    header: ({ column }) => (
      <SortableHeader column={column}>등록일</SortableHeader>
    ),
    cell: ({ getValue }) => {
      const date = getValue();
      return (
        <span className="text-sm text-muted-foreground">
          {dayjs(date).format("YYYY.MM.DD")}
        </span>
      );
    },
    enableSorting: true,
  }),

  // 액션
  columnHelper.display({
    id: "actions",
    size: 100,
    header: "",
    cell: ({ row }) => {
      const song = row.original;
      return (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(song);
            }}
          >
            <Pencil className="h-4 w-4" />
            <span className="sr-only">수정</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(song);
            }}
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">삭제</span>
          </Button>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  }),
];
