'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Eye } from 'lucide-react';
import { Badge } from '@/meloming/shared/components/ui/badge';
import { Button } from '@/meloming/shared/components/ui/button';
import type { SessionHistoryItem } from '@/meloming/domains/overlay/apis/session';
import { PLATFORM_NAMES, formatSessionDuration, formatDonationAmount } from '@/meloming/domains/overlay/utils/session-format';

const columnHelper = createColumnHelper<SessionHistoryItem>();

export function createSessionHistoryColumns(
  onViewDetail: (sessionId: number) => void
) {
  return [
    columnHelper.accessor('startedAt', {
      size: 160,
      header: () => <span className="font-medium">날짜</span>,
      cell: ({ getValue }) => {
        const date = new Date(getValue());
        return (
          <div>
            <div className="font-medium text-sm">
              {format(date, 'yyyy.MM.dd (EEE)', { locale: ko })}
            </div>
            <div className="text-xs text-muted-foreground">
              {format(date, 'HH:mm')}
            </div>
          </div>
        );
      },
      enableSorting: false,
    }),

    columnHelper.accessor('platform', {
      size: 80,
      header: () => <span className="font-medium">플랫폼</span>,
      cell: ({ getValue }) => (
        <Badge variant="outline">
          {PLATFORM_NAMES[getValue()] || getValue()}
        </Badge>
      ),
      enableSorting: false,
    }),

    columnHelper.accessor('duration', {
      size: 80,
      header: () => <span className="font-medium">시간</span>,
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">
          {formatSessionDuration(getValue())}
        </span>
      ),
      enableSorting: false,
    }),

    columnHelper.display({
      id: 'totalRequests',
      size: 70,
      header: () => <span className="font-medium">신청</span>,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.stats.totalRequests}곡
        </span>
      ),
      enableSorting: false,
    }),

    columnHelper.display({
      id: 'completedCount',
      size: 70,
      header: () => <span className="font-medium">완료</span>,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-green-600">
          {row.original.stats.completedCount}곡
        </span>
      ),
      enableSorting: false,
    }),

    columnHelper.display({
      id: 'rejectedCount',
      size: 70,
      header: () => <span className="font-medium">거절</span>,
      cell: ({ row }) => {
        const count = row.original.stats.rejectedCount;
        if (count === 0) return <span className="text-sm text-muted-foreground">-</span>;
        return (
          <span className="text-sm tabular-nums text-red-600">
            {count}곡
          </span>
        );
      },
      enableSorting: false,
    }),

    columnHelper.display({
      id: 'totalDonation',
      size: 100,
      header: () => <span className="font-medium">후원</span>,
      cell: ({ row }) => {
        const amount = row.original.stats.totalDonation;
        if (amount === 0) return <span className="text-sm text-muted-foreground">-</span>;
        return (
          <span className="text-sm tabular-nums text-yellow-600 font-medium">
            {formatDonationAmount(amount)}
          </span>
        );
      },
      enableSorting: false,
    }),

    columnHelper.display({
      id: 'actions',
      size: 50,
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onViewDetail(row.original.id);
            }}
          >
            <Eye className="h-4 w-4" />
            <span className="sr-only">상세보기</span>
          </Button>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    }),
  ];
}
