import { MatchedSong, SongMatchResult } from '../song-matcher.service';

export type MatchTier = 'tier1' | 'tier2a' | 'tier2b' | 'tier3' | 'ignored';

export type TierClassificationReason =
  | 'request_command_prefix' // 채널의 requestCommand(`!신청` 등)
  | 'exclam_request_variant' // `!신청곡 / !노래신청 / !곡신청 / !sr`
  | 'request_word_prefix' // `신청 ...`
  | 'exclam_whitelisted_command' // `!sr` 같은 신청 alias 명령
  | 'request_word_contained' // 메시지 중간에 `신청` + 신청 동사
  | 'bot_message' // `🎵 신청이 완료되었습니다` 등
  | 'noise_word' // `수강신청`, `갱신 신청` 등
  | 'no_signal'; // 매칭 신호 없음

export interface TierClassification {
  tier: MatchTier;
  reason: TierClassificationReason;
  /**
   * Tier별 본문(prefix 제거 후). Tier 1/2 매칭 알고리즘이 사용할 query.
   * Tier 3는 message 전체를 본문으로 둠 (artist - title 추출은 별도).
   */
  payload: string;
}

export interface MatchStepTrace {
  step: string;
  /** 매칭 시도가 발생한 알고리즘 단계명 */
  algorithm:
    | 'exact'
    | 'alias'
    | 'fuzzy_levenshtein'
    | 'fuzzy_jamo'
    | 'fuzzy_chosung'
    | 'fuzzy_romanize'
    | 'lyrics_contains'
    | 'lyrics_semantic'
    | 'global_song_cross_alias'
    | 'youtube_url'
    | 'llm_extract'
    | 'category'
    | 'random';
  matched: boolean;
  songId?: number;
  /** 0.0 ~ 1.0 */
  score?: number;
  /** 후보가 여럿일 때 */
  candidates?: Array<{ songId: number; score: number; title: string; artist: string }>;
  /** debug용 자유 메시지 */
  note?: string;
}

export interface SongMatchResultV2 extends SongMatchResult {
  tier: MatchTier;
  reason: TierClassificationReason;
  /** 0.0 ~ 1.0 — Tier 임계값과 비교해 자동 신청 여부 결정 */
  confidence: number;
  /** Tier별 자동 신청 임계값 (디버그/admin UI용) */
  threshold: number;
  /** 자동 신청 가능 여부 */
  autoAcceptable: boolean;
  trace: MatchStepTrace[];
  /** LLM이 추출한 artist/title (있으면 노출, 디버그용) */
  llmExtracted?: { artist?: string; title?: string };
}

export interface MatchV2Input {
  channelId: number;
  /** 채팅 원문 (Tier 분류용). 필수. */
  rawMessage: string;
  /**
   * 채널의 requestCommand 설정 (LiveSessionSettings.requestCommand). 기본 `!신청`.
   * 채팅 dispatcher 경로에서 전달. admin preview에서는 생략 가능 (default 적용).
   */
  requestCommand?: string;
}

/**
 * Tier별 자동 신청 임계값.
 * Tier 1: LLM/Full Fuzzy까지 다 동원하므로 낮게 (관대)
 * Tier 2: 기본 알고리즘 결과만 보고 중간 임계값
 * Tier 3: 정확 형식만 통과시켜야 하므로 높게 (오탐 0)
 */
export const TIER_THRESHOLDS: Record<Exclude<MatchTier, 'ignored'>, number> = {
  tier1: 0.5,
  tier2a: 0.7,
  tier2b: 0.7,
  tier3: 0.95,
};

export type { MatchedSong };
