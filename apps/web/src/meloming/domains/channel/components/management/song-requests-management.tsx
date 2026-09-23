"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { Music, Loader2 } from "lucide-react";
import { ManagementHeader } from "./management-header";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { InlineError } from "@/meloming/shared/components/common/error-boundary";
import { Badge } from "@/meloming/shared/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import {
  useInfiniteChannelSongAddRequests,
} from "@/meloming/domains/channel/hooks/use-song-requests";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import {
  SongRequestCard,
  SongRequestCardSkeleton,
} from "@/meloming/domains/channel/components/song-request-card";
import { SongRequestReviewDialog } from "@/meloming/domains/channel/components/song-request-review-dialog";
import type { SongAddRequest, SongAddRequestStatus } from "@/meloming/domains/channel/types/song-request";
import { useIntersectionObserver } from "@/meloming/shared/hooks/use-intersection-observer";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import {
  countBucket,
  getApiErrorStatus,
  getErrorName,
  getSongRequestListSummary,
  getSongRequestSummary,
} from "./songbook-analytics";

const STATUS_OPTIONS: { value: SongAddRequestStatus | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "PENDING", label: "대기중" },
  { value: "APPROVED", label: "승인됨" },
  { value: "REJECTED", label: "거절됨" },
  { value: "CANCELED", label: "취소됨" },
];

export function SongRequestsManagement() {
  const params = useParams();
  const user = params?.user as string;
  const userParam = Array.isArray(user) ? user[0] : user;
  const username = userParam || "";

  const { data: channel } = useChannel(username);
  const channelId = channel?.id ?? 0;

  const [statusFilter, setStatusFilter] = useState<SongAddRequestStatus | "all">(
    "PENDING"
  );

  // 검토 다이얼로그 상태
  const [reviewingRequest, setReviewingRequest] = useState<SongAddRequest | null>(
    null
  );
  const pageViewCapturedRef = useRef(false);
  const listLoadSignatureRef = useRef<string | null>(null);
  const emptyStateSignatureRef = useRef<string | null>(null);
  const pendingBadgeCapturedRef = useRef(false);
  const endReachedSignatureRef = useRef<string | null>(null);

  const queryParams = useMemo(
    () => ({
      status: statusFilter === "all" ? undefined : statusFilter,
      take: 20,
    }),
    [statusFilter]
  );

  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteChannelSongAddRequests(channelId, queryParams, {
    enabled: channelId > 0,
  });

  // 무한스크롤
  const isLoadingRef = useRef(false);
  const { elementRef, isIntersecting } = useIntersectionObserver({
    threshold: 0.1,
    rootMargin: "50px",
    enabled: hasNextPage && !isFetchingNextPage && !isLoading,
  });

  useEffect(() => {
    if (
      isIntersecting &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isLoading &&
      !isLoadingRef.current
    ) {
      isLoadingRef.current = true;
      const eventProperties = {
        channel_id: channelId || null,
        channel_username_present: Boolean(username),
        request_status_filter: statusFilter,
        page_count: data?.pages?.length ?? 0,
        page_count_bucket: countBucket(data?.pages?.length ?? 0),
        has_next_page: Boolean(hasNextPage),
      };
      captureIntentEvent(
        "channel_songbook_requests_management_load_more_triggered",
        eventProperties
      );
      const timeoutId = setTimeout(() => {
        captureIntentEvent(
          "channel_songbook_requests_management_load_more_submitted",
          eventProperties
        );
        fetchNextPage()
          .then((result) => {
            captureIntentEvent(
              "channel_songbook_requests_management_load_more_succeeded",
              {
                ...eventProperties,
                next_page_loaded: Boolean(result.data),
              }
            );
          })
          .catch((error) => {
            captureIntentEvent(
              "channel_songbook_requests_management_load_more_failed",
              {
                ...eventProperties,
                error_name: getErrorName(error),
                error_status: getApiErrorStatus(error),
              }
            );
          })
          .finally(() => {
            setTimeout(() => {
              isLoadingRef.current = false;
            }, 1000);
          });
      }, 100);
      return () => {
        clearTimeout(timeoutId);
        isLoadingRef.current = false;
      };
    }
  }, [
    channelId,
    data?.pages?.length,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isIntersecting,
    isLoading,
    statusFilter,
    username,
  ]);

  // 모든 페이지의 신청 합치기
  const allRequests = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.items);
  }, [data]);

  // 중복 제거
  const uniqueRequests = useMemo(() => {
    const seen = new Set<number>();
    return allRequests.filter((req) => {
      if (seen.has(req.id)) return false;
      seen.add(req.id);
      return true;
    });
  }, [allRequests]);

  // 대기 중 개수
  const pendingCount = data?.pages?.[0]?.pendingCount ?? 0;

  const getListContextProperties = useCallback(
    () => ({
      channel_id: channelId || null,
      channel_username_present: Boolean(username),
      page_count: data?.pages?.length ?? 0,
      page_count_bucket: countBucket(data?.pages?.length ?? 0),
      has_next_page: Boolean(hasNextPage),
      is_fetching_next_page: Boolean(isFetchingNextPage),
      ...getSongRequestListSummary(uniqueRequests, pendingCount, statusFilter),
    }),
    [
      channelId,
      data?.pages?.length,
      hasNextPage,
      isFetchingNextPage,
      pendingCount,
      statusFilter,
      uniqueRequests,
      username,
    ]
  );

  useEffect(() => {
    if (!channelId || pageViewCapturedRef.current) return;
    pageViewCapturedRef.current = true;
    captureIntentEvent("channel_songbook_requests_management_viewed", {
      ...getListContextProperties(),
      list_ready: Boolean(data),
    });
  }, [channelId, data, getListContextProperties]);

  useEffect(() => {
    if (!error) return;
    captureIntentEvent("channel_songbook_requests_management_list_load_failed", {
      channel_id: channelId || null,
      channel_username_present: Boolean(username),
      request_status_filter: statusFilter,
      error_name: getErrorName(error),
      error_status: getApiErrorStatus(error),
    });
  }, [channelId, error, statusFilter, username]);

  useEffect(() => {
    if (!data) return;
    const signature = [
      statusFilter,
      data.pages.length,
      uniqueRequests.map((request) => `${request.id}:${request.status}`).join("|"),
      pendingCount,
    ].join(":");
    if (listLoadSignatureRef.current === signature) return;
    listLoadSignatureRef.current = signature;

    captureIntentEvent("channel_songbook_requests_management_list_loaded", {
      ...getListContextProperties(),
    });
  }, [data, getListContextProperties, pendingCount, statusFilter, uniqueRequests]);

  useEffect(() => {
    if (pendingCount <= 0 || pendingBadgeCapturedRef.current) return;
    pendingBadgeCapturedRef.current = true;
    captureIntentEvent("channel_songbook_requests_management_pending_badge_viewed", {
      ...getListContextProperties(),
    });
  }, [getListContextProperties, pendingCount]);

  useEffect(() => {
    if (isLoading || !data || uniqueRequests.length > 0) return;
    const signature = `${statusFilter}:${pendingCount}`;
    if (emptyStateSignatureRef.current === signature) return;
    emptyStateSignatureRef.current = signature;
    captureIntentEvent("channel_songbook_requests_management_empty_state_viewed", {
      ...getListContextProperties(),
      empty_state_filter: statusFilter,
    });
  }, [
    data,
    getListContextProperties,
    isLoading,
    pendingCount,
    statusFilter,
    uniqueRequests.length,
  ]);

  useEffect(() => {
    if (isLoading || hasNextPage || uniqueRequests.length === 0) return;
    const signature = `${statusFilter}:${uniqueRequests.length}`;
    if (endReachedSignatureRef.current === signature) return;
    endReachedSignatureRef.current = signature;
    captureIntentEvent("channel_songbook_requests_management_list_end_reached", {
      ...getListContextProperties(),
    });
  }, [
    getListContextProperties,
    hasNextPage,
    isLoading,
    statusFilter,
    uniqueRequests.length,
  ]);

  // 검토 다이얼로그 열기
  const handleReview = (request: SongAddRequest) => {
    captureIntentEvent("channel_songbook_requests_management_review_clicked", {
      ...getListContextProperties(),
      ...getSongRequestSummary(request, "request"),
    });
    setReviewingRequest(request);
    captureIntentEvent("channel_songbook_requests_management_review_dialog_opened", {
      ...getListContextProperties(),
      ...getSongRequestSummary(request, "request"),
    });
  };

  // 에러 상태
  if (error) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="노래 등록 요청 관리"
          description="다른 사용자들이 요청한 노래 등록을 관리합니다."
          icon={Music}
        />
        <InlineError
          message="노래 요청 목록을 불러오는데 실패했습니다."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <ManagementHeader
        title="노래 등록 요청 관리"
        description="다른 사용자들이 요청한 노래 등록을 관리합니다."
        icon={Music}
      >
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <Badge variant="destructive" className="hidden sm:flex">
              {pendingCount}개 대기
            </Badge>
          )}
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              const nextStatus = v as SongAddRequestStatus | "all";
              captureIntentEvent(
                "channel_songbook_requests_management_status_filter_changed",
                {
                  ...getListContextProperties(),
                  previous_status_filter: statusFilter,
                  next_status_filter: nextStatus,
                }
              );
              setStatusFilter(nextStatus);
            }}
          >
            <SelectTrigger className="w-28">
              <SelectValue placeholder="대기중" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ManagementHeader>

      {/* 로딩 상태 */}
      {isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SongRequestCardSkeleton key={i} />
          ))}
        </div>
      ) : uniqueRequests && uniqueRequests.length > 0 ? (
        <>
          <div className="grid gap-3">
            {uniqueRequests.map((request) => (
              <SongRequestCard
                key={request.id}
                request={request}
                variant="channel"
                onReview={handleReview}
              />
            ))}
          </div>

          {/* 무한스크롤 트리거 */}
          {hasNextPage && (
            <div
              ref={elementRef}
              className="flex justify-center mt-6 py-4"
            >
              {isFetchingNextPage ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  더 불러오는 중...
                </div>
              ) : (
                <div className="h-8 flex items-center justify-center text-xs text-muted-foreground">
                  스크롤하여 더 보기
                </div>
              )}
            </div>
          )}

          {/* 모든 데이터 로드 완료 */}
          {!hasNextPage && uniqueRequests.length > 0 && (
            <div className="flex justify-center mt-6">
              <div className="text-sm text-muted-foreground">
                모든 요청을 불러왔습니다
              </div>
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Music className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2 paperlogy">
              {statusFilter === "PENDING"
                ? "처리 대기 중인 요청이 없습니다"
                : statusFilter !== "all"
                ? "조건에 맞는 요청이 없습니다"
                : "아직 노래 요청이 없습니다"}
            </h3>
            <p className="text-muted-foreground text-center">
              {statusFilter === "PENDING"
                ? "모든 노래 요청이 처리되었습니다."
                : statusFilter !== "all"
                ? "다른 상태를 선택해보세요."
                : "다른 사용자가 노래를 요청하면 여기에서 확인할 수 있습니다."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* 검토 다이얼로그 */}
      {reviewingRequest && (
        <SongRequestReviewDialog
          open={!!reviewingRequest}
          onOpenChange={(open) => !open && setReviewingRequest(null)}
          request={reviewingRequest}
          channelIdentifier={username}
          channelId={channelId}
          onSuccess={() => {
            captureIntentEvent(
              "channel_songbook_requests_management_review_succeeded",
              {
                ...getListContextProperties(),
                ...getSongRequestSummary(reviewingRequest, "request"),
              }
            );
            setReviewingRequest(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}
