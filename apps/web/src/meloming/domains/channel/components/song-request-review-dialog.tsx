"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { Label } from "@/meloming/shared/components/ui/label";
import { Alert, AlertDescription } from "@/meloming/shared/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import { Music, CheckCircle, XCircle, User, Clock, Loader2, Pencil } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/meloming/shared/components/ui/avatar";
import { AvatarPlaceholder } from "@/shared/ui/avatar-placeholder";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import type { SongAddRequest, ApproveSongAddRequestBody } from "../types/song-request";
import { SongFormV2 } from "@/meloming/domains/channel/components/management/song-form-v2";
import type { SongFormValues } from "@/meloming/domains/channel/components/management/song-form.schema";
import {
  useApproveSongAddRequest,
  useRejectSongAddRequest,
} from "@/meloming/domains/channel/hooks/use-song-requests";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import {
  getApiErrorStatus,
  getErrorName,
  getRejectReasonSummary,
  getSongFormSummary,
  getSongRequestApprovalPatchSummary,
  getSongRequestSummary,
  textLengthBucket,
} from "@/meloming/domains/channel/components/management/songbook-analytics";

interface SongRequestReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: SongAddRequest;
  channelIdentifier: string;
  channelId: number;
  onSuccess?: () => void;
}

export function SongRequestReviewDialog({
  open,
  onOpenChange,
  request,
  channelIdentifier,
  channelId,
  onSuccess,
}: SongRequestReviewDialogProps) {
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [currentFormValues, setCurrentFormValues] = useState<SongFormValues | null>(null);
  const closeReasonRef = useRef("dismissed");
  const rejectDialogCloseReasonRef = useRef("dismissed");
  const rejectReasonFocusCapturedRef = useRef(false);
  const rejectReasonEditedCapturedRef = useRef(false);
  const formModifiedCapturedRef = useRef(false);
  const viewedSignatureRef = useRef<string | null>(null);

  const approveMutation = useApproveSongAddRequest(channelId);
  const rejectMutation = useRejectSongAddRequest(channelId);

  const isProcessing = approveMutation.isPending || rejectMutation.isPending;

  // 요청 데이터를 SongFormValues 형태로 변환
  const initialValues: Partial<SongFormValues> = useMemo(() => ({
    title: request.title,
    artistName: request.artistName,
    categoryNames: request.categoryNames ?? [],
    albumArt: request.albumArt ?? "",
    karaokeUrl: request.karaokeUrl ?? "",
    coverUrl: request.coverUrl ?? "",
    originalUrl: request.originalUrl ?? "",
    lyricsLink: request.lyricsLink ?? "",
    difficulty: request.difficulty ?? 1,
    proficiency: request.proficiency ?? undefined,
    songKey: request.songKey ?? "",
    bpm: request.bpm ?? undefined,
    lyricsText: request.lyricsText ?? "",
  }), [request]);

  // 폼 값 변경 감지
  const handleValuesChange = useCallback((values: SongFormValues) => {
    setCurrentFormValues(values);
  }, []);

  // 수정 여부 판단
  const isModified = useMemo(() => {
    if (!currentFormValues) return false;

    const iv = initialValues;
    const cv = currentFormValues;

    // 각 필드 비교
    if ((cv.title ?? "").trim() !== (iv.title ?? "").trim()) return true;
    if ((cv.artistName ?? "").trim() !== (iv.artistName ?? "").trim()) return true;
    if ((cv.albumArt ?? "") !== (iv.albumArt ?? "")) return true;
    if ((cv.karaokeUrl ?? "") !== (iv.karaokeUrl ?? "")) return true;
    if ((cv.coverUrl ?? "") !== (iv.coverUrl ?? "")) return true;
    if ((cv.originalUrl ?? "") !== (iv.originalUrl ?? "")) return true;
    if ((cv.lyricsLink ?? "") !== (iv.lyricsLink ?? "")) return true;
    if ((cv.lyricsText ?? "") !== (iv.lyricsText ?? "")) return true;
    if ((cv.songKey ?? "") !== (iv.songKey ?? "")) return true;
    if ((cv.difficulty ?? 1) !== (iv.difficulty ?? 1)) return true;
    if ((cv.proficiency ?? undefined) !== (iv.proficiency ?? undefined)) return true;

    // bpm 비교 (undefined 처리)
    const cvBpm = cv.bpm ?? undefined;
    const ivBpm = iv.bpm ?? undefined;
    if (cvBpm !== ivBpm) return true;

    // categoryNames 비교
    const cvCategories = [...(cv.categoryNames ?? [])].sort();
    const ivCategories = [...(iv.categoryNames ?? [])].sort();
    if (cvCategories.length !== ivCategories.length) return true;
    if (cvCategories.some((c, i) => c !== ivCategories[i])) return true;

    return false;
  }, [currentFormValues, initialValues]);

  const getReviewEventProperties = useCallback(
    () => ({
      channel_id: channelId || null,
      channel_identifier_present: Boolean(channelIdentifier),
      ...getSongRequestSummary(request, "request"),
      form_modified: isModified,
    }),
    [channelId, channelIdentifier, isModified, request]
  );

  const buildApprovalBody = useCallback((): ApproveSongAddRequestBody | undefined => {
    if (!isModified || !currentFormValues) return undefined;

    return {
      title: currentFormValues.title?.trim(),
      artistName: currentFormValues.artistName?.trim(),
      albumArt: currentFormValues.albumArt || undefined,
      karaokeUrl: currentFormValues.karaokeUrl || undefined,
      coverUrl: currentFormValues.coverUrl || undefined,
      originalUrl: currentFormValues.originalUrl || undefined,
      lyricsLink: currentFormValues.lyricsLink || undefined,
      lyricsText: currentFormValues.lyricsText || undefined,
      songKey: currentFormValues.songKey || undefined,
      difficulty: currentFormValues.difficulty,
      proficiency: currentFormValues.proficiency,
      bpm: currentFormValues.bpm ? Number(currentFormValues.bpm) : undefined,
      categoryNames: currentFormValues.categoryNames?.length
        ? currentFormValues.categoryNames
        : undefined,
    };
  }, [currentFormValues, isModified]);

  const buildAnalyticsApprovalBody = useCallback(():
    | ApproveSongAddRequestBody
    | undefined => {
    if (!isModified || !currentFormValues) return undefined;

    const body: ApproveSongAddRequestBody = {};
    const iv = initialValues;
    const cv = currentFormValues;

    if ((cv.title ?? "").trim() !== (iv.title ?? "").trim()) {
      body.title = cv.title?.trim();
    }
    if ((cv.artistName ?? "").trim() !== (iv.artistName ?? "").trim()) {
      body.artistName = cv.artistName?.trim();
    }
    if ((cv.albumArt ?? "") !== (iv.albumArt ?? "")) {
      body.albumArt = cv.albumArt || undefined;
    }
    if ((cv.karaokeUrl ?? "") !== (iv.karaokeUrl ?? "")) {
      body.karaokeUrl = cv.karaokeUrl || undefined;
    }
    if ((cv.coverUrl ?? "") !== (iv.coverUrl ?? "")) {
      body.coverUrl = cv.coverUrl || undefined;
    }
    if ((cv.originalUrl ?? "") !== (iv.originalUrl ?? "")) {
      body.originalUrl = cv.originalUrl || undefined;
    }
    if ((cv.lyricsLink ?? "") !== (iv.lyricsLink ?? "")) {
      body.lyricsLink = cv.lyricsLink || undefined;
    }
    if ((cv.lyricsText ?? "") !== (iv.lyricsText ?? "")) {
      body.lyricsText = cv.lyricsText || undefined;
    }
    if ((cv.songKey ?? "") !== (iv.songKey ?? "")) {
      body.songKey = cv.songKey || undefined;
    }
    if ((cv.difficulty ?? 1) !== (iv.difficulty ?? 1)) {
      body.difficulty = cv.difficulty;
    }
    if ((cv.proficiency ?? undefined) !== (iv.proficiency ?? undefined)) {
      body.proficiency = cv.proficiency;
    }
    if ((cv.bpm ?? undefined) !== (iv.bpm ?? undefined)) {
      body.bpm = cv.bpm ? Number(cv.bpm) : undefined;
    }

    const cvCategories = [...(cv.categoryNames ?? [])].sort();
    const ivCategories = [...(iv.categoryNames ?? [])].sort();
    if (
      cvCategories.length !== ivCategories.length ||
      cvCategories.some((category, index) => category !== ivCategories[index])
    ) {
      body.categoryNames = cv.categoryNames?.length ? cv.categoryNames : undefined;
    }

    return Object.keys(body).length > 0 ? body : undefined;
  }, [currentFormValues, initialValues, isModified]);

  useEffect(() => {
    if (!open) {
      viewedSignatureRef.current = null;
      return;
    }

    const signature = `${request.id}:${request.status}`;
    if (viewedSignatureRef.current === signature) return;
    viewedSignatureRef.current = signature;
    closeReasonRef.current = "dismissed";
    formModifiedCapturedRef.current = false;
    rejectReasonFocusCapturedRef.current = false;
    rejectReasonEditedCapturedRef.current = false;
    captureIntentEvent("channel_songbook_requests_review_dialog_viewed", {
      ...getReviewEventProperties(),
      ...getSongFormSummary(initialValues),
    });
  }, [getReviewEventProperties, initialValues, open, request.id, request.status]);

  useEffect(() => {
    if (!isModified || formModifiedCapturedRef.current) return;
    formModifiedCapturedRef.current = true;
    const body = buildAnalyticsApprovalBody();
    captureIntentEvent("channel_songbook_requests_review_form_modified_started", {
      ...getReviewEventProperties(),
      ...getSongFormSummary(currentFormValues ?? {}),
      ...getSongRequestApprovalPatchSummary(body),
    });
  }, [
    buildAnalyticsApprovalBody,
    currentFormValues,
    getReviewEventProperties,
    isModified,
  ]);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }

      captureIntentEvent("channel_songbook_requests_review_dialog_closed", {
        ...getReviewEventProperties(),
        close_reason: closeReasonRef.current,
      });
      onOpenChange(false);
    },
    [getReviewEventProperties, onOpenChange]
  );

  // 승인 처리
  const handleApprove = async () => {
    const body = buildApprovalBody();
    const analyticsBody = buildAnalyticsApprovalBody();
    const eventProperties = {
      ...getReviewEventProperties(),
      ...getSongFormSummary(currentFormValues ?? initialValues),
      ...getSongRequestApprovalPatchSummary(analyticsBody),
    };
    captureIntentEvent("channel_songbook_requests_review_approve_clicked", {
      ...eventProperties,
    });
    captureIntentEvent("channel_songbook_requests_review_approve_submitted", {
      ...eventProperties,
    });

    try {
      await approveMutation.mutateAsync({ id: request.id, body });
      captureIntentEvent("channel_songbook_requests_review_approve_succeeded", {
        ...eventProperties,
      });
      toast.success(
        isModified
          ? "노래 요청이 수정 후 승인되었습니다."
          : "노래 요청이 승인되었습니다."
      );
      closeReasonRef.current = "approved";
      handleDialogOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error("Failed to approve:", error);
      captureIntentEvent("channel_songbook_requests_review_approve_failed", {
        ...eventProperties,
        error_name: getErrorName(error),
        error_status: getApiErrorStatus(error),
      });
      toast.error("승인 처리에 실패했습니다.");
    }
  };

  // 거절 처리
  const handleReject = async () => {
    const eventProperties = {
      ...getReviewEventProperties(),
      ...getRejectReasonSummary(rejectReason),
    };
    rejectDialogCloseReasonRef.current = "confirm_clicked";
    captureIntentEvent("channel_songbook_requests_review_reject_submitted", {
      ...eventProperties,
    });

    try {
      await rejectMutation.mutateAsync({
        id: request.id,
        body: rejectReason ? { reason: rejectReason } : undefined,
      });
      captureIntentEvent("channel_songbook_requests_review_reject_succeeded", {
        ...eventProperties,
      });
      toast.success("노래 요청이 거절되었습니다.");
      rejectDialogCloseReasonRef.current = "rejected";
      handleRejectDialogOpenChange(false);
      setRejectReason("");
      closeReasonRef.current = "rejected";
      handleDialogOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error("Failed to reject:", error);
      rejectDialogCloseReasonRef.current = "failed";
      captureIntentEvent("channel_songbook_requests_review_reject_failed", {
        ...eventProperties,
        error_name: getErrorName(error),
        error_status: getApiErrorStatus(error),
      });
      toast.error("거절 처리에 실패했습니다.");
    }
  };

  const handleCloseClicked = useCallback(() => {
    closeReasonRef.current = "close_clicked";
    captureIntentEvent("channel_songbook_requests_review_close_clicked", {
      ...getReviewEventProperties(),
    });
    handleDialogOpenChange(false);
  }, [getReviewEventProperties, handleDialogOpenChange]);

  const handleRejectClicked = useCallback(() => {
    rejectDialogCloseReasonRef.current = "dismissed";
    rejectReasonFocusCapturedRef.current = false;
    rejectReasonEditedCapturedRef.current = false;
    captureIntentEvent("channel_songbook_requests_review_reject_clicked", {
      ...getReviewEventProperties(),
    });
    setRejectDialogOpen(true);
    captureIntentEvent("channel_songbook_requests_review_reject_dialog_opened", {
      ...getReviewEventProperties(),
    });
  }, [getReviewEventProperties]);

  const handleRejectDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      setRejectDialogOpen(nextOpen);
      if (!nextOpen) {
        captureIntentEvent(
          "channel_songbook_requests_review_reject_dialog_closed",
          {
            ...getReviewEventProperties(),
            ...getRejectReasonSummary(rejectReason),
            close_reason: rejectDialogCloseReasonRef.current,
          }
        );
      }
    },
    [getReviewEventProperties, rejectReason]
  );

  const handleRejectCancelClicked = useCallback(() => {
    rejectDialogCloseReasonRef.current = "cancel_clicked";
    captureIntentEvent("channel_songbook_requests_review_reject_cancel_clicked", {
      ...getReviewEventProperties(),
      ...getRejectReasonSummary(rejectReason),
    });
  }, [getReviewEventProperties, rejectReason]);

  const handleRejectReasonFocus = useCallback(() => {
    if (rejectReasonFocusCapturedRef.current) return;
    rejectReasonFocusCapturedRef.current = true;
    captureIntentEvent("channel_songbook_requests_review_reject_reason_focused", {
      ...getReviewEventProperties(),
      ...getRejectReasonSummary(rejectReason),
    });
  }, [getReviewEventProperties, rejectReason]);

  const handleRejectReasonChanged = useCallback(
    (value: string) => {
      if (!rejectReasonEditedCapturedRef.current && value.trim().length > 0) {
        rejectReasonEditedCapturedRef.current = true;
        captureIntentEvent(
          "channel_songbook_requests_review_reject_reason_edited",
          {
            ...getReviewEventProperties(),
            reject_reason_length_bucket: textLengthBucket(value),
          }
        );
      }
      setRejectReason(value);
    },
    [getReviewEventProperties]
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Music className="size-5" />
              노래 요청 검토
            </DialogTitle>
            <DialogDescription>
              요청 내용을 확인하고 필요시 수정 후 승인하거나 거절하세요.
            </DialogDescription>
          </DialogHeader>

          {/* 요청자 정보 */}
          <Alert>
            <User className="size-4" />
            <AlertDescription className="flex items-center gap-3">
              <Avatar className="size-6">
                <AvatarImage src={request.requester.profileImageUrl} />
                <AvatarFallback className="text-xs">
                  <AvatarPlaceholder />
                </AvatarFallback>
              </Avatar>
              <span>
                <span className="font-medium">{request.requester.nickname}</span>
                님의 요청
              </span>
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="size-3" />
                {formatDistanceToNow(new Date(request.createdAt), {
                  addSuffix: true,
                  locale: ko,
                })}
              </span>
            </AlertDescription>
          </Alert>

          {/* 노래 폼 (수정 가능) */}
          <div className="mt-4">
            <SongFormV2
              identifier={channelIdentifier}
              channelId={channelId}
              initialValues={initialValues}
              validationMode="relaxed"
              hideSubmitButton={true}
              onValuesChange={handleValuesChange}
            />
          </div>

          {/* 하단 액션 버튼 */}
          <div className="flex items-center justify-between pt-4 border-t mt-4">
            <div>
              {isModified && (
                <span className="text-sm text-amber-600 flex items-center gap-1">
                  <Pencil className="size-3" />
                  내용이 수정됨
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleCloseClicked}
                disabled={isProcessing}
              >
                닫기
              </Button>
              <Button
                variant="destructive"
                onClick={handleRejectClicked}
                disabled={isProcessing}
              >
                <XCircle className="size-4 mr-2" />
                거절
              </Button>
              <Button onClick={handleApprove} disabled={isProcessing}>
                {approveMutation.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="size-4 mr-2" />
                )}
                {isModified ? "수정 승인" : "승인"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 거절 확인 다이얼로그 */}
      <AlertDialog
        open={rejectDialogOpen}
        onOpenChange={handleRejectDialogOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>노래 요청을 거절하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              거절 사유를 입력하면 요청자에게 전달됩니다. (선택사항)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label htmlFor="rejectReason" className="sr-only">
              거절 사유
            </Label>
            <Textarea
              id="rejectReason"
              value={rejectReason}
              onFocus={handleRejectReasonFocus}
              onChange={(e) => handleRejectReasonChanged(e.target.value)}
              placeholder="거절 사유를 입력하세요 (선택)"
              className="h-24 resize-none"
              maxLength={500}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={rejectMutation.isPending}
              onClick={handleRejectCancelClicked}
            >
              취소
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : null}
              거절하기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
