"use client";

import { useState } from "react";
import {
  Clock,
  CheckCircle,
  XCircle,
  Ban,
  ExternalLink,
  Trash2,
  Music,
  Search,
} from "lucide-react";
import type { SongAddRequest, SongAddRequestStatus } from "../types/song-request";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  AlertDialog,
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

const STATUS_CONFIG: Record<
  SongAddRequestStatus,
  { label: string; icon: typeof Clock; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  PENDING: { label: "대기중", icon: Clock, variant: "secondary" },
  APPROVED: { label: "승인됨", icon: CheckCircle, variant: "default" },
  REJECTED: { label: "거절됨", icon: XCircle, variant: "destructive" },
  CANCELED: { label: "취소됨", icon: Ban, variant: "outline" },
};

interface SongRequestCardProps {
  request: SongAddRequest;
  variant?: "my" | "channel";
  onCancel?: (id: number) => void;
  onApprove?: (id: number) => void;
  onReject?: (id: number, reason?: string) => void;
  /** 검토 버튼 클릭 시 호출 (채널 관리자용) */
  onReview?: (request: SongAddRequest) => void;
  onCancelClick?: (request: SongAddRequest) => void;
  onCancelDialogOpenChange?: (request: SongAddRequest, open: boolean) => void;
  onCancelDialogCancel?: (request: SongAddRequest) => void;
  onCancelConfirm?: (request: SongAddRequest) => void;
  onChannelLinkClick?: (request: SongAddRequest) => void;
  onApprovedSongLinkClick?: (request: SongAddRequest) => void;
  isProcessing?: boolean;
}

export function SongRequestCard({
  request,
  variant = "my",
  onCancel,
  onApprove,
  onReject,
  onReview,
  onCancelClick,
  onCancelDialogOpenChange,
  onCancelDialogCancel,
  onCancelConfirm,
  onChannelLinkClick,
  onApprovedSongLinkClick,
  isProcessing = false,
}: SongRequestCardProps) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const statusConfig = STATUS_CONFIG[request.status];
  const StatusIcon = statusConfig.icon;

  const handleCancelDialogOpenChange = (open: boolean) => {
    setCancelDialogOpen(open);
    onCancelDialogOpenChange?.(request, open);
  };

  const handleCancelClick = () => {
    onCancelClick?.(request);
    handleCancelDialogOpenChange(true);
  };

  const handleCancel = () => {
    onCancelConfirm?.(request);
    onCancel?.(request.id);
    handleCancelDialogOpenChange(false);
  };

  const handleReject = () => {
    onReject?.(request.id, rejectReason || undefined);
    setRejectDialogOpen(false);
    setRejectReason("");
  };

  return (
    <>
      <div className="flex flex-col gap-4 p-4 rounded-xl border bg-card hover:shadow-sm transition-shadow">
        {/* 상단: 앨범아트 + 정보 */}
        <div className="flex gap-4">
          {/* 앨범아트 */}
          <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-muted shrink-0">
            {request.albumArt ? (
              <img
                src={request.albumArt}
                alt={request.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <Music className="size-6" />
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
                  {request.artistName}
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
              {request.categoryNames && request.categoryNames.length > 0 && (
                <>
                  <span>{request.categoryNames.slice(0, 2).join(", ")}</span>
                  <span>·</span>
                </>
              )}
              {variant === "my" ? (
                <Link
                  href={`/channel/${request.channel.webPath}`}
                  onClick={() => onChannelLinkClick?.(request)}
                  className="hover:underline"
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
            </div>

            {/* 난이도 / 숙련도 */}
            {(request.difficulty || request.proficiency) && (
              <div className="flex flex-wrap items-center gap-3 mt-1">
                {request.difficulty && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">
                      난이도
                    </span>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span
                        key={i}
                        className={`text-xs ${
                          i < request.difficulty!
                            ? "text-yellow-500"
                            : "text-muted-foreground/30"
                        }`}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                )}
                {request.proficiency && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">
                      숙련도
                    </span>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span
                        key={i}
                        className={`text-xs ${
                          i < request.proficiency!
                            ? "text-yellow-500"
                            : "text-muted-foreground/30"
                        }`}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {request.karaokeUrl && (
              <a
                href={request.karaokeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground flex items-center gap-1"
              >
                <ExternalLink className="size-3" />
                노래방
              </a>
            )}
            {request.originalUrl && (
              <a
                href={request.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground flex items-center gap-1"
              >
                <ExternalLink className="size-3" />
                원곡
              </a>
            )}
          </div>

          {/* 액션 버튼 */}
          <div className="flex items-center gap-2">
            {/* 내 신청 목록에서 취소 */}
            {variant === "my" && request.status === "PENDING" && onCancel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancelClick}
                disabled={isProcessing}
              >
                <Trash2 className="size-4 mr-1" />
                취소
              </Button>
            )}

            {/* 채널 관리에서 검토 */}
            {variant === "channel" && request.status === "PENDING" && onReview && (
              <Button
                size="sm"
                onClick={() => onReview(request)}
                disabled={isProcessing}
              >
                <Search className="size-4 mr-1" />
                검토
              </Button>
            )}

            {/* 승인된 노래로 이동 */}
            {request.status === "APPROVED" && request.approvedSong && (
              <Link
                href={`/channel/${request.channel.webPath}`}
                onClick={() => onApprovedSongLinkClick?.(request)}
              >
                <Button variant="outline" size="sm">
                  노래 보기
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* 취소 확인 다이얼로그 */}
      <AlertDialog
        open={cancelDialogOpen}
        onOpenChange={handleCancelDialogOpenChange}
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
            <Button variant="destructive" onClick={handleCancel}>
              취소하기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 거절 확인 다이얼로그 */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>노래 요청을 거절하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              거절 사유를 입력하면 요청자에게 전달됩니다. (선택사항)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="거절 사유를 입력하세요 (선택)"
              className="w-full h-24 px-3 py-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              maxLength={500}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button variant="destructive" onClick={handleReject}>
              거절하기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function SongRequestCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 rounded-xl border bg-card">
      <div className="flex gap-4">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-muted animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-3/4 bg-muted animate-pulse rounded" />
          <div className="h-4 w-1/2 bg-muted animate-pulse rounded" />
          <div className="h-3 w-1/3 bg-muted animate-pulse rounded" />
        </div>
      </div>
    </div>
  );
}
