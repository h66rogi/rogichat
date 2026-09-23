/**
 * PSD-uploaded 텍스트 슬롯의 `literal` 텍스트로부터 binding key 를 best-effort 추정.
 *
 * 사용 컨텍스트:
 *  - PSD 파싱 직후, 모든 텍스트 슬롯에 literal 만 채워진 상태.
 *  - 사용자가 한 슬롯씩 binding 을 클릭해 매핑하기 전, "자동 매핑" CTA 또는
 *    개별 슬롯의 "추천" 버튼으로 첫 안을 제시.
 *
 * 정책:
 *  - **보수적 매칭**. false positive 가 사용자에게 더 큰 비용 (잘못된 자동 매핑을
 *    원복하기 어려움) 이므로 자신 없는 케이스는 null.
 *  - 모호한 입력 (시간만 있고 요일 모름, "1월" 같은 month 표현, 일반 문장) 은 모두 null.
 *  - 카탈로그/리졸버에 없는 binding 은 절대 반환하지 않는다.
 *
 * 예:
 *   "월요일"      → 'day[0].title'
 *   "월"          → 'day[0].title'
 *   "월요일 방송" → 'day[0].title'
 *   "월 8:00"     → 'day[0].startTime'
 *   "토 오후 8시" → 'day[5].startTime'
 *   "MON" / "Mon" / "monday" / "Monday" → 'day[0].title'
 *   "이번 주"     → 'week.rangeLabel'
 *   "4/21 - 4/27" → 'week.rangeLabel'
 *   "8/12 ~ 8/18" → 'week.rangeLabel'
 *   "채널명"      → 'channel.name'
 *   "오전 8시"    → null (요일 모름)
 *   "1월"         → null (요일 단축형 '월' 과 혼동 방지)
 */

const DAY_TOKENS = ["월", "화", "수", "목", "금", "토", "일"] as const;

/** "월요일", "화요일", … */
const DAY_LONG_TO_INDEX: Record<string, number> = {
  월요일: 0,
  화요일: 1,
  수요일: 2,
  목요일: 3,
  금요일: 4,
  토요일: 5,
  일요일: 6,
};

/** 요일 단축형 (1글자) - "1월" 같은 month 표현과 구분 필요. */
const DAY_SHORT_TO_INDEX: Record<string, number> = {
  월: 0,
  화: 1,
  수: 2,
  목: 3,
  금: 4,
  토: 5,
  일: 6,
};

/**
 * 영어 요일 (대/소문자 모두) — `MON`, `Mon`, `mon`, `Monday`, `MONDAY`, `monday`.
 * normalize 시 소문자로 통일해서 매칭한다.
 *
 * 단축형(`mon` 3글자)과 풀네임(`monday`) 모두 지원.
 */
const DAY_EN_TO_INDEX: Record<string, number> = {
  mon: 0,
  monday: 0,
  tue: 1,
  tues: 1,
  tuesday: 1,
  wed: 2,
  weds: 2,
  wednesday: 2,
  thu: 3,
  thur: 3,
  thurs: 3,
  thursday: 3,
  fri: 4,
  friday: 4,
  sat: 5,
  saturday: 5,
  sun: 6,
  sunday: 6,
};

/** 시간 표현 — `8:00`, `19:30`, `오전`, `오후`, `N시` 등. */
const TIME_TOKEN_RE = /(\d{1,2}:\d{2}|\d{1,2}\s*시|오전|오후)/;

/**
 * "M/D - M/D" 또는 "M/D ~ M/D" 형태 (공백 선택).
 * `-` (하이픈) 과 `~` (틸드, ~~ 단일/중복 허용 X) 모두 범위 구분자로 인정.
 */
const WEEK_RANGE_RE = /^\d{1,2}\/\d{1,2}\s*[-~]\s*\d{1,2}\/\d{1,2}$/;

/** "이번주", "이번 주". */
const THIS_WEEK_RE = /^이번\s*주$/;

/** "1월", "12월", "3월 ..." 같은 month 표현 — DAY 매칭 차단용. */
const MONTH_PREFIX_RE = /^\d{1,2}\s*월/;

export function inferBindingFromLiteral(literal: string): string | null {
  if (typeof literal !== "string") return null;
  const trimmed = literal.trim();
  if (trimmed.length === 0) return null;

  // 1) "1월", "12월" 같은 month 표현은 day token 매칭 전에 차단.
  //    "1월 첫째 주" 같은 합성도 동일.
  if (MONTH_PREFIX_RE.test(trimmed)) return null;

  // 2) 채널 이름 — "채널", "채널명", "채널 이름".
  //    엄격 일치만 허용 (방송제목으로 "채널 후원" 같은 게 들어와도 매칭 X).
  if (
    trimmed === "채널" ||
    trimmed === "채널명" ||
    trimmed === "채널 이름"
  ) {
    return "channel.name";
  }

  // 3) 주간 범위 라벨.
  if (WEEK_RANGE_RE.test(trimmed)) return "week.rangeLabel";
  if (THIS_WEEK_RE.test(trimmed)) return "week.rangeLabel";

  // 4) 요일 + 시간 → startTime. 긴 형태(요일 + 시간) 부터 매칭해야
  //    "월 8:00" 이 day[0].title 로 잘못 잡히지 않는다.
  const dayIdxFromCombo = matchDayWithTime(trimmed);
  if (dayIdxFromCombo !== null) return `day[${dayIdxFromCombo}].startTime`;

  // 5) 요일 단독 / 요일 + 일반어 → title.
  const dayIdxFromTitle = matchDayForTitle(trimmed);
  if (dayIdxFromTitle !== null) return `day[${dayIdxFromTitle}].title`;

  // 6) 영어 요일 단독 — 한국어 매칭 후 fallback.
  //    `MON`, `Mon`, `monday` 등. 시간 토큰이 함께 있으면 startTime 으로 분기하지만
  //    영어 + 시간 조합은 PSD 파일에서 거의 보이지 않으므로 보수적으로 title 만 매칭.
  const enDayIdx = matchEnglishDayForTitle(trimmed);
  if (enDayIdx !== null) {
    if (TIME_TOKEN_RE.test(trimmed)) {
      return `day[${enDayIdx}].startTime`;
    }
    return `day[${enDayIdx}].title`;
  }

  return null;
}

/**
 * "월 8:00", "월요일 19:30", "토 오후 8시" 등 — 요일 + 시간 토큰이 모두 있으면
 * day index 반환. 없으면 null.
 */
function matchDayWithTime(input: string): number | null {
  if (!TIME_TOKEN_RE.test(input)) return null;
  // 긴 라벨 우선 확인 ("월요일" 이 "월" 보다 우선).
  for (const [label, idx] of Object.entries(DAY_LONG_TO_INDEX)) {
    if (input.startsWith(label)) return idx;
  }
  // 단축형 — input 의 첫 토큰이 정확히 day token 이어야 한다.
  // "월 8:00" → 첫 글자 "월" + 공백.
  const firstChar = input.charAt(0);
  if (firstChar in DAY_SHORT_TO_INDEX) {
    // 다음 글자가 "요" (=> "월요일") 인 경우는 위 long-label 분기에서 잡힘.
    // 여기 도달했다면 단축형. 다음 글자가 공백/숫자/오전/오후 중 하나일 때만 OK.
    const next = input.charAt(1);
    if (next === " " || next === "" || /\d|오/.test(next)) {
      return DAY_SHORT_TO_INDEX[firstChar];
    }
  }
  return null;
}

/**
 * 시간 토큰이 없는 경우 — 요일 단독 또는 "월요일 방송" 같은 자유 문구.
 *
 * 단축형 ("월" 단독) 은 month 표현 가드 (위 MONTH_PREFIX_RE) 를 이미 통과했으므로
 * 안전하다. 다만 "월간 보고" 같은 "월" 로 시작하지만 요일이 아닌 합성을 거르기 위해
 * 단축형은 (a) input 길이 1, (b) input == day token, 인 경우만 허용.
 */
function matchDayForTitle(input: string): number | null {
  // 긴 라벨이 prefix 면 채택.
  for (const [label, idx] of Object.entries(DAY_LONG_TO_INDEX)) {
    if (input.startsWith(label)) return idx;
  }
  // 단축형 — input 이 정확히 day token 한 글자.
  if (DAY_TOKENS.includes(input as (typeof DAY_TOKENS)[number])) {
    return DAY_SHORT_TO_INDEX[input];
  }
  return null;
}

/**
 * 영어 요일 단독 매칭 — `MON`, `Mon`, `mon`, `Monday`, `MONDAY`, `monday` 등.
 *
 * 정책:
 *  - 대/소문자 무시 (lowercase 후 lookup).
 *  - 단축형(3글자) 또는 풀네임만 허용 — "Monitor" 같은 단어가 "mon" 으로 잘못 매칭되지 않게
 *    `input` 이 정확히 매핑 키여야 한다 (prefix 매칭 X).
 *  - 시간 토큰이 함께 있으면 호출 측에서 startTime 분기.
 */
function matchEnglishDayForTitle(input: string): number | null {
  // 대소문자 무시 + 시간/공백 토큰 떼어내기 — "Mon 8:00" 같은 입력 대응.
  // 첫 단어만 추출해 lookup. (영어 요일은 항상 prefix 위치에 온다고 가정.)
  const firstWord = input
    .split(/[\s,/.-]+/, 1)[0]
    ?.toLowerCase()
    ?.trim();
  if (!firstWord) return null;
  const idx = DAY_EN_TO_INDEX[firstWord];
  return typeof idx === "number" ? idx : null;
}
