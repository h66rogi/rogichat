"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
  type OnChangeFn,
} from "@tanstack/react-table";
import type { Category } from "@/meloming/domains/channel/types/category";
import { createCategoriesTableColumns } from "./categories-table-columns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/meloming/shared/components/ui/table";
import { useMemo } from "react";

interface CategoriesTableProps {
  data: Category[];
  rowSelection: RowSelectionState;
  onRowSelectionChange: OnChangeFn<RowSelectionState>;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  onMoveUp: (category: Category) => void;
  onMoveDown: (category: Category) => void;
  showPrice: boolean;
  currencyUnit: string;
  currencyConfigs?: Array<{ key: string; unit: string }>;
}

export function CategoriesTable({
  data,
  rowSelection,
  onRowSelectionChange,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  showPrice,
  currencyUnit,
  currencyConfigs,
}: CategoriesTableProps) {
  // 첫 번째/마지막 체크 함수
  const isFirst = (category: Category) => {
    return data.length > 0 && data[0].id === category.id;
  };

  const isLast = (category: Category) => {
    return data.length > 0 && data[data.length - 1].id === category.id;
  };

  // 컬럼 정의 메모이제이션
  const columns = useMemo(
    () =>
      createCategoriesTableColumns({
        onEdit,
        onDelete,
        onMoveUp,
        onMoveDown,
        isFirst,
        isLast,
        showPrice,
        currencyUnit,
        currencyConfigs,
      }),
    [
      onEdit,
      onDelete,
      onMoveUp,
      onMoveDown,
      data,
      showPrice,
      currencyUnit,
      currencyConfigs,
    ]
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
                카테고리가 없습니다.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
