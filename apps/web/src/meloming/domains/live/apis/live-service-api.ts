import axios from "axios";
import { attachResponseInterceptor } from "@/meloming/shared/lib/api-client";
import type { PlaybackResponse } from "../types/live";

/**
 * meloming-live-service 와 직접 통신하는 axios client.
 *
 * - Prod : https://live-api.meloming.com
 * - QA   : https://live-api.meloming.pri.sbalyd.com
 *
 * 인증: meloming-back 이 httpOnly cookie `accessToken` 을 cookie domain
 * `.meloming.com` / `.meloming.pri.sbalyd.com` 으로 굽기 때문에 live-api 서브도메인도
 * 같은 cookie 를 자동으로 받는다. withCredentials:true 로 cross-host 전송,
 * live-service auth.ExtractToken 이 cookie 의 token 을 추출해 검증.
 */
const baseURL =
  process.env.NEXT_PUBLIC_LIVE_SERVICE_API_URL ??
  "https://live-api.meloming.com";

export const liveServiceApi = axios.create({
  baseURL: `${baseURL}/v1`,
  withCredentials: true,
});

// 회사 표준: apiClient/apiV2Client 와 동일한 401 -> /auth/refresh -> retry interceptor.
// 사용자 cookie 가 host-only 또는 옛 잘못된 domain 으로 굽혀있을 때 첫 호출은 401 받지만
// refresh 가 .meloming.pri.sbalyd.com 으로 새 cookie 를 발급해 cross-host 도달 가능하게
// 만들고 retry. live-service 도 같은 패턴이어야 axios 인스턴스 간 일관성 유지.
attachResponseInterceptor(liveServiceApi);

export async function getPlayback(
  publicId: string,
): Promise<PlaybackResponse> {
  const res = await liveServiceApi.get<PlaybackResponse>(
    `/lives/${encodeURIComponent(publicId)}/playback`,
  );
  return res.data;
}
