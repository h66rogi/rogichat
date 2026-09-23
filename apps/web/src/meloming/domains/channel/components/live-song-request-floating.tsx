"use client";

import { useState, useMemo } from "react";
import { ListMusic, X, Radio, Coins, Trash2, HelpCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/meloming/shared/components/ui/button";
import { Badge } from "@/meloming/shared/components/ui/badge";
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
import { getSongRequestQueue, type SongRequest } from "@/meloming/domains/overlay/apis/song-requests";
import { songRequestKeys, useCancelMySongRequest } from "@/meloming/domains/overlay/hooks/use-song-requests";
import type { LiveSongRequestState } from "@/meloming/domains/channel/types/live-song-request";
import { SongRequestGuideModal } from "./song-request-guide-modal";
import type { PublicLiveSessionSettings } from "@/meloming/domains/overlay/apis/public-session";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import clsx from "clsx";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "대기",
  ACCEPTED: "수락",
  PLAYING: "재생",
  COMPLETED: "완료",
  REJECTED: "거절",
};

function getRequestPriceLabel(item: SongRequest): string | null {
  if (item.formattedPrice != null) {
    const trimmed = item.formattedPrice.trim();
    if (trimmed !== "") {
      return trimmed;
    }
    return item.priceSource === "FREE" || item.calculatedPrice == null
      ? "무료"
      : null;
  }
  if (item.priceSource === "FREE" || item.calculatedPrice == null) {
    return "무료";
  }
  return `${item.calculatedPrice.toLocaleString()}원`;
}

interface LiveSongRequestFloatingProps {
  requestState: LiveSongRequestState;
  settings?: PublicLiveSessionSettings | null;
}

type PanelTab = "queue" | "mine";

export function LiveSongRequestFloating({
  requestState,
  settings,
}: LiveSongRequestFloatingProps) {
  const [open, setOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>("queue");
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const cancelMutation = useCancelMySongRequest(requestState.sessionId);
  const userIdNum = user?.id ? Number(user.id) : null;

  const enabled = requestState.showRequestUI && !!requestState.sessionId;
  const { data, isLoading } = useQuery({
    queryKey: songRequestKeys.queue(requestState.sessionId ?? 0),
    queryFn: () => getSongRequestQueue(requestState.sessionId!, false),
    enabled,
    refetchInterval: 5000,
  });

  const { data: mineData, isLoading: mineLoading } = useQuery({
    queryKey: ["song-requests", "session-mine", requestState.sessionId ?? 0] as const,
    queryFn: () => getSongRequestQueue(requestState.sessionId!, true),
    enabled: enabled && userIdNum !== null,
    refetchInterval: 5000,
  });

  const queue = data?.queue ?? [];
  const totalCount = data?.totalCount ?? requestState.queueCount;

  const myRequests = useMemo<SongRequest[]>(() => {
    if (userIdNum === null || !mineData?.queue) return [];
    return [...mineData.queue]
      .filter((r) => r.requestUserId === userIdNum)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }, [mineData?.queue, userIdNum]);

  const effectiveTab: PanelTab = userIdNum !== null ? activeTab : "queue";
  const displayItems = effectiveTab === "mine" ? myRequests : queue;
  const displayIsLoading = effectiveTab === "mine" ? mineLoading : isLoading;

  const canCancelRequest = (item: SongRequest): boolean => {
    if (!user?.id || item.status !== "PENDING") return false;
    return item.requestUserId === Number(user.id);
  };

  const handleConfirmCancel = async () => {
    if (!cancelTargetId) return;
    try {
      await cancelMutation.mutateAsync(cancelTargetId);
      toast.success("신청곡을 취소했어요");
      setCancelTargetId(null);
    } catch (err) {
      const message = extractApiErrorMessage(err, "신청곡 취소에 실패했어요");
      toast.error(message);
    }
  };

  const summary = useMemo(() => {
    if (!requestState.maxQueueSize) {
      return `${totalCount}곡`;
    }
    return `${totalCount}/${requestState.maxQueueSize}곡`;
  }, [totalCount, requestState.maxQueueSize]);

  if (!requestState.showRequestUI) {
    return null;
  }

  return (
    <>
      {/* Backdrop overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 animate-in fade-in duration-200"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Queue Panel - right side */}
      {open && (
        <div
          className={clsx(
            "fixed z-50 rounded-2xl border-2 shadow-2xl flex flex-col",
            "bg-background",
            "border-fuchsia-500/30 dark:border-fuchsia-400/20",
            "animate-in fade-in duration-300",
            isMobile
              ? "left-3 right-3 bottom-4 slide-in-from-bottom-4"
              : "right-[88px] top-1/2 -translate-y-1/2 w-[380px] slide-in-from-right-4"
          )}
          style={{
            maxHeight: isMobile ? "70vh" : "calc(100vh - 80px)",
          }}
        >
          {/* Header with gradient accent */}
          <div className="flex-shrink-0 relative px-4 py-3 border-b border-fuchsia-500/20 bg-gradient-to-r from-fuchsia-500/10 via-pink-500/10 to-violet-500/10 rounded-t-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <Radio className="size-4 text-fuchsia-500" />
                  <span className="absolute -top-0.5 -right-0.5 size-2 bg-fuchsia-500 rounded-full" />
                </div>
                <span className="font-bold text-sm bg-gradient-to-r from-fuchsia-600 to-pink-600 dark:from-fuchsia-400 dark:to-pink-400 bg-clip-text text-transparent">
                  LIVE 신청곡
                </span>
                <Badge
                  className="text-[10px] font-semibold bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30 hover:bg-fuchsia-500/20"
                >
                  {summary}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                className="h-7 w-7 hover:bg-fuchsia-500/10 rounded-full"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {/* Tabs */}
          {userIdNum !== null && (
            <div className="flex-shrink-0 flex border-b border-fuchsia-500/10 bg-background">
              <button
                type="button"
                onClick={() => setActiveTab("queue")}
                className={clsx(
                  "flex-1 px-4 py-2.5 text-xs font-semibold transition-colors relative",
                  activeTab === "queue"
                    ? "text-fuchsia-600 dark:text-fuchsia-400"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                대기열 {totalCount > 0 && `(${totalCount})`}
                {activeTab === "queue" && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-fuchsia-500 to-pink-500" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("mine")}
                className={clsx(
                  "flex-1 px-4 py-2.5 text-xs font-semibold transition-colors relative",
                  activeTab === "mine"
                    ? "text-fuchsia-600 dark:text-fuchsia-400"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                내 신청 {myRequests.length > 0 && `(${myRequests.length})`}
                {activeTab === "mine" && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-fuchsia-500 to-pink-500" />
                )}
              </button>
            </div>
          )}

          {/* Queue List - scrollable */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="p-3 space-y-2">
              {displayIsLoading && (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  <div className="size-4 border-2 border-fuchsia-500 border-t-transparent rounded-full animate-spin mr-2" />
                  불러오는 중...
                </div>
              )}
              {!displayIsLoading && displayItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <ListMusic className="size-10 mb-3 opacity-30" />
                  {effectiveTab === "mine" ? (
                    <>
                      <p className="text-sm">이 세션에서 신청한 곡이 없어요</p>
                      <p className="text-xs mt-1 opacity-70">대기열에서 원하는 곡을 신청해보세요!</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm">대기 중인 신청곡이 없습니다</p>
                      <p className="text-xs mt-1 opacity-70">노래를 신청해보세요!</p>
                    </>
                  )}
                </div>
              )}
              {displayItems.map((item: SongRequest, index: number) => {
                const priceLabel = getRequestPriceLabel(item);

                return (
                  <div
                    key={item.id}
                    className={clsx(
                      "flex items-start gap-3 rounded-xl p-2.5 transition-all",
                      "bg-gradient-to-r from-muted/50 to-transparent",
                      "hover:from-fuchsia-500/10 hover:to-pink-500/5",
                      "border border-transparent hover:border-fuchsia-500/20"
                    )}
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="relative flex-shrink-0">
                      {item.song?.albumArt ? (
                        <img
                          src={item.song.albumArt}
                          alt={item.song.title}
                          className="size-11 rounded-lg object-cover ring-1 ring-black/5 dark:ring-white/10"
                        />
                      ) : (
                        <div className="size-11 rounded-lg bg-gradient-to-br from-fuchsia-500/20 to-pink-500/20 flex items-center justify-center">
                          <ListMusic className="size-5 text-fuchsia-500/60" />
                        </div>
                      )}
                      <span className="absolute -bottom-1 -right-1 size-5 rounded-full bg-background border border-fuchsia-500/30 flex items-center justify-center text-[10px] font-bold text-fuchsia-600 dark:text-fuchsia-400">
                        {index + 1}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">
                        {item.song?.title || item.rawTitle}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {item.song?.artist?.name || item.rawArtist}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[10px] text-muted-foreground/70">
                          by {item.requesterNickname}
                        </span>
                        {priceLabel && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30">
                            <Coins className="size-2.5 mr-0.5" />
                            {priceLabel}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <Badge
                        variant="outline"
                        className={clsx(
                          "text-[10px]",
                          item.status === "PLAYING" && "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/30"
                        )}
                      >
                        {STATUS_LABEL[item.status] ?? item.status}
                      </Badge>
                      {canCancelRequest(item) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          onClick={() => setCancelTargetId(item.id)}
                          disabled={cancelMutation.isPending}
                          className="h-6 w-6 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-full"
                          aria-label="내 신청곡 취소"
                          title="내 신청곡 취소"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Buttons - Right Middle (stacked) */}
      <div className="fixed z-40 right-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
        {/* Main queue button */}
        <div className="group relative">
          {/* Hover Tooltip - shown on hover when panel is closed */}
          {!open && (
            <div
              className={clsx(
                "absolute right-full mr-3 top-1/2 -translate-y-1/2",
                "pointer-events-none whitespace-nowrap",
                "opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0",
                "transition-all duration-200 ease-out"
              )}
            >
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-lg bg-background border border-fuchsia-500/30 text-sm font-semibold">
                <span className="bg-gradient-to-r from-fuchsia-600 to-pink-600 dark:from-fuchsia-400 dark:to-pink-400 bg-clip-text text-transparent">
                  신청곡
                </span>
                <span className="text-fuchsia-600 dark:text-fuchsia-400">
                  ({totalCount})
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            aria-label={open ? "신청곡 목록 닫기" : `신청곡 ${totalCount}곡 열기`}
            onClick={() => setOpen((prev) => !prev)}
            className={clsx(
              "relative flex items-center justify-center rounded-full text-white",
              "size-14",
              "bg-gradient-to-br from-fuchsia-600 via-pink-600 to-violet-600",
              "hover:from-fuchsia-500 hover:via-pink-500 hover:to-violet-500",
              "shadow-lg shadow-fuchsia-500/30 hover:shadow-xl hover:shadow-fuchsia-500/40",
              "transform hover:scale-110 active:scale-95",
              "transition-all duration-200 ease-out",
              "ring-2 ring-white/20 ring-offset-2 ring-offset-background",
              open && "ring-fuchsia-400/50 scale-105"
            )}
          >
            <Radio className="size-6" />
            {/* Count badge */}
            {!open && totalCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-white text-fuchsia-600 text-[11px] font-bold flex items-center justify-center border-2 border-background shadow">
                {totalCount}
              </span>
            )}
          </button>
        </div>

        {/* Guide button */}
        <button
          type="button"
          aria-label="신청 방법 안내"
          onClick={() => setGuideOpen(true)}
          className={clsx(
            "relative flex items-center justify-center rounded-full text-white",
            "size-10",
            "bg-gradient-to-br from-fuchsia-500/80 to-pink-500/80",
            "hover:from-fuchsia-500 hover:to-pink-500",
            "shadow-md shadow-fuchsia-500/20 hover:shadow-lg hover:shadow-fuchsia-500/30",
            "transform hover:scale-110 active:scale-95",
            "transition-all duration-200 ease-out",
            "ring-1 ring-white/20 ring-offset-1 ring-offset-background"
          )}
        >
          <HelpCircle className="size-5" />
        </button>
      </div>

      {/* Guide modal */}
      <SongRequestGuideModal
        open={guideOpen}
        onOpenChange={setGuideOpen}
        settings={settings}
      />

      {/* Cancel confirmation dialog */}
      <AlertDialog
        open={cancelTargetId !== null}
        onOpenChange={(next) => {
          if (!next) setCancelTargetId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>신청곡을 취소할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              취소하면 대기열에서 즉시 제거되고 되돌릴 수 없어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>
              닫기
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              disabled={cancelMutation.isPending}
              className="bg-rose-500 hover:bg-rose-600 text-white"
            >
              {cancelMutation.isPending ? "취소 중..." : "신청곡 취소"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
