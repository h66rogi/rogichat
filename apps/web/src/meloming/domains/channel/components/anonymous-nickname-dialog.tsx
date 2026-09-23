"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";

const STORAGE_KEY_PREFIX = "meloming:anon-song-request-nickname";
const MIN_LEN = 1;
const MAX_LEN = 20;

/**
 * 채널별로 별도 localStorage 키를 쓴다. 채널 A에서 입력한 닉네임이
 * 채널 B에서 prefill되는 UX/프라이버시 이슈 방지.
 * /channel/{identifier}/... 경로 기준. 매칭 실패 시 "global"로 fallback.
 */
function useStorageKey(): string {
  const pathname = usePathname();
  return useMemo(() => {
    const match = pathname?.match(/^\/channel\/([^/]+)/);
    const channel = match?.[1] ?? "global";
    return `${STORAGE_KEY_PREFIX}:${channel}`;
  }, [pathname]);
}

interface AnonymousNicknameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 확정된 닉네임. 서버에서 "익명 (웹신청) {닉네임}" 로 저장됨. */
  onSubmit: (nickname: string) => void;
  songTitle: string;
  artistName: string;
}

export function AnonymousNicknameDialog({
  open,
  onOpenChange,
  onSubmit,
  songTitle,
  artistName,
}: AnonymousNicknameDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const storageKey = useStorageKey();

  useEffect(() => {
    if (!open) return;
    const saved =
      typeof window !== "undefined"
        ? window.localStorage.getItem(storageKey) ?? ""
        : "";
    setValue(saved);
    setError(null);
  }, [open, storageKey]);

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (trimmed.length < MIN_LEN) {
      setError("닉네임을 입력해 주세요");
      return;
    }
    if (trimmed.length > MAX_LEN) {
      setError(`닉네임은 ${MAX_LEN}자 이하여야 해요`);
      return;
    }
    try {
      window.localStorage.setItem(storageKey, trimmed);
    } catch {
      // localStorage 접근 불가 (private mode 등) — 무시
    }
    onOpenChange(false);
    onSubmit(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-full flex items-center justify-center text-indigo-500 bg-indigo-500/10">
              <User className="size-4" />
            </span>
            익명으로 신청
          </DialogTitle>
          <DialogDescription>
            로그인 없이 신청할 수 있어요. 스트리머 화면에는
            <br />
            <span className="font-mono">익명 (웹신청) {value.trim() || "{닉네임}"}</span>
            {" "}로 표시돼요.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          <div className="rounded-lg bg-muted px-3 py-2.5 text-sm">
            <div className="text-muted-foreground text-xs mb-1">신청할 곡</div>
            <div className="font-medium break-all">
              {artistName} - {songTitle}
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="anon-nickname-input"
              className="text-sm font-medium"
            >
              닉네임
            </label>
            <Input
              id="anon-nickname-input"
              autoFocus
              value={value}
              maxLength={MAX_LEN}
              placeholder="1 ~ 20자 사이"
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-destructive min-h-[1rem]">
                {error ?? ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {value.length} / {MAX_LEN}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            익명 신청은 스트리머가 로그인 없이 신청을 받도록 허용한 경우에만
            가능해요. 남용 방지를 위해 같은 접속 환경에서 짧은 시간에 너무 많이
            신청하면 일시적으로 제한될 수 있어요.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleConfirm}>익명으로 신청하기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
