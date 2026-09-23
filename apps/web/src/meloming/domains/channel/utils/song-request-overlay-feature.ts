type SongRequestOverlayFeatureUser = {
  id?: number | string | null;
  isAdmin?: boolean | null;
  isAmbassador?: boolean | null;
  isProSubscriber?: boolean | null;
  proSubscriptionEndAt?: string | Date | null;
};

function getUserId(
  user: SongRequestOverlayFeatureUser | null | undefined,
): number | null {
  if (!user) {
    return null;
  }

  if (typeof user.id === "number" && Number.isInteger(user.id)) {
    return user.id;
  }

  if (typeof user.id === "string" && user.id.trim().length > 0) {
    const parsed = Number(user.id);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

/**
 * 신청곡/오버레이 기능 접근 규칙
 * - 로그인 사용자는 모두 허용
 */
export function canAccessSongRequestOverlayFeature(
  user: SongRequestOverlayFeatureUser | null | undefined,
): boolean {
  return getUserId(user) !== null;
}

/**
 * 채널 관리 내 신청곡/오버레이 관련 섹션 여부
 */
export function isSongRequestOverlayManagementSection(section: string): boolean {
  return (
    section === "live" ||
    section === "song-request-settings" ||
    section === "overlay-settings" ||
    section === "overlay-custom-css" ||
    section === "console" ||
    section === "stream-deck"
  );
}
