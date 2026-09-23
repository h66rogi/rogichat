"use client";

import { useState } from "react";
import {
  Clock,
  CheckCircle,
  XCircle,
  Ban,
  ExternalLink,
  MoreHorizontal,
  Trash2,
  Eye,
} from "lucide-react";
import type { ClipRequest, ClipRequestStatus } from "../types/clip-request";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/meloming/shared/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import Link from "next/link";
import { cn } from "@/meloming/shared/lib/utils";

const STATUS_CONFIG: Record<
  ClipRequestStatus,
  { label: string; icon: typeof Clock; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  PENDING: { label: "대기중", icon: Clock, variant: "secondary" },
  APPROVED: { label: "승인됨", icon: CheckCircle, variant: "default" },
  REJECTED: { label: "거절됨", icon: XCircle, variant: "destructive" },
  CANCELED: { label: "취소됨", icon: Ban, variant: "outline" },
};

const PLATFORM_LABELS: Record<string, string> = {
  YOUTUBE: "YouTube",
  SOOP: "숲(SOOP)",
  CHZZK: "치지직",
  OTHER: "기타",
};

interface ClipRequestCardProps {
  request: ClipRequest;
  variant?: "my" | "channel";
  onCancel?: (id: number) => void;
  onApprove?: (id: number) => void;
  onReject?: (id: number, reason?: string) => void;
  isProcessing?: boolean;
  onCancelClick?: (request: ClipRequest) => void;
  onCancelDialogOpenChange?: (request: ClipRequest, open: boolean) => void;
  onCancelDialogCancel?: (request: ClipRequest) => void;
  onCancelConfirm?: (request: ClipRequest) => void;
  onChannelLinkClick?: (request: ClipRequest) => void;
  onVideoLinkClick?: (request: ClipRequest) => void;
  onApprovedClipLinkClick?: (request: ClipRequest) => void;
  onApproveClick?: (request: ClipRequest) => void;
  onRejectClick?: (request: ClipRequest) => void;
  onRejectDialogOpenChange?: (request: ClipRequest, open: boolean) => void;
  onRejectDialogCancel?: (request: ClipRequest) => void;
  onRejectConfirm?: (request: ClipRequest, reason?: string) => void;
  onRejectReasonFocused?: (request: ClipRequest) => void;
  onRejectReasonEdited?: (request: ClipRequest, reason: string) => void;
}

export function ClipRequestCard({
  request,
  variant = "my",
  onCancel,
  onApprove,
  onReject,
  isProcessing = false,
  onCancelClick,
  onCancelDialogOpenChange,
  onCancelDialogCancel,
  onCancelConfirm,
  onChannelLinkClick,
  onVideoLinkClick,
  onApprovedClipLinkClick,
  onApproveClick,
  onRejectClick,
  onRejectDialogOpenChange,
  onRejectDialogCancel,
  onRejectConfirm,
  onRejectReasonFocused,
  onRejectReasonEdited,
}: ClipRequestCardProps) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const statusConfig = STATUS_CONFIG[request.status];
  const StatusIcon = statusConfig.icon;

  const handleCancel = () => {
    onCancelConfirm?.(request);
    onCancel?.(request.id);
    setCancelDialogOpen(false);
  };

  const handleReject = () => {
    onRejectConfirm?.(request, rejectReason || undefined);
    onReject?.(request.id, rejectReason || undefined);
    setRejectDialogOpen(false);
    setRejectReason("");
  };

  return (
    <>
      <div className="flex flex-col gap-4 p-4 rounded-xl border bg-card hover:shadow-sm transition-shadow">
        {/* 상단: 썸네일 + 정보 */}
        <div className="flex gap-4">
          {/* 썸네일 */}
          <div className="relative w-24 h-16 sm:w-32 sm:h-20 rounded-lg overflow-hidden bg-muted shrink-0">
            {request.thumbnailUrl ? (
              <img
                src={request.thumbnailUrl}
                alt={request.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <Eye className="size-6" />
              </div>
            )}
          </div>

          {/* 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-sm sm:text-base line-clamp-1">
                  {request.title}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 line-clamp-1">
                  {request.song.title}
                  {request.song.artistName && ` - ${request.song.artistName}`}
                </p>
              </div>

              {/* 상태 배지 */}
              <Badge variant={statusConfig.variant} className="shrink-0">
                <StatusIcon className="size-3 mr-1" />
                {statusConfig.label}
              </Badge>
            </div>

            {/* 메타 정보 */}
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
              <span>{PLATFORM_LABELS[request.platform] || request.platform}</span>
              <span>·</span>
              {variant === "my" ? (
                <Link
                  href={`/channel/${request.channel.webPath}`}
                  className="hover:underline"
                  onClick={() => onChannelLinkClick?.(request)}
                >
                  {request.channel.name}
                </Link>
              ) : (
                <span>{request.requester.nickname}</span>
              )}
              <span>·</span>
              <span>
                {formatDistanceToNow(new Date(request.createdAt), {
                  addSuffix: true,
                  locale: ko,
                })}
              </span>
              <span>·</span>
              <span>{request.publishToHotClip ? "핫클립 게시" : "채널에만 등록"}</span>
            </div>
          </div>
        </div>

        {/* 거절 사유 */}
        {request.status === "REJECTED" && request.rejectionReason && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">
            <span className="font-medium">거절 사유: </span>
            {request.rejectionReason}
          </div>
        )}

        {/* 하단: 액션 버튼 */}
        <div className="flex items-center justify-between pt-2 border-t">
          {/* 링크 */}
          {request.videoUrl && (
            <a
              href={request.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => onVideoLinkClick?.(request)}
            >
              <ExternalLink className="size-3" />
              영상 보기
            </a>
          )}
          {!request.videoUrl && <div />}

          {/* 액션 버튼 */}
          <div className="flex items-center gap-2">
            {/* 내 신청 목록에서 취소 */}
            {variant === "my" && request.status === "PENDING" && onCancel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onCancelClick?.(request);
                  setCancelDialogOpen(true);
                }}
                disabled={isProcessing}
              >
                <Trash2 className="size-4 mr-1" />
                취소
              </Button>
            )}

            {/* 채널 관리에서 승인/거절 */}
            {variant === "channel" && request.status === "PENDING" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onRejectClick?.(request);
                    setRejectDialogOpen(true);
                  }}
                  disabled={isProcessing}
                >
                  거절
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onApproveClick?.(request);
                    onApprove?.(request.id);
                  }}
                  disabled={isProcessing}
                >
                  승인
                </Button>
              </>
            )}

            {/* 승인된 클립으로 이동 */}
            {request.status === "APPROVED" && request.approvedClipId && (
              <Link
                href={`/clip/${request.approvedClipId}`}
                onClick={() => onApprovedClipLinkClick?.(request)}
              >
                <Button variant="outline" size="sm">
                  클립 보기
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* 취소 확인 다이얼로그 */}
      <AlertDialog
        open={cancelDialogOpen}
        onOpenChange={(open) => {
          onCancelDialogOpenChange?.(request, open);
          setCancelDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>요청을 취소하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              이 작업은 되돌릴 수 없습니다. 요청이 취소되면 다시 요청해야 합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onCancelDialogCancel?.(request)}>
              아니요
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>취소하기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 거절 확인 다이얼로그 */}
      <AlertDialog
        open={rejectDialogOpen}
        onOpenChange={(open) => {
          onRejectDialogOpenChange?.(request, open);
          setRejectDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>클립 요청을 거절하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              거절 사유를 입력하면 요청자에게 전달됩니다. (선택사항)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <textarea
              value={rejectReason}
              onFocus={() => onRejectReasonFocused?.(request)}
              onChange={(e) => {
                setRejectReason(e.target.value);
                onRejectReasonEdited?.(request, e.target.value);
              }}
              placeholder="거절 사유를 입력하세요 (선택)"
              className="w-full h-24 px-3 py-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              maxLength={500}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onRejectDialogCancel?.(request)}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleReject}>거절하기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ClipRequestCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 rounded-xl border bg-card">
      <div className="flex gap-4">
        <div className="w-24 h-16 sm:w-32 sm:h-20 rounded-lg bg-muted animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-3/4 bg-muted animate-pulse rounded" />
          <div className="h-4 w-1/2 bg-muted animate-pulse rounded" />
          <div className="h-3 w-1/3 bg-muted animate-pulse rounded" />
        </div>
      </div>
    </div>
  );
}
