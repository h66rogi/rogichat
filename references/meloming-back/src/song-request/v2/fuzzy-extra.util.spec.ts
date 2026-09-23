import {
  chosungMatch,
  decomposeJamo,
  enToKo,
  extractChosung,
  extractYoutubeVideoId,
  jamoSimilarity,
  koToEn,
  levenshtein,
} from './fuzzy-extra.util';

describe('decomposeJamo', () => {
  it('한글을 자모로 분해한다', () => {
    expect(decomposeJamo('밤편지')).toBe('ㅂㅏㅁㅍㅕㄴㅈㅣ');
    expect(decomposeJamo('가')).toBe('ㄱㅏ'); // 종성 없음
    expect(decomposeJamo('값')).toBe('ㄱㅏㅄ');
  });

  it('비한글은 그대로 유지', () => {
    expect(decomposeJamo('IU 좋은날')).toBe('IU ㅈㅗㅎㅇㅡㄴㄴㅏㄹ');
  });
});

describe('extractChosung', () => {
  it('초성만 추출', () => {
    expect(extractChosung('밤편지')).toBe('ㅂㅍㅈ');
    expect(extractChosung('아이유')).toBe('ㅇㅇㅇ');
  });

  it('비한글은 그대로 통과', () => {
    expect(extractChosung('BTS 다이너마이트')).toBe('BTS ㄷㅇㄴㅁㅇㅌ');
  });
});

describe('jamoSimilarity', () => {
  it('자모 단위 1글자 오타에 강함', () => {
    // 박편지 vs 밤편지 — 글자 단위는 1/3 = 33% 차이
    // 자모 단위 ㅂㅏㄱㅍㅕㄴㅈㅣ vs ㅂㅏㅁㅍㅕㄴㅈㅣ — 1/8 차이
    const sim = jamoSimilarity('박편지', '밤편지');
    expect(sim).toBeGreaterThan(0.85);
  });

  it('완전 동일 → 1', () => {
    expect(jamoSimilarity('밤편지', '밤편지')).toBe(1);
  });

  it('완전 다른 문자열 → 낮은 점수', () => {
    expect(jamoSimilarity('아이유', 'BTS')).toBeLessThan(0.3);
  });
});

describe('chosungMatch', () => {
  it('query가 초성만이고 target 초성과 일치', () => {
    expect(chosungMatch('ㅂㅍㅈ', '밤편지')).toBe(true);
    expect(chosungMatch('ㅇㅇㅇ', '아이유')).toBe(true);
  });

  it('query가 초성이 아니면 false', () => {
    expect(chosungMatch('밤편지', '밤편지')).toBe(false);
  });

  it('초성이 다르면 false', () => {
    expect(chosungMatch('ㅂㅍㅈ', '좋은날')).toBe(false);
  });
});

describe('enToKo / koToEn', () => {
  it('주요 K-pop 아티스트 매핑', () => {
    expect(enToKo('BTS')).toBe('방탄소년단');
    expect(enToKo('iu')).toBe('아이유');
    expect(enToKo('NewJeans')).toBe('뉴진스');
    expect(koToEn('아이유')).toBe('iu');
  });

  it('미등록 → null', () => {
    expect(enToKo('unknown')).toBeNull();
    expect(koToEn('미등록아티스트')).toBeNull();
  });
});

describe('extractYoutubeVideoId', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=foo', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['앞에 텍스트 https://youtu.be/dQw4w9WgXcQ 뒤에 텍스트', 'dQw4w9WgXcQ'],
  ])('%s → %s', (input, expected) => {
    expect(extractYoutubeVideoId(input)).toBe(expected);
  });

  it('URL 없으면 null', () => {
    expect(extractYoutubeVideoId('!신청 아이유 좋은날')).toBeNull();
  });
});

describe('levenshtein', () => {
  it.each([
    ['', '', 0],
    ['abc', 'abc', 0],
    ['abc', 'abd', 1],
    ['kitten', 'sitting', 3],
  ])('lev(%s, %s) = %s', (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
  });
});
