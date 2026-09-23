/**
 * 노래책 추가 채팅 명령 결과 이벤트.
 *
 * overlay 가 토스트 표시 (별도 핸들러). admin 콘솔이 활동 로그 표시 가능.
 */
export const SONGBOOK_ADD_EVENTS = {
  FEEDBACK: 'songbook-add.feedback',
} as const;

export type SongbookAddOutcome =
  | 'accepted'
  | 'already_exists'
  | 'rejected_no_match'
  | 'rejected_no_permission'
  | 'low_confidence'
  | 'error';

export interface SongbookAddFeedbackEvent {
  channelId: number;
  sessionId: number;
  outcome: SongbookAddOutcome;
  /** 채팅 발화자 닉네임 — overlay 표시 후보. */
  nickname?: string;
  /** 사용자가 입력한 원 query. */
  query: string;
  /** 매칭/등록된 곡 정보 (accepted / already_exists 일 때만 채움). */
  title?: string;
  artistName?: string;
  /** accepted 시 0~1 confidence (admin trace 용). */
  confidence?: number;
  /** low_confidence / rejected_no_match 사유 (디버그용). */
  reason?: string;
}
