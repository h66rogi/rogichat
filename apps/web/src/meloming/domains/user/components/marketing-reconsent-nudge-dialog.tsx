"use client";

import { authKeys, useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import {
  useFavoriteChannelAnniversaries,
  useFavoriteChannels,
} from "@/meloming/domains/channel/hooks/use-favorites";
import { useMyChannel } from "@/meloming/domains/channel/hooks/use-my-channel";
import { patchUserMe } from "@/meloming/domains/user/apis/users";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const DISMISS_KEY_PREFIX = "MELOMING_MKT_RECONSENT_DISMISS_";
const SHOWN_COUNT_KEY_PREFIX = "MELOMING_MKT_RECONSENT_SHOWN_COUNT_";
const DEFAULT_DISMISS_DAYS = 60;
const MAX_RETRY_BEFORE_FORCE_CLOSE = 2;

// task-heavy 라우트에서는 모달 노출을 막아 작업 흐름을 보존.
// 콘솔/오버레이/채널 매니지/스튜디오 진입 시엔 nudge 강제 skip.
const HARD_BLOCK_PREFIXES = [
  "/channel/", // 채널 페이지 전체 (manage 내부 task heavy)
  "/console",
  "/overlay",
  "/studio",
  "/mypage/console",
];

function getDismissKey(userId: number) {
  return `${DISMISS_KEY_PREFIX}${userId}`;
}

function getShownCountKey(userId: number) {
  return `${SHOWN_COUNT_KEY_PREFIX}${userId}`;
}

function safeRead(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    // ignore — fallthrough to sessionStorage
  }
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
    return;
  } catch {
    // private mode 등 — sessionStorage 폴백 (탭 한정)
  }
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // 둘 다 실패 — closedThisSession state로만 dismiss
  }
}

function safeRemove(key: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function isDismissed(userId: number): boolean {
  const value = safeRead(getDismissKey(userId));
  if (!value) return false;
  const expiry = new Date(value);
  if (isNaN(expiry.getTime())) {
    safeRemove(getDismissKey(userId));
    return false;
  }
  if (new Date() < expiry) return true;
  safeRemove(getDismissKey(userId));
  return false;
}

function setDismissed(userId: number, days: number = DEFAULT_DISMISS_DAYS) {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  safeWrite(getDismissKey(userId), expiry.toISOString());
}

function getShownCount(userId: number): number {
  const value = safeRead(getShownCountKey(userId));
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function incrementShownCount(userId: number): number {
  const next = getShownCount(userId) + 1;
  safeWrite(getShownCountKey(userId), String(next));
  return next;
}

// 비동의 처리(마이페이지 토글 / 첫 가입 모달 "비동의") 직후 호출하면
// 다음 nudge 모달이 즉시 뜨는 것을 방지.
// `days` 인자로 명시 거부일수록 더 긴 기간 차단 가능 (마이페이지 toggle-off=180).
export function dismissMarketingReconsentNudge(
  userId: number,
  days: number = DEFAULT_DISMISS_DAYS,
) {
  setDismissed(userId, days);
}

type Audience = "STREAMER" | "VIEWER";

interface UpcomingAnniversary {
  channelName: string;
  label: string;
  daysUntil: number;
}

interface ViewerFavoriteContext {
  favoriteCount: number;
  upcoming: UpcomingAnniversary | null;
}

function formatDday(daysUntil: number): string {
  if (daysUntil <= 0) return "D-DAY";
  return `D-${daysUntil}`;
}

function buildCopy(args: {
  audience: Audience;
  shownCount: number;
  viewer: ViewerFavoriteContext | null;
}): { title: ReactNode; description: string } {
  const { audience, shownCount, viewer } = args;

  if (audience === "STREAMER") {
    if (shownCount >= 2) {
      return {
        title: "혹시 마음 바뀌셨다면, 커미션 소식 받아볼까요?",
        description:
          "매주 1회 본인 채널과 매칭되는 커미션 추천을 보내드려요. 이벤트·할인 등 마케팅 정보도 함께 발송되며, 마이페이지에서 언제든 끌 수 있어요.",
      };
    }
    return {
      title: "멜로밍이 골라주는 커미션 소식, 이제 받아볼래요?",
      description:
        "매주 1회 본인 채널과 매칭되는 커미션 추천을 보내드려요. 이벤트·할인 등 마케팅 정보도 함께 발송되며, 마이페이지에서 언제든 끌 수 있어요.",
    };
  }

  const upcoming = viewer?.upcoming ?? null;
  const favoriteCount = viewer?.favoriteCount ?? 0;

  if (upcoming) {
    return {
      title: (
        <>
          <span className="text-rose-500 dark:text-rose-400 font-semibold">
            {formatDday(upcoming.daysUntil)}
          </span>{" "}
          {upcoming.channelName}님 {upcoming.label},{"\n"}놓치지 않으시려면
          알림 켜둘까요?
        </>
      ),
      description:
        "즐겨찾기한 스트리머의 데뷔일·생일·N주년 같은 기념일을 미리 알려드려요. 라이브 시작과 신곡 소식도 함께 받아볼 수 있고, 마이페이지에서 언제든 끌 수 있어요.",
    };
  }

  if (favoriteCount > 0) {
    return {
      title: `즐겨찾기한 ${favoriteCount}명 스트리머의 기념일, 미리 알려드릴까요?`,
      description:
        "데뷔 기념일·생일·N주년을 며칠 전 알림으로 받아보세요. 라이브 시작·신곡 소식도 함께 발송되며, 마이페이지에서 언제든 끌 수 있어요.",
    };
  }

  if (shownCount >= 2) {
    return {
      title: "혹시 마음 바뀌셨다면, 기념일·라이브 알림 받아볼래요?",
      description:
        "좋아하는 스트리머의 데뷔 기념일·생일·라이브 시작 소식을 멜로밍이 미리 알려드려요. 마이페이지에서 언제든 끌 수 있어요.",
    };
  }
  return {
    title: "좋아하는 스트리머의 기념일, 놓치지 않게 해드릴게요",
    description:
      "즐겨찾기한 스트리머의 데뷔일·생일·N주년 같은 기념일을 미리 알려드려요. 라이브 시작과 신곡 소식도 함께 받아볼 수 있고, 마이페이지에서 언제든 끌 수 있어요.",
  };
}

function pickNearestUpcoming(
  items: Array<{
    channelName: string;
    anniversaries?: {
      nextUpcomingEvent: { label: string; daysUntil: number } | null;
    } | null;
  }>,
  maxDaysAhead = 30,
): UpcomingAnniversary | null {
  let best: UpcomingAnniversary | null = null;
  for (const item of items) {
    const ev = item.anniversaries?.nextUpcomingEvent;
    if (!ev) continue;
    if (ev.daysUntil < 0 || ev.daysUntil > maxDaysAhead) continue;
    if (best === null || ev.daysUntil < best.daysUntil) {
      best = {
        channelName: item.channelName,
        label: ev.label,
        daysUntil: ev.daysUntil,
      };
    }
  }
  return best;
}

export default function MarketingReconsentNudgeDialog() {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  const pathname = usePathname();
  const [closedThisSession, setClosedThisSession] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const shownCaptureRef = useRef(false);

  const isOnHardBlockedRoute = useMemo(() => {
    if (!pathname) return false;
    return HARD_BLOCK_PREFIXES.some((p) => pathname.startsWith(p));
  }, [pathname]);

  // dialog 후보 (channel/favorites 조회 트리거용) — 실제 open 은 audience 확정 후
  const isCandidate = useMemo(() => {
    if (closedThisSession) return false;
    if (!isAuthenticated || !user) return false;
    if (user.isMarketingAllowableCheckNeeded) return false;
    if (user.marketingConsent !== false) return false;
    if (isOnHardBlockedRoute) return false;
    if (isDismissed(user.id)) return false;
    return true;
  }, [closedThisSession, isAuthenticated, user, isOnHardBlockedRoute]);

  const { data: myChannels, isLoading: myChannelsLoading } = useMyChannel({
    enabled: isCandidate,
  });

  // 본인이 소유한 채널이 하나라도 있으면 스트리머, 아니면 시청자 audience.
  // API 실패/빈 응답은 시청자로 처리해 후킹 카피 fallback 을 노출.
  const audience: Audience | null = useMemo(() => {
    if (!isCandidate) return null;
    if (myChannelsLoading) return null;
    return (myChannels ?? []).some((c) => c.isOwner) ? "STREAMER" : "VIEWER";
  }, [isCandidate, myChannels, myChannelsLoading]);

  const viewerFetchEnabled = isCandidate && audience === "VIEWER";

  const { data: favoriteChannelsData } = useFavoriteChannels(
    { page: 1, limit: 1 },
    { enabled: viewerFetchEnabled },
  );

  const favoriteCount = favoriteChannelsData?.total ?? 0;

  const { data: anniversariesData } = useFavoriteChannelAnniversaries({
    enabled: viewerFetchEnabled && favoriteCount > 0,
  });

  const upcoming = useMemo(() => {
    if (audience !== "VIEWER") return null;
    return pickNearestUpcoming(anniversariesData?.items ?? []);
  }, [audience, anniversariesData]);

  const viewerContext = useMemo<ViewerFavoriteContext | null>(() => {
    if (audience !== "VIEWER") return null;
    return { favoriteCount, upcoming };
  }, [audience, favoriteCount, upcoming]);

  const open = useMemo(() => {
    if (!isCandidate) return false;
    if (audience === null) return false;
    return true;
  }, [isCandidate, audience]);

  const shownCount = useMemo(() => {
    if (!user || !open) return 0;
    return getShownCount(user.id);
  }, [user, open]);

  const copy = useMemo(
    () =>
      buildCopy({
        audience: audience ?? "VIEWER",
        shownCount,
        viewer: viewerContext,
      }),
    [audience, shownCount, viewerContext],
  );

  // 모달이 처음 open될 때 1회만 PostHog impression 이벤트 + shown count 증가
  useEffect(() => {
    if (!open || !user || shownCaptureRef.current) return;
    shownCaptureRef.current = true;
    const nextCount = incrementShownCount(user.id);
    posthog?.capture("marketing_reconsent_nudge_shown", {
      userId: user.id,
      shownCount: nextCount,
      audience,
      favoriteChannelCount: viewerContext?.favoriteCount ?? null,
      upcomingDaysUntil: viewerContext?.upcoming?.daysUntil ?? null,
      upcomingLabel: viewerContext?.upcoming?.label ?? null,
    });
  }, [open, user, posthog, audience, viewerContext]);

  const { mutateAsync: agree, isPending } = useMutation({
    mutationFn: async () => {
      await patchUserMe({ marketingConsent: true });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authKeys.me() });
    },
  });

  if (!user) return null;

  const handleAgree = async () => {
    try {
      await agree();
      setDismissed(user.id);
      setClosedThisSession(true);
      posthog?.capture("marketing_reconsent_nudge_agreed", {
        userId: user.id,
        audience,
        favoriteChannelCount: viewerContext?.favoriteCount ?? null,
        upcomingDaysUntil: viewerContext?.upcoming?.daysUntil ?? null,
        upcomingLabel: viewerContext?.upcoming?.label ?? null,
      });
      toast.success(
        audience === "STREAMER"
          ? "커미션 추천 안내 수신을 시작했어요! 새로운 매칭 소식을 보내드릴게요."
          : "기념일·라이브 알림 수신을 시작했어요! 좋아하는 스트리머의 소식을 미리 알려드릴게요.",
      );
    } catch {
      const nextErrors = errorCount + 1;
      setErrorCount(nextErrors);
      if (nextErrors >= MAX_RETRY_BEFORE_FORCE_CLOSE) {
        // 사용자 트랩 방지: 2회 실패 시 세션 한정 close + 토스트 안내
        setClosedThisSession(true);
        toast.error("처리에 실패했어요. 잠시 후 마이페이지에서 다시 시도해 주세요.");
      } else {
        toast.error("처리 중 오류가 발생했어요. 다시 시도해 주세요.");
      }
    }
  };

  const handleDecline = (source: "button" | "dismiss" = "button") => {
    setDismissed(user.id);
    setClosedThisSession(true);
    posthog?.capture("marketing_reconsent_nudge_declined", {
      userId: user.id,
      source,
      audience,
      favoriteChannelCount: viewerContext?.favoriteCount ?? null,
      upcomingDaysUntil: viewerContext?.upcoming?.daysUntil ?? null,
    });
  };

  const isViewer = audience === "VIEWER";
  const declineLabel = isViewer ? "괜찮아요, 놓쳐도 돼요" : "안 받을래요";
  const agreeLabel = isViewer ? "네, 알려주세요" : "받을래요";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // 외부 클릭/Esc로 닫는 경우도 명시적 거부와 동일하게 60일 dismiss.
          // (사용자가 "닫기"를 거부 의사로 받아들이는 게 자연스럽다)
          handleDecline("dismiss");
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="whitespace-pre-line leading-snug">
            {copy.title}
          </DialogTitle>
          <DialogDescription
            id="reconsent-nudge-caveat"
            className="leading-relaxed py-4 text-sm text-muted-foreground"
          >
            {copy.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="w-full">
          <Button
            variant={isViewer ? "ghost" : "secondary"}
            disabled={isPending}
            onClick={() => handleDecline("button")}
            className={
              isViewer
                ? "flex-1 h-11 text-muted-foreground hover:text-foreground"
                : "flex-1 h-11"
            }
          >
            {declineLabel}
          </Button>
          <Button
            disabled={isPending}
            onClick={handleAgree}
            className={isViewer ? "flex-[2] h-11" : "flex-1 h-11"}
            variant="indigo"
            autoFocus
            aria-describedby="reconsent-nudge-caveat"
          >
            {agreeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
