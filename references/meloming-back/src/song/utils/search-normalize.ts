/**
 * 노래책 검색용 정규화. 사용자가 띄어쓰기/대소문자/전각·반각을 다르게 입력해도
 * 동일하게 매칭되도록 만든 stable substring key.
 *
 * 흐름:
 *   1. NFKC Unicode normalize (fullwidth -> halfwidth, compatibility forms)
 *   2. lowercase
 *   3. 모든 whitespace + 비가시 문자 제거
 *      (ASCII space/tab/newline + U+00A0 NBSP + U+1680 + U+2000..U+200C
 *       + U+202F + U+205F + U+3000 ideographic space + U+FEFF BOM)
 *   4. titleSearchable / nameSearchable 컬럼 길이 (VarChar(255)) 와 일치하도록
 *      255 code point 까지만 남긴다. astral 문자 (surrogate pair) 가 잘려
 *      lone surrogate 가 남으면 MySQL utf8mb4 strict mode INSERT 가 throw
 *      하므로, JS string code unit 이 아닌 code point 기준으로 자른다.
 *      저장값과 검색어 양쪽 동일 정책이라 일관 매칭 보장.
 *
 * GlobalSong.normTitle 의 normalizeTitle 과 의도가 다르다:
 *   - normalizeTitle      -> fuzzy matching. 공백을 single space 로 collapse만
 *   - normalizeForSearch  -> substring 검색. 공백/비가시 문자 완전 제거
 *
 * Song.titleSearchable / Artist.nameSearchable 컬럼 값과
 * 사용자 검색어를 동일 함수로 통과시켜 비교한다.
 */

const WHITESPACE_AND_INVISIBLE_RE = new RegExp(
  '[\\s\\u00A0\\u1680\\u2000-\\u200C\\u202F\\u205F\\u3000\\uFEFF]',
  'g',
);

const MAX_LEN = 255;

export function normalizeForSearch(
  input: string | null | undefined,
): string {
  if (typeof input !== 'string') return '';
  const normalized = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(WHITESPACE_AND_INVISIBLE_RE, '');
  if (normalized.length <= MAX_LEN) return normalized;
  // code point 단위 슬라이스. Array.from 은 surrogate pair 를 단일 요소로
  // 분해하므로 256번째 code point 직전에서 정확히 잘리고 lone surrogate 가 생기지 않는다.
  return Array.from(normalized).slice(0, MAX_LEN).join('');
}

/**
 * Prisma `contains` 는 MySQL LIKE 로 변환되는데 사용자 입력의 `%` / `_` / `\`
 * 가 wildcard 로 해석되어 false positive 가 발생할 수 있다.
 *
 * 검색어 단계에서만 escape 한다 (저장값은 그대로 둔다 - title 안의 literal `%`
 * 가 의미를 가짐). MySQL LIKE 의 기본 escape character 는 backslash 이며,
 * Prisma 는 prepared statement 파라미터로 값을 바인딩하기 때문에 sql_mode 의
 * `NO_BACKSLASH_ESCAPES` (문자열 리터럴 파싱에만 영향) 와는 무관하게 backslash
 * escape 가 동작한다. LIKE 의 escape character 를 ESCAPE 절로 다른 문자로
 * 변경한 경우에만 본 escape 가 무력화된다.
 *
 *   `\` -> `\\`,  `%` -> `\%`,  `_` -> `\_`
 */
export function escapeForLike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}
