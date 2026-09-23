export const MS_PER_DAY = 1000 * 60 * 60 * 24;
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type UpcomingEventType = 'broadcast' | 'birthday';

export interface ChannelMilestones {
  daysPassed: number;
  nextMilestone: string;
  daysToMilestone: number;
}

export interface ChannelBirthdayDday {
  daysUntilBirthday: number;
  birthdayDate: string;
}

export interface NextUpcomingEvent {
  type: UpcomingEventType;
  label: string;
  daysUntil: number;
}

export function parseKstYmd(dateString: string): Date {
  const [yearString, monthString, dayString] = dateString.split('-');
  const year = Number(yearString);
  const month = Number(monthString);
  const day = Number(dayString);

  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
}

function getTodayKstYmd(now: Date = new Date()): string {
  const kstTime = new Date(now.getTime() + KST_OFFSET_MS);
  return kstTime.toISOString().slice(0, 10);
}

export function toKstYmd(date: Date): string {
  const kstTime = new Date(date.getTime() + KST_OFFSET_MS);
  return kstTime.toISOString().slice(0, 10);
}

/**
 * KST "오늘(YYYY-MM-DD)" 문자열을 반환합니다.
 * - 내부 계산과 동일하게 KST 기준으로 날짜 경계가 정해집니다.
 */
export function getTodayKstYmdString(now: Date = new Date()): string {
  return getTodayKstYmd(now);
}

/**
 * KST 기준 "오늘 00:00"을 기준으로 `daysUntil`만큼 더한 시각을 ISO 문자열로 반환합니다.
 * - 예: daysUntil=0 => 오늘(KST) 00:00의 UTC ISO
 * - 홈 하이라이트 등에서 "날짜 단위" 비교/정렬을 안정적으로 하기 위한 용도
 */
export function getUpcomingEventDateIso(
  daysUntil: number,
  now: Date = new Date(),
): string {
  const todayYmd = getTodayKstYmd(now);
  const todayKstMidnightUtc = parseKstYmd(todayYmd);
  const target = new Date(
    todayKstMidnightUtc.getTime() + daysUntil * MS_PER_DAY,
  );
  return target.toISOString();
}

export function calculateMilestonesFromDate(
  debutDate: Date,
  now: Date = new Date(),
): ChannelMilestones {
  const debutYmd = toKstYmd(debutDate);
  const debut = parseKstYmd(debutYmd);
  const todayYmd = getTodayKstYmd(now);
  const today = parseKstYmd(todayYmd);

  const diffTime = today.getTime() - debut.getTime();
  const diffDays = Math.floor(diffTime / MS_PER_DAY);
  const daysPassed = diffDays >= 0 ? diffDays + 1 : 0;

  // 다음 100일 단위 기념일 계산 (이미 지난 것은 제외)
  const next100Day =
    daysPassed > 0 ? Math.ceil((daysPassed + 1) / 100) * 100 : 100;
  const daysTo100 = next100Day - daysPassed;

  // 주년 계산: 현재 연도 기준으로 다음 주년 찾기
  const currentYear = Number(todayYmd.slice(0, 4));
  const debutYear = Number(debutYmd.slice(0, 4));
  const [, debutMonth, debutDay] = debutYmd.split('-');

  // 올해 주년 날짜
  const thisYearAnniversary = parseKstYmd(
    `${currentYear}-${debutMonth}-${debutDay}`,
  );

  // 다음 주년 날짜 (올해 주년이 이미 지났으면 내년, 아니면 올해)
  const nextAnniversaryDate =
    thisYearAnniversary.getTime() < today.getTime()
      ? parseKstYmd(`${currentYear + 1}-${debutMonth}-${debutDay}`)
      : thisYearAnniversary;

  const daysToAnniversary = Math.floor(
    (nextAnniversaryDate.getTime() - today.getTime()) / MS_PER_DAY,
  );

  // 주년 번호 계산 (데뷔 연도 기준)
  const anniversaryNumber =
    currentYear -
    debutYear +
    (thisYearAnniversary.getTime() < today.getTime() ? 1 : 0);

  // 100일 단위와 주년 중 더 가까운 것 선택
  if (daysTo100 < daysToAnniversary) {
    return {
      daysPassed,
      nextMilestone: `${next100Day}일`,
      daysToMilestone: daysTo100,
    };
  }

  return {
    daysPassed,
    nextMilestone: `${anniversaryNumber}주년`,
    daysToMilestone: daysToAnniversary,
  };
}

export function calculateBirthdayDdayFromDate(
  birthday: Date,
  now: Date = new Date(),
): ChannelBirthdayDday {
  const todayYmd = getTodayKstYmd(now);
  const today = parseKstYmd(todayYmd);

  const birthdayYmd = toKstYmd(birthday);
  const [, monthString, dayString] = birthdayYmd.split('-');
  const month = Number(monthString);
  const day = Number(dayString);

  const currentYear = Number(todayYmd.slice(0, 4));
  const baseYmd = (year: number): string =>
    `${String(year).padStart(4, '0')}-${monthString}-${dayString}`;

  let thisBirthday = parseKstYmd(baseYmd(currentYear));
  if (thisBirthday.getTime() < today.getTime()) {
    thisBirthday = parseKstYmd(baseYmd(currentYear + 1));
  }

  const diffTime = thisBirthday.getTime() - today.getTime();
  const daysUntilBirthday = Math.ceil(diffTime / MS_PER_DAY);

  return {
    daysUntilBirthday,
    birthdayDate: `${month}월 ${day}일`,
  };
}

export function pickNextUpcomingEvent(
  milestones?: ChannelMilestones | null,
  birthdayDday?: ChannelBirthdayDday | null,
): NextUpcomingEvent | null {
  const events: NextUpcomingEvent[] = [];

  if (milestones) {
    events.push({
      type: 'broadcast',
      label: milestones.nextMilestone,
      daysUntil: milestones.daysToMilestone,
    });
  }

  if (birthdayDday) {
    events.push({
      type: 'birthday',
      label: `생일 (${birthdayDday.birthdayDate})`,
      daysUntil: birthdayDday.daysUntilBirthday,
    });
  }

  if (events.length === 0) return null;

  return events.reduce<NextUpcomingEvent>(
    (closest, current) =>
      current.daysUntil < closest.daysUntil ? current : closest,
    events[0]!,
  );
}
