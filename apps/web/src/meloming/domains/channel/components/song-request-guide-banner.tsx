"use client";

import { useState, useCallback } from "react";
import {
  Music,
  HelpCircle,
  Radio,
  Sparkles,
  Gamepad2,
  ExternalLink,
  MessageSquare,
} from "lucide-react";
import {
  usePublicActiveSession,
  publicSessionKeys,
} from "@/meloming/domains/overlay/hooks/use-public-session";
import { useChannelPermission } from "@/meloming/domains/channel/hooks/use-channel";
import { useChannelVerifications } from "@/meloming/domains/channel/hooks/use-channel-verification";
import {
  useStartSession,
  useEndSession,
  useUpdateSessionSettings,
} from "@/meloming/domains/overlay/hooks/use-session";
import { useConsoleToken } from "@/meloming/domains/channel/hooks/use-console-token";
import { openConsolePopup } from "@/meloming/domains/channel/utils/console-popup";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { SongRequestGuideModal } from "./song-request-guide-modal";
import { EndSessionConfirmDialog } from "@/meloming/domains/overlay/components/end-session-confirm-dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Switch } from "@/meloming/shared/components/ui/switch";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";

interface SongRequestGuideBannerProps {
  userId: string;
}

export function SongRequestGuideBanner({
  userId,
}: SongRequestGuideBannerProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const { data: userPermission } = useChannelPermission(userId);
  const isOwner = userPermission?.isOwner ?? false;

  const {
    data: publicSession,
    isLoading: isPublicSessionLoading,
    refetch: refetchPublicSession,
  } = usePublicActiveSession(userId, {
    enabled: Boolean(userId),
    refetchInterval: 30_000,
  });

  const isLive = Boolean(publicSession?.isLive);
  const requestEnabled = Boolean(publicSession?.settings?.requestEnabled);
  const showRequestUI = isLive && requestEnabled;

  if (!publicSession) return null;

  if (isOwner) {
    return (
      <StreamerSection
        userId={userId}
        publicSession={publicSession}
        isPublicSessionLoading={isPublicSessionLoading}
        refetchPublicSession={refetchPublicSession}
      />
    );
  }

  if (showRequestUI) {
    return (
      <>
        <div
          className={clsx(
            "relative overflow-hidden rounded-xl mb-4 p-4",
            "bg-gradient-to-r from-fuchsia-600/15 via-pink-500/10 to-violet-500/15",
            "border-2 border-fuchsia-500/30"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="size-10 bg-fuchsia-500/20 rounded-full flex items-center justify-center flex-shrink-0">
              <Music className="size-5 text-fuchsia-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-sm">신청곡을 받고 있어요!</h3>
                <span className="flex items-center gap-1 px-2 py-0.5 bg-fuchsia-500/20 rounded-full text-[10px] font-bold text-fuchsia-600 dark:text-fuchsia-400">
                  <Sparkles className="size-2.5" />
                  LIVE
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                노래를 클릭하고{" "}
                <span className="font-semibold text-fuchsia-600 dark:text-fuchsia-400">
                  신청
                </span>{" "}
                버튼을 눌러 신청해보세요. 멜로밍 앱과 크롬 확장에서도
                신청할 수 있어요!
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGuideOpen(true)}
              className="flex-shrink-0 border-fuchsia-500/30 text-fuchsia-600 dark:text-fuchsia-400 hover:bg-fuchsia-500/10"
            >
              <HelpCircle className="size-4 mr-1" />
              신청 방법
            </Button>
          </div>
        </div>

        <SongRequestGuideModal
          open={guideOpen}
          onOpenChange={setGuideOpen}
          settings={publicSession.settings}
        />
      </>
    );
  }

  return (
    <>
      <div
        className={clsx(
          "relative overflow-hidden rounded-xl mb-4 p-4",
          "bg-gradient-to-r from-amber-500/10 via-orange-500/8 to-yellow-500/10",
          "border-2 border-amber-500/30"
        )}
      >
        <div className="flex items-start gap-3">
          <div className="size-10 bg-amber-500/20 rounded-full flex items-center justify-center flex-shrink-0">
            <MessageSquare className="size-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm mb-1">
              현재 신청곡을 받고 있지 않아요
            </h3>
            <p className="text-sm text-muted-foreground">
              스트리머에게{" "}
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                신청곡 모드를 켜달라고
              </span>{" "}
              알려주세요! 신청곡 모드가 켜지면 노래책, 앱, 크롬 확장에서
              원하는 곡을 신청할 수 있어요.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setGuideOpen(true)}
            className="flex-shrink-0 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
          >
            <HelpCircle className="size-4 mr-1" />
            신청 방법
          </Button>
        </div>
      </div>

      <SongRequestGuideModal
        open={guideOpen}
        onOpenChange={setGuideOpen}
        settings={publicSession.settings}
      />
    </>
  );
}

function StreamerSection({
  userId,
  publicSession,
  isPublicSessionLoading,
  refetchPublicSession,
}: {
  userId: string;
  publicSession: NonNullable<
    ReturnType<typeof usePublicActiveSession>["data"]
  >;
  isPublicSessionLoading: boolean;
  refetchPublicSession: () => void;
}) {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();

  const { data: channelVerifications } = useChannelVerifications(userId, {
    enabled: Boolean(userId),
  });
  const hasApprovedVerification = (channelVerifications ?? []).some(
    (v) => v.status === "APPROVED"
  );

  const { data: consoleTokenData } = useConsoleToken(userId);
  const startSessionMutation = useStartSession(userId);
  const endSessionMutation = useEndSession(userId);
  const updateSessionSettingsMutation = useUpdateSessionSettings(userId);

  const liveSessionId = publicSession.sessionId ?? null;
  const isLiveSessionActive = Boolean(publicSession.isLive && liveSessionId);
  const requestModeFromSession =
    publicSession.settings?.requestEnabled ?? false;

  const [requestModeOverride, setRequestModeOverride] = useState<
    boolean | null
  >(null);
  const requestModeEnabled = requestModeOverride ?? requestModeFromSession;
  const requestModeDisabled =
    isPublicSessionLoading ||
    startSessionMutation.isPending ||
    updateSessionSettingsMutation.isPending ||
    endSessionMutation.isPending ||
    (!isLiveSessionActive && !hasApprovedVerification);

  const [endConfirmOpen, setEndConfirmOpen] = useState(false);

  const handleRequestModeChange = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        if (!liveSessionId) return;
        setEndConfirmOpen(true);
        return;
      }

      setRequestModeOverride(checked);
      try {
        if (!liveSessionId) {
          await startSessionMutation.mutateAsync({});
          queryClient.invalidateQueries({
            queryKey: publicSessionKeys.active(userId),
          });
          setRequestModeOverride(null);
          toast.success("신청곡 모드를 시작했습니다");
          return;
        }

        await updateSessionSettingsMutation.mutateAsync({
          sessionId: liveSessionId,
          settings: { requestEnabled: checked },
        });
        queryClient.invalidateQueries({
          queryKey: publicSessionKeys.active(userId),
        });
        setRequestModeOverride(null);
        toast.success("신청곡 모드를 켰습니다");
      } catch (error: unknown) {
        setRequestModeOverride(null);
        const message = extractApiErrorMessage(
          error,
          "신청곡 모드 변경에 실패했습니다"
        );
        toast.error(message);
      }
    },
    [
      liveSessionId,
      userId,
      queryClient,
      startSessionMutation,
      updateSessionSettingsMutation,
    ]
  );

  const handleConfirmEndSession = async () => {
    if (!liveSessionId) {
      setEndConfirmOpen(false);
      return;
    }
    try {
      await endSessionMutation.mutateAsync(liveSessionId);
      queryClient.invalidateQueries({
        queryKey: publicSessionKeys.active(userId),
      });
      toast.success("신청곡 모드를 끄고 세션을 종료했습니다");
      setEndConfirmOpen(false);
    } catch (error: unknown) {
      const message = extractApiErrorMessage(
        error,
        "신청곡 모드 변경에 실패했습니다"
      );
      toast.error(message);
    }
  };

  return (
    <>
    <div
      className={clsx(
        "relative overflow-hidden rounded-xl mb-4",
        "bg-gradient-to-br from-indigo-600 via-indigo-600 to-purple-600",
        "shadow-lg shadow-indigo-500/20"
      )}
    >
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0%,transparent_50%)]" />

      <div className="relative p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-9 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
              <Radio className="size-4.5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">신청곡 모드</h3>
                {isLiveSessionActive && requestModeEnabled && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded-full text-[10px] font-bold text-white">
                    <Sparkles className="size-2.5" />
                    LIVE
                  </span>
                )}
              </div>
              <p className="text-xs text-white/70 mt-0.5">
                {!hasApprovedVerification && !isLiveSessionActive
                  ? "채널 인증을 완료하면 사용할 수 있어요"
                  : isLiveSessionActive && requestModeEnabled
                    ? "활성 중 · 끄면 세션 종료"
                    : "켜면 시청자가 곡을 신청할 수 있어요"}
              </p>
            </div>
          </div>
          <Switch
            checked={requestModeEnabled}
            disabled={requestModeDisabled}
            onCheckedChange={handleRequestModeChange}
            className="data-[state=checked]:bg-white data-[state=unchecked]:bg-white/30 [&>span]:data-[state=checked]:bg-indigo-600"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              openConsolePopup(userId, consoleTokenData?.consoleToken)
            }
            className={clsx(
              "flex-1 group flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg",
              "bg-white/15 text-white hover:bg-white/25 transition-colors font-semibold text-sm"
            )}
          >
            <Gamepad2 className="size-4" />
            리모컨 (신청곡 콘솔)
            <ExternalLink className="size-3.5 opacity-70" />
          </button>

          <Link
            href={`/channel/${userId}/manage/live`}
            className={clsx(
              "flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg",
              "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors text-sm"
            )}
          >
            관리
          </Link>
        </div>
      </div>
    </div>
    <EndSessionConfirmDialog
      open={endConfirmOpen}
      onOpenChange={(next) => {
        if (!next && !endSessionMutation.isPending) setEndConfirmOpen(false);
      }}
      onConfirm={() => void handleConfirmEndSession()}
      isPending={endSessionMutation.isPending}
    />
    </>
  );
}
