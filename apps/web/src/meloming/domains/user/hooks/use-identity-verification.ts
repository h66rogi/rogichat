"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import * as PortOne from "@portone/browser-sdk/v2";
import { authKeys } from "@/meloming/domains/auth/hooks/use-auth";
import { postIdentityVerification } from "@/meloming/domains/user/apis/users";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { isAxiosError } from "@/meloming/shared/lib/axios-error";

const PORTONE_STORE_ID = "store-6b6847b3-74de-4484-b0bf-3844c7324ebe";

// viewport 기반 useIsMobile은 데스크톱의 좁은 창(DevTools right dock 등)을
// 모바일로 오판정 → `if (isMobile) return`에서 조용히 종료되는 문제가 있어
// PortOne redirect 분기에는 user-agent 기반 판정 사용
function getIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

interface UseIdentityVerificationOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * 포트원 본인인증 hook
 *
 * @example
 * ```tsx
 * const { isVerifying, verify } = useIdentityVerification({
 *   onSuccess: () => console.log("본인인증 성공"),
 * });
 *
 * <Button onClick={verify} disabled={isVerifying}>
 *   본인인증 하기
 * </Button>
 * ```
 */
export function useIdentityVerification(
  options?: UseIdentityVerificationOptions
) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [isVerifying, setIsVerifying] = useState(false);
  const isMobile = getIsMobile();

  // options 를 ref 로 보관 — useEffect deps 에 options 객체가 들어가면 매 렌더 새 객체로 재실행 되어
  // redirect handler 중복 호출 risk. ref 로 latest closure 만 가리키게 하고 effect deps 에서 제외.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const verify = async () => {
    try {
      setIsVerifying(true);

      const identityVerificationId = `${crypto.randomUUID()}`;
      const currentUrl = window.location.origin + pathname;

      // 포트원 본인인증 요청
      const response = await PortOne.requestIdentityVerification({
        storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID || PORTONE_STORE_ID,
        identityVerificationId,
        channelKey:
          process.env.NEXT_PUBLIC_PORTONE_KCP_CHANNEL_KEY ||
          "channel-key-dummy",
        bypass: {
          kcpV2: {
            web_siteid:
              process.env.NEXT_PUBLIC_PORTONE_KCP_WEB_SITE_ID ||
              "web-site-id-dummy",
          },
        },
        // 모바일인 경우 redirectUrl 설정
        ...(isMobile && { redirectUrl: currentUrl }),
      });

      // 모바일 redirect 방식인 경우 여기서 끝
      if (isMobile) {
        return;
      }

      // 응답이 없는 경우 처리
      if (!response) {
        toast.error("본인인증 응답을 받지 못했습니다.");
        return;
      }

      // 프로세스가 제대로 완료되지 않은 경우 에러 코드가 존재
      if (response.code !== undefined) {
        toast.error(response.message || "본인인증에 실패했습니다.");
        return;
      }

      // 서버에 인증 ID 전송
      await postIdentityVerification({ identityVerificationId });

      // 사용자 정보 재조회
      await queryClient.invalidateQueries({ queryKey: authKeys.me() });
      toast.success("본인인증이 완료되었습니다.");
      optionsRef.current?.onSuccess?.();
    } catch (error) {
      console.error("본인인증 오류:", error);

      const fallbackMessage =
        isAxiosError(error) && error.response?.status === 403
          ? "본인인증이 제한된 사용자입니다. 고객센터로 문의해주세요."
          : "본인인증 중 오류가 발생했습니다.";
      toast.error(extractApiErrorMessage(error, fallbackMessage));

      optionsRef.current?.onError?.(
        error instanceof Error ? error : new Error("Unknown error")
      );
    } finally {
      setIsVerifying(false);
    }
  };

  return {
    isVerifying,
    verify,
  };
}
