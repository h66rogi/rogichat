# 웹 푸시 기반 요구사항

사용자 확정 요구: 로기챗 웹은 Service Worker 기반 Web Push를 지원한다.
이번 단계는 인프라·앱 scaffold에서 놓치지 않아야 할 조건을 기록하며, 알림 이벤트와
제품 UX의 상세 설계·구현은 이후 제품 설계에서 진행한다.

## 인프라와 배포 계약

- 웹 origin은 QA `https://qa.rogi.chat`, 운영 `https://rogi.chat`이다. Service Worker는
  **웹 origin**의 `/sw.js`에서 제공한다. API DNS-only 여부가 웹 SW의 origin을 바꾸지 않는다.
- Next.js 웹 앱에 manifest, 앱 이름 로기챗, 전용 아이콘, install/standalone 구성을 준비한다.
  SW는 웹 UI를 대체하는 것이 아니라 알림 수신·클릭·필요한 캐시 동작을 담당한다.
- `/sw.js`는 로그인 redirect/HTML fallback 없이 JavaScript MIME으로 제공하고 장기 immutable
  캐시에서 제외한다. 배포·rollback에서 이전 SW와 새 API의 호환 기간을 유지한다.
- QA/prod의 VAPID key pair·구독 저장소·발송 작업을 분리한다. private key는 외부 runtime
  secret, public key만 클라이언트 설정으로 전달한다. 과거 서비스의 키·구독을 복제하지 않는다.
- 발송은 API request나 SW의 계속 실행에 의존하지 않고 서버의 영속 outbox/worker가 맡는다.
  QA 단일 호스트에서 시작할 수 있으며 push 때문에 즉시 별도 서버를 추가하지 않는다.
- push provider로의 HTTPS egress가 필요하다. 사용자 제출 endpoint는 서버가 검증해 SSRF,
  내부 주소 접근·redirect 우회를 막는다. endpoint/auth/p256dh는 민감한 구독 정보로 취급한다.

## 제품 설계에서 결정할 항목

- 누가 어떤 이벤트를 받는지: 호스트 메시지, 팬 답장, 공지, 방명록 등 권한과 구독 범위.
- 알림 동의 요청 시점, 거절 이후 동작, iOS 설치 안내, 알림음·묶음·야간 방해 금지.
- 잠금 화면의 메시지 본문 노출 여부. 기본안은 최소 정보와 인증 후 내용 조회다.
- 여러 기기·웹/네이티브 앱 중복, 읽음 상태와 발송 취소, 탈퇴/차단/로그아웃/계정 전환.
- 클릭 URL의 로기챗 origin allowlist, 로그인 후 원래 화면 복귀, 만료·삭제된 메시지 처리.

## 출시 검증 기준

HTTPS와 명시적인 사용자 동작에 의한 권한 요청을 사용한다. iOS/iPadOS는 Home Screen
웹 앱의 Web Push 조건을 검증하고, 일반 Safari 탭에서도 동일하게 된다고 안내하지 않는다.
Android Chrome·데스크톱·iOS 실기기별로 background/종료·재시작·권한 철회·만료된 구독
404/410·중복 발송·오프라인 후 복귀를 검증한다. 전송 성공과 실제 전달/열람을 구분한다.

SW cache에는 OAuth callback, 인증 API, 사용자별 채팅/프로필 응답을 기본적으로 저장하지
않는다. 로그아웃·계정 전환 때 subscription의 user 연결과 캐시를 정리하고, 이전 계정의
알림이 새 계정 화면에서 내용을 노출하지 않도록 서버·SW 양쪽을 검증한다.
최신 Safari의 Declarative Web Push는 후속 호환성 검토 대상이며 초기 필수 의존성은 아니다.

근거: [WebKit Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/),
[Apple Web Push 안내](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers),
[Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API),
[Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/).
