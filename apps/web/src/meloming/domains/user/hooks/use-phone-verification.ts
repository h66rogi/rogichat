"use client";
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { postIdentityPhoneSend, postIdentityPhoneCheck } from "@/meloming/domains/user/apis/users";
import { authKeys } from "@/meloming/domains/auth/hooks/use-auth";

export function usePhoneVerification(options?: { onSuccess?: () => void }) {
  const queryClient = useQueryClient();
  const [isSending, setIsSending] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const send = useCallback(async (phoneNumber: string): Promise<boolean> => {
    try {
      setIsSending(true);
      await postIdentityPhoneSend({ phoneNumber });
      return true;
    } catch (error) {
      toast.error((error as Error)?.message || "인증번호 발송에 실패했어요.");
      return false;
    } finally { setIsSending(false); }
  }, []);

  const check = useCallback(async (phoneNumber: string, code: string): Promise<boolean> => {
    try {
      setIsChecking(true);
      await postIdentityPhoneCheck({ phoneNumber, code });
      await queryClient.invalidateQueries({ queryKey: authKeys.me() });
      toast.success("전화번호 인증이 완료됐어요.");
      options?.onSuccess?.();
      return true;
    } catch (error) {
      toast.error((error as Error)?.message || "인증에 실패했어요.");
      return false;
    } finally { setIsChecking(false); }
  }, [queryClient, options]);

  return { send, check, isSending, isChecking };
}
