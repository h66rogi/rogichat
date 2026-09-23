/**
 * 초 단위 시간을 MM:SS 또는 HH:MM:SS 형식으로 포맷
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "0:00";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * 조회수/좋아요 수 등을 읽기 쉬운 형식으로 포맷
 * 예: 1234 -> "1.2천", 12345 -> "1.2만"
 */
export function formatCount(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) {
    const k = count / 1000;
    return k % 1 === 0 ? `${k}천` : `${k.toFixed(1)}천`;
  }
  if (count < 100000000) {
    const m = count / 10000;
    return m % 1 === 0 ? `${m}만` : `${m.toFixed(1)}만`;
  }
  const b = count / 100000000;
  return b % 1 === 0 ? `${b}억` : `${b.toFixed(1)}억`;
}

/**
 * 상대 시간 포맷 (예: "3시간 전", "2일 전")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffSec < 60) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHour < 24) return `${diffHour}시간 전`;
  if (diffDay < 7) return `${diffDay}일 전`;
  if (diffWeek < 5) return `${diffWeek}주 전`;
  if (diffMonth < 12) return `${diffMonth}개월 전`;
  return `${diffYear}년 전`;
}
