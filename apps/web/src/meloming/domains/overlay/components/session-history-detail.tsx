'use client';

import { useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import {
  ArrowLeft,
  Clock,
  Music,
  CheckCircle2,
  XCircle,
  Coins,
  Loader2,
  AlertCircle,
  RotateCcw,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/meloming/shared/components/ui/button';
import { Badge } from '@/meloming/shared/components/ui/badge';
import { Card, CardContent } from '@/meloming/shared/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/meloming/shared/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/meloming/shared/components/ui/alert-dialog';
import { ManagementHeader } from '@/meloming/domains/channel/components/management/management-header';
import { InlineError } from '@/meloming/shared/components/common/error-boundary';
import {
  useSessionDetail,
  useCloneSession,
} from '@/meloming/domains/overlay/hooks/use-session';
import { PLATFORM_NAMES, formatSessionDuration, formatDonationAmount } from '@/meloming/domains/overlay/utils/session-format';
import { formatDonationAmount as formatDonationAmountFull } from '@/meloming/domains/channel/utils/donation-amount-format';
import { extractApiErrorMessage } from '@/meloming/shared/lib/api-error';

type SessionSongRequest = NonNullable<
  ReturnType<typeof useSessionDetail>['data']
>['songRequests'][number];

interface SessionHistoryDetailProps {
  sessionId: number;
  identifier?: string;
  onBack: () => void;
  /** 지정 시 복원 성공 후 router.push 대신 이 콜백 호출 (콘솔 임베드용) */
  onRestored?: () => void;
}

export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'COMPLETED':
      return (
        <Badge variant="default" className="bg-green-500">
          <CheckCircle2 className="size-3 mr-1" />
          완료
        </Badge>
      );
    case 'REJECTED':
      return (
        <Badge variant="destructive">
          <XCircle className="size-3 mr-1" />
          거절
        </Badge>
      );
    case 'PLAYING':
      return (
        <Badge variant="default" className="bg-blue-500">
          <Music className="size-3 mr-1" />
          재생중
        </Badge>
      );
    case 'PENDING':
      return (
        <Badge variant="secondary">
          <Clock className="size-3 mr-1" />
          대기중
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function SessionHistoryDetail({ sessionId, identifier, onBack, onRestored }: SessionHistoryDetailProps) {
  const router = useRouter();
  const params = useParams();
  const user = params?.user as string;

  const { data: session, isLoading, error, refetch } = useSessionDetail(sessionId);
  const cloneSessionMutation = useCloneSession(identifier);
  const [isRestarting, setIsRestarting] = useState(false);
  const requestColumns = useMemo<ColumnDef<SessionSongRequest>[]>(
    () => [
      {
        id: 'index',
        header: '#',
        cell: ({ row }) => row.index + 1,
      },
      {
        id: 'song',
        header: '곡 정보',
        cell: ({ row }) => {
          const req = row.original;
          return (
            <div className="flex items-center gap-3">
              {req.albumArt ? (
                <img
                  src={req.albumArt}
                  alt={req.title}
                  className="size-10 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded bg-muted">
                  <Music className="size-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate font-medium">{req.title}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {req.artist}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: 'requester',
        header: '신청자',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.requester}
          </span>
        ),
      },
      {
        id: 'status',
        header: '상태',
        cell: ({ row }) => (
          <>
            <StatusBadge status={row.original.status} />
            {row.original.rejectionReason && (
              <div
                className="mt-1 max-w-[120px] truncate text-xs text-muted-foreground"
                title={row.original.rejectionReason}
              >
                {row.original.rejectionReason}
              </div>
            )}
          </>
        ),
      },
      {
        id: 'donation',
        header: '후원',
        cell: ({ row }) => {
          const req = row.original;
          const donationDisplay = formatDonationAmountFull({
            nativeAmount: req.donationNativeAmount,
            currency: req.donationCurrency,
            krwSnapshot: req.donationAmount,
          });
          return donationDisplay ? (
            <span className="flex items-center justify-end gap-1 text-sm font-medium text-yellow-600">
              <Coins className="size-3" />
              {donationDisplay}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          );
        },
      },
    ],
    [],
  );
  const requestTable = useReactTable({
    data: session?.songRequests ?? [],
    columns: requestColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const handleRestart = async () => {
    if (!session) return;

    setIsRestarting(true);
    try {
      await cloneSessionMutation.mutateAsync(session.id);
      toast.success('이전 세션이 그대로 복원되었습니다.');
      if (onRestored) {
        onRestored();
      } else {
        router.push(`/channel/${user}/manage/console`);
      }
    } catch (err: unknown) {
      const message = extractApiErrorMessage(err, '');
      if (message?.includes('활성화된')) {
        toast.error('이미 진행 중인 세션이 있습니다. 먼저 종료해주세요.');
      } else {
        toast.error('세션 복원에 실패했습니다.');
      }
    } finally {
      setIsRestarting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <>
        <ManagementHeader title="신청곡 기록 상세" icon={FileText}>
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
            <ArrowLeft className="size-4" />
            목록으로
          </Button>
        </ManagementHeader>
        <InlineError
          message="신청곡 기록을 불러오는데 실패했습니다."
          onRetry={() => refetch()}
        />
      </>
    );
  }

  const startDate = new Date(session.startedAt);
  const completionRate = session.stats.totalRequests > 0
    ? Math.round((session.stats.completedCount / session.stats.totalRequests) * 100)
    : 0;

  const headerDescription = [
    PLATFORM_NAMES[session.platform] || session.platform,
    format(startDate, 'yyyy년 M월 d일 (EEE) HH:mm', { locale: ko }),
    session.duration != null ? formatSessionDuration(session.duration) : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <ManagementHeader
        title="신청곡 기록 상세"
        description={headerDescription}
        icon={FileText}
      >
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="size-4" />
          목록으로
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" className="gap-1.5" disabled={isRestarting}>
              {isRestarting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              이 세션 그대로 복원
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>세션을 복원할까요?</AlertDialogTitle>
              <AlertDialogDescription>
                {PLATFORM_NAMES[session.platform] || session.platform} 플랫폼에서
                이전 세션의 설정, 신청곡, 상태를 그대로 복원합니다.
                <span className="block mt-2 text-xs">
                  완료 {session.stats.completedCount}곡 · 거절 {session.stats.rejectedCount}곡 · 총 {session.stats.totalRequests}곡
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={handleRestart}>복원하기</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ManagementHeader>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-blue-600 tabular-nums">
              {session.stats.totalRequests}
            </div>
            <div className="text-xs text-muted-foreground mt-1">총 신청곡</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-green-600 tabular-nums">
              {session.stats.completedCount}
            </div>
            <div className="text-xs text-muted-foreground mt-1">완료</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-red-600 tabular-nums">
              {session.stats.rejectedCount}
            </div>
            <div className="text-xs text-muted-foreground mt-1">거절</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-yellow-600 tabular-nums">
              {formatDonationAmount(session.stats.totalDonation)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">총 후원</div>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-primary tabular-nums">
              {completionRate}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">소화율</div>
          </CardContent>
        </Card>
      </div>

      {/* Song requests table */}
      {session.songRequests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2 paperlogy">신청곡이 없습니다</h3>
          <p className="text-muted-foreground text-center">이 세션에 신청된 곡이 없어요.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              {requestTable.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="bg-muted/50">
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      style={
                        header.column.id === 'index'
                          ? { width: 50, minWidth: 50 }
                          : header.column.id === 'requester'
                            ? { width: 100, minWidth: 100 }
                            : header.column.id === 'status'
                              ? { width: 80, minWidth: 80 }
                              : header.column.id === 'donation'
                                ? { width: 100, minWidth: 100 }
                                : undefined
                      }
                      className={header.column.id === 'donation' ? 'text-right' : undefined}
                    >
                      <span className="font-medium">
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {requestTable.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/30">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={
                        cell.column.id === 'index'
                          ? 'font-medium text-muted-foreground tabular-nums'
                          : cell.column.id === 'donation'
                            ? 'text-right'
                            : undefined
                      }
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
