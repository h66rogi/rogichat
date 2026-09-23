/** 서비스 종료일. 상단 고정 바와 홈이 같은 날짜를 말하도록 한 곳에 둔다. */
export const SERVICE_SHUTDOWN_DATE_LABEL = "9월 25일";

/**
 * 서비스 종료 안내가 가리키는 고객센터 공지. 최상단 고정 바와 홈 포털이
 * 같은 곳을 가리키도록 한 곳에 둔다.
 */
export const SERVICE_NOTICE_URL = "https://help.meloming.com/notices/9";

/** 고객센터 홈. 문의와 나머지 공지가 여기로 모인다. */
export const HELP_CENTER_URL = "https://help.meloming.com";

/** 개인정보 유출 관련 공지 게시판. */
export const PRIVACY_INCIDENT_BOARD_PATH = "/community/privacy-incident";

/**
 * 유출 조회. 자체 페이지 `/privacy-incident` 는 proxy 가 이 주소로 307 을 보내므로
 * 홈에서는 한 번 덜 튀도록 최종 목적지를 직접 가리킨다.
 */
export const PRIVACY_INCIDENT_LOOKUP_URL =
  "https://help.meloming.com/inquiry?category=privacy-incident-lookup";

/** 마이페이지와 회원 탈퇴. `/mypage/withdrawal` 이 프로필 탭으로 넘겨준다. */
export const MYPAGE_PATH = "/mypage";
export const WITHDRAWAL_PATH = "/mypage/withdrawal";
