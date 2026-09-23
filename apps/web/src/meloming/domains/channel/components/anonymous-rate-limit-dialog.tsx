"use client";

import { useEffect, useMemo, useState } from "react";
import { Hourglass } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";

interface AnonymousRateLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 백엔드 429 응답의 retryAfterSeconds */
  retryAfterSeconds: number;
  /** windowSeconds 내 limit건 — 안내 문구에 사용 */
  limit?: number;
  windowSeconds?: number;
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "지금";
  if (seconds < 60) return `${seconds}초`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec === 0 ? `${min}분` : `${min}분 ${sec}초`;
}

/**
 * 익명 신청이 rate limit에 걸렸을 때 표시하는 전용 안내 모달.
 * 단순 toast.error가 아닌 구조화된 페이로드 기반으로 "언제쯤 다시 가능한지" 명확히 안내.
 */
export function AnonymousRateLimitDialog({
  open,
  onOpenChange,
  retryAfterSeconds,
  limit,
  windowSeconds,
}: AnonymousRateLimitDialogProps) {
  const [remaining, setRemaining] = useState(retryAfterSeconds);

  useEffect(() => {
    if (!open) return;
    setRemaining(retryAfterSeconds);
  }, [open, retryAfterSeconds]);

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      setRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [open]);

  const limitText = useMemo(() => {
    if (!limit || !windowSeconds) return null;
    const windowMin = Math.round(windowSeconds / 60);
    const windowLabel = windowMin >= 1 ? `${windowMin}분` : `${windowSeconds}초`;
    return `${windowLabel}에 ${limit}건`;
  }, [limit, windowSeconds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-full flex items-center justify-center text-amber-500 bg-amber-500/10">
              <Hourglass className="size-4" />
            </span>
            잠시 후 다시 시도해 주세요
          </DialogTitle>
          <DialogDescription>
            익명 신청은 남용 방지를 위해 신청 빈도가 제한돼 있어요
            {limitText ? ` (${limitText})` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          <div className="rounded-lg bg-muted px-4 py-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">
              재시도 가능 시점
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {remaining > 0 ? `약 ${formatCountdown(remaining)} 뒤` : "지금 다시 시도할 수 있어요"}
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            로그인하시면 이 제한 없이 자유롭게 신청할 수 있어요. 급하게 여러
            곡을 신청해야 한다면 로그인을 권장해요.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>확인</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
