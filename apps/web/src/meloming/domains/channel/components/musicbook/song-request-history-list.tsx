"use client";

import { useState } from "react";
import {
  ClipboardList,
  EyeOff,
  HandCoins,
  MessageCircle,
  Wrench,
} from "lucide-react";

import { Badge } from "@/meloming/shared/components/ui/badge";
import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import { formatRelativeTime } from "@/meloming/domains/clip/utils/format";
import { StatusBadge } from "@/meloming/domains/overlay/components/session-history-detail";
import { useChannelSongRequestHistory } from "@/meloming/domains/overlay/hooks/use-song-requests";

interface SongRequestHistoryListProps {
  songId: number | undefined;
  channelId: number | undefined;
  enabled: boolean;
}

const PAGE_SIZE = 20;

export function SongRequestHistoryList({
  songId,
  channelId,
  enabled,
}: SongRequestHistoryListProps) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useChannelSongRequestHistory(
    enabled ? songId : undefined,
    enabled ? channelId : undefined,
    page,
    PAGE_SIZE,
  );

  if (isLoading) {
    return (
      <div
        data-testid="song-request-history-loading"
        className="flex flex-col gap-2 py-6"
        role="status"
        aria-label="신청 이력 로딩 중"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">신청 이력을 불러오지 못했어요.</p>
      </div>
    );
  }

  if (!data || data.requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <ClipboardList className="size-10 mb-2 opacity-50" />
        <p className="text-sm">신청내역이 없습니다</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul
        className="flex flex-col divide-y divide-border/60"
        aria-label="신청 이력"
      >
        {data.requests.map((req) => (
          <li
            key={req.id}
            className="flex items-center justify-between py-2 text-sm"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium truncate">
                  {req.requesterNickname}
                </span>
                {req.isAnonymous && (
                  <Badge
                    variant="outline"
                    className="h-5 gap-1 px-1.5 text-[10px]"
                  >
                    <EyeOff className="size-3" />
                    익명
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <StatusBadge status={req.status} />
                <SourceLabel
                  source={req.source}
                  donationAmount={req.donationAmount}
                  donationCurrency={req.donationCurrency}
                />
              </div>
            </div>
            <time
              dateTime={req.createdAt}
              className="text-xs text-muted-foreground tabular-nums shrink-0"
            >
              {formatRelativeTime(req.createdAt)}
            </time>
          </li>
        ))}
      </ul>

      {data.pagination.totalPages > 1 && (
        <Pager
          page={data.pagination.page}
          totalPages={data.pagination.totalPages}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() =>
            setPage((p) => Math.min(data.pagination.totalPages, p + 1))
          }
        />
      )}
    </div>
  );
}

function Pager({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
      <button
        type="button"
        className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
        onClick={onPrev}
        disabled={page <= 1}
        aria-label="이전 페이지"
      >
        이전
      </button>
      <span aria-live="polite" aria-atomic="true">
        {page} / {totalPages} 페이지
      </span>
      <button
        type="button"
        className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
        onClick={onNext}
        disabled={page >= totalPages}
        aria-label="다음 페이지"
      >
        다음
      </button>
    </div>
  );
}

function SourceLabel({
  source,
  donationAmount,
  donationCurrency,
}: {
  source: string;
  donationAmount: number | null;
  donationCurrency: string | null;
}) {
  if (source === "DONATION" && donationAmount != null) {
    return (
      <span className="inline-flex items-center gap-1">
        <HandCoins className="size-3" />
        후원 {donationAmount.toLocaleString()} {donationCurrency ?? ""}
      </span>
    );
  }
  if (source === "MANUAL") {
    return (
      <span className="inline-flex items-center gap-1">
        <Wrench className="size-3" /> 수동
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <MessageCircle className="size-3" /> 채팅
    </span>
  );
}
