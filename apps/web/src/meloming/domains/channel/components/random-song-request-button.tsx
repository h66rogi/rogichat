"use client";

import { useState, type MouseEvent } from "react";
import { Shuffle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/meloming/shared/components/ui/button";
import LoginRequiredDialog from "@/meloming/shared/components/common/login-required-dialog";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import {
  useCreateSongRequest,
  songRequestKeys,
} from "@/meloming/domains/overlay/hooks/use-song-requests";
import type { LiveSongRequestState } from "@/meloming/domains/channel/types/live-song-request";
import { AnonymousNicknameDialog } from "./anonymous-nickname-dialog";
import { AnonymousRateLimitDialog } from "./anonymous-rate-limit-dialog";

interface RandomSongRequestButtonProps {
  requestState: LiveSongRequestState;
  className?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "secondary" | "outline" | "ghost" | "link" | "destructive";
  /** true 면 라벨 숨기고 아이콘만. mobile 좁은 영역에서 사용. */
  iconOnly?: boolean;
}

/**
 * 시청자가 "랜덤신청" 을 트리거하면 백엔드가 채널 노래책에서 임의 1곡을 골라 신청한다.
 *
 * 차단 조건은 LiveSongRequestButton 과 동일 (paused/queue-full).
 * 단 곡-specific 조건(중복/blocked category) 은 백엔드 추출 단계에서 자동 적용되므로
 * 클라이언트가 사전 검증할 필요 없다 — 추출 풀이 비어있으면 백엔드가 400 으로 안내.
 */
export function RandomSongRequestButton({
  requestState,
  className,
  size = "default",
  variant = "outline",
  iconOnly = false,
}: RandomSongRequestButtonProps) {
  const { user, isAuthenticated } = useAuth();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [anonymousDialogOpen, setAnonymousDialogOpen] = useState(false);
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    retryAfterSeconds: number;
    limit?: number;
    windowSeconds?: number;
  } | null>(null);
  const queryClient = useQueryClient();
  const createRequestMutation = useCreateSongRequest(requestState.sessionId);

  const isPending = createRequestMutation.isPending;
  // 운영자가 아닌 일반 시청자는 운영 상태에 따른 제한을 적용한다.
  const operatorMayRequest =
    requestState.viewerIsOperator && requestState.showRequestUI;

  const submitRandom = async (opts?: { anonymousNickname?: string }) => {
    const isAnonRequest = Boolean(opts?.anonymousNickname);
    try {
      const created = await createRequestMutation.mutateAsync({
        // RANDOM 은 backend 가 노래책에서 추출 — songId/rawArtist/rawTitle 은 채워준다.
        rawArtist: "",
        rawTitle: "",
        requesterPlatformId: isAnonRequest
          ? "anon_pending"
          : `web_${user?.id ?? "guest"}`,
        requesterNickname: isAnonRequest
          ? opts!.anonymousNickname!
          : user?.nickname ?? "익명",
        source: "MANUAL",
        anonymousNickname: opts?.anonymousNickname,
        requestType: "RANDOM",
      });
      const pickedArtist = created.song?.artist?.name ?? created.rawArtist;
      const pickedTitle = created.song?.title ?? created.rawTitle;
      const label = pickedArtist
        ? `"${pickedArtist} - ${pickedTitle}"`
        : `"${pickedTitle}"`;
      toast.success(
        isAnonRequest
          ? `${label} 익명으로 랜덤 신청 완료`
          : `${label} 랜덤 신청 완료`,
      );
      if (requestState.sessionId) {
        queryClient.invalidateQueries({
          queryKey: songRequestKeys.requestedSongIds(requestState.sessionId),
        });
      }
    } catch (error: any) {
      const data = error?.response?.data;
      if (data?.code === "ANONYMOUS_RATE_LIMIT") {
        setRateLimitInfo({
          retryAfterSeconds: Number(data.retryAfterSeconds) || 60,
          limit: typeof data.limit === "number" ? data.limit : undefined,
          windowSeconds:
            typeof data.windowSeconds === "number"
              ? data.windowSeconds
              : undefined,
        });
        return;
      }
      const message = extractApiErrorMessage(error, "랜덤 신청에 실패했습니다");
      toast.error(message);
    }
  };

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();

    if (!requestState.sessionId) {
      toast.error("신청곡 모드가 활성화되어 있지 않아요");
      return;
    }

    if (!operatorMayRequest) {
      if (requestState.paused) {
        toast.error("스트리머가 신청곡을 잠시 멈췄어요");
        return;
      }
      if (requestState.isQueueFull) {
        toast.error("신청 대기열이 가득 찼어요");
        return;
      }
      if (!requestState.canRequest) {
        toast.error("지금은 신청을 받을 수 없어요");
        return;
      }
    }

    // 로그인/익명 분기
    if (!isAuthenticated) {
      if (requestState.allowAnonymous) {
        setAnonymousDialogOpen(true);
        return;
      }
      setLoginDialogOpen(true);
      return;
    }

    await submitRandom();
  };

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        disabled={isPending}
        onClick={handleClick}
      >
        {isPending ? (
          <Loader2 className={iconOnly ? "size-4 animate-spin" : "size-4 mr-1.5 animate-spin"} />
        ) : (
          <Shuffle className={iconOnly ? "size-4" : "size-4 mr-1.5"} />
        )}
        {!iconOnly && "랜덤신청"}
      </Button>
      <LoginRequiredDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
      />
      <AnonymousNicknameDialog
        open={anonymousDialogOpen}
        onOpenChange={setAnonymousDialogOpen}
        artistName="랜덤"
        songTitle="노래책에서 자동 선택"
        onSubmit={(nickname) => {
          void submitRandom({ anonymousNickname: nickname });
        }}
      />
      <AnonymousRateLimitDialog
        open={rateLimitInfo !== null}
        onOpenChange={(next) => {
          if (!next) setRateLimitInfo(null);
        }}
        retryAfterSeconds={rateLimitInfo?.retryAfterSeconds ?? 60}
        limit={rateLimitInfo?.limit}
        windowSeconds={rateLimitInfo?.windowSeconds}
      />
    </>
  );
}
