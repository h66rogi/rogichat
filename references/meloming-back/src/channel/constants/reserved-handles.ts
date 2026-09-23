/**
 * 채널 핸들(webPath) 로 사용할 수 없는 예약어.
 *
 * Why: meloming-front 의 라우팅이 unknown path 를 `/channel/{handle}` 로
 * fallback 하므로(`/admin` → `/channel/admin`), 누군가 `admin`/`support`/
 * `staff` 같은 핸들을 선점하면 그 채널 페이지가 운영자 페이지로 오인되어
 * phishing 사용자 경험이 만들어진다. DTO 단계에서 차단해 sign-up 자체를
 * 막는다.
 *
 * How to apply: 새 핸들을 막아야 할 일이 생기면 이 set 에만 추가하면
 * `NotReservedHandleConstraint` 가 자동으로 차단한다.
 */
export const RESERVED_CHANNEL_HANDLES = new Set<string>([
  // 운영자 사칭 방지
  'admin',
  'administrator',
  'root',
  'system',
  'staff',
  'manager',
  'owner',
  'ceo',
  'official',
  'support',
  'help',
  'contact',
  // 자사 브랜드
  'meloming',
  'dylabs',
  // 인증/시스템 라우트
  'api',
  'auth',
  'login',
  'signin',
  'signup',
  'register',
  'logout',
  // 일반 인프라/이메일
  'www',
  'mail',
  'ftp',
  'smtp',
  'dns',
  // 환경 식별자
  'qa',
  'dev',
  'test',
  'staging',
  'prod',
  // 메인 라우트와 충돌
  'mypage',
  'settings',
  'purchase',
  'subscription',
  'channel',
  'console',
  'page',
  'promotion',
  'content',
  'community',
  'ranking',
  'news',
  'app',
  'search',
  'ambassador',
  // 보안/법무 채널 사칭 방지
  'security',
  'dmca',
  'abuse',
  'privacy',
  'legal',
  'terms',
]);

export function isReservedHandle(handle: string): boolean {
  return RESERVED_CHANNEL_HANDLES.has(handle.toLowerCase());
}
