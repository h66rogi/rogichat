"use client";

import { authKeys, useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { patchUserMe } from "@/meloming/domains/user/apis/users";
import { dismissMarketingReconsentNudge } from "@/meloming/domains/user/components/marketing-reconsent-nudge-dialog";
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
import { usePostHog } from "posthog-js/react";
import { forwardRef, useImperativeHandle, useState } from "react";
import { toast } from "sonner";

export type MktNudgeTriggerId =
  | "attendance"
  | "channel_favorite"
  | "anongift_payment"
  | "store_purchase";

const DISMISS_KEY_PREFIX = "MELOMING_MKT_NUDGE_DISMISS_";
// 2026-05-15 이전에 attendance trigger 만 있던 시절의 dismiss 키.
// 기존 dismiss 사용자가 재노출 받지 않게 lookup 시 함께 검사.
const LEGACY_ATTENDANCE_DISMISS_PREFIX = "MELOMING_MKT_FEATURE_NUDGE_DISMISS_";
const DEFAULT_DISMISS_DAYS = 60;

function getDismissKey(triggerId: MktNudgeTriggerId, userId: number) {
  return `${DISMISS_KEY_PREFIX}${triggerId}_${userId}`;
}

function getLegacyAttendanceDismissKey(userId: number) {
  return `${LEGACY_ATTENDANCE_DISMISS_PREFIX}${userId}`;
}

function safeRead(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    // fall through to sessionStorage
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
    // private mode 등 → sessionStorage 폴백 (탭 한정)
  }
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // 둘 다 실패 → in-memory state 만 유지
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

function readExpiry(key: string): Date | null {
  const value = safeRead(key);
  if (!value) return null;
  const expiry = new Date(value);
  if (isNaN(expiry.getTime())) {
    safeRemove(key);
    return null;
  }
  if (new Date() >= expiry) {
    safeRemove(key);
    return null;
  }
  return expiry;
}

function isDismissed(triggerId: MktNudgeTriggerId, userId: number): boolean {
  if (readExpiry(getDismissKey(triggerId, userId))) return true;
  if (triggerId === "attendance") {
    // legacy attendance 키 backward compat
    return readExpiry(getLegacyAttendanceDismissKey(userId)) !== null;
  }
  return false;
}

function setDismissed(
  triggerId: MktNudgeTriggerId,
  userId: number,
  days: number = DEFAULT_DISMISS_DAYS,
) {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  safeWrite(getDismissKey(triggerId, userId), expiry.toISOString());
}

export interface MktNudgeContext {
  triggerId: MktNudgeTriggerId;
  title: string;
  description: string;
  /** dismiss 일수 (default 60). 트리거별로 frequency 다르게 가져갈 수 있음. */
  dismissDays?: number;
  /** PostHog 이벤트에 함께 박을 추가 메타 (channelId, orderId 등) */
  meta?: Record<string, string | number | boolean | null | undefined>;
}

export interface MarketingNudgeDialogHandle {
  /**
   * 호출 시 다이얼로그 노출을 시도. 비동의자 + first-time consent 미요구 +
   * 해당 triggerId 의 dismiss 키 미설정인 사용자에게만 실제 노출.
   * 노출 시 true, skip 시 false.
   */
  triggerOpen: (ctx: MktNudgeContext) => boolean;
}

const MarketingFeatureNudgeDialog = forwardRef<
  MarketingNudgeDialogHandle,
  unknown
>(function MarketingFeatureNudgeDialog(_, ref) {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<MktNudgeContext | null>(null);
  const [errorCount, setErrorCount] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      triggerOpen: (nextCtx) => {
        if (!isAuthenticated || !user) return false;
        // first-time consent 다이얼로그가 떠야 하는 사용자는 그 모달 우선
        if (user.isMarketingAllowableCheckNeeded) return false;
        if (user.marketingConsent !== false) return false;
        if (isDismissed(nextCtx.triggerId, user.id)) return false;
        setCtx(nextCtx);
        setOpen(true);
        posthog?.capture("marketing_nudge_shown", {
          userId: user.id,
          trigger: nextCtx.triggerId,
          ...nextCtx.meta,
        });
        return true;
      },
    }),
    [isAuthenticated, user, posthog],
  );

  const { mutateAsync: agree, isPending } = useMutation({
    mutationFn: async () => {
      await patchUserMe({ marketingConsent: true });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authKeys.me() });
    },
  });

  if (!user || !ctx) return null;

  const dismissDays = ctx.dismissDays ?? DEFAULT_DISMISS_DAYS;

  const closeWithDismiss = (source: "button" | "dismiss") => {
    setDismissed(ctx.triggerId, user.id, dismissDays);
    setOpen(false);
    posthog?.capture("marketing_nudge_declined", {
      userId: user.id,
      source,
      trigger: ctx.triggerId,
      ...ctx.meta,
    });
  };

  const handleAgree = async () => {
    try {
      await agree();
      setDismissed(ctx.triggerId, user.id, dismissDays);
      // reconsent layout-level 모달이 같은 세션에서 즉시 안 뜨게 동시 dismiss
      dismissMarketingReconsentNudge(user.id);
      setOpen(false);
      posthog?.capture("marketing_nudge_agreed", {
        userId: user.id,
        trigger: ctx.triggerId,
        ...ctx.meta,
      });
      toast.success(
        "마케팅 수신 동의 완료! 좋은 소식을 가장 먼저 전해드릴게요.",
      );
    } catch {
      const nextErrors = errorCount + 1;
      setErrorCount(nextErrors);
      if (nextErrors >= 2) {
        setOpen(false);
        toast.error(
          "처리에 실패했어요. 잠시 후 마이페이지에서 다시 시도해 주세요.",
        );
      } else {
        toast.error("처리 중 오류가 발생했어요. 다시 시도해 주세요.");
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeWithDismiss("dismiss");
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="leading-snug">{ctx.title}</DialogTitle>
          <DialogDescription
            id="mkt-nudge-caveat"
            className="leading-relaxed py-4 text-sm text-muted-foreground"
          >
            {ctx.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="w-full">
          <Button
            variant="ghost"
            disabled={isPending}
            onClick={() => closeWithDismiss("button")}
            className="flex-1 h-11 text-muted-foreground hover:text-foreground"
          >
            괜찮아요
          </Button>
          <Button
            disabled={isPending}
            onClick={handleAgree}
            className="flex-[2] h-11"
            variant="indigo"
            autoFocus
            aria-describedby="mkt-nudge-caveat"
          >
            네, 알려주세요
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export default MarketingFeatureNudgeDialog;
