"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { authKeys } from "@/meloming/domains/auth/hooks/use-auth";
import { postDiditSession } from "@/meloming/domains/user/apis/users";
import { isAxiosError } from "@/meloming/shared/lib/axios-error";

interface UseDiditVerificationOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Didit 글로벌 KYC 본인인증 hook (해외 사용자).
 *
 * 한국 휴대폰 인증 불가 사용자용. PortOne 과 달리 모달 SDK 가 아니라
 * Didit 호스팅 페이지로 redirect — 웹캠 없는 PC 는 Didit 가 자동으로
 * QR 핸드오프(휴대폰 스캔)를 제공하므로 isMobile 분기 불필요.
 *
 * isIdentityVerified 전환은 백엔드 webhook 이 단일 권위. 콜백 복귀 시엔
 * status 쿼리를 읽어 토스트만 노출하고 queryClient 로 user 최신화한다.
 *
 * 백엔드 콜백 URL 은 origin='meloming' 으로 화이트리스트 매핑 — 기존 서비스
 * 도메인으로 복귀.
 */
export function useDiditVerification(options?: UseDiditVerificationOptions) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isVerifying, setIsVerifying] = useState(false);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const sessionId = searchParams.get("verificationSessionId");
    const status = searchParams.get("status");
    if (!sessionId || !status) return;

    const handle = async () => {
      try {
        if (status === "Approved") {
          await queryClient.invalidateQueries({ queryKey: authKeys.me() });
          toast.success("본인인증이 완료되었습니다.");
          optionsRef.current?.onSuccess?.();
        } else if (status === "Declined") {
          toast.error("본인인증에 실패했습니다.");
        } else {
          toast.info("심사 중입니다. 결과는 잠시 후 반영됩니다.");
        }
      } finally {
        router.replace(pathname);
      }
    };

    handle();
    // searchParams 변화만 트리거. pathname/router/queryClient 는 안정 ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const verify = useCallback(async () => {
    setIsVerifying(true);
    try {
      const { url } = await postDiditSession({
        language: "ko",
        origin: "meloming",
      });
      if (!url) {
        toast.error("본인인증 진행에 실패했습니다.");
        setIsVerifying(false);
        return;
      }
      window.location.href = url;
      // 성공 시 redirect 발생하므로 setIsVerifying(false) 불필요.
    } catch (error) {
      // apiClient 는 axios — AxiosError.response.status 로 HTTP status 추출.
      if (isAxiosError(error) && error.response?.status === 403) {
        toast.error("본인인증 사용이 제한되었습니다.");
      } else {
        toast.error("본인인증 진행에 실패했습니다.");
      }
      optionsRef.current?.onError?.(
        error instanceof Error ? error : new Error("Unknown error"),
      );
      setIsVerifying(false);
    }
  }, []);

  return { isVerifying, verify };
}
