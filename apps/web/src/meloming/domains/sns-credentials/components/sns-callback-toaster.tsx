"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  isOauthCallbackReason,
  type OauthCallbackReason,
} from "@/meloming/domains/sns-credentials/types/sns-credential";
import { isSnsPlatform } from "@/meloming/domains/sns-credentials/types/sns-platform";
import { snsCredentialsKeys } from "@/meloming/domains/sns-credentials/query-keys";

const PLATFORM_LABEL: Record<string, string> = {
  X: "X",
  NAVER_CAFE: "네이버 카페",
};

const REASON_MESSAGE: Record<OauthCallbackReason, string> = {
  invalid_platform: "지원하지 않는 SNS 플랫폼입니다.",
  oauth_state_unavailable:
    "세션이 만료되었어요. 다시 시도해 주세요.",
  oauth_state_invalid:
    "OAuth 상태 검증에 실패했어요. 다시 시도해 주세요.",
  oauth_provider_failed:
    "SNS 서버 응답 오류로 연동에 실패했어요. 잠시 후 다시 시도해 주세요.",
  oauth_failed:
    "SNS 연동에 실패했어요. 다시 시도해 주세요.",
};

/**
 * OAuth callback 결과 표시 + URL 정리.
 *
 * 백엔드는 callback 처리 후 `/channel/me/manage/sns-settings?platform=X&status=success|error&reason=...`
 * 로 redirect 한다 (백엔드 `SnsCredentialsController.buildRedirect` 참고).
 *
 * 이 컴포넌트는 mount 시 1회:
 * - status=success → toast.success "연동 완료" + sns-credentials invalidate
 * - status=error   → reason 코드 매핑 → toast.error
 * - 어느 쪽이든 query string 을 제거 (replace) 해서 새로고침 시 중복 toast 방지
 */
export function SnsCallbackToaster({ basePath }: { basePath: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;

    const status = searchParams.get("status");
    if (status !== "success" && status !== "error") {
      return;
    }

    handledRef.current = true;

    const platformParam = searchParams.get("platform");
    const platformLabel =
      platformParam && isSnsPlatform(platformParam)
        ? PLATFORM_LABEL[platformParam]
        : null;

    if (status === "success") {
      toast.success(
        platformLabel ? `${platformLabel} 연동이 완료되었어요!` : "SNS 연동이 완료되었어요!",
      );
      // 캐시 즉시 갱신 — staleTime 30s 안이라도 새 상태 반영
      queryClient.invalidateQueries({ queryKey: snsCredentialsKeys.all });
    } else {
      const reasonParam = searchParams.get("reason");
      const message =
        reasonParam && isOauthCallbackReason(reasonParam)
          ? REASON_MESSAGE[reasonParam]
          : "SNS 연동에 실패했어요. 다시 시도해 주세요.";
      toast.error(
        platformLabel ? `${platformLabel} ${message}` : message,
      );
    }

    // URL 의 status/platform/reason 만 제거하고 다른 query 는 유지
    const next = new URLSearchParams(searchParams.toString());
    next.delete("status");
    next.delete("platform");
    next.delete("reason");
    const target = next.toString().length > 0
      ? `${basePath}?${next.toString()}`
      : basePath;

    // 현재 pathname 이 아직 redirect 직후라 정확하지 않을 수 있으므로 basePath 사용
    if (pathname !== null) {
      router.replace(target);
    }
  }, [basePath, pathname, queryClient, router, searchParams]);

  return null;
}
