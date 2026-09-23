/**
 * SNS 플랫폼 식별자.
 *
 * 백엔드 `src/sns-credentials/types/sns-platform.type.ts` 와 1:1 동기화.
 * 추가 시 두 곳 모두 수정 필요.
 */
export const SNS_PLATFORMS = ["X", "NAVER_CAFE"] as const;

export type SnsPlatform = (typeof SNS_PLATFORMS)[number];

export function isSnsPlatform(value: unknown): value is SnsPlatform {
  return (
    typeof value === "string" &&
    (SNS_PLATFORMS as readonly string[]).includes(value)
  );
}
