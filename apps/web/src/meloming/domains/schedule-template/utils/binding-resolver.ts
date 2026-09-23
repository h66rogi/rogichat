/**
 * 클라이언트 미리보기용 binding DSL 리졸버.
 *
 * 백엔드 정합 — `meloming-back/src/schedule-renders/services/binding-resolver.service.ts`.
 * 서버 렌더가 정답이고 이 모듈은 빠른 시각 근사치를 위한 클라이언트 사이드
 * 리프레젠테이션이다. 따라서:
 *   - 동일한 DSL 표현 (channel.*, week.*, day[N].*) 만 지원
 *   - 결과 의미가 다르면 안 됨 (특히 day index 매핑, KST 시간 변환)
 *   - 신규 binding 이 백엔드에 추가되면 이 모듈도 함께 갱신해야 한다
 *
 * 지원 형식:
 *  - `channel.name`
 *  - `channel.profileImageUrl`
 *  - `week.startAt`      → ISO 문자열
 *  - `week.endAt`        → ISO 문자열
 *  - `week.rangeLabel`   → "4/21 - 4/27" (KST 기준)
 *  - `day[N].title`      (N=0..6, 0=월)
 *  - `day[N].startTime`  (HH:mm KST, allDay 시 null)
 *  - `day[N].status`     (LIVE | COLLAB | OFF | ETC | TBD)
 *  - `day[N].thumbnail`  (null — 백엔드 MVP 가 항상 null 반환)
 *
 * 반환 규칙:
 *  - resolve 결과가 없으면 null. 호출 측이 literal/fallbackUrl 사용 여부 판단.
 */

import type { ScheduleStatus } from "@/meloming/domains/schedule/types/schedule";

export interface PreviewDayItem {
  title: string;
  status: ScheduleStatus;
  /** HH:mm (KST). allDay 면 null. */
  startTime: string | null;
  thumbnail: string | null;
}

export interface PreviewDayBucket {
  /** 0=월, 6=일. */
  index: number;
  item: PreviewDayItem | null;
}

export interface PreviewBindingContext {
  channel: {
    name: string;
    profileImageUrl: string | null;
  };
  week: {
    /** UTC Date — KST 월요일 00:00 의 UTC 표현. */
    startAt: Date;
    /** UTC Date — `startAt + 7d` (exclusive). */
    endAt: Date;
    /** "4/21 - 4/27" 형태 KST 라벨. */
    rangeLabel: string;
  };
  /** 길이 7. 비어있는 요일은 item: null. */
  days: PreviewDayBucket[];
}

const DAY_BINDING_RE = /^day\[(\d+)\]\.(title|startTime|status|thumbnail)$/;

/**
 * 백엔드 `BindingResolverService.resolve` 와 완전 동일한 DSL 매칭/반환 규칙.
 *
 * - 빈/공백 binding → null
 * - 알 수 없는 표현 → null
 * - day index 범위 0..6 외 → null
 * - bucket.item === null → null (요일 비어있음)
 */
export function resolveBinding(
  binding: string,
  ctx: PreviewBindingContext,
): string | null {
  if (!binding || typeof binding !== "string") return null;
  const trimmed = binding.trim();
  if (!trimmed) return null;

  // channel.*
  if (trimmed === "channel.name") {
    return ctx.channel.name ?? null;
  }
  if (trimmed === "channel.profileImageUrl") {
    return ctx.channel.profileImageUrl ?? null;
  }

  // week.*
  if (trimmed === "week.startAt") {
    return ctx.week.startAt.toISOString();
  }
  if (trimmed === "week.endAt") {
    return ctx.week.endAt.toISOString();
  }
  if (trimmed === "week.rangeLabel") {
    return ctx.week.rangeLabel;
  }

  // day[N].field
  const match = trimmed.match(DAY_BINDING_RE);
  if (match) {
    const idx = Number(match[1]);
    const field = match[2];
    if (!Number.isInteger(idx) || idx < 0 || idx > 6) return null;
    const bucket = ctx.days[idx];
    if (!bucket || !bucket.item) return null;
    switch (field) {
      case "title":
        return bucket.item.title ?? null;
      case "startTime":
        return bucket.item.startTime ?? null;
      case "status":
        return bucket.item.status ?? null;
      case "thumbnail":
        return bucket.item.thumbnail ?? null;
      default:
        return null;
    }
  }

  return null;
}

/**
 * 빈 7일 버킷 (모두 null). 일정 데이터가 없을 때의 미리보기 시드.
 */
export function emptyDayBuckets(): PreviewDayBucket[] {
  return Array.from({ length: 7 }, (_, i) => ({ index: i, item: null }));
}
