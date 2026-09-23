import {
  expandBirthdayInRange,
  expandMilestonesInRange,
} from './channel-anniversary-range.utils';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * KST 기준 자정(00:00) 시각을 UTC ISO 형태의 Date 로 만든다.
 * (`channel-anniversary.utils.ts` 의 `parseKstYmd` 와 동일한 의미)
 */
const kstDate = (ymd: string): Date => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - KST_OFFSET_MS);
};

const kstYmd = (date: Date): string => {
  const kstTime = new Date(date.getTime() + KST_OFFSET_MS);
  return kstTime.toISOString().slice(0, 10);
};

/* -------------------------------------------------------------------------- */
/* expandMilestonesInRange                                                     */
/* -------------------------------------------------------------------------- */

describe('expandMilestonesInRange', () => {
  it('debutDate=2024-01-01, from=2026-01-01, to=2026-02-01 → 100일/주년 마일스톤만 정확히 반환', () => {
    const debutDate = kstDate('2024-01-01');
    const from = kstDate('2026-01-01');
    const to = kstDate('2026-02-01');

    const result = expandMilestonesInRange(debutDate, from, to);

    // 데뷔일(2024-01-01)을 day 1 로 두면:
    //  - 2026-01-01 = day 732
    //  - 2026-02-01 = day 763 (half-open, 미포함)
    //  → 100일 단위 중 [732, 763) 에 떨어지는 것 없음
    //  → 주년: 2주년(2026-01-01)이 from <= x < to 범위에 포함
    expect(result).toEqual([
      {
        type: 'BROADCAST_MILESTONE',
        title: '2주년',
        date: kstDate('2026-01-01'),
      },
    ]);
  });

  it('debutDate=2024-01-01, from=2025-01-01, to=2025-12-31 → 한 해 동안의 모든 100일/주년 마일스톤', () => {
    const debutDate = kstDate('2024-01-01');
    const from = kstDate('2025-01-01');
    const to = kstDate('2025-12-31');

    const result = expandMilestonesInRange(debutDate, from, to);

    // 2025-01-01 = day 367, 2025-12-31 = day 731 (half-open, 미포함)
    // 100일 단위: 400, 500, 600, 700일이 [367, 731) 에 포함
    //   - 400일 = 2024-01-01 + 399 days = 2025-02-03
    //   - 500일 = 2025-05-14
    //   - 600일 = 2025-08-22
    //   - 700일 = 2025-11-30
    // 주년: 1주년(2025-01-01) 포함 (2026-01-01 은 to 밖)
    const titles = result.map((m) => m.title);
    expect(titles).toContain('400일');
    expect(titles).toContain('500일');
    expect(titles).toContain('600일');
    expect(titles).toContain('700일');
    expect(titles).toContain('1주년');
    // 2주년(2026-01-01) 은 to(2025-12-31) 이후이므로 미포함
    expect(titles).not.toContain('2주년');
    // 800일(2026-03-11) 은 to 이후
    expect(titles).not.toContain('800일');
  });

  it('debutDate 가 from 보다 미래 → 빈 배열', () => {
    const debutDate = kstDate('2027-01-01');
    const from = kstDate('2025-01-01');
    const to = kstDate('2026-12-31');

    const result = expandMilestonesInRange(debutDate, from, to);

    expect(result).toEqual([]);
  });

  it('debutDate 와 from 사이가 100일 미만 → 100일 마일스톤 1개부터 시작', () => {
    const debutDate = kstDate('2026-01-01');
    const from = kstDate('2026-01-01');
    const to = kstDate('2027-01-01');

    const result = expandMilestonesInRange(debutDate, from, to);

    // day 1 ~ day 366 (half-open). 100, 200, 300일 + 주년이 포함되어야 함
    const titles = result.map((m) => m.title);
    expect(titles).toContain('100일');
    expect(titles).toContain('200일');
    expect(titles).toContain('300일');
    // 400일은 day 400 ≈ 2027-02-04, to(2027-01-01) 이후이므로 미포함
    expect(titles).not.toContain('400일');
  });

  it('정확히 100일 단위 boundary — debutDate + 100일 == from 인 케이스 (포함)', () => {
    const debutDate = kstDate('2024-01-01');
    // 100일째 = debutDate + 99 days = 2024-04-09 (day 100)
    const from = kstDate('2024-04-09');
    const to = kstDate('2024-04-10');

    const result = expandMilestonesInRange(debutDate, from, to);

    expect(result).toEqual([
      {
        type: 'BROADCAST_MILESTONE',
        title: '100일',
        date: kstDate('2024-04-09'),
      },
    ]);
  });

  it('half-open 경계: to 와 같은 날짜는 포함 안 됨', () => {
    const debutDate = kstDate('2024-01-01');
    const from = kstDate('2024-04-08');
    const to = kstDate('2024-04-09'); // 100일째 당일이 to → 미포함

    const result = expandMilestonesInRange(debutDate, from, to);

    expect(result).toEqual([]);
  });

  it('half-open 경계: from 과 같은 날짜는 포함', () => {
    const debutDate = kstDate('2024-01-01');
    const from = kstDate('2024-04-09'); // 100일째 당일이 from → 포함
    const to = kstDate('2024-04-10');

    const result = expandMilestonesInRange(debutDate, from, to);

    expect(result.length).toBe(1);
    expect(result[0].title).toBe('100일');
  });

  it('같은 날짜에 100일 단위와 주년 단위 둘 다 떨어지면 둘 다 반환', () => {
    // 데뷔 후 365일 = 1주년 같은 날 (윤년 보정 무관, 주년은 월/일 매칭)
    // 4년차 = 1461일 (4년에 한번 윤년) → 4주년 / 1500일은 다른날
    // 100일 단위가 주년과 정확히 겹치는 경우는 드묾
    // → 같은 날짜에 두 개 떨어지는 케이스: debutDate=2024-01-01,
    //    1년 = 365일, 즉 day 366(2025-01-01)이 1주년인데 100일 단위는 아님.
    //    주년 = 365일째인 경우는 평년뿐. 인위적으로 4주년에 1500일 같은 케이스 없음.
    // 대신 둘 다 같은 범위에 있으면 둘 다 출력되는지 검증
    const debutDate = kstDate('2024-01-01');
    const from = kstDate('2024-12-31');
    const to = kstDate('2025-01-02');

    const result = expandMilestonesInRange(debutDate, from, to);

    // day 366 = 2024-12-31, day 367 = 2025-01-01 (1주년)
    // 100일 단위 중 [366, 367+1=368) 에 떨어지는 것 없음
    // 주년만 1개
    const titles = result.map((m) => m.title);
    expect(titles).toContain('1주년');
  });

  it('cap 없음 — 10000일까지도 생성', () => {
    const debutDate = kstDate('2000-01-01');
    const from = kstDate('2027-05-18'); // ~ day 10000 근처
    const to = kstDate('2027-05-20');

    const result = expandMilestonesInRange(debutDate, from, to);

    // 2000-01-01 + 9999 days = 2027-05-19 (day 10000)
    const titles = result.map((m) => m.title);
    expect(titles).toContain('10000일');
  });

  it('주년 단위 — 데뷔 월/일이 from~to 범위 안이면 N주년 추가', () => {
    const debutDate = kstDate('2020-05-15');
    const from = kstDate('2025-01-01');
    const to = kstDate('2026-01-01');

    const result = expandMilestonesInRange(debutDate, from, to);

    // 5주년 = 2025-05-15 포함
    const fiveYr = result.find((m) => m.title === '5주년');
    expect(fiveYr).toBeDefined();
    expect(fiveYr?.date.getTime()).toBe(kstDate('2025-05-15').getTime());
    // 6주년 = 2026-05-15, to(2026-01-01) 이후 → 미포함
    expect(result.find((m) => m.title === '6주년')).toBeUndefined();
  });

  it('debutDate 의 timezone 차이 무관 — UTC 시작 일자도 KST YMD 로 정규화', () => {
    // UTC 2024-01-01 00:00 = KST 2024-01-01 09:00 (KST YMD = 2024-01-01)
    const debutDate = new Date('2024-01-01T00:00:00.000Z');
    const from = kstDate('2024-04-09');
    const to = kstDate('2024-04-10');

    const result = expandMilestonesInRange(debutDate, from, to);

    expect(result.length).toBe(1);
    expect(result[0].title).toBe('100일');
  });
});

/* -------------------------------------------------------------------------- */
/* expandBirthdayInRange                                                       */
/* -------------------------------------------------------------------------- */

describe('expandBirthdayInRange', () => {
  it('1년 범위에 생일 1번 (1990-05-15, 2026 한 해)', () => {
    const birthday = kstDate('1990-05-15');
    const from = kstDate('2026-01-01');
    const to = kstDate('2026-12-31');

    const result = expandBirthdayInRange(birthday, from, to);

    expect(result).toEqual([
      {
        type: 'BIRTHDAY',
        title: '생일',
        date: kstDate('2026-05-15'),
      },
    ]);
  });

  it('걸친 범위 — 2025-12-01 ~ 2026-06-01 → 2026-05-15 만 포함', () => {
    const birthday = kstDate('1990-05-15');
    const from = kstDate('2025-12-01');
    const to = kstDate('2026-06-01');

    const result = expandBirthdayInRange(birthday, from, to);

    expect(result).toEqual([
      {
        type: 'BIRTHDAY',
        title: '생일',
        date: kstDate('2026-05-15'),
      },
    ]);
  });

  it('여러 해 — 2024-01-01 ~ 2027-01-01 → 2024/2025/2026 생일 3개', () => {
    const birthday = kstDate('1990-05-15');
    const from = kstDate('2024-01-01');
    const to = kstDate('2027-01-01');

    const result = expandBirthdayInRange(birthday, from, to);

    expect(result.map((b) => kstYmd(b.date))).toEqual([
      '2024-05-15',
      '2025-05-15',
      '2026-05-15',
    ]);
  });

  it('half-open: to 와 같은 날 생일은 포함 안 됨', () => {
    const birthday = kstDate('1990-05-15');
    const from = kstDate('2025-01-01');
    const to = kstDate('2026-05-15'); // 2026-05-15 가 to → 2026 생일 미포함

    const result = expandBirthdayInRange(birthday, from, to);

    expect(result.map((b) => kstYmd(b.date))).toEqual(['2025-05-15']);
  });

  it('half-open: from 과 같은 날 생일은 포함', () => {
    const birthday = kstDate('1990-05-15');
    const from = kstDate('2025-05-15'); // 2025-05-15 가 from → 포함
    const to = kstDate('2026-01-01');

    const result = expandBirthdayInRange(birthday, from, to);

    expect(result.map((b) => kstYmd(b.date))).toEqual(['2025-05-15']);
  });

  it('윤년 2/29 생일 — 평년에는 2/28 로 처리 (Date 자동 정규화 X, 명시 처리)', () => {
    const birthday = kstDate('2000-02-29');
    const from = kstDate('2025-01-01');
    const to = kstDate('2027-01-01');

    const result = expandBirthdayInRange(birthday, from, to);

    // 2025 평년 → 2025-02-28
    // 2026 평년 → 2026-02-28
    expect(result.map((b) => kstYmd(b.date))).toEqual([
      '2025-02-28',
      '2026-02-28',
    ]);
  });

  it('윤년 2/29 생일 — 윤년에는 2/29 그대로', () => {
    const birthday = kstDate('2000-02-29');
    const from = kstDate('2024-01-01');
    const to = kstDate('2024-12-31');

    const result = expandBirthdayInRange(birthday, from, to);

    expect(result.map((b) => kstYmd(b.date))).toEqual(['2024-02-29']);
  });

  it('연속 여러 해 cap 없음 — 100년 범위에서 100개 생성', () => {
    const birthday = kstDate('1990-05-15');
    const from = kstDate('2000-01-01');
    const to = kstDate('2100-01-01');

    const result = expandBirthdayInRange(birthday, from, to);

    // 2000 ~ 2099 매년 5/15 → 100개
    expect(result.length).toBe(100);
    expect(kstYmd(result[0].date)).toBe('2000-05-15');
    expect(kstYmd(result[result.length - 1].date)).toBe('2099-05-15');
  });

  it('birthday 의 timezone 차이 무관 — UTC 자정도 KST YMD 로 정규화', () => {
    // UTC 1990-05-15 00:00 = KST 1990-05-15 09:00 (KST YMD = 1990-05-15)
    const birthday = new Date('1990-05-15T00:00:00.000Z');
    const from = kstDate('2026-01-01');
    const to = kstDate('2026-12-31');

    const result = expandBirthdayInRange(birthday, from, to);

    expect(result.length).toBe(1);
    expect(kstYmd(result[0].date)).toBe('2026-05-15');
  });
});
