import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * 주간 렌더는 KST 월요일 00:00 을 기준으로 한다.
 * 백엔드 `WeeklyScheduleLoaderService.load(channelId, weekStartAt)` 가
 * `weekStartAt` 을 월요일로 간주하며, 주간 버킷을 `startAt >= weekStartAt &&
 * startAt < weekStartAt + 7 days` 로 조회하므로 이 계약을 깨지 않아야 한다.
 *
 * shared `src/shared/lib/week-utils.ts` 는 일요일 시작 + 로컬 시간 기반이라
 * 본 요건(KST + 월요일)과 호환되지 않아 별도 유틸로 둔다.
 */
export const APP_TIMEZONE = "Asia/Seoul";

/**
 * 주어진 시각을 포함하는 주의 KST 월요일 00:00 에 해당하는 UTC `Date` 를 반환.
 *
 * 구현 근거:
 *  - `toZonedTime(now, KST)` 로 "KST 시계의 벽시계 시각" 을 얻는다
 *    (Date 객체는 UTC 를 저장하지만 내부 필드가 KST 벽시계 값이 되어 get/set 이
 *    KST 기준으로 동작). 이렇게 해야 일요일 밤 23:30 UTC 같이 KST 로는 월요일
 *    08:30 인 시각에 월요일이 올바르게 잡힌다.
 *  - day = 0(일)~6(토). 월요일까지 오프셋은 day === 0 ? -6 : 1 - day.
 *  - hour/min/sec/ms 를 0 으로 맞춘 뒤 `fromZonedTime(zoned, KST)` 로 다시 UTC
 *    `Date` 로 환산해 ISO 직렬화 가능한 결과를 만든다.
 */
export function getKstWeekStart(reference: Date = new Date()): Date {
  const zoned = toZonedTime(reference, APP_TIMEZONE);
  const day = zoned.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  zoned.setDate(zoned.getDate() + offset);
  zoned.setHours(0, 0, 0, 0);
  return fromZonedTime(zoned, APP_TIMEZONE);
}

/** KST 월요일 자정을 ISO8601 UTC 문자열로 직렬화 (백엔드 `@IsDateString` 호환) */
export function toWeekStartIso(monday: Date): string {
  return monday.toISOString();
}

/** 주어진 월요일 Date 에서 n주 이동한 새 월요일 Date 를 반환 */
export function shiftWeek(monday: Date, deltaWeeks: number): Date {
  const shifted = new Date(monday.getTime());
  shifted.setUTCDate(shifted.getUTCDate() + deltaWeeks * 7);
  return shifted;
}

/**
 * 사람이 읽기 쉬운 주간 레인지 라벨. KST 기준. 예) `4/21 (월) - 4/27 (일)`.
 */
export function formatWeekRangeLabel(monday: Date): string {
  const sunday = new Date(monday.getTime());
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const start = formatInTimeZone(monday, APP_TIMEZONE, "M/d (EEE)");
  const end = formatInTimeZone(sunday, APP_TIMEZONE, "M/d (EEE)");
  return `${start} - ${end}`;
}

/**
 * 파일명에 안전하게 쓰기 위한 주 키. 예) `2026-04-21`.
 * KST 월요일 날짜 부분만 추출한다.
 */
export function toWeekStartDateKey(monday: Date): string {
  return formatInTimeZone(monday, APP_TIMEZONE, "yyyy-MM-dd");
}

/** 두 월요일 Date 가 같은 주를 가리키는지 */
export function isSameWeek(a: Date, b: Date): boolean {
  return toWeekStartDateKey(a) === toWeekStartDateKey(b);
}
