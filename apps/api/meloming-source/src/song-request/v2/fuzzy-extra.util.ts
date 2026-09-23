/**
 * v2 매칭에서 추가로 사용하는 fuzzy 헬퍼들.
 *
 * - 자모 분해: `밤편지` → `ㅂㅏㅁㅍㅕㄴㅈㅣ` 변환 후 Levenshtein. 한글 1글자 오타에 강함.
 *   예) 박편지 vs 밤편지 — 글자 단위 Levenshtein은 1/3 = 33%지만,
 *       자모 단위는 1/8 = 12.5%로 더 가까움.
 * - 초성 검색: `밤편지` → `ㅂㅍㅈ`. 사용자가 초성만 친 케이스 매칭.
 * - 로마자 변환: `BTS` ↔ `비티에스`, `IU` ↔ `아이유` (간이 변환만; 정밀한 KR↔EN
 *   romanization은 LLM 단계로 위임).
 */

const HANGUL_BASE = 0xac00; // '가'
const HANGUL_END = 0xd7a3; // '힣'

const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
  'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];
const JUNG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ',
  'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ',
  'ㅡ', 'ㅢ', 'ㅣ',
];
const JONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ',
  'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ',
  'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/** 한글 1글자를 [초성, 중성, 종성]으로 분해. 비한글은 그대로 반환. */
function decomposeChar(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_END) return ch;
  const idx = code - HANGUL_BASE;
  const cho = Math.floor(idx / (21 * 28));
  const jung = Math.floor((idx % (21 * 28)) / 28);
  const jong = idx % 28;
  return CHO[cho] + JUNG[jung] + JONG[jong];
}

/** 문자열 전체 자모 분해. */
export function decomposeJamo(text: string): string {
  let out = '';
  for (const ch of text) out += decomposeChar(ch);
  return out;
}

/** 문자열의 한글 부분만 초성 추출. 비한글은 그대로. */
export function extractChosung(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_END) {
      const idx = code - HANGUL_BASE;
      out += CHO[Math.floor(idx / (21 * 28))];
    } else {
      out += ch;
    }
  }
  return out;
}

/** Levenshtein distance — 자모 단위 비교에도 그대로 사용. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * 자모 분해 후 정규화된 유사도 (0~1). 같으면 1.
 * 두 문자열 중 짧은 쪽 길이가 0이면 0.
 */
export function jamoSimilarity(a: string, b: string): number {
  const ja = decomposeJamo(a);
  const jb = decomposeJamo(b);
  if (!ja || !jb) return 0;
  const dist = levenshtein(ja, jb);
  const maxLen = Math.max(ja.length, jb.length);
  return 1 - dist / maxLen;
}

/**
 * 초성만 같은지 비교. 사용자가 `ㅂㅍㅈ`처럼 초성만 친 경우.
 * 한쪽이 초성 전용이고 그것이 다른 쪽의 초성과 일치하면 매치.
 */
export function chosungMatch(query: string, target: string): boolean {
  // query가 한글 자모만(초성)인지 검사
  if (!/^[ㄱ-ㅎ]+$/u.test(query)) return false;
  const targetChosung = extractChosung(target).replace(/[^ㄱ-ㅎ]/g, '');
  return targetChosung === query;
}

/**
 * 매우 간이한 영-한 변환 매핑.
 * 정밀 변환은 LLM 단계에서 처리하고, 여기서는 자주 나오는 아티스트/약어만.
 */
const EN_TO_KO_MAP: ReadonlyMap<string, string> = new Map([
  ['bts', '방탄소년단'],
  ['iu', '아이유'],
  ['exo', '엑소'],
  ['twice', '트와이스'],
  ['blackpink', '블랙핑크'],
  ['nct', '엔시티'],
  ['ive', '아이브'],
  ['lesserafim', '르세라핌'],
  ['newjeans', '뉴진스'],
  ['aespa', '에스파'],
  ['gidle', '여자아이들'],
  ['itzy', '있지'],
  ['stray kids', '스트레이키즈'],
  ['straykids', '스트레이키즈'],
  ['skz', '스트레이키즈'],
  ['day6', '데이식스'],
  ['exid', '이엑스아이디'],
  ['shinee', '샤이니'],
  ['snsd', '소녀시대'],
  ['mamamoo', '마마무'],
  ['fromis_9', '프로미스나인'],
  ['oasis', '오아시스'],
  ['radiohead', '라디오헤드'],
  ['queen', '퀸'],
]);

/**
 * 영문 표기를 한글 표기로 변환 (사전 기반). 매칭 안 되면 null.
 * 양방향 lookup이 필요하면 호출자가 두 번 호출 (en→ko, ko→en).
 */
export function enToKo(en: string): string | null {
  const key = en.trim().toLowerCase();
  return EN_TO_KO_MAP.get(key) ?? null;
}

/** ko→en 역변환. 첫 매치만 반환 (보통 1:1). */
export function koToEn(ko: string): string | null {
  const trimmed = ko.trim();
  for (const [en, k] of EN_TO_KO_MAP.entries()) {
    if (k === trimmed) return en;
  }
  return null;
}

/** YouTube URL 추출 (없으면 null). watch / shorts / embed / live / youtu.be 모두 cover. */
const YOUTUBE_RE = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
export function extractYoutubeVideoId(text: string): string | null {
  const m = text.match(YOUTUBE_RE);
  return m ? m[1] : null;
}

/**
 * 매칭 비교용 정규화. NFKC + lowercase + 공백/구분자 제거 + 특수문자 제거.
 * 한글/한자/일본어/영숫자만 살림.
 *
 * 같은 곡이 표기 방식만 달라도 같은 normTitle/normAlias를 만들도록 GlobalSongAlias
 * 인덱스가 이 함수의 출력 형태로 저장되어 있다.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_]/g, '')
    .replace(
      /[^\w가-힣ᄀ-ᇿㄱ-ㅣぁ-んァ-ヺー〜一-鿿㐀-䶿]/g,
      '',
    );
}

/**
 * "아티스트 - 제목" 형태의 페이로드를 분해.
 * 구분자 후보: ` - ` / ` / ` / ` – ` / ` — `. padded form 우선 시도하고
 * 실패하면 padding 없이 첫 매치. 분해 실패 시 artist=''로 두고 title에 전체.
 */
export function splitArtistTitle(payload: string): {
  artist: string;
  title: string;
} {
  const separators = ['-', '/', '–', '—'];
  for (const sep of separators) {
    const padded = ` ${sep} `;
    const idx = payload.indexOf(padded);
    if (idx > 0) {
      return {
        artist: payload.substring(0, idx).trim(),
        title: payload.substring(idx + padded.length).trim(),
      };
    }
  }
  for (const sep of separators) {
    const idx = payload.indexOf(sep);
    if (idx > 0) {
      const left = payload.substring(0, idx).trim();
      const right = payload.substring(idx + sep.length).trim();
      if (left && right) return { artist: left, title: right };
    }
  }
  return { artist: '', title: payload.trim() };
}
