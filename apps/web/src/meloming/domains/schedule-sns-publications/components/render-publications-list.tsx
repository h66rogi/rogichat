"use client";

import { useEffect, useRef } from "react";
import {
  AlertCircle,
  BookText,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  Twitter,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/meloming/shared/components/ui/alert";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { useRenderPublications } from "@/meloming/domains/schedule-sns-publications/hooks";
import type {
  ScheduleSnsPublication,
  ScheduleSnsPublicationStatus,
} from "@/meloming/domains/schedule-sns-publications/types";
import type { SnsPlatform } from "@/meloming/domains/sns-credentials/types/sns-platform";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";

interface RenderPublicationsListProps {
  renderId: number;
  /** 부모로부터 받는 enabled — 비로그인/feature off 시 false. */
  enabled?: boolean;
  /**
   * 폴링 timeout reset 트리거. 값이 바뀔 때마다 `resetPollingTimeout()` 가
   * 호출된다. 부모가 새 publish 를 트리거했을 때 이 값을 bump 하면 timed-out
   * 상태에서도 폴링이 즉시 재개된다.
   */
  pollingResetSignal?: number;
}

const PLATFORM_LABEL: Record<SnsPlatform, string> = {
  X: "X",
  NAVER_CAFE: "네이버 카페",
};

const PLATFORM_ICON: Record<SnsPlatform, LucideIcon> = {
  X: Twitter,
  NAVER_CAFE: BookText,
};

interface StatusMeta {
  label: string;
  icon: LucideIcon;
  /** 회전 애니메이션이 필요한지 (POSTING). */
  spin?: boolean;
  /** Badge variant — semantic 색상. */
  badgeClassName: string;
}

const STATUS_META: Record<ScheduleSnsPublicationStatus, StatusMeta> = {
  QUEUED: {
    label: "대기 중",
    icon: Clock,
    badgeClassName:
      "bg-muted text-muted-foreground border-transparent",
  },
  POSTING: {
    label: "게시 중",
    icon: Loader2,
    spin: true,
    badgeClassName: "bg-blue-500 text-white border-transparent",
  },
  POSTED: {
    label: "게시 완료",
    icon: CheckCircle2,
    badgeClassName:
      "bg-emerald-500 text-white border-transparent",
  },
  FAILED: {
    label: "실패",
    icon: AlertCircle,
    badgeClassName: "bg-destructive text-destructive-foreground border-transparent",
  },
};

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

interface PublicationRowProps {
  publication: ScheduleSnsPublication;
}

function PublicationRow({ publication }: PublicationRowProps) {
  const meta = STATUS_META[publication.status];
  const PlatformIcon = PLATFORM_ICON[publication.platform];
  const StatusIcon = meta.icon;
  const requestedAt = formatDateTime(publication.createdAt);
  const finishedAt =
    publication.status === "POSTED" ? formatDateTime(publication.publishedAt) : null;

  return (
    <Card data-testid={`publication-row-${publication.id}`}>
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <PlatformIcon className="size-4 text-foreground" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {PLATFORM_LABEL[publication.platform]}
              </span>
              <Badge
                className={meta.badgeClassName}
                data-testid={`publication-status-badge-${publication.status}`}
              >
                <StatusIcon
                  className={meta.spin ? "size-3 animate-spin" : "size-3"}
                />
                {meta.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {requestedAt && <>요청 {requestedAt}</>}
              {finishedAt && <> · 완료 {finishedAt}</>}
            </p>
            {publication.status === "FAILED" && publication.errorMessage && (
              <p className="text-xs text-destructive">
                {publication.errorMessage}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:justify-end">
          {publication.status === "POSTED" && publication.externalPostUrl && (
            <Button asChild type="button" variant="outline" size="sm">
              <a
                href={publication.externalPostUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`publication-link-${publication.id}`}
              >
                <ExternalLink className="size-3.5" />
                외부에서 열기
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * 한 렌더의 SNS 게시 내역을 표시한다 (자동 폴링 포함).
 *
 *  - 항목 0개: 안내 카드 노출 (게시 이력이 없음).
 *  - in-progress(POSTING) 항목 존재 시 4초 폴링.
 *  - 폴링 5분 timeout 도달 시 안내 + 새로고침 버튼.
 *  - error 시 alert + 재시도 버튼.
 */
export function RenderPublicationsList({
  renderId,
  enabled = true,
  pollingResetSignal,
}: RenderPublicationsListProps) {
  const { query, isPollingTimedOut, resetPollingTimeout } = useRenderPublications(
    renderId,
    {
      enabled,
    },
  );

  // 부모 신호 reset — 새 publish 직후 timed-out 상태 해제하고 polling 재개.
  // 첫 렌더(initial 0) 에는 발동하지 않는다 — pollingResetSignal 은 "bump → reset"
  // 의미인데 initial value 가 0 이면 마운트 시 의도치 않게 호출되었기 때문
  // (Codex F9 NIT). prev value 를 ref 로 추적해 변동 시에만 호출.
  const prevPollingResetSignalRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (pollingResetSignal === undefined) return;
    if (prevPollingResetSignalRef.current === pollingResetSignal) return;
    if (prevPollingResetSignalRef.current === undefined) {
      // 첫 등록 — 아직 부모가 reset 한 적 없으니 호출 X.
      prevPollingResetSignalRef.current = pollingResetSignal;
      return;
    }
    prevPollingResetSignalRef.current = pollingResetSignal;
    resetPollingTimeout();
    // resetPollingTimeout 은 useCallback 으로 안정 — deps 에 포함해도 무한 재실행 X.
  }, [pollingResetSignal, resetPollingTimeout]);

  if (query.isLoading) {
    return (
      <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" />
        게시 내역을 불러오는 중…
      </div>
    );
  }

  if (query.error) {
    return (
      <Alert variant="destructive" data-testid="publications-error">
        <AlertCircle className="size-4" />
        <AlertTitle>게시 내역을 불러오지 못했어요</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>
            {extractApiErrorMessage(
              query.error,
              "잠시 후 다시 시도해 주세요.",
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              resetPollingTimeout();
              void query.refetch();
            }}
          >
            <RefreshCw className="size-3.5" />
            다시 불러오기
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const items = query.data ?? [];

  return (
    <div className="space-y-3" data-testid="render-publications-list">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">SNS 게시 내역</h3>
        {items.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              resetPollingTimeout();
              void query.refetch();
            }}
            disabled={query.isFetching}
          >
            {query.isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            새로고침
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          아직 게시 이력이 없어요. 위 &quot;SNS에 게시&quot; 버튼으로 처음
          게시해 보세요.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((row) => (
            <PublicationRow key={row.id} publication={row} />
          ))}
        </div>
      )}
      {isPollingTimedOut && (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>오랫동안 처리 중이에요</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>
              자동 갱신을 일시 중단했습니다. 새로고침으로 최신 상태를
              확인해 주세요.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => {
                resetPollingTimeout();
                void query.refetch();
              }}
            >
              <RefreshCw className="size-3.5" />
              지금 새로고침
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
