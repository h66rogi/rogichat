/**
 * 클라이언트 미리보기 컨텍스트 빌더.
 *
 * 백엔드 정합 — `meloming-back/src/schedule-renders/services/weekly-schedule-loader.service.ts`.
 *  - dayIndex 매핑: KST 월요일 startAt 기준 24h 단위.
 *  - 하루에 여러 일정 → 가장 이른 startAt 1건만 대표.
 *  - allDay 시 startTime = null, 아니면 KST HH:mm.
 *  - thumbnail 은 백엔드 MVP 가 항상 null 반환하므로 여기서도 null.
 *
 * 입력은 프론트의 `Schedule` 객체 배열. 백엔드 `ChannelSchedule` 의 isDeleted/
 * isCanceled 필드 중 isCanceled 만 프론트에 노출된다 (isDeleted=true 는 API 가
 * 반환하지 않음). 따라서 isDeleted 동등 처리는 불필요 — isCanceled 만 필터.
 */

import type { Schedule } from "@/meloming/domains/schedule/types/schedule";
import type { Channel } from "@/meloming/domains/channel/types/channel";
import {
  emptyDayBuckets,
  type PreviewBindingContext,
  type PreviewDayBucket,
} from "./binding-resolver";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * KST(UTC+9) 기준 HH:mm. Docker 컨테이너 TZ 가 어떻든 동일 결과를 내도록
 * UTC 시간에 +9h 직접 더해 포맷한다 (백엔드와 동일 정책).
 */
function formatKstHHmm(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * KST 기준 "M/d" — `4/21` 형태. UTC+9 직접 가산 후 UTC 메서드로 추출.
 */
function formatKstMonthDay(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const m = kst.getUTCMonth() + 1;
  const d = kst.getUTCDate();
  return `${m}/${d}`;
}

/**
 * `4/21 - 4/27` 형태 KST 라벨. `endAtExclusive` 는 startAt+7d 이므로
 * 표시 시점에 -1d 해서 inclusive 마지막일을 사용한다 (백엔드 동일).
 */
export function buildRangeLabel(startAt: Date, endAtExclusive: Date): string {
  const endInclusive = new Date(endAtExclusive.getTime() - MS_PER_DAY);
  return `${formatKstMonthDay(startAt)} - ${formatKstMonthDay(endInclusive)}`;
}

/**
 * `weekStartAt` 으로부터 `startAt` 까지의 일 인덱스 (0=주의 시작일=월).
 * 음수면 -1 (주 외부) 반환.
 */
function computeDayIndex(weekStartAt: Date, target: Date): number {
  const diffMs = target.getTime() - weekStartAt.getTime();
  if (diffMs < 0) return -1;
  return Math.floor(diffMs / MS_PER_DAY);
}

interface BuildPreviewContextOptions {
  channel: Pick<Channel, "name" | "profileImageUrl">;
  weekStartAt: Date;
  /** 주 범위 안의 schedules. 호출자가 from/to 로 미리 필터해서 넘겨도 되고,
   *  더 큰 집합을 넘겨도 이 함수가 다시 필터한다. */
  schedules: Pick<
    Schedule,
    "title" | "status" | "startAt" | "allDay" | "isCanceled"
  >[];
}

/**
 * 프리뷰 컨텍스트 빌드. 백엔드 `WeeklyScheduleLoaderService.load` 와
 * 같은 알고리즘을 클라이언트에서 그대로 수행한다.
 */
export function buildPreviewContext(
  options: BuildPreviewContextOptions,
): PreviewBindingContext {
  const { channel, weekStartAt, schedules } = options;
  const weekEndAt = new Date(weekStartAt.getTime() + 7 * MS_PER_DAY);

  // 정렬: startAt 오름차순. 가장 이른 일정이 그 요일의 대표가 된다.
  const sorted = [...schedules].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );

  const days: PreviewDayBucket[] = emptyDayBuckets();
  for (const schedule of sorted) {
    if (schedule.isCanceled) continue;
    const startAt = new Date(schedule.startAt);
    if (Number.isNaN(startAt.getTime())) continue;
    if (startAt < weekStartAt || startAt >= weekEndAt) continue;
    const dayIndex = computeDayIndex(weekStartAt, startAt);
    if (dayIndex < 0 || dayIndex > 6) continue;
    if (days[dayIndex].item !== null) continue; // 이른 startAt 만 채택.
    days[dayIndex].item = {
      title: schedule.title,
      status: schedule.status,
      startTime: schedule.allDay ? null : formatKstHHmm(startAt),
      thumbnail: null, // 백엔드 MVP 가 항상 null.
    };
  }

  return {
    channel: {
      name: channel.name,
      profileImageUrl: channel.profileImageUrl ?? null,
    },
    week: {
      startAt: weekStartAt,
      endAt: weekEndAt,
      rangeLabel: buildRangeLabel(weekStartAt, weekEndAt),
    },
    days,
  };
}
