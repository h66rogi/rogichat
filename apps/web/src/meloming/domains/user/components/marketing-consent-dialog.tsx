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
import { useMemo } from "react";
import { toast } from "sonner";

export default function MarketingConsentDialog() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const shouldOpen = useMemo(() => {
    if (!user) return false;
    return user.isMarketingAllowableCheckNeeded === true;
  }, [user]);

  const { mutateAsync: updateConsent, isPending } = useMutation({
    mutationFn: async (consent: boolean) => {
      if (!user) return;
      await patchUserMe({
        nickname: user.nickname,
        profileImageUrl: user.profileImageUrl,
        marketingConsent: consent,
      });
    },
    onSuccess: async (_, consent) => {
      // 비동의 직후 user.marketingConsent === false로 캐시 갱신되면서
      // MarketingReconsentNudgeDialog가 즉시 뜨지 않도록 invalidate **이전에**
      // dismiss localStorage write. (race 차단)
      if (consent === false && user?.id) {
        dismissMarketingReconsentNudge(user.id);
      }
      await queryClient.invalidateQueries({ queryKey: authKeys.me() });
    },
  });

  if (!shouldOpen) return null;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const agree = document.getElementById("agree-button");
          if (agree) (agree as HTMLButtonElement).focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>마케팅 수신 동의</DialogTitle>
          <DialogDescription className="leading-relaxed py-4">
            서비스 관련 소식, 이벤트 및 프로모션에 대한 안내를 받아보시겠어요?
            <br />
            동의 여부는 마이페이지에서 언제든지 변경할 수 있어요.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="w-full">
          <Button
            variant="secondary"
            disabled={isPending}
            onClick={async () => {
              try {
                await updateConsent(false);
                toast.success(
                  "마케팅 수신 비동의 처리되었어요. (수신 거부 일자: " +
                    new Date().toLocaleDateString() +
                    ")"
                );
              } catch {
                toast.error("처리 중 오류가 발생했어요. 다시 시도해 주세요.");
              }
            }}
            className="flex-1"
          >
            비동의
          </Button>
          <Button
            disabled={isPending}
            onClick={async () => {
              try {
                await updateConsent(true);
                toast.success(
                  "마케팅 수신 동의해주셔서 감사합니다! (수신 동의 일자: " +
                    new Date().toLocaleDateString() +
                    ")"
                );
              } catch {
                toast.error("처리 중 오류가 발생했어요. 다시 시도해 주세요.");
              }
            }}
            className="flex-1"
            variant="indigo"
            id="agree-button"
            autoFocus
          >
            동의
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
