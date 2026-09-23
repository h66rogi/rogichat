/**
 * 채널 통합 캘린더용 anniversary range expansion 유틸.
 *
 * 기존 `channel-anniversary.utils.ts` 의 `calculateMilestonesFromDate` /
 * `calculateBirthdayDdayFromDate` 는 "다음 1개" 만 반환하지만,
 * 캘린더는 임의의 [from, to) 구간에 떨어지는 모든 인스턴스가 필요하다.
 *
 * - timezone: KST (UTC+9) 기준. 입력 Date 는 어떤 timezone 이든 KST YMD 로 정규화한다.
 * - half-open 구간: `[from, to)` — `from` 포함, `to` 미포함.
 * - cap 없음: 100, 200, …, 9999, 10000일 등 시간 범위만 길면 모두 생성.
 * - 윤년 2/29 생일: 윤년에는 2/29, 평년에는 2/28 로 처리.
 */

import { MS_PER_DAY, parseKstYmd, toKstYmd } from './channel-anniversary.utils';

export interface MilestoneInRange {
  type: 'BROADCAST_MILESTONE';
  title: string;
  date: Date;
}

export interface BirthdayInRange {
  type: 'BIRTHDAY';
  title: string;
  date: Date;
}

/**
 * 윤년 여부.
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * `[from, to)` 구간 안에 있는 모든 100일 단위 + N주년 마일스톤을 반환한다.
 *
 * - 데뷔일을 day 1 로 둔다 (`calculateMilestonesFromDate` 의 `daysPassed` 와 일치).
 * - 100일/200일/.../K00일 = debutDate + (K00 - 1) days.
 * - N주년 = 데뷔년도 + N 의 같은 월/일 (KST 기준).
 *   - 데뷔일이 윤년 2/29 인 N주년이 평년이면 2/28 로 처리.
 * - 결과는 날짜 오름차순 정렬.
 * - from/to 는 KST 일 단위로 정규화 — 시각 부분은 무시됨.
 * - Invalid Date 입력 시 RangeError throw.
 * - cap 없음. 호출자가 from~to 범위를 합리적 (예: 13개월 이내) 으로 제한해야 함.
 */
export function expandMilestonesInRange(
  debutDate: Date,
  from: Date,
  to: Date,
): MilestoneInRange[] {
  const debutYmd = toKstYmd(debutDate);
  const debut = parseKstYmd(debutYmd);
  const fromYmd = toKstYmd(from);
  const fromKst = parseKstYmd(fromYmd);
  const toYmd = toKstYmd(to);
  const toKst = parseKstYmd(toYmd);

  // half-open 범위가 비었거나 음수면 빈 배열
  if (toKst.getTime() <= fromKst.getTime()) {
    return [];
  }

  const result: MilestoneInRange[] = [];

  // ---- 100일 단위 ----
  // day k 의 날짜 = debut + (k - 1) days
  // k 가 [k_min, k_max] 인 100 의 배수만 생성.
  // 조건: from <= debut + (k - 1) * MS_PER_DAY < to
  //   => (from - debut) / MS_PER_DAY + 1 <= k < (to - debut) / MS_PER_DAY + 1
  const fromDayDelta = Math.ceil(
    (fromKst.getTime() - debut.getTime()) / MS_PER_DAY,
  );
  const fromDayNumber = fromDayDelta + 1; // day 번호 기준 (1-based)
  const toDayDelta = Math.ceil(
    (toKst.getTime() - debut.getTime()) / MS_PER_DAY,
  );
  const toDayNumberExclusive = toDayDelta + 1; // half-open exclusive

  // 첫 100일 단위 마일스톤 day 번호
  const startK = Math.max(100, Math.ceil(fromDayNumber / 100) * 100);
  // 마지막 100일 단위 (exclusive 기준이므로 -1 한 후 floor)
  const endK = Math.floor((toDayNumberExclusive - 1) / 100) * 100;

  for (let k = startK; k <= endK; k += 100) {
    const milestoneTime = debut.getTime() + (k - 1) * MS_PER_DAY;
    result.push({
      type: 'BROADCAST_MILESTONE',
      title: `${k}일`,
      date: new Date(milestoneTime),
    });
  }

  // ---- N주년 단위 ----
  const debutYear = Number(debutYmd.slice(0, 4));
  const debutMonth = debutYmd.slice(5, 7);
  const debutDay = debutYmd.slice(8, 10);

  const fromYear = Number(fromYmd.slice(0, 4));
  // toYmd 는 exclusive — 같은 해의 더 늦은 N주년이 to 와 같으면 미포함이지만
  // year 자체는 to 의 연도까지 검사해야 한다 (예: to=2026-12-31, 2026-05-15 주년 포함).
  const toYear = Number(toYmd.slice(0, 4));

  // 데뷔년도부터 ~ to 연도까지
  for (let year = Math.max(debutYear, fromYear); year <= toYear; year++) {
    const anniversaryNumber = year - debutYear;
    if (anniversaryNumber <= 0) {
      continue; // 데뷔 당해는 0주년 — 제외
    }

    let anniversaryYmd = `${year}-${debutMonth}-${debutDay}`;
    // 윤년 2/29 데뷔 → 평년에는 2/28
    if (debutMonth === '02' && debutDay === '29' && !isLeapYear(year)) {
      anniversaryYmd = `${year}-02-28`;
    }
    const anniversaryDate = parseKstYmd(anniversaryYmd);

    if (
      anniversaryDate.getTime() >= fromKst.getTime() &&
      anniversaryDate.getTime() < toKst.getTime()
    ) {
      result.push({
        type: 'BROADCAST_MILESTONE',
        title: `${anniversaryNumber}주년`,
        date: anniversaryDate,
      });
    }
  }

  // 날짜 오름차순 정렬 (같은 날짜면 100일 단위가 먼저 — 안정 정렬)
  result.sort((a, b) => a.date.getTime() - b.date.getTime());

  return result;
}

/**
 * `[from, to)` 구간 안에 있는 모든 생일 인스턴스를 반환한다.
 *
 * - 매년 birthday 의 KST 월/일에 생일.
 * - 윤년 2/29 생일: 윤년에는 2/29, 평년에는 2/28.
 * - title 은 단순히 `"생일"` (출생년도 보장 X).
 * - from/to 는 KST 일 단위로 정규화 — 시각 부분은 무시됨.
 * - Invalid Date 입력 시 RangeError throw.
 * - cap 없음. 호출자가 from~to 범위를 합리적 (예: 13개월 이내) 으로 제한해야 함.
 */
export function expandBirthdayInRange(
  birthday: Date,
  from: Date,
  to: Date,
): BirthdayInRange[] {
  const birthdayYmd = toKstYmd(birthday);
  const fromYmd = toKstYmd(from);
  const fromKst = parseKstYmd(fromYmd);
  const toYmd = toKstYmd(to);
  const toKst = parseKstYmd(toYmd);

  if (toKst.getTime() <= fromKst.getTime()) {
    return [];
  }

  const birthMonth = birthdayYmd.slice(5, 7);
  const birthDay = birthdayYmd.slice(8, 10);

  const fromYear = Number(fromYmd.slice(0, 4));
  const toYear = Number(toYmd.slice(0, 4));

  const result: BirthdayInRange[] = [];

  for (let year = fromYear; year <= toYear; year++) {
    let bdayYmd = `${year}-${birthMonth}-${birthDay}`;
    if (birthMonth === '02' && birthDay === '29' && !isLeapYear(year)) {
      bdayYmd = `${year}-02-28`;
    }
    const bdayDate = parseKstYmd(bdayYmd);

    if (
      bdayDate.getTime() >= fromKst.getTime() &&
      bdayDate.getTime() < toKst.getTime()
    ) {
      result.push({
        type: 'BIRTHDAY',
        title: '생일',
        date: bdayDate,
      });
    }
  }

  return result;
}
