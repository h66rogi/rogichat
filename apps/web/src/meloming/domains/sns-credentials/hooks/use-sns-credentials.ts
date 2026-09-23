import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { getSnsCredentials } from "@/meloming/domains/sns-credentials/apis/sns-credentials";
import type { SnsCredentialResponse } from "@/meloming/domains/sns-credentials/types/sns-credential";
import { snsCredentialsKeys } from "@/meloming/domains/sns-credentials/query-keys";

interface UseSnsCredentialsOptions {
  /**
   * 비활성화하려면 false. 기본 true.
   * 로그인하지 않은 사용자에서는 false 로 막아서 401 노이즈 방지.
   */
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
}

/**
 * 내 SNS 연동 상태 목록 조회 훅.
 *
 * 응답: 한 사용자당 한 행이 무조건 반환되며, 미연동 플랫폼은 isConnected=false.
 */
export function useSnsCredentials(
  options?: UseSnsCredentialsOptions,
): UseQueryResult<SnsCredentialResponse[], Error> {
  return useQuery({
    queryKey: snsCredentialsKeys.list(),
    queryFn: getSnsCredentials,
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 30 * 1000, // 30s — OAuth 흐름 직후 빠른 반영
    gcTime: options?.gcTime ?? 5 * 60 * 1000,
  });
}
