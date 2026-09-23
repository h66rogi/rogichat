"use client";

import { useState, type MouseEvent } from "react";
import { Radio, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/meloming/shared/components/ui/button";
import LoginRequiredDialog from "@/meloming/shared/components/common/login-required-dialog";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { useCreateSongRequest, songRequestKeys, useRequestedSongIds } from "@/meloming/domains/overlay/hooks/use-song-requests";
import type { Song } from "@/meloming/domains/channel/types/song";
import type { LiveSongRequestState } from "@/meloming/domains/channel/types/live-song-request";
import {
  SongRequestActionModal,
  type SongRequestActionModalVariant,
} from "./song-request-action-modal";
import { AnonymousNicknameDialog } from "./anonymous-nickname-dialog";
import { AnonymousRateLimitDialog } from "./anonymous-rate-limit-dialog";

interface LiveSongRequestButtonProps {
  song: Song;
  requestState: LiveSongRequestState;
  className?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "secondary" | "outline" | "ghost" | "link" | "destructive";
  iconOnly?: boolean;
  onRequested?: () => void;
}

type RequestState =
  | { kind: "operator" }
  | { kind: "duplicate" }
  | { kind: "paused" }
  | { kind: "blocked" }
  | { kind: "queue-full" }
  | { kind: "unavailable" }
  | { kind: "ready" };

export function LiveSongRequestButton({
  song,
  requestState,
  className,
  size = "sm",
  variant = "outline",
  iconOnly = false,
  onRequested,
}: LiveSongRequestButtonProps) {
  const { user, isAuthenticated } = useAuth();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [actionModalVariant, setActionModalVariant] =
    useState<SongRequestActionModalVariant | null>(null);
  const [anonymousDialogOpen, setAnonymousDialogOpen] = useState(false);
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    retryAfterSeconds: number;
    limit?: number;
    windowSeconds?: number;
  } | null>(null);
  const queryClient = useQueryClient();
  const createRequestMutation = useCreateSongRequest(requestState.sessionId);
  const { data: requestedSongIdsData } = useRequestedSongIds(
    requestState.sessionId,
    requestState.preventDuplicateSongs,
  );
  const requestedSongIds = requestedSongIdsData?.songIds ?? [];

  const isBlockedCategory = requestState.blockedCategoryIds.length > 0 &&
    (
      song.songCategories?.some((sc) =>
        requestState.blockedCategoryIds.includes(sc.categoryId)
      ) ||
      song.categories?.some((c) =>
        requestState.blockedCategoryIds.includes(c.id)
      )
    );

  const isDuplicateRequest = requestState.preventDuplicateSongs &&
    requestedSongIds.includes(song.id);

  const operatorMayRequest = requestState.viewerIsOperator && requestState.showRequestUI;
  const isPending = requestState.loading || createRequestMutation.isPending;

  // 라벨 / 클릭 동작이 어긋나지 않도록 한 곳에서 상태 결정.
  // 우선순위: operator > duplicate > paused > blocked > queue-full > 기타
  const resolveState = (): RequestState => {
    if (operatorMayRequest) return { kind: "operator" };
    if (isDuplicateRequest) return { kind: "duplicate" };
    if (requestState.paused) return { kind: "paused" };
    if (isBlockedCategory) return { kind: "blocked" };
    if (requestState.isQueueFull) return { kind: "queue-full" };
    if (!requestState.canRequest) return { kind: "unavailable" };
    return { kind: "ready" };
  };

  const state = resolveState();

  // 버튼이 실제로 disable되는 경우는 로딩 중이거나 이미 신청한 곡(중복) 뿐.
  // 그 외 차단 상황은 전부 active — 클릭하면 안내 모달이 뜬다.
  const isDisabled = isPending || state.kind === "duplicate";

  const displayLabel = (() => {
    switch (state.kind) {
      case "operator":
      case "ready":
        return "신청";
      case "duplicate":
        return "신청됨";
      case "paused":
        return "일시정지";
      case "blocked":
      case "queue-full":
      case "unavailable":
        return "신청 불가";
    }
  })();

  const LeadingIcon = isPending ? Loader2 : Radio;

  /**
   * 신청 제출 공통 루틴.
   * 로그인/익명 분기는 호출자에서 처리하고, 여기서는 anonymousNickname 유무만으로
   * 서버에 전달할 페이로드를 결정한다. 서버는 공개 경로에서 requesterPlatformId/nickname을
   * 무시하고 재구성하므로 더미 값을 보내도 된다 (trust boundary).
   */
  const submitRequest = async (opts?: { anonymousNickname?: string }) => {
    const isAnonRequest = Boolean(opts?.anonymousNickname);
    try {
      await createRequestMutation.mutateAsync({
        songId: song.id,
        rawArtist: song.artist.name,
        rawTitle: song.title,
        requesterPlatformId: isAnonRequest
          ? "anon_pending"
          : `web_${user?.id ?? "guest"}`,
        requesterNickname: isAnonRequest
          ? opts!.anonymousNickname!
          : user?.nickname ?? "익명",
        source: "MANUAL",
        anonymousNickname: opts?.anonymousNickname,
      });
      toast.success(
        isAnonRequest
          ? `"${song.title}" 익명으로 신청 완료`
          : `"${song.title}" 신청 완료`,
      );
      onRequested?.();
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
      const message = extractApiErrorMessage(error, "신청에 실패했습니다");
      toast.error(message);
    }
  };

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();

    // 신청 불가 상태는 로그인 여부와 무관하게 안내한다.
    switch (state.kind) {
      case "duplicate":
        // disable 상태이므로 클릭 도달 불가 — 방어 코드
        return;
      case "unavailable":
        toast.error("지금은 신청을 받을 수 없어요");
        return;
      case "paused":
      case "blocked":
      case "queue-full":
        setActionModalVariant(state.kind);
        return;
      case "operator":
      case "ready":
        break;  // ↓ 실제 신청 시도
    }

    if (!requestState.sessionId) {
      toast.error("신청곡 모드가 활성화되어 있지 않아요");
      return;
    }

    // 실제 신청 가능한 상태 — 로그인/익명 분기
    if (!isAuthenticated) {
      if (requestState.allowAnonymous) {
        setAnonymousDialogOpen(true);
        return;
      }
      setLoginDialogOpen(true);
      return;
    }

    await submitRequest();
  };

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        disabled={isDisabled}
        onClick={handleClick}
      >
        <LeadingIcon
          className={
            iconOnly
              ? "size-4"
              : isPending
                ? "size-4 animate-spin mr-1.5"
                : "size-4 mr-1.5"
          }
        />
        {!iconOnly && displayLabel}
      </Button>
      <LoginRequiredDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
      />
      {actionModalVariant && (
        <SongRequestActionModal
          open={actionModalVariant !== null}
          onOpenChange={(next) => {
            if (!next) setActionModalVariant(null);
          }}
          variant={actionModalVariant}
        />
      )}
      <AnonymousNicknameDialog
        open={anonymousDialogOpen}
        onOpenChange={setAnonymousDialogOpen}
        songTitle={song.title}
        artistName={song.artist.name}
        onSubmit={(nickname) => {
          void submitRequest({ anonymousNickname: nickname });
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
