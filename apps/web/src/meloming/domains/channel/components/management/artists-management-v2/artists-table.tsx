"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
  type OnChangeFn,
} from "@tanstack/react-table";
import type { Artist } from "@/meloming/domains/channel/types/artist";
import { createArtistsTableColumns } from "./artists-table-columns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/meloming/shared/components/ui/table";
import { useMemo } from "react";

interface ArtistsTableProps {
  data: Artist[];
  rowSelection: RowSelectionState;
  onRowSelectionChange: OnChangeFn<RowSelectionState>;
  onEdit: (artist: Artist) => void;
  onDelete: (artist: Artist) => void;
}

export function ArtistsTable({
  data,
  rowSelection,
  onRowSelectionChange,
  onEdit,
  onDelete,
}: ArtistsTableProps) {
  // 컬럼 정의 메모이제이션
  const columns = useMemo(
    () =>
      createArtistsTableColumns({
        onEdit,
        onDelete,
      }),
    [onEdit, onDelete]
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      rowSelection,
    },
    onRowSelectionChange,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
    enableRowSelection: true,
  });

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="bg-muted/50">
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    key={header.id}
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
                {row.getVisibleCells().map((cell) => {
                  return (
                    <TableCell
                      key={cell.id}
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
                아티스트가 없습니다.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
