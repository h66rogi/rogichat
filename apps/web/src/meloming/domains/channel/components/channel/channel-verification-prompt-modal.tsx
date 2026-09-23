"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { ChannelAuthDialog } from "@/meloming/domains/channel/components/management/channel-auth-dialog";
import { useChannelVerifications } from "@/meloming/domains/channel/hooks/use-channel-verification";

const STORAGE_KEY = "channel-verification-dismiss-until";

interface ChannelVerificationPromptModalProps {
  channelId: number;
  platformUrl: string | null;
  isOwner: boolean;
  isVerified: boolean;
}

export function ChannelVerificationPromptModal({
  channelId,
  platformUrl,
  isOwner,
  isVerified,
}: ChannelVerificationPromptModalProps) {
  const router = useRouter();
  const params = useParams();
  const identifier = (params?.user as string) || "";

  const [open, setOpen] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);

  // 채널 인증 상태 조회 (PENDING 상태 체크용)
  const { data: verifications, isLoading: isVerificationLoading } = useChannelVerifications(identifier, {
    enabled: isOwner && !isVerified,
  });

  // 인증 다이얼로그가 닫힐 때 페이지 새로고침 (인증 완료 반영)
  const handleAuthDialogChange = (isOpen: boolean) => {
    setShowAuthDialog(isOpen);
    if (!isOpen) {
      // 다이얼로그가 닫힐 때 페이지 새로고침하여 인증 상태 반영
      router.refresh();
    }
  };

  useEffect(() => {
    // 소유자가 아니거나 이미 인증된 채널이면 표시하지 않음
    if (!isOwner || isVerified) {
      return;
    }

    // 인증 상태 로딩 중이면 대기
    if (isVerificationLoading) {
      return;
    }

    // PENDING 또는 APPROVED 상태인 인증이 있으면 표시하지 않음
    if (verifications?.some((v) => v.status === "PENDING" || v.status === "APPROVED")) {
      return;
    }

    // localStorage에서 dismiss 시간 확인
    const dismissUntil = localStorage.getItem(
      `${STORAGE_KEY}-${channelId}`
    );

    if (dismissUntil) {
      const dismissTime = parseInt(dismissUntil, 10);
      if (Date.now() < dismissTime) {
        // 아직 dismiss 기간이 남아있으면 표시하지 않음
        return;
      }
      // 기간이 지났으면 localStorage 정리
      localStorage.removeItem(`${STORAGE_KEY}-${channelId}`);
    }

    // 모달 표시
    setOpen(true);
  }, [isOwner, isVerified, channelId, verifications, isVerificationLoading]);

  const handleDismissUntilTomorrow = () => {
    // 24시간 후 시간 저장
    const dismissUntil = Date.now() + 24 * 60 * 60 * 1000;
    localStorage.setItem(
      `${STORAGE_KEY}-${channelId}`,
      dismissUntil.toString()
    );
    setOpen(false);
  };

  const handleStartVerification = () => {
    setOpen(false);
    setShowAuthDialog(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-[450px]"
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="text-center sm:text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
              <ShieldAlert className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            </div>
            <DialogTitle className="text-xl">채널 인증, 10초면 끝나요!</DialogTitle>
            <DialogDescription className="text-base mt-2">
              지금 바로 인증하고 멜로밍을 계속 이용해보세요.
              <br />
              2026년 7월 1일부터는 인증된 채널만 관리할 수 있어요.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleStartVerification}
                size="lg"
                className="w-full gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                바로 인증하기
              </Button>
              <Button
                onClick={handleDismissUntilTomorrow}
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
              >
                내일까지 보지 않기
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ChannelAuthDialog
        open={showAuthDialog}
        onOpenChange={handleAuthDialogChange}
        platformUrl={platformUrl}
      />
    </>
  );
}
