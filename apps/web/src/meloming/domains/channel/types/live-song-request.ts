export interface LiveSongRequestState {
  isLive: boolean;
  sessionId: number | null;
  requestEnabled: boolean;
  paused: boolean;
  maxQueueSize: number;
  queueCount: number;
  isQueueFull: boolean;
  canRequest: boolean;
  showRequestUI: boolean;
  loading: boolean;
  preventDuplicateSongs: boolean;
  blockedCategoryIds: number[];
  /**
   * 익명 웹 신청 허용 여부. true면 비로그인 유저는 닉네임 입력 모달 경로로
   * 신청 가능하고, false면 로그인 모달을 표시한다.
   */
  allowAnonymous: boolean;
  /**
   * 웹 랜덤 신청 허용 여부. false면 "랜덤신청" 버튼을 노출하지 않는다.
   */
  randomRequestEnabled: boolean;
  /**
   * 현재 로그인 사용자가 채널 운영자(소유자/활성 매니저/사이트 관리자)인지 여부.
   * true면 일반 사용자용 제한(maxPerUser/중복방지/blocked 등)을 우회할 수 있어
   * UI도 신청 버튼을 활성 상태로 노출한다.
   */
  viewerIsOperator: boolean;
}
