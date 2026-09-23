import type { GetUserMeResponse } from "@/meloming/domains/user/types/user";
import { fetchServerJsonWithAuth } from "@/meloming/shared/lib/server-api-client";

/**
 * 서버 컴포넌트에서 사용하는 유저 API 함수들
 * 쿠키를 자동으로 전달합니다.
 */

/**
 * GET /user/me - 내 정보 조회 (인증 필요)
 * 서버 컴포넌트에서 사용하며, 쿠키를 자동으로 전달합니다.
 */
export async function getUserMeServer(): Promise<GetUserMeResponse | null> {
  const result = await fetchServerJsonWithAuth<GetUserMeResponse>(
    "/v1/user/me",
    {
      cache: "no-store",
    },
    "Failed to fetch user me"
  );

  return result;
}
