"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { Film, Loader2 } from "lucide-react";
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
  useInfiniteChannelClipRequests,
  useApproveClipRequest,
  useRejectClipRequest,
} from "@/meloming/domains/clip/hooks/use-clip-requests";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import {
  ClipRequestCard,
  ClipRequestCardSkeleton,
} from "@/meloming/domains/clip/components/clip-request-card";
import type {
  ClipRequest,
  ClipRequestStatus,
} from "@/meloming/domains/clip/types/clip-request";
import { useIntersectionObserver } from "@/meloming/shared/hooks/use-intersection-observer";
import { toast } from "sonner";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import {
  countBucket,
  durationBucket,
  getApiErrorStatus,
  getErrorName,
  textLengthBucket,
} from "@/meloming/domains/channel/components/management/songbook-analytics";

const STATUS_OPTIONS: { value: ClipRequestStatus | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "PENDING", label: "대기중" },
  { value: "APPROVED", label: "승인됨" },
  { value: "REJECTED", label: "거절됨" },
  { value: "CANCELED", label: "취소됨" },
];

function getManagementClipRequestFilterSummary({
  channelId,
  statusFilter,
  pageCount,
  requestCount,
  hasNextPage,
  pendingCount,
}: {
  channelId: number;
  statusFilter: ClipRequestStatus | "all";
  pageCount: number;
  requestCount: number;
  hasNextPage: boolean;
  pendingCount: number;
}) {
  return {
    channel_id: channelId || null,
    channel_resolved: channelId > 0,
    status_filter: statusFilter,
    has_status_filter: statusFilter !== "all",
    page_size: 20,
    page_count: pageCount,
    page_count_bucket: countBucket(pageCount),
    visible_request_count: requestCount,
    visible_request_count_bucket: countBucket(requestCount),
    has_next_page: hasNextPage,
    pending_count: pendingCount,
    pending_count_bucket: countBucket(pendingCount),
    has_pending_count: pendingCount > 0,
  };
}

function getManagementClipRequestSummary(request: ClipRequest, prefix = "request") {
  return {
    [`${prefix}_id`]: request.id,
    [`${prefix}_status`]: request.status,
    [`${prefix}_channel_id`]: request.channel.id,
    [`${prefix}_song_id`]: request.song.id,
    [`${prefix}_platform`]: request.platform,
    [`${prefix}_approved_clip_id`]: request.approvedClipId ?? null,
    [`${prefix}_publish_to_hot_clip`]: request.publishToHotClip,
    [`${prefix}_title_length_bucket`]: textLengthBucket(request.title),
    [`${prefix}_description_length_bucket`]: textLengthBucket(request.description),
    [`${prefix}_has_description`]: Boolean(request.description?.trim()),
    [`${prefix}_has_video_id`]: Boolean(request.videoId),
    [`${prefix}_has_video_url`]: Boolean(request.videoUrl),
    [`${prefix}_has_thumbnail_url`]: Boolean(request.thumbnailUrl),
    [`${prefix}_duration_bucket`]: durationBucket(request.duration),
    [`${prefix}_has_rejection_reason`]: Boolean(request.rejectionReason?.trim()),
    [`${prefix}_rejection_reason_length_bucket`]: textLengthBucket(
      request.rejectionReason,
    ),
    [`${prefix}_has_processed_by`]: Boolean(request.processedBy),
    [`${prefix}_has_processed_at`]: Boolean(request.processedAt),
    [`${prefix}_is_approved_with_clip`]: request.status === "APPROVED" && Boolean(request.approvedClipId),
  };
}

function getManagementClipRequestListSummary(requests: ClipRequest[]) {
  const statusCounts = requests.reduce<Record<string, number>>((acc, request) => {
    acc[request.status] = (acc[request.status] ?? 0) + 1;
    return acc;
  }, {});
  const platformCounts = requests.reduce<Record<string, number>>((acc, request) => {
    acc[request.platform] = (acc[request.platform] ?? 0) + 1;
    return acc;
  }, {});
  const songIds = new Set(requests.map((request) => request.song.id));
  const requesterIds = new Set(requests.map((request) => request.requester.id));
  const hotClipCount = requests.filter((request) => request.publishToHotClip).length;
  const videoLinkCount = requests.filter((request) => Boolean(request.videoUrl)).length;
  const thumbnailCount = requests.filter((request) => Boolean(request.thumbnailUrl)).length;
  const approvedClipCount = requests.filter(
    (request) => request.status === "APPROVED" && Boolean(request.approvedClipId),
  ).length;
  const rejectedReasonCount = requests.filter(
    (request) => Boolean(request.rejectionReason?.trim()),
  ).length;

  return {
    visible_statuses: Object.keys(statusCounts).sort(),
    visible_platforms: Object.keys(platformCounts).sort(),
    pending_visible_count: statusCounts.PENDING ?? 0,
    approved_visible_count: statusCounts.APPROVED ?? 0,
    rejected_visible_count: statusCounts.REJECTED ?? 0,
    canceled_visible_count: statusCounts.CANCELED ?? 0,
    unique_song_count: songIds.size,
    unique_song_count_bucket: countBucket(songIds.size),
    unique_requester_count: requesterIds.size,
    unique_requester_count_bucket: countBucket(requesterIds.size),
    hot_clip_publish_count: hotClipCount,
    hot_clip_publish_count_bucket: countBucket(hotClipCount),
    video_link_count: videoLinkCount,
    video_link_count_bucket: countBucket(videoLinkCount),
    thumbnail_count: thumbnailCount,
    thumbnail_count_bucket: countBucket(thumbnailCount),
    approved_clip_count: approvedClipCount,
    approved_clip_count_bucket: countBucket(approvedClipCount),
    rejected_reason_count: rejectedReasonCount,
    rejected_reason_count_bucket: countBucket(rejectedReasonCount),
    has_pending_actions: (statusCounts.PENDING ?? 0) > 0,
    has_approved_results: (statusCounts.APPROVED ?? 0) > 0,
    has_rejected_results: (statusCounts.REJECTED ?? 0) > 0,
    has_hot_clip_publish_results: hotClipCount > 0,
    has_external_video_results: videoLinkCount > 0,
  };
}

export function ClipRequestsManagement() {
  const params = useParams();
  const user = params?.user as string;
  const userParam = Array.isArray(user) ? user[0] : user;
  const username = userParam || "";

  const { data: channel } = useChannel(username);
  const channelId = channel?.id ?? 0;

  const [statusFilter, setStatusFilter] = useState<ClipRequestStatus | "all">(
    "PENDING"
  );
  const pageViewedRef = useRef(false);
  const listLoadSignatureRef = useRef<string | null>(null);
  const listErrorSignatureRef = useRef<string | null>(null);
  const pendingBadgeViewedRef = useRef(false);
  const pendingActionsViewedRef = useRef(false);
  const emptyStateSignatureRef = useRef<string | null>(null);
  const endReachedSignatureRef = useRef<string | null>(null);
  const rejectReasonFocusedRef = useRef<Set<number>>(new Set());
  const rejectReasonEditedRef = useRef<Set<number>>(new Set());

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
  } = useInfiniteChannelClipRequests(channelId, queryParams, {
    enabled: channelId > 0,
  });

  const approveMutation = useApproveClipRequest(channelId);
  const rejectMutation = useRejectClipRequest(channelId);

  // 무한스크롤
  const isLoadingRef = useRef(false);
  const { elementRef, isIntersecting } = useIntersectionObserver({
    threshold: 0.1,
    rootMargin: "50px",
    enabled: hasNextPage && !isFetchingNextPage && !isLoading,
  });

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

  const filterSummary = useMemo(
    () =>
      getManagementClipRequestFilterSummary({
        channelId,
        statusFilter,
        pageCount: data?.pages?.length ?? 0,
        requestCount: uniqueRequests.length,
        hasNextPage: Boolean(hasNextPage),
        pendingCount,
      }),
    [channelId, data?.pages?.length, hasNextPage, pendingCount, statusFilter, uniqueRequests.length],
  );

  const getEventPropertiesForRequest = useCallback(
    (request: ClipRequest) => ({
      ...filterSummary,
      ...getManagementClipRequestSummary(request),
    }),
    [filterSummary],
  );

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
        ...filterSummary,
      };
      captureIntentEvent("channel_clip_requests_management_load_more_triggered", eventProperties);
      const timeoutId = setTimeout(() => {
        captureIntentEvent("channel_clip_requests_management_load_more_submitted", eventProperties);
        fetchNextPage()
          .then((result) => {
            const resultPages = result.data?.pages ?? [];
            const lastPage = resultPages[resultPages.length - 1];
            const addedCount = lastPage?.items.length ?? 0;
            captureIntentEvent("channel_clip_requests_management_load_more_succeeded", {
              ...eventProperties,
              added_request_count: addedCount,
              added_request_count_bucket: countBucket(addedCount),
              next_page_count: resultPages.length,
              next_cursor_present: Boolean(lastPage?.nextCursor),
            });
          })
          .catch((fetchError) => {
            captureIntentEvent("channel_clip_requests_management_load_more_failed", {
              ...eventProperties,
              api_status: getApiErrorStatus(fetchError),
              error_name: getErrorName(fetchError),
            });
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
    fetchNextPage,
    filterSummary,
    hasNextPage,
    isFetchingNextPage,
    isIntersecting,
    isLoading,
  ]);

  const handleStatusFilterOpenChange = (open: boolean) => {
    if (open) {
      captureIntentEvent("channel_clip_requests_management_status_filter_dropdown_opened", filterSummary);
      return;
    }
    captureIntentEvent("channel_clip_requests_management_status_filter_dropdown_closed", filterSummary);
  };

  const handleStatusFilterChange = (value: string) => {
    captureIntentEvent("channel_clip_requests_management_status_filter_changed", {
      ...filterSummary,
      previous_status_filter: statusFilter,
      next_status_filter: value,
      filter_changed_to_all: value === "all",
    });
    setStatusFilter(value as ClipRequestStatus | "all");
  };

  const handleRetry = () => {
    captureIntentEvent("channel_clip_requests_management_retry_clicked", {
      ...filterSummary,
      api_status: getApiErrorStatus(error),
      error_name: error ? getErrorName(error) : null,
    });
    refetch();
  };

  const handleApprove = async (request: ClipRequest) => {
    const eventProperties = getEventPropertiesForRequest(request);
    captureIntentEvent("channel_clip_requests_management_approve_submitted", eventProperties);
    try {
      const approvedRequest = await approveMutation.mutateAsync(request.id);
      captureIntentEvent("channel_clip_requests_management_approve_succeeded", {
        ...eventProperties,
        ...getManagementClipRequestSummary(approvedRequest, "approved_request"),
      });
      toast.success("클립이 승인되었습니다.");
    } catch (approveError) {
      captureIntentEvent("channel_clip_requests_management_approve_failed", {
        ...eventProperties,
        api_status: getApiErrorStatus(approveError),
        error_name: getErrorName(approveError),
      });
      toast.error("클립 승인에 실패했습니다.");
    }
  };

  const handleReject = async (request: ClipRequest, reason?: string) => {
    const eventProperties = {
      ...getEventPropertiesForRequest(request),
      has_reject_reason_input: Boolean(reason?.trim()),
      reject_reason_length_bucket: textLengthBucket(reason),
    };
    captureIntentEvent("channel_clip_requests_management_reject_submitted", eventProperties);
    try {
      const rejectedRequest = await rejectMutation.mutateAsync({
        id: request.id,
        body: reason ? { reason } : undefined,
      });
      captureIntentEvent("channel_clip_requests_management_reject_succeeded", {
        ...eventProperties,
        ...getManagementClipRequestSummary(rejectedRequest, "rejected_request"),
      });
      toast.success("클립 요청이 거절되었습니다.");
    } catch (rejectError) {
      captureIntentEvent("channel_clip_requests_management_reject_failed", {
        ...eventProperties,
        api_status: getApiErrorStatus(rejectError),
        error_name: getErrorName(rejectError),
      });
      toast.error("클립 거절에 실패했습니다.");
    }
  };

  const handleApproveClick = (request: ClipRequest) => {
    captureIntentEvent("channel_clip_requests_management_approve_clicked", getEventPropertiesForRequest(request));
  };

  const handleRejectClick = (request: ClipRequest) => {
    captureIntentEvent("channel_clip_requests_management_reject_clicked", getEventPropertiesForRequest(request));
  };

  const handleRejectDialogOpenChange = (request: ClipRequest, open: boolean) => {
    const eventProperties = getEventPropertiesForRequest(request);
    if (open) {
      captureIntentEvent("channel_clip_requests_management_reject_dialog_opened", eventProperties);
      return;
    }
    captureIntentEvent("channel_clip_requests_management_reject_dialog_closed", eventProperties);
  };

  const handleRejectDialogCancel = (request: ClipRequest) => {
    captureIntentEvent("channel_clip_requests_management_reject_dialog_cancel_clicked", getEventPropertiesForRequest(request));
  };

  const handleRejectConfirm = (request: ClipRequest, reason?: string) => {
    captureIntentEvent("channel_clip_requests_management_reject_confirm_clicked", {
      ...getEventPropertiesForRequest(request),
      has_reject_reason_input: Boolean(reason?.trim()),
      reject_reason_length_bucket: textLengthBucket(reason),
    });
  };

  const handleRejectReasonFocused = (request: ClipRequest) => {
    if (rejectReasonFocusedRef.current.has(request.id)) return;
    rejectReasonFocusedRef.current.add(request.id);
    captureIntentEvent("channel_clip_requests_management_reject_reason_focused", getEventPropertiesForRequest(request));
  };

  const handleRejectReasonEdited = (request: ClipRequest, reason: string) => {
    if (rejectReasonEditedRef.current.has(request.id) || reason.trim().length === 0) return;
    rejectReasonEditedRef.current.add(request.id);
    captureIntentEvent("channel_clip_requests_management_reject_reason_started", {
      ...getEventPropertiesForRequest(request),
      reject_reason_length_bucket: textLengthBucket(reason),
    });
  };

  const handleVideoLinkClick = (request: ClipRequest) => {
    captureIntentEvent("channel_clip_requests_management_video_link_clicked", getEventPropertiesForRequest(request));
  };

  const handleApprovedClipLinkClick = (request: ClipRequest) => {
    captureIntentEvent("channel_clip_requests_management_approved_clip_clicked", getEventPropertiesForRequest(request));
  };

  useEffect(() => {
    if (!channelId || pageViewedRef.current) return;
    pageViewedRef.current = true;
    captureIntentEvent("channel_clip_requests_management_viewed", filterSummary);
  }, [channelId, filterSummary]);

  useEffect(() => {
    if (!error) return;
    const errorSignature = `${channelId}:${statusFilter}:${getApiErrorStatus(error)}`;
    if (listErrorSignatureRef.current === errorSignature) return;
    listErrorSignatureRef.current = errorSignature;
    captureIntentEvent("channel_clip_requests_management_list_load_failed", {
      ...filterSummary,
      api_status: getApiErrorStatus(error),
      error_name: getErrorName(error),
    });
  }, [channelId, error, filterSummary, statusFilter]);

  useEffect(() => {
    if (!channelId || isLoading || error || !data) return;
    const listSignature = JSON.stringify({
      channelId,
      statusFilter,
      pageCount: data.pages.length,
      nextCursor: data.pages[data.pages.length - 1]?.nextCursor ?? null,
      requestIds: uniqueRequests.map((request) => request.id).join(","),
    });
    if (listLoadSignatureRef.current === listSignature) return;
    listLoadSignatureRef.current = listSignature;

    const duplicateCount = allRequests.length - uniqueRequests.length;
    const listSummary = getManagementClipRequestListSummary(uniqueRequests);
    const eventProperties = {
      ...filterSummary,
      ...listSummary,
      all_request_count_before_dedupe: allRequests.length,
      duplicate_request_count: duplicateCount,
      duplicate_request_count_bucket: countBucket(duplicateCount),
    };

    captureIntentEvent("channel_clip_requests_management_list_loaded", eventProperties);
    captureIntentEvent("channel_clip_requests_management_result_composition_viewed", eventProperties);

    if (pendingCount > 0 && !pendingBadgeViewedRef.current) {
      pendingBadgeViewedRef.current = true;
      captureIntentEvent("channel_clip_requests_management_pending_badge_viewed", eventProperties);
    }
    if (listSummary.has_pending_actions && !pendingActionsViewedRef.current) {
      pendingActionsViewedRef.current = true;
      captureIntentEvent("channel_clip_requests_management_pending_actions_viewed", eventProperties);
    }
    if (uniqueRequests.length === 0) {
      const emptySignature = `${channelId}:${statusFilter}:${data.pages.length}`;
      if (emptyStateSignatureRef.current !== emptySignature) {
        emptyStateSignatureRef.current = emptySignature;
        if (statusFilter === "PENDING") {
          captureIntentEvent("channel_clip_requests_management_pending_empty_state_viewed", eventProperties);
        } else if (statusFilter === "all") {
          captureIntentEvent("channel_clip_requests_management_empty_state_viewed", eventProperties);
        } else {
          captureIntentEvent("channel_clip_requests_management_filtered_empty_state_viewed", eventProperties);
        }
      }
    }
    if (listSummary.has_approved_results) {
      captureIntentEvent("channel_clip_requests_management_approved_results_viewed", eventProperties);
    }
    if (listSummary.has_rejected_results) {
      captureIntentEvent("channel_clip_requests_management_rejected_results_viewed", eventProperties);
    }
    if (listSummary.has_hot_clip_publish_results) {
      captureIntentEvent("channel_clip_requests_management_hot_clip_publish_results_viewed", eventProperties);
    }
    if (listSummary.has_external_video_results) {
      captureIntentEvent("channel_clip_requests_management_external_video_results_viewed", eventProperties);
    }
    if (!hasNextPage && uniqueRequests.length > 0 && endReachedSignatureRef.current !== listSignature) {
      endReachedSignatureRef.current = listSignature;
      captureIntentEvent("channel_clip_requests_management_list_end_reached", eventProperties);
    }
  }, [
    allRequests.length,
    channelId,
    data,
    error,
    filterSummary,
    hasNextPage,
    isLoading,
    pendingCount,
    statusFilter,
    uniqueRequests,
  ]);

  const isProcessing = approveMutation.isPending || rejectMutation.isPending;

  // 에러 상태
  if (error) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="클립 등록 요청 관리"
          description="다른 사용자들이 요청한 클립 등록을 관리합니다."
          icon={Film}
        />
        <InlineError
          message="클립 요청 목록을 불러오는데 실패했습니다."
          onRetry={handleRetry}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <ManagementHeader
        title="클립 등록 요청 관리"
        description="다른 사용자들이 요청한 클립 등록을 관리합니다."
        icon={Film}
      >
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <Badge variant="destructive" className="hidden sm:flex">
              {pendingCount}개 대기
            </Badge>
          )}
          <Select
            value={statusFilter}
            onValueChange={handleStatusFilterChange}
            onOpenChange={handleStatusFilterOpenChange}
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
            <ClipRequestCardSkeleton key={i} />
          ))}
        </div>
      ) : uniqueRequests && uniqueRequests.length > 0 ? (
        <>
          <div className="grid gap-3">
            {uniqueRequests.map((request) => (
              <ClipRequestCard
                key={request.id}
                request={request}
                variant="channel"
                onApprove={() => handleApprove(request)}
                onReject={(_, reason) => handleReject(request, reason)}
                isProcessing={isProcessing}
                onApproveClick={handleApproveClick}
                onRejectClick={handleRejectClick}
                onRejectDialogOpenChange={handleRejectDialogOpenChange}
                onRejectDialogCancel={handleRejectDialogCancel}
                onRejectConfirm={handleRejectConfirm}
                onRejectReasonFocused={handleRejectReasonFocused}
                onRejectReasonEdited={handleRejectReasonEdited}
                onVideoLinkClick={handleVideoLinkClick}
                onApprovedClipLinkClick={handleApprovedClipLinkClick}
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
            <Film className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2 paperlogy">
              {statusFilter === "PENDING"
                ? "처리 대기 중인 요청이 없습니다"
                : statusFilter !== "all"
                ? "조건에 맞는 요청이 없습니다"
                : "아직 클립 요청이 없습니다"}
            </h3>
            <p className="text-muted-foreground text-center">
              {statusFilter === "PENDING"
                ? "모든 클립 요청이 처리되었습니다."
                : statusFilter !== "all"
                ? "다른 상태를 선택해보세요."
                : "다른 사용자가 클립을 요청하면 여기에서 확인할 수 있습니다."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
