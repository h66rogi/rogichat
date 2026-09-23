// twitter-text@3.1.0 의 ESM build 는 named export 가 없고 default export 안에
// `parseTweet` 등 함수가 들어 있다. CJS build 에는 named 가 있지만 Next.js 가
// ESM 을 우선 해석하므로 default import 로 통일.
import twitterText from "twitter-text";

const { parseTweet } = twitterText;

/**
 * X(트위터) 게시 본문 한도 — `weightedLength` 기준 280.
 *
 * 단순 `string.length` 가 아니라 X 의 가중 글자수 정책을 사용한다:
 *  - 라틴/숫자 등 가벼운 코드포인트: weight 1
 *  - 한글/한자/일본어 등 CJK: weight 2
 *  - URL: 길이와 무관하게 23 (t.co 단축 길이 가정)
 *  - 이모지: surrogate pair / variation selector / ZWJ 시퀀스 등은 단일 시각 단위로 묶임
 *
 * 출처: https://developer.x.com/en/docs/counting-characters
 */
export const X_TWEET_MAX_WEIGHTED_LENGTH = 280;

/**
 * X 본문 검증 결과. UI 카운터 / 버튼 활성화 / 에러 메시지에 모두 사용한다.
 */
export interface XTweetValidation {
  /** twitter-text `parseTweet().valid` — 280 weight 이내 + 비어있지 않음 */
  valid: boolean;
  /** 가중 글자수 (0..N). 280 까지가 정상. */
  weightedLength: number;
  /** 0~1000 (1000 = 100%). UI 의 progress 표현용. */
  permillage: number;
  /** 총 한도 — UI 가 분모에 표시. */
  maxWeightedLength: number;
}

/**
 * 빈 문자열 / 공백만은 항상 invalid 로 간주한다.
 *
 * twitter-text 의 `parseTweet("")` 는 `valid: false` 를 반환하지만 공백만 있는
 * 입력에는 weight 만 잡히고 `valid: true` 가 나올 수 있다. 본문 게시 UX 상
 * "공백만" 케이스는 항상 invalid 여야 하므로 trim 을 명시적으로 본다.
 */
export function validateXTweet(body: string): XTweetValidation {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      weightedLength: 0,
      permillage: 0,
      maxWeightedLength: X_TWEET_MAX_WEIGHTED_LENGTH,
    };
  }

  const parsed = parseTweet(body);
  return {
    valid: parsed.valid,
    weightedLength: parsed.weightedLength,
    permillage: parsed.permillage,
    maxWeightedLength: X_TWEET_MAX_WEIGHTED_LENGTH,
  };
}
