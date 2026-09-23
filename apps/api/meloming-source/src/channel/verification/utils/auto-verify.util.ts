import { StreamPlatform, UserPlatformVerification } from '@prisma/client';

export interface AutoVerifyResult {
  canAutoVerify: boolean;
  platform: StreamPlatform;
  platformChannelId: string | null;
  reason?: string;
}

/**
 * 자동 인증 가능 여부 확인
 *
 * @param platform 채널의 플랫폼 (platformUrl에서 추출)
 * @param extractedChannelId platformUrl에서 추출된 채널 ID
 * @param userVerification 사용자의 플랫폼 인증 정보
 * @returns 자동 인증 결과
 */
export function checkAutoVerify(
  platform: StreamPlatform,
  extractedChannelId: string | null,
  userVerification: UserPlatformVerification | null,
): AutoVerifyResult {
  // OTHER 플랫폼은 자동 검증 불가
  if (platform === 'OTHER') {
    return {
      canAutoVerify: false,
      platform,
      platformChannelId: extractedChannelId,
      reason: `${platform} 플랫폼은 자동 검증이 불가능합니다.`,
    };
  }

  // 채널 ID 추출 실패
  if (!extractedChannelId) {
    return {
      canAutoVerify: false,
      platform,
      platformChannelId: null,
      reason: 'platformUrl에서 채널 ID를 추출할 수 없습니다.',
    };
  }

  // 사용자의 해당 플랫폼 인증 정보 없음
  if (!userVerification) {
    return {
      canAutoVerify: false,
      platform,
      platformChannelId: extractedChannelId,
      reason: `${platform} 플랫폼 인증이 완료되지 않았습니다.`,
    };
  }

  // 플랫폼이 일치하지 않음
  if (userVerification.platform !== platform) {
    return {
      canAutoVerify: false,
      platform,
      platformChannelId: extractedChannelId,
      reason: `사용자의 인증된 플랫폼(${userVerification.platform})과 채널 플랫폼(${platform})이 일치하지 않습니다.`,
    };
  }

  // 인증되지 않은 상태
  if (!userVerification.isVerified) {
    return {
      canAutoVerify: false,
      platform,
      platformChannelId: extractedChannelId,
      reason: `${platform} 플랫폼 인증이 완료되지 않았습니다.`,
    };
  }

  // 채널 ID 비교 (대소문자 무시)
  const verifiedChannelId =
    userVerification.platformChannelId || userVerification.platformUserId;
  const normalizedExtracted = extractedChannelId.toLowerCase();
  const normalizedVerified = verifiedChannelId.toLowerCase();

  if (normalizedExtracted !== normalizedVerified) {
    return {
      canAutoVerify: false,
      platform,
      platformChannelId: extractedChannelId,
      reason: `채널 ID(${extractedChannelId})가 인증된 ID(${verifiedChannelId})와 일치하지 않습니다.`,
    };
  }

  // 자동 인증 성공
  return {
    canAutoVerify: true,
    platform,
    platformChannelId: extractedChannelId,
  };
}
