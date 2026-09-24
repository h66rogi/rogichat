/**
 * 채널 통합 캘린더 타입 정의
 *
 * 백엔드 source-of-truth:
 *   meloming-back/src/channel/dto/channel-calendar.response.dto.ts
 *   meloming-back/src/channel/dto/channel-calendar.query.dto.ts
 *
 * 백엔드 응답 DTO 와 1:1 매핑. 필드 추가/변경 시 백엔드부터 변경 후 동기화.
 */
import type { Schedule } from "@/meloming/domains/schedule/types/schedule";

/** 통합 캘린더 응답에 담겨오는 broadcast 기록. 백엔드 CalendarBroadcastDto 와 일치. */
export interface CalendarBroadcastRecord {
  /**
   * 방송 세션 키.
   * 형식: `${platform}:${platformChannelId}:${startedAt.toISOString()}`.
   */
  sessionKey: string;
  /** 방송 플랫폼 (CHZZK / SOOP / CIME / YOUTUBE) */
  platform: string;
  /** 방송 시작 시각 (ISO8601) */
  startedAt: string;
  /** 방송 종료 시각 (ISO8601) — ACTIVE 면 null */
  endedAt: string | null;
  /** 방송 상태 */
  status: "ENDED" | "ACTIVE";
  /** 방송 진행 시간 (분) — ACTIVE 면 null */
  durationMinutes: number | null;
  /** 방송 제목 (없으면 빈 문자열) */
  title: string;
  /** 카테고리 / 게임 (없으면 빈 문자열) */
  category: string;
  /** 최고 시청자 수 (없으면 0) */
  peakViewerCount: number;
}

/**
 * 통합 캘린더 응답에 담겨오는 클립 플랫폼.
 * 백엔드 prisma `ClipPlatform` enum 과 일치.
 */
export type ClipPlatform = "YOUTUBE" | "SOOP" | "CHZZK" | "OTHER";

/** 통합 캘린더 응답에 담겨오는 노래 클립. 백엔드 CalendarClipDto 와 일치. */
export interface CalendarClipRecord {
  /** 클립 ID */
  id: number;
  /** 클립 제목 */
  title: string;
  /** 클립 플랫폼 (YOUTUBE / SOOP / CHZZK / OTHER) */
  platform: ClipPlatform;
  /** 플랫폼 video ID. OTHER 면 null 가능. */
  videoId: string | null;
  /** 비디오 URL (OTHER 플랫폼용 또는 전체 URL) */
  videoUrl: string | null;
  /** 썸네일 URL */
  thumbnailUrl: string | null;
  /** 재생 시간 (초) */
  duration: number | null;
  /** 클립 생성 시각 (ISO8601) — 캘린더 표시 기준 시점. */
  createdAt: string;
  /** 해당 채널이 이 클립의 메인 채널인지 여부. false 면 출연(태그) 채널. */
  isPrimary: boolean;
  /** 연결된 노래 제목 (없으면 null) */
  songTitle: string | null;
}

/** 통합 캘린더 응답에 담겨오는 기념일. 백엔드 CalendarAnniversaryDto 와 일치. */
export interface CalendarAnniversary {
  /**
   * 기념일 ID. 자동 계산 (profile 의 debutDate / birthday 기반) 이면 null,
   * 수동 (Phase 2 의 ChannelAnniversary 테이블) 이면 cuid.
   */
  id: string | null;
  /** 기념일 출처. Phase 1 은 모두 AUTO. */
  source: "AUTO" | "MANUAL";
  /** 기념일 종류. Phase 1 은 BIRTHDAY / BROADCAST_MILESTONE. */
  type: "BIRTHDAY" | "BROADCAST_MILESTONE";
  /** 기념일 표시명 (예: "100일", "1주년", "생일") */
  title: string;
  /** 기념일 날짜 (ISO8601 — KST 자정의 UTC 표현) */
  date: string;
}

/** 통합 캘린더 응답 echo 의 range 객체. 백엔드 CalendarRangeDto 와 일치. */
export interface CalendarRange {
  /** from (요청 echo) */
  from: string;
  /** to (요청 echo) */
  to: string;
}

/** 통합 캘린더 응답. 백엔드 ChannelCalendarResponseDto 와 일치. */
export interface ChannelCalendarResponse {
  /** 채널 ID (numeric ID 의 문자열 표현) */
  channelId: string;
  /** 요청 범위 echo */
  range: CalendarRange;
  /** 채널 일정 목록 (PUBLIC + 본인/매니저면 PRIVATE 포함). 기존 Schedule 재사용. */
  schedules: Schedule[];
  /** 방송 기록 목록 (ranking-back). */
  broadcasts: CalendarBroadcastRecord[];
  /** 기념일 목록 (Phase 1 은 자동 계산만). */
  anniversaries: CalendarAnniversary[];
  /**
   * 노래 클립 목록. 채널이 메인/출연으로 연결된 VISIBLE 클립을 createdAt DESC 로 반환.
   * `createdAt` 이 [from, to) 안에 들어오는 것만 포함.
   */
  clips: CalendarClipRecord[];
}

/**
 * 통합 캘린더 검색 결과 아이템 타입.
 * 백엔드 CalendarSearchItemType 과 일치.
 */
export type CalendarSearchItemType =
  | "SCHEDULE"
  | "BROADCAST"
  | "CLIP"
  | "ANNIVERSARY";

/**
 * 통합 캘린더 검색 결과 1건. 백엔드 CalendarSearchItemDto 와 1:1 매핑.
 *
 * 결과를 하나의 flat 리스트로 합치므로 표시용 공통 필드(type/date/title/subtitle)
 * 와 타입별 식별자를 함께 담는다. 해당 타입이 아닌 식별자는 null.
 */
export interface CalendarSearchItem {
  /** 항목 종류 */
  type: CalendarSearchItemType;
  /** 이동 기준 날짜 (ISO8601). 클릭 시 캘린더가 이 날짜로 이동. */
  date: string;
  /** 결과 표시 제목 */
  title: string;
  /** 결과 보조 설명 (장소 / 카테고리 / 매칭 곡 등). 없으면 null. */
  subtitle: string | null;
  /** SCHEDULE 일 때 일정 ID. 그 외 null. */
  scheduleId: number | null;
  /** BROADCAST 일 때 세션 키. 그 외 null. */
  sessionKey: string | null;
  /** CLIP 일 때 클립 ID. 그 외 null. */
  clipId: number | null;
  /** ANNIVERSARY 일 때 기념일 종류. 그 외 null. */
  anniversaryType: string | null;
}

/** GET /channels/:identifier/calendar/search 응답. 백엔드 CalendarSearchResponseDto 와 일치. */
export interface CalendarSearchResponse {
  /** 채널 ID (numeric ID 의 문자열 표현) */
  channelId: string;
  /** 검색 키워드 echo */
  query: string;
  /** 검색 범위 echo */
  range: CalendarRange;
  /** 전체 매칭 수 (limit 상한 적용 전) */
  total: number;
  /** 검색 결과 (date DESC, limit 상한 적용 후) */
  items: CalendarSearchItem[];
}

/** GET /channels/:identifier/calendar/search 쿼리 파라미터. */
export interface GetCalendarSearchParams {
  /** 채널 식별자 (numeric ID 또는 webPath) */
  identifier: string;
  /** 검색 키워드 */
  q: string;
  /** 조회 범위 시작 (YYYY-MM-DD, inclusive). half-open `[from, to)`. */
  from: string;
  /** 조회 범위 끝 (YYYY-MM-DD, exclusive). half-open `[from, to)`. */
  to: string;
  /** 방송기록 포함 여부 (default: true) */
  includeBroadcasts?: boolean;
  /** 기념일 포함 여부 (default: true) */
  includeAnniversaries?: boolean;
  /** 일정 포함 여부 (default: true) */
  includeSchedules?: boolean;
  /** 클립 포함 여부 (default: true) */
  includeClips?: boolean;
  /** 최대 결과 수 (default 50, max 100) */
  limit?: number;
}

/** GET /channels/:identifier/calendar 쿼리 파라미터. */
export interface GetChannelCalendarParams {
  /** 채널 식별자 (numeric ID 또는 webPath) */
  identifier: string;
  /** 조회 범위 시작 (YYYY-MM-DD, inclusive). half-open `[from, to)`. */
  from: string;
  /** 조회 범위 끝 (YYYY-MM-DD, exclusive). half-open `[from, to)`. */
  to: string;
  /** 방송기록 포함 여부 (default: true) */
  includeBroadcasts?: boolean;
  /** 기념일 포함 여부 (default: true) */
  includeAnniversaries?: boolean;
  /** 일정 포함 여부 (default: true) */
  includeSchedules?: boolean;
  /** 클립 포함 여부 (default: true) */
  includeClips?: boolean;
}
