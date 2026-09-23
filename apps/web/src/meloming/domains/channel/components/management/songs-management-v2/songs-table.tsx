"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
  type RowSelectionState,
  type OnChangeFn,
} from "@tanstack/react-table";
import type { Song } from "@/meloming/domains/channel/types/song";
import type { Category } from "@/meloming/domains/channel/types/category";
import type { Artist } from "@/meloming/domains/channel/types/artist";
import { createSongsTableColumns } from "./songs-table-columns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/meloming/shared/components/ui/table";
import { cn } from "@/meloming/shared/lib/utils";
import { useMemo } from "react";
import { useFeatureFlag } from "@/meloming/shared/hooks/use-feature-flag";

interface SongsTableProps {
  data: Song[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  rowSelection: RowSelectionState;
  onRowSelectionChange: OnChangeFn<RowSelectionState>;
  onEdit: (song: Song) => void;
  onDelete: (song: Song) => void;
  totalCount: number;
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
}

export function SongsTable({
  data,
  sorting,
  onSortingChange,
  rowSelection,
  onRowSelectionChange,
  onEdit,
  onDelete,
  totalCount,
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
}: SongsTableProps) {
  const showSheetMusic = useFeatureFlag("songbookSheetMusic");

  // 컬럼 정의 메모이제이션
  const columns = useMemo(
    () =>
      createSongsTableColumns({
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
      }),
    [
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
    ]
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      rowSelection,
    },
    onSortingChange,
    onRowSelectionChange,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true, // 서버 사이드 정렬
    manualPagination: true, // 서버 사이드 페이지네이션
    getRowId: (row) => String(row.id),
    enableRowSelection: true,
  });

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="bg-muted/50">
              {headerGroup.headers.map((header, index) => {
                // 첫 번째 컬럼(선택)과 두 번째 컬럼(제목)은 고정
                const isPinned = index < 2;

                return (
                  <TableHead
                    key={header.id}
                    className={cn(
                      isPinned && "sticky z-10 bg-muted/50",
                      index === 0 && "left-0",
                      index === 1 && "left-[40px]"
                    )}
                    style={{
                      width: header.getSize(),
                      minWidth: header.getSize(),
                    }}
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
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
                className="hover:bg-muted/30"
              >
                {row.getVisibleCells().map((cell, index) => {
                  // 첫 번째 컬럼(선택)과 두 번째 컬럼(제목)은 고정
                  const isPinned = index < 2;

                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        isPinned && "sticky z-10 bg-background",
                        index === 0 && "left-0",
                        index === 1 && "left-[40px]",
                        row.getIsSelected() && isPinned && "bg-muted"
                      )}
                      style={{
                        width: cell.column.getSize(),
                        minWidth: cell.column.getSize(),
                      }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                노래가 없습니다.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
