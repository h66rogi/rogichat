const STORAGE_KEY = "meloming:recent-clips";
const MAX_RECENT_CLIPS = 20;

/**
 * Session Storage에 최근 본 클립 ID 관리
 * - 최대 20개까지 저장
 * - 가장 최근에 본 클립이 앞에 위치
 */
export const recentClipsStorage = {
  /**
   * 클립 ID 추가 (중복 시 앞으로 이동)
   */
  add(clipId: number): void {
    if (typeof window === "undefined") return;

    try {
      const ids = this.getAll();
      const filtered = ids.filter((id) => id !== clipId);
      filtered.unshift(clipId);
      const trimmed = filtered.slice(0, MAX_RECENT_CLIPS);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Session Storage 접근 실패 시 무시
    }
  },

  /**
   * 모든 최근 본 클립 ID 조회
   */
  getAll(): number[] {
    if (typeof window === "undefined") return [];

    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
    } catch {
      return [];
    }
  },

  /**
   * 추천 API용 제외 목록 문자열 반환
   */
  getExcludeIdsString(): string {
    return this.getAll().join(",");
  },

  /**
   * 초기화
   */
  clear(): void {
    if (typeof window === "undefined") return;

    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // 무시
    }
  },
};
