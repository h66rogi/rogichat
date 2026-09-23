'use client';

import { useState, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table';
import { History, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/meloming/shared/components/ui/button';
import { Badge } from '@/meloming/shared/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/meloming/shared/components/ui/table';
import { ManagementHeader } from '@/meloming/domains/channel/components/management/management-header';
import { InlineError } from '@/meloming/shared/components/common/error-boundary';
import { useSessionHistory } from '@/meloming/domains/overlay/hooks/use-session';
import { createSessionHistoryColumns } from './session-history-columns';
import { SessionHistoryDetail } from './session-history-detail';

const PAGE_SIZE = 15;

interface SessionHistoryProps {
  identifier?: string;
  /** 지정 시 URL 대신 이 값으로 선택 세션을 결정 (콘솔 임베드 모드) */
  selectedSessionId?: number | null;
  /** 지정 시 URL 대신 이 콜백으로 세션 선택 변경 */
  onSelectSession?: (sessionId: number | null) => void;
  /** 상세 페이지에서 세션 복원 완료 시 호출 (콘솔에서 탭 전환 등에 사용) */
  onRestored?: () => void;
  /** 컨테이너 padding 제거 (콘솔 임베드용) */
  noPadding?: boolean;
}

export function SessionHistory({
  identifier,
  selectedSessionId: controlledSelectedSessionId,
  onSelectSession,
  onRestored,
  noPadding = false,
}: SessionHistoryProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const isControlled = controlledSelectedSessionId !== undefined;

  const sessionIdParam = searchParams.get('sessionId');
  const parsedFromUrl = sessionIdParam ? Number(sessionIdParam) : null;
  const urlSelectedSessionId =
    parsedFromUrl !== null && Number.isFinite(parsedFromUrl) ? parsedFromUrl : null;

  const selectedSessionId = isControlled
    ? controlledSelectedSessionId ?? null
    : urlSelectedSessionId;

  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useSessionHistory(page, PAGE_SIZE, identifier);

  const sessions = data?.sessions ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const handleViewDetail = useCallback(
    (sessionId: number) => {
      if (onSelectSession) {
        onSelectSession(sessionId);
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set('sessionId', String(sessionId));
      router.push(`${pathname}?${params.toString()}`);
    },
    [onSelectSession, searchParams, router, pathname],
  );

  const handleBack = useCallback(() => {
    if (onSelectSession) {
      onSelectSession(null);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete('sessionId');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [onSelectSession, searchParams, router, pathname]);

  const containerClass = noPadding ? '' : 'p-6';

  const columns = useMemo(
    () => createSessionHistoryColumns(handleViewDetail),
    [handleViewDetail]
  );

  const table = useReactTable({
    data: sessions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getRowId: (row) => String(row.id),
  });

  // Detail view
  if (selectedSessionId) {
    return (
      <div className={containerClass}>
        <SessionHistoryDetail
          sessionId={selectedSessionId}
          identifier={identifier}
          onBack={handleBack}
          onRestored={onRestored}
        />
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className={containerClass}>
        <ManagementHeader
          title="신청곡 기록"
          description="과거 신청곡 세션 기록을 조회합니다."
          icon={History}
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className={containerClass}>
        <ManagementHeader
          title="신청곡 기록"
          description="과거 신청곡 세션 기록을 조회합니다."
          icon={History}
        />
        <InlineError
          message="신청곡 기록을 불러오는데 실패했습니다."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const getPageNumbers = (): (number | '...')[] => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push('...');
      if (totalPages > 1) pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className={containerClass}>
      <ManagementHeader
        title="신청곡 기록"
        description="과거 신청곡 세션 기록을 조회합니다."
        icon={History}
      >
        {pagination && pagination.total > 0 && (
          <Badge variant="secondary">총 {pagination.total}회</Badge>
        )}
      </ManagementHeader>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <History className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2 paperlogy">
            아직 신청곡 기록이 없습니다
          </h3>
          <p className="text-muted-foreground text-center">
            신청곡 모드를 진행하면 여기에 기록이 남아요.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="bg-muted/50">
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        style={{
                          width: header.getSize(),
                          minWidth: header.getSize(),
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => handleViewDetail(row.original.id)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          style={{
                            width: cell.column.getSize(),
                            minWidth: cell.column.getSize(),
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 text-center">
                      신청곡 기록이 없습니다.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-4">
              <div className="text-sm text-muted-foreground">
                총 {pagination!.total.toLocaleString()}개 중{' '}
                {((page - 1) * PAGE_SIZE + 1).toLocaleString()}-
                {Math.min(page * PAGE_SIZE, pagination!.total).toLocaleString()}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {getPageNumbers().map((p, idx) =>
                  p === '...' ? (
                    <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">
                      ...
                    </span>
                  ) : (
                    <Button
                      key={p}
                      variant={page === p ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  )
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
