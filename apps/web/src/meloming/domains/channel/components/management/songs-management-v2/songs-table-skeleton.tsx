"use client";

import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/meloming/shared/components/ui/table";

interface SongsTableSkeletonProps {
  rowCount?: number;
}

export function SongsTableSkeleton({ rowCount = 10 }: SongsTableSkeletonProps) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            {/* 선택 */}
            <TableHead style={{ width: 40 }}>
              <div className="flex items-center justify-center">
                <Skeleton className="h-4 w-4 rounded" />
              </div>
            </TableHead>
            {/* 제목 */}
            <TableHead style={{ width: 280 }}>
              <Skeleton className="h-4 w-12" />
            </TableHead>
            {/* 가수 */}
            <TableHead style={{ width: 120 }}>
              <Skeleton className="h-4 w-10" />
            </TableHead>
            {/* 카테고리 */}
            <TableHead style={{ width: 180 }}>
              <Skeleton className="h-4 w-16" />
            </TableHead>
            {/* 난이도 */}
            <TableHead style={{ width: 100 }}>
              <Skeleton className="h-4 w-12" />
            </TableHead>
            {/* 등록일 */}
            <TableHead style={{ width: 100 }}>
              <Skeleton className="h-4 w-12" />
            </TableHead>
            {/* 액션 */}
            <TableHead style={{ width: 100 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rowCount }).map((_, index) => (
            <TableRow key={index}>
              {/* 선택 */}
              <TableCell style={{ width: 40 }}>
                <div className="flex items-center justify-center">
                  <Skeleton className="h-4 w-4 rounded" />
                </div>
              </TableCell>
              {/* 제목 (앨범아트 + 텍스트) */}
              <TableCell style={{ width: 280 }}>
                <div className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded flex-shrink-0" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </TableCell>
              {/* 가수 */}
              <TableCell style={{ width: 120 }}>
                <Skeleton className="h-4 w-16" />
              </TableCell>
              {/* 카테고리 */}
              <TableCell style={{ width: 180 }}>
                <div className="flex gap-1">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              </TableCell>
              {/* 난이도 */}
              <TableCell style={{ width: 100 }}>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="w-3.5 h-3.5 rounded-sm" />
                  ))}
                </div>
              </TableCell>
              {/* 등록일 */}
              <TableCell style={{ width: 100 }}>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              {/* 액션 */}
              <TableCell style={{ width: 100 }}>
                <div className="flex items-center gap-1">
                  <Skeleton className="h-8 w-8 rounded" />
                  <Skeleton className="h-8 w-8 rounded" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
