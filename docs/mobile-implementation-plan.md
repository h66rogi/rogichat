# Android/iOS 세부 구현 계획

2026-09-20. 상태: **구현을 위한 계획이며 기능 완료 기록이 아니다.**
초기 조사 `6123ae2`, 첫 QA 와이어프레임 `9a028b9`에 공통 기반 재사용 조사를 통합했다.
사용자 보정: **멜로밍의 탐색·설정·알림·공통 앱 구현을 우선 재사용하고 채팅 UX는 제외**한다.
즉시 목표는 서버 없이 진행할 수 있는 공통 shell·설정·OS 상태 기반이며, 실제 서비스의 첫
통합 목표는 **인증 → SOOP 연결 → 방 입장 → 두 OS 간 텍스트 왕복 → 앱 종료 후 복구**다.

> 후속 실행: 백엔드 병행 개발에 따라 미연동 화면부터 진행한
> [첫 QA 와이어프레임 구현·블로커 기록](mobile-wireframe-progress.md)을 참고한다.
> 실행 정책은 이 통합 계획을 따른다. 재사용 파일/심볼 근거는
> [공통 기반 조사](mobile-reuse-audit.md), 다관점 판정은 [리뷰 기록](mobile-implementation-review.md)에 있다.

## 1. 기준과 현재 상태

확정 정책은 [모바일 기반](mobile-foundation.md), [인증](mobile-authentication.md),
[백엔드 제품 정책](backend-design.md)을 따른다. 이번 문서는 구체적인 책임·의존성·작업
순서를 추가한다. API 변경 제안은 아래 MB01 계약 단계에서 백엔드와 함께 확정한다.
문서 작성 자체가 API 변경·실서비스 로그인·운영 승격을 승인하거나 완료하는 것은 아니다.

| 영역 | 조사 시점 증거 | 계획에서의 취급 |
|---|---|---|
| 네이티브 앱 | `9a028b9`에서 QA 전용 탐색/미연동 화면, prod 시작 화면 구현 | MB00/02 일부. 실제 세션/저장/통신은 미구현 |
| 빌드/배포 | QA/prod 분리, 서명 도구, Firebase/TestFlight 시험과 테스터 그룹 연결 | 기존 [배포 절차](mobile-test-distribution.md) 재사용 |
| M03 인증 | 웹 쿠키/Origin/CSRF, `/auth/session`, SOOP start/callback | 네이티브 handoff·Apple 인증은 미구현 |
| M04–M07 | 방·프로필·텍스트·삭제·sync·힌트·공개·반응과 합성 fixture | HTTP 계약을 확인하며 활용; live 성공과 구별 |
| 계약 패키지 | health JSON, JS sync/interaction 참조 구현 | OpenAPI·Kotlin/Swift 생성 DTO·실제 SQLite adapter는 아직 없음 |
| M08 | 미디어 관련 파일·migration·기존 DTO가 작업트리에서 수정 중 | 미커밋 형태를 확정 API로 생성하거나 복사하지 않음 |
| 백엔드 구조 | 평면 소스와 수동 조립을 feature module/DTO/projector로 보정하는 동시 작업 | 공개 HTTP 동작 보존과 구조 보정 완료를 서버 변경의 선행 확인 사항으로 둠 |

근거: [M03](backend-m03-implementation.md), [M04](backend-m04-implementation.md),
[M05](backend-m05-implementation.md), [M06](backend-m06-implementation.md),
[M07](backend-m07-implementation.md), [sync 참조](../packages/contracts/sync-client.mjs),
[상호작용 참조](../packages/contracts/interactions-client.mjs).
SOOP canonical subject와 broker 실연동, 실제 배포 상태는 해당 작업의 검증 결과를 받아야 한다.
미구현 로그인 우회를 hosted QA에 만들어 앱 개발을 진행하지 않는다.

## 2. 앱 책임과 의존 방향

```text
View → ScreenModel/ViewModel → Repository → 로컬 DB + REST client
                                       ↑
Lifecycle / Socket hint → SyncCoordinator
Composer → Outbox(원자 저장) → CommandSender → REST receipt → DB
SessionManager → 세션/계정 scope, 권한 gate, 위 작업의 취소·폐기
```

서버는 저장·권한의 최종 원본이다. 로컬 DB는 현재 허용된 화면 데이터와 복구 상태의
단일 저장소다. 화면은 REST 응답과 socket payload를 별도의 메시지 배열에 누적하지 않는다.
화면 전환은 작업을 구독/해제하며 앱 전체 sync와 전송 큐를 새로 만들지 않는다.

| 구성 요소 | 소유 책임 | 금지할 의존 |
|---|---|---|
| SessionManager | credential 보관, 복원, 현재 user/environment, session generation, logout | View가 token 직접 읽기/로그 기록 |
| APIClient | DTO 직렬화, 오류 변환, timeout, 인증 첨부 | 화면 전환·모든 403의 강제 로그아웃 |
| Repository | domain model 변환, DB 질의/transaction, command enqueue | ViewModel이 SQL·HTTP 호출 직접 조합 |
| SyncCoordinator | 직렬 sync, 힌트 병합, 페이지·reset·generation 관리 | socket cursor 추론, 중첩 sync |
| Outbox / CommandSender | 영속 command ID, 불변 payload, 재시도·receipt 병합 | 실패 시 새 ID 생성, 대상 변경 후 같은 ID 사용 |
| ScreenModel/ViewModel | 화면 상태·선택·스크롤 anchor·입력 intent | 세션 갱신·소켓·동기화의 별도 구현 |

Android 목표 모듈은 `app`, `core`, `feature:auth`, `feature:rooms`, `feature:chat`,
`feature:settings`다. core 내부는 model/network/database/session/sync/design 패키지로
구분한다. 실제 책임이 생길 때 추가하고 서로의 feature 내부를 import하지 않는다.
Compose + ViewModel/StateFlow, Hilt, Ktor, Room을 사용한다.

iOS는 앱 조립부와 `Features/{Auth,Rooms,Chat,Settings}`, 로컬 SPM `RogichatCore`
(Model/Network/Persistence/Session/Sync)로 시작한다. SwiftUI/Observation 화면 상태는
`@MainActor`, session/sync는 actor 경계, DB transaction은 GRDB가 관리한다.
URLSession, Keychain, 명시적 생성자 주입을 사용한다. actor reentrancy 때문에 await 이후에도
generation을 재확인한다. callback 기반 socket SDK는 adapter 안에 격리한다.

두 OS는 제품 동작·계약·fixture를 공유하고 네이티브 UI/저장 구현을 각각 유지한다.
KMP/TCA 등 추가 아키텍처 프레임워크 도입은 이번 기반 작업 범위에 포함하지 않는다.
새 의존성은 추가 PR에서 공식 stable·호환성을 확인하고 lock/version catalog에 고정한다.

### 2.1 공통 앱 기반 재사용 — 통합 결정

2026-09-20 사용자 보정: meloming-ios/android의 **탐색·설정·알림·공통 UI·앱 기반 구현을
최대한 재사용**한다. 멜로밍 채팅은 production UX 검증 근거가 없으며, **Talk/TalkV2의
화면·입력바·버블·제스처·scroll/socket/outbox 구현은 이식하지 않는다.** 로기챗의 채팅 제품
정책은 유지하되 자체 설계·검증한다. 이 결정이 이전의 채팅 UX 참고/상세화 우선 제안을 대체한다.

[재사용 조사](mobile-reuse-audit.md)는 원본 SHA·파일·심볼·결합도를 기록한 증거 목록이다.
실행 순서·제품 정책·gate의 단일 기준은 **이 문서**다. foundation은 요약, wireframe-progress는
구현 시점 기록, review는 결정 근거다. 별도의 경쟁하는 재사용 로드맵을 운영하지 않는다.

- 기본 선택은 **작은 구현 단위의 수정 재사용**이다. 독립적인 설정 행/section, navigation bar,
  loading/error/empty/button부터 실제 코드를 추출한다. 원본을 읽고 새로 작성한 코드는
  재사용 완료로 집계하지 않는다. 접근성 결함과 legacy 의존까지 보존하지는 않는다.
- screen 전체·전역 singleton·원본 DI graph·사업 기능·원본 버전을 일괄 이식하지 않는다.
  원본 스타일과 shell 구조를 필요한 단위로 가져오되 로기챗 이름/토큰/목적지로 바꾼다.
- Android는 `core/design`, `feature/settings`, app navigation부터 책임을 분리한다.
  예: `SettingsRow/SettingsSection`, `AppNavigationBar/AppTopBar`, `AppRouter`.
  물리 Gradle 모듈 분리는 재사용 경계에 실제 코드가 생길 때 수행한다.
- iOS는 `Core/Design/SettingsRow.swift`, `Features/Settings`, app `AppRouter/AppShell`로
  추출한다. UI는 `@MainActor`/Observation으로 주입하고 delegate 입력은 Sendable 값으로
  정규화한다. actor 사이 raw notification dictionary를 전달하지 않고 await 뒤 generation을
  재확인한다. 경고를 blanket `@unchecked Sendable`로 숨기지 않는다.
- settings/button/navigation 등 공통 코드와 screen model은 main/shared 영역에 둔다.
  합성 계정·방·시나리오·preview 진입·QA adapter는 QA source set/컴파일 조건에 남긴다.
  공통 화면의 prod 컴파일과 가짜 서비스 상태의 prod 노출은 별개다. 계약 전 prod 서비스 진입은
  계속 차단하며, 공통 UI 이동을 위해 preview gate를 인증 domain으로 승격하지 않는다.
- 원본 고정 endpoint/ID/브랜드/서명/분석·결제·방송·고객지원 SDK를 제거한다. 사용자 재사용
  지시는 자체 코드 재사용 작업의 승인으로 취급한다. 출처/third-party 고지와 배포 권리를
  파일별로 확인하고 불명확한 코드·자산 단위만 보류한다. 전체 공통 기반 작업을 멈추지 않는다.

### 2.2 Shell·라우팅·설정의 책임

초기 shell은 **대화 / 설정 2개 top-level 목적지**로 정한다. 알림 설정은 설정 내부에 둔다.
알림함·badge·별도 알림 탭은 현재 제품/API 계약이 없으므로 추가 확정 전 구현 완료 범위에서
제외한다. 멜로밍의 홈·채널·마켓 등 탭은 가져오지 않는다. 양 OS에서 같은 목적지 의미를
유지하되 Android back/탭 복원, iOS NavigationStack/dismiss 동작은 각각 구현한다.

`RouteIntent → RouteCoordinator → SessionGate/현재 room 권한 확인 → AppRouter → Screen`

Router는 stack/선택 tab을 소유하고 서버 호출·세션 갱신을 하지 않는다. SessionManager가
이용 gate를 제공하고, Coordinator가 목적지의 현재 권한을 검증한다. 실제 인가 전에는 private
화면을 복원하지 않는다. 저장하는 route에는 본문/토큰/서명 URL이 없고, 계정·환경·참여 scope가
바뀌면 private stack·sheet·pending intent를 버린다. UI route ID는 opaque 문자열이며 원본 Int
ID를 승계하지 않는다. 인증 completion은 content route hint와 별도 채널로 처리한다.

| 이용 상태 | 열 수 있는 화면 | shell/복귀 처리 |
|---|---|---|
| Restoring / RetryableFailure | 복원 상태·재시도·비민감 지원/정책 | 캐시된 private 화면/이름/알림 badge 표시 금지 |
| SignedOut | 로그인·정책/지원·일반 앱 정보 | 개인 설정과 대화 진입 금지; content link 자체로 인증하지 않음 |
| LinkRequired / SOOP 재연결 필요 | 연결 안내, 내 계정·logout·탈퇴·지원/약관 | 대화 조회/등록/sync/push 금지, 설정 접근은 유지 |
| Ready | 대화/설정, 현재 허용된 방/프로필 | 처음 진입 시 방 하나면 재인가 후 바로 열 수 있음; 설정 접근은 항상 유지 |
| Blocked / AccountClosing | 서버 정책에 맞는 계정 종료/지원 | 일반 대화·알림/전송 작업 정지; 차단 사유 이상 데이터 추론 금지 |

현재 QA의 `rooms → settings`만 가능한 reducer는 실서비스 권한 정책이 아니다. MB02b에서
QA 제한 계정 시나리오에도 설정/계정 관리 진입을 추가한다. 방 하나 자동 진입은 bootstrap의
첫 진입 판단에만 적용하고 목록 뒤로 가기/설정 복귀 때마다 강제로 다시 chat을 열지 않는다.

설정 모델은 row/section, 값, enabled/loading/saving/error, action을 화면에 주입한다.
버전 정보와 정책 링크 같은 일반 설정, 기기별 OS 상태, 계정/환경별 서버 설정을 구분한다.
서버 설정의 초기 미조회 상태를 true/저장 완료로 표시하지 않는다. 로딩으로 값을 대입하는
것과 사용자 변경 command를 분리하고, 빠른 연속 토글은 직렬화 또는 revision으로 최신 의도를
보장한다. 실패 rollback이 더 최근 선택을 덮어쓰지 않아야 한다. destructive action은 확인
화면을 거치며 실제 API 미연결이면 준비 중으로 표시한다.

### 2.3 알림·링크·앱 복귀의 선행 기반

알림은 세 축을 분리한다: **OS permission/channel 상태**, **앱/서버 preference**,
**provider token/device binding 상태**. 권한 허용은 서버 등록 성공이나 실제 전달 성공이 아니다.
OS 설정 복귀 시 권한을 다시 읽는다. Android runtime permission뿐 아니라 전체 앱/채널 차단,
iOS notDetermined/denied/authorized/provisional 등 플랫폼 상태를 adapter에서 다룬다.

MB02c는 permission read/settings-open, 합성 provider, route parser와 UI까지 구현한다.
QA 미리보기에서는 자동 permission prompt·SDK 초기화·device 등록을 하지 않는다. 실제 OS
adapter와 권한 요청은 사용자가 명시적으로 누른 설정 action에 연결하며 합성 상태와 분리한다.
FCM/APNs runtime 구성·등록·발송·해제는 **C09 계약 합의와 서버 준비 확인 후 MB07에서
구현**하고, 실기기 전달 시험으로 C09/MB07 통합 검증을 완료한다. 계약 합의와 기능 완료를
구분해 SDK 구현과 전달 시험이 서로를 선행 조건으로 요구하지 않게 한다. 현재 Firebase App
Distribution 사용을 runtime FCM 선택/설정 완료로 해석하지 않는다.

- 외부 URL은 로기챗의 환경별 allowlist·scheme·경로·길이·opaque ID 형태로 정규화하고
  미지/다른 환경 입력을 거부한다. 정책/지원 URL 미확정 시 임의 legacy URL로 대체하지 않는다.
  정상 외부 정책 링크는 browser adapter로 열며 auth-cookie 주입 WebView는 재사용하지 않는다.
- push는 최소 목적지 hint다. private 본문·팬 신원·signed URL·credential을 알림/로그에 넣지 않는다.
  parser, OS callback, pending queue는 화면을 직접 열지 않는다. foreground 수신은 자동 이동
  요청이 아니며, 사용자 tap만 route intent를 만든다.
- pending content intent는 메모리 **최대 1개, 최신 사용자 tap 우선, 5분 TTL**로 시작한다.
  event ID/정규화 key로 중복 tap을 합치고, 성공 이동/명시 취소/만료/계정·환경 변경 시 제거한다.
  consume 전 현재 계정/방 인가를 확인한다. 각 intent에 revision/nonce를 부여하고 인가 await
  뒤 session generation과 **pending revision도** 재확인한다. 같은 revision만 이동·제거할 수
  있어 A 인가 중 B tap이 들어오면 A가 뒤늦게 이동하거나 B를 지우지 않는다. 영구적인
  exactly-once 전달을 주장하지 않는다.
- 로그인 전 일반 content link는 로그인 시도와 묶은 비민감 intent로만 보류할 수 있다.
  같은 시도의 로그인 성공 뒤 재인가하고, 취소/다른 계정 전환에서는 폐기한다. 이전 계정에
  묶인 push는 새 계정으로 승계하지 않는다. binding 확인이 안 되는 push는 민감 목적지를 열지 않는다.
- 목적지 삭제/권한 철회는 안전한 목록/접근 안내로 종료한다. 일시적 네트워크 오류는 제한된
  대기/수동 재시도이며 URI를 외부 앱으로 fallback 실행하지 않는다.
- 한 LifecycleCoordinator가 foreground/OS 설정 복귀 신호를 전달한다. permission 재조회와
  SessionManager/SyncCoordinator 호출은 역할별로 분리하고 중복 신호를 병합한다.
  화면마다 독립 polling/socket을 만들지 않는다. session 종료 시 작업 취소와 generation 검사를
  함께 적용한다. 기존 loading(previous:)도 현재 권한이 확인된 같은 scope에서만 허용한다.

## 3. 서버와 먼저 확정할 모바일 계약 — MB01 산출물

기존 경로는 `/v1` 기준이다. 아래 **제안**을 현재 구현으로 오인하지 않는다.
각 항목은 OpenAPI/JSON fixture, 서버 회귀 테스트, Kotlin/Swift decode 시험이 통과해야 닫는다.

| ID | 현재 계약의 공백 | 구현안·완료 조건 | 담당 경계 |
|---|---|---|---|
| C01 | REST/socket이 웹 cookie·Origin·CSRF 전용 | web 흐름 보존, native Bearer credential adapter를 REST/socket 모두에 추가. 두 credential 혼합·환경 혼용 거부. 같은 session/account/ACL 검사 재사용 | 서버 Auth/Realtime + 앱 Session |
| C02 | 앱 복귀·Apple identity 처리 없음 | native login/link transaction, S256 PKCE, 서버 nonce, 일회용 completion exchange. Apple native/web client별 audience와 callback allowlist, 재전송·취소·충돌 시험 | 서버 Auth + 앱 Auth |
| C03 | session 응답에 user UUID/이용 상태 부족, room manifest는 role까지만 제공 | bootstrap에서 계정 scope와 상태, 방별 actor/참여기간 scope·capabilities 제공. `/auth/session` 확장과 별도 bootstrap 중 하나를 ADR로 확정. capabilities는 UX 힌트이며 서버 인가 대체 불가 | 서버 Auth/Rooms/Access |
| C04 | receipt에만 clientMessageId 있고 sync message에는 없음 | **작성자 본인에게만** clientMessageId를 direct GET/sync에 동일하게 projection하는 안을 우선 검증. 타 기기·ACK 유실에서도 하나로 합치며 공개본/타 사용자에는 제외. 명령 결과 조회 방식으로 바꾸면 동등한 중복 방지 fixture 필수 | 서버 Messages/Sync + 앱 Outbox |
| C05 | PRIVATE 응답에 답장 상대와 허용 동작이 충분하지 않음 | 현재 viewer에게 허용된 counterpart actor 및 reply/publish/delete 가능 여부를 명시. 본인이 보낸 개인답장의 상대 복원, 익명 공개본에서 원 작성자/원본 연결 미노출 시험 | 서버 projector + 앱 Composer |
| C06 | 화면 정렬·오래된 미로딩 메시지 upsert 처리 미확정 | 표시 순서·동일 시각 tie·history 병합 계약을 ADR과 fixture로 고정. 후보는 `(createdAt,id)` 표시 정렬과 기존 opaque pagination의 분리. commit 순서와 같다고 주장하지 않으며 내부 order/숨은 gap을 노출하지 않음 | 서버 Sync + 양 OS DB |
| C07 | DTO가 손으로 작성된 반환 객체, M08에서 변동 중 | canonical projector와 strict DTO에서 OpenAPI export. sync/socket versioned schema 및 JSON 공통 예제. nullable PATCH의 absent/null/value 구분과 unsigned bigint 문자열 비교 포함 | 서버 contracts + 양 OS API |
| C08 | 모바일 갱신·만료 정책 미확정 | 첫 버전은 기존 DB 검증 가능한 opaque session/만료 정책을 native Bearer로 운반하고 만료 시 재인증하는 안을 기준으로 ADR 확정. 존재하지 않는 refresh endpoint를 가정하지 않음. refresh 도입 시 rotation/replay/응답 유실을 별도 검증 | 서버 Auth + 앱 Session |

C09는 이번 재사용 조사에서 구체화한 **후속 알림 계약**이다. MB01의 C01–C08 인증/텍스트
계약을 일괄 지연시키지 않고, MB02c의 순수 UI/parser와 독립적으로 준비한다.

| 후속 계약 | 현재/제안 구분 | 완료 조건 |
|---|---|---|
| C09 — native push/device/preferences | backend M11 및 web-push 문서는 설계이며 native 등록·수신의 구현 증거가 아님. FCM/APNs transport 선택, installation/device 식별·계정/환경 binding revision, upsert/unbind·회전·재시도, preference scope/수정 동시성, 최소 route payload와 dedupe key를 명시 | 서버 발송 직전 session/SOOP/방 권한 재검사, logout offline·계정 전환·늦은 register/unregister/rotation 경쟁, 오래된 job 거부, OS 표시/tap 실기기 fixture. 실제 path/DTO는 OpenAPI 확정 전 가정하지 않음 |

알림함 이력·미확인 badge·채팅 unread는 C09 기본 범위에 자동 포함하지 않는다. 필요 시
제품 의미와 서버 pagination/count/read-state 계약을 별도 확정한다. C09 통합 검증 미완료는 push 완료 선언/공개 출시를
차단하지만 공통 shell·설정·OS 상태 UI나 MB03/04 REST 기반 기능을 차단하지 않는다.

C06은 MB04 전에 해결해야 하는 차단 항목이다. UUID 정렬이나 클라이언트 시각으로
commit 순서를 복원하지 않는다. 동일 timestamp, 역순 ACK, 오래된 메시지의 reaction upsert,
history와 delta 동시 도착, reset 후 페이지 도착을 양 OS에서 같은 fixture로 검증한다.
특히 같은 createdAt가 history 페이지 경계를 가로지르는 경우와 아직 로딩하지 않은 오래된
메시지가 reaction upsert로 처음 도착하는 경우를 포함한다.
서버 기존 페이지 순서와 새 표시 순서의 차이를 허용할지는 이 단계에서 명시적으로 결정한다.

OpenAPI는 DB row를 그대로 노출하지 않는다. 원본 스키마→고정 도구→Kotlin/Swift DTO를
생성하고 CI에서 drift를 확인한다. 네트워크/세션/저장 코드는 생성 DTO 바깥의 얇은 adapter로
유지한다. 참조 JS를 앱에 번들하지 않고 공통 JSON 입력·기대 결과를 같은 규칙으로 실행한다.

## 4. 인증·앱 시작 상태

```text
Restoring → SignedOut → Authenticating → LinkRequired → Ready
     └→ RetryableFailure              └→ Blocked / AccountClosing
```

이는 앱의 domain 상태이며 현재 서버 enum이라고 가정하지 않는다. 실제 bootstrap DTO를
mapper가 변환한다. 약관 필요 상태와 연결 진행/취소 상태는 Auth 내부에 둔다.
성공 redirect 자체를 Ready의 증거로 삼지 않고 서버 세션·SOOP·참여 상태를 재조회한다.

- iOS Apple 로그인은 native API, SOOP는 ASWebAuthenticationSession 계열을 사용한다.
  Android는 시스템 브라우저/Custom Tabs 경로이며 Apple web 인증도 같은 사용자 계정에 연결한다.
  WebView에서 provider 비밀번호를 수집하거나 서버 secret을 앱에 넣지 않는다.
- API callback과 앱 callback 경로를 분리한다. App/Universal Links는 환경별로 등록하고
  OS association 파일을 검증한다. URL에는 일회용 completion code만 둔다.
- login/link 의도, 로그인한 계정·session generation, environment, app challenge를 묶는다.
  앱 종료 후 인증 재개에 필요한 verifier/transaction만 단기 보호 저장하고 완료/취소/만료 시 제거한다.
  다른 계정으로 바뀐 뒤 늦게 온 callback을 적용하지 않는다.
- Apple identity는 검증된 issuer/subject로 연결한다. 이메일/이름 자동 병합 금지, 최초 제공
  이름·relay 이메일 재수신을 필수로 하지 않는다. SOOP 충돌은 계정 복구 흐름으로 안내한다.
- 첫 native session안은 server-side 폐기 가능한 opaque token이다. 저장은 iOS Keychain과
  Android Keystore 기반 보호를 사용한다. 앱 재설치 때 남은 Keychain의 세션을 의도 없이
  복원하지 않도록 설치 marker와 정책을 검증한다. OS backup에 세션/개인 cache를 포함하지 않는다.
- cold start에는 현재 세션·방 인가가 확인되기 전 private 본문을 표시하지 않는다.
  네트워크 오류는 재시도 화면이고 401로 오인해 계정이나 큐를 삭제하지 않는다.
- Apple identity 철회·SOOP 재검증·정지·탈퇴 결과를 서버와 앱에 연결한다. 로그아웃/탈퇴 시
  socket, 진행 요청, DB 관찰, 전송 작업을 정지하고 계정 데이터를 제거한다.

실제 provider 연동이 막혀 있는 동안 test/preview 및 **QA 설치 앱의 명시적 오프라인 화면
미리보기**로 개발한다. QA Release에도 비인증 synthetic adapter를 허용하되 실제 API와
연결하거나 session/capability로 사용할 수 없다. prod Debug/Release에는 fixture/preview
진입이 없어야 한다. hosted QA의 mock login·고정 사용자 토큰·인증 우회는 금지한다.

## 5. 화면·입력 모델

### 기본 화면

| 화면 | 동작·상태 | 의존 |
|---|---|---|
| 로그인/약관 | Apple/SOOP 진입, 진행·취소·재시도, 지원/정책 링크 | C01/C02/C08 |
| SOOP 연결 | 연결 목적·필수 안내, 취소 후 제한 계정 유지, logout/탈퇴 접근 | C02/C03, 계정 lifecycle |
| 방 선택/입장 | 참여/가입 가능 방, 빈 목록·로딩·실패. 참여 방 하나면 재인가 후 바로 이동 | C03, M04 |
| 채팅 | 공통+허용된 private 타임라인, history, 전송 상태·삭제, 연결 복구 표시 | C04–C07, MB04 |
| 내 프로필/설정 | 닉네임, 선택 생일 월/일, 전역 스트리머 공개 선택, 계정/알림 관리 | M04, MB06/07 |

첫 방 이름·ID·스트리머 UUID를 앱에 하드코딩하지 않는다. 최초 방 생성과 소유자 지정은
권한 있는 운영 작업이며 가입 첫 사용자를 자동 스트리머로 만들지 않는다.
생일은 기본 비공개, 팬에게 보이지 않은 필드는 합성해서 표시하지 않는다.

### 채팅 상호작용

- 팬은 공통 메시지와 자신의 private 대화를 한 타임라인에서 구별한다. 스트리머는 같은
  화면 기반을 쓰되 전체 발송/개인답장 대상을 입력창에 항상 명시한다.
- Composer는 `SharedDraft`와 `PrivateDraft(recipientActorId, quoteId?)`를 구분한다.
  초안 key는 계정·방·대상·참여 scope를 포함한다. 답장 진입 제스처는 별도 사용성 검증으로
  결정한다. 스와이프를 채택해도 초안만 열며 즉시 전송하지 않는다. VoiceOver/TalkBack에서
  접근 가능한 답장 버튼을 제공한다. 멜로밍 제스처를 기본 UX로 승계하지 않는다.
- 개인답장 대상이 일시적으로 거부되면 같은 계정의 초안을 보존하고 전송을 막는다.
  전체 발송으로 자동 전환하지 않는다. 방 접근/계정 자체가 철회되면 아래 삭제 정책을 우선한다.
- 전체공개는 별도 명령/명시적인 확인 화면으로 처리한다. 서버 정책상 팬의 추가 동의를
  요청하는 구조는 도입하지 않되 방 안내에 공개 가능성을 설명한다. 202는 준비 중이며
  publication 상태를 조회해 공개 메시지를 확인한다. 앱이 private 본문을 공통 메시지로 재전송하지 않는다.
- 반응은 본인 선택 1개/교체/해제와 집계만 표시한다. actor 목록·팬 활동을 추론하지 않는다.
  message version 갱신 시 보이는 메시지 중심으로 제한된 동시성의 reaction 조회를 합친다.
- 위로 history를 추가할 때 현재 보던 message ID와 offset을 유지한다. 과거를 읽는 동안
  새 메시지가 와도 바닥으로 강제 이동하지 않는다. 키보드·폰트 확대·회전/재생성을 시험한다.
- 저장 ACK는 상대방 읽음이 아니다. 미구현 read receipt·typing·온라인 인원은 표시하지 않는다.

## 6. 로컬 데이터·전송 상태·복구

각 환경/계정별 DB를 열고 session generation을 메모리 작업 fence로 둔다. 설치 단위 deviceId,
계정 manifest의 cacheId, 방별 timeline cacheId, 방별 profile cacheId를 구분한다.
한 방의 snapshot/events/history는 같은 timeline cacheId를 사용한다. 계정 전환은 모든 scope를
교체한다. C03/C07에서 이 cacheId 사용이 서버 binding과 일치하는지 fixture로 확정한다.
테이블 개념은
`rooms`, `memberships`, `messages`, `profiles`, `reactions`, `sync_checkpoints`,
`manifest_staging`, `outbox`, `drafts`, 이후 `media_transfers`다. membership period는 C03의
opaque scope를 사용한다. 실제 DB schema와 migration은 MB02/04에서 검증해 확정한다.

- `messages`: server ID, resource version(십진 문자열), audience, 허용된 author/content,
  tombstone, generation. version은 문자열 사전순·부동소수점으로 비교하지 않는다.
- `outbox`: UUID clientMessageId, 계정/방/참여 scope, 불변 정규화 payload, 상태, 시도 시각,
  serverMessageId/receipt. 전송 전에 payload와 낙관 표시 항목을 한 transaction에 저장한다.
- 전송 상태: `queued → sending → committed`; 응답 유실은 `outcomeUnknown`, 명시적 거부는
  `rejected/blocked`, 서버 삭제 receipt는 `deleted` 종료 상태로 구분한다.
  사용자가 내용을 수정하면 기존 불명 명령 결과부터 확인하고
  별도 새 명령을 만든다. 앱 재시작 후 sending은 새 ID 없이 결과 불명 상태로 복구한다.
- outbox row/메시지/receipt mapping 반영은 원자적이다. ACK보다 sync가 먼저 와도 C04로
  합친다. 계정/방 철회 후 과거 outbox를 자동 재전송하지 않는다.
- snapshot에 없다는 사실은 미전송 증거가 아니다. 현재 권한이 유효할 때 같은 ID와 payload로
  POST를 replay해 receipt를 확인한다. `deleted`이면 낙관 표시·본문을 지우고 최소 종료 표식만
  남긴다. 결과 확인 권한이 사라졌다면 미전송으로 단정하지 않고 송신 종료·해당 scope 정리를
  적용한다. 같은 내용을 새 ID로 자동 생성하지 않는다.
- 명시적 400/409는 자동 반복하지 않는다. 429는 서버 재시도 정보가 있으면 따르고,
  없으면 bounded exponential backoff+jitter를 적용한다. 네트워크/5xx는 같은 명령으로
  제한된 재시도와 수동 재시도를 제공한다. 실패 메시지를 새 명령으로 몰래 다시 보내지 않는다.

| 사건 | 표시/저장 정책 | 재개 |
|---|---|---|
| 일시적 네트워크 오류 | 확인된 현재 화면은 연결 안내와 유지; cold start 민감 본문은 gate | foreground에서 재인가·동기화 |
| 세션 401 | 작업 중지, 민감 cache/전송 큐 제거, 로그인 | 새 세션/새 cache generation |
| SOOP_LINK_REQUIRED | 채팅 상태·cache·큐 정리, 연결 안내 | 연결 확인 후 새 snapshot |
| 방 접근 상실 확인·퇴장 | room/bootstrap/완료 manifest로 접근 상실을 확인한 방의 본문·첨부 cache·초안·큐 제거 | 재입장은 새 참여 scope |
| 답장 대상만 거부 | 방 자체가 유효하면 대상 초안 유지, 자동 전송 중단 | 사용자가 명시적으로 해결 |
| logout/계정 전환/탈퇴 | 전체 계정 cache·검색 파생·미디어·credential 정리 | 다른 계정과 DB/작업 격리 |
| sync reset | 아래 reset 표에 따라 cache scope와 이전 응답 적용 차단; pending 송신 중단 | 서버에서 현재 참여/권한 확인 후 같은 명령으로만 결과 확인/재시도 |

첫 버전은 private 기록의 완전한 오프라인 열람·백그라운드 상시 전송을 보장하지 않는다.
개별 message/recipient/media endpoint의 403/404는 리소스 비가시성일 수도 있다.
해당 작업을 중단하고 같은 session generation에서 방/bootstrap을 재인가한다. 방이 유효하면
대상/인용 문제로 초안을 보존하고, 접근 상실이 확인되면 방 정리를 수행한다. 재인가가 네트워크
오류로 불가능하면 민감 내용을 숨기고 송신 중지 상태로 재확인을 기다린다. 오류 하나로 방
전체 큐를 삭제하거나 새 세션에 이전 재인가 결과를 적용하지 않는다.
알려진 `{error:{code}}` 외 Nest/프록시의 다른 오류 body·비 JSON 응답은 안전한 일반 오류로
변환한다. body 모양만으로 로그아웃하거나 raw response를 사용자/로그에 노출하지 않는다.
서버에서 삭제한 정보는 수신/재인가 시 지우지만 이미 사용자 기기에 노출된 내용의 소급 회수를
보장한다고 표시하지 않는다. 민감 본문·토큰·서명 URL을 진단 로그에 남기지 않는다.

reset 응답은 사유를 노출하지 않으므로 expiry·삭제·인가 변경 중 하나라고 추정하지 않는다.
outbox는 cache와 분리해 명령 ID·불변 payload·outcomeUnknown을 유지할 수 있지만 현재
계정/참여 scope를 재확인하기 전에는 전송·재전송하지 않는다. 철회 확인 시 payload를 제거한다.

| reset 발생 지점 | 폐기·차단 범위 | 복구와 큐 처리 |
|---|---|---|
| 계정 membership manifest | staging/continuation과 account manifest cacheId 교체, 그 계정의 pending 송신 일시 중지 | 완전한 새 manifest와 열린 방 재인가 후 scope 대조; 사라진 방/변경된 참여는 정리 |
| 방 snapshot/events/history | 해당 timeline generation·메시지/인용/반응·미디어 파생 cache·두 cursor 폐기, 방 송신 중지 | 새 timeline cacheId와 snapshot. outbox는 별도로 주차하고 현재 scope 확인 후 receipt replay; snapshot 부재로 재생성 금지 |
| 방 profile manifest | profile staging/continuation/cacheId와 기존 민감 profile 표시 무효화 | 새 profile cycle을 완주해 replace. 메시지 cursor는 유지하되 현재 권한 확인 실패 시 방/계정 정리로 확대 |
| 계정/방 인가 상실 확인 | 위 cache reset을 넘어 관련 outbox·초안·credential(계정 종료 시)까지 정리 | 새 인가/참여 이후에도 과거 명령 자동 부활 금지 |

## 7. 동기화 알고리즘

1. 계정별 coordinator 한 개, 동시 authoritative cycle 한 개. 힌트는 dirty flag로 합친다.
2. `/sync` membership manifest는 같은 generation의 전체 페이지 완료 후 교체한다.
   도중 generation이 바뀌면 staging을 버리고 재시작한다. 한 페이지에 없는 방을 삭제하지 않는다.
   완전한 manifest에서는 removed room, 변경된 참여 scope, 축소된 capability를 대조한다.
   해당 room 작업 generation을 먼저 무효화하고 화면/송신을 중단한 뒤 DB·파생 cache를 정리한다.
   같은 roomId의 재입장도 새 scope이며 이전 ACK/history/media callback은 commit할 수 없다.
   capability만 줄어든 경우에도 재인가와 cache rebuild를 수행하고 더 이상 허용되지 않는 큐를 폐기한다.
3. 진입 방은 snapshot에서 메시지와 event cursor를 함께 받고 DB에 원자 반영한다.
   history cursor는 별도 저장하며 event cursor를 변경하지 않는다.
4. event effects와 nextCursor를 같은 DB transaction으로 commit한다. 요청 cursor/cache/session
   generation이 현재와 다르면 응답 전체를 버린다. 낮은 version과 동일 version의 tombstone 역전도 거부한다.
5. profile manifest도 전체 완료 후 replace한다. 응답에서 빠진 생일 필드는 제거한다.
   알 수 없는 콘텐츠는 지원하지 않는 메시지 placeholder, 알 수 없는 필수 sync event/schema는
   적용/체크포인트 전진을 중지하고 업데이트 필요 상태로 처리한다. 무한 reset 반복 금지.
6. foreground/재연결/명령 ACK/socket hint에 sync한다. 기존 계약 초기값은 foreground
   15초±jitter, socket 장애 시 3–5초 polling, hint 100–250ms 병합이다. 테스트 가능 clock을 주입한다.
7. background에서는 상시 socket/polling에 의존하지 않고 종료/유예한다. 복귀 시 재인가·sync한다.
   네트워크 가용성 신호는 시도 계기일 뿐 서버 연결 성공 증거가 아니다.

Socket.IO adapter는 C01 native handshake가 통과한 뒤 붙인다. REST-only 모드에서 같은
복구 시험이 먼저 통과해야 한다. account-wide hint는 방 ID를 주지 않으므로 열린 방 우선 sync와
참여 방 재확인을 coalesce한다. 자동 socket recovery로 과거 payload를 재생하지 않는다.

## 8. 실행 단계와 PR 경계

단계 ID `MB`는 백엔드 `M01–M12`와 구별한다. 기간을 임의로 약속하지 않고 완료 gate로 진행한다.
서버 코드가 필요한 PR은 진행 중인 백엔드 구조 보정 담당 작업과 조율하며 평면 파일을 추가하지 않는다.
구조 보정이 검증·리뷰·commit 완료되기 전에는 계약 ADR/fixture 초안과 앱 독립 작업만 병행한다.
새 native Auth/DTO 등 서버 기능 PR의 착수는 구조 보정 완료 확인 이후다. 경계 합의만으로
이 선행 조건을 통과한 것으로 간주하지 않는다.

| 단계 | 선행 | 구체적인 산출물 | 통과 조건 |
|---|---|---|---|
| MB00 — 기준 고정 | 없음 | 현재 baseline/미완료 gate 기록, 양 OS module skeleton, synthetic personas와 화면 목록 | 기존 QA/prod·배포 검증 유지, 계정/방 2개 이상의 fixture |
| MB01 — 계약 확정 | MB00, 서버 구조 보정 경계 합의 | C01–C08 ADR, 작은 auth/room/message/sync OpenAPI, JSON fixture, 고정 DTO generator | backend 응답과 양 OS 모델 parity, 공개 projection 검증, D 항목 결정 |
| MB02 — 앱 기반 | MB00; 서버 adapter만 확정 계약 의존 | 아래 MB02a–d: 공통 구현 추출·shell·설정·OS 경계부터, 이후 API/Session/DB | 재사용 ledger, QA/prod 격리, gate/상태 복구와 adapter 시험 |
| MB03 — 실제 인증·방 | MB01/02, Apple/provider/broker 등록·실연동 | 시스템 인증, Apple/SOOP 연결, bootstrap, 방 입장, 초기 profile/settings, 최소 logout/작업 취소/세션·cache 정리 | Android/iPhone 실제 왕복·취소·재시작·충돌·기한 만료·계정 교체 시험 |
| MB04 — 텍스트와 복구 | MB03, C04/C05/C06 확정 | 로컬 outbox, snapshot/events/history, 최소 SHARED/PRIVATE composer와 스트리머 수신자 식별, 삭제, REST fallback, socket adapter | 팬 PRIVATE→스트리머, 스트리머 SHARED/PRIVATE→팬의 두 OS 왕복, ACK 유실+강제 종료, 중복/역순/reset/철회 시험 |
| MB05 — 대화 UX | MB04, M07 확인 | 스와이프·답장 선택 UX/접근성, 전체공개 상태, 반응, scroll anchor | 대상 오발송 0, 익명 공개본 역추적 정보 0, 원본 삭제 연쇄 반영 |
| MB06 — 미디어 | MB04/05, M08 계약·실배포 검증 | picker/전처리, upload 상태 머신, 처리 대기·재시도, authorized URL loader, 스티커/아바타 | 권한/URL 만료/취소/재시작/크기·형식 거부 및 계정 전환 시험 |
| MB07 — 계정·알림·출시 UX | MB03/04, C09 계약 합의, 서버 lifecycle/push/moderation/delete 준비 | MB03 logout 확장, 서버 탈퇴, 신고/차단, 생일 공개 철회, MB02c adapter에 실제 push binding/선호 설정/재인가 연결 | 늦은 push/callback/응답의 계정 혼입 0, 데이터 삭제·정책 링크·접근성 |
| MB08 — 내부 기능 검증 | MB03–05, 서버 실데이터 gate | QA 서명 빌드, 합성/승인 계정 시나리오, 지원 OS 실기기 결과 | 설치 성공과 기능 성공 분리, 알려진 제한 기록, 출시 기능은 MB06/07 포함 후 별도 승인 |

### MB02 실행 분할과 현재 우선순위

| 순서 | 구체적인 산출물 | 선행/통과 gate | 막힐 때 계속할 일 |
|---|---|---|---|
| MB02a — 재사용 단위·공통 UI | audit 후보 중 Android nav/topbar·settings row/section·button/empty/loading, iOS MyPageSection/MyActionRow·loading/error 상태 추출. 로기챗 token과 문자열·접근성 보강, provenance ledger | MB00 기준 SHA, 파일별 권리/의존 확인. 원본 legacy 자산·도메인·사업 SDK 없음; 원본 vs 수정 vs 신규 구분. 양 OS light/dark/긴 한글/큰 글자/스크린리더 확인 | 불명확 코드 단위만 보류; 독립 단위 추출과 화면 상태 시험 |
| MB02b — shell·설정 조립 | 대화/설정 루트, typed route, 설정/앱 정보/프로필/계정 UI. shared screen과 QA adapter 분리, LinkRequired 계정 관리 진입, back/tab 복원 | MB02a. SignedOut/LinkRequired/Ready/Blocked gate fixture, 방 하나 자동 진입·설정 복귀, 중복 탭·Activity 재생성/stack dismiss. 실제 세션 없이 prod 서비스 진입 금지 | 정책 URL/API 미확정 행은 준비 중. auth flow 실연동을 기다리지 않음 |
| MB02c — OS 알림·링크·lifecycle | permission/read/settings-open port, 알림 설정 3축 UI, 안전한 parser와 pending intent/consume, foreground coordinator. synthetic provider 및 OS adapter 분리 | MB02b; OS 호출에는 실제 platform 의미 검증. cold/warm/중복/TTL/다른 환경/잘못된 URL/계정 변경 fixture, prompt 자동 실행 없음. 실제 등록/푸시 성공은 MB07까지 보류 | 서버 선호 설정 대신 명시적 미연동 상태, 알림함/badge는 별도 결정 전 제외 |
| MB02d — 서비스 adapter·영속 기반 | C01/07/08 기반 APIClient/오류·SessionManager, 계정별 저장소와 test clock, Room/GRDB migration; 필요 부분만 참조 wrapper 수정 재사용 | 확정된 MB01 계약만 연결. 원본 refresh/WebView token/민감 logging 금지. 실제 SQLite·secure store 오류·취소·generation 시험 | 미확정 adapter는 port/fixture만, 다른 UI 작업 진행 |

현재 MB00 및 MB02의 preview 일부만 구현됐다. **다음 구현은 MB02a → MB02b → MB02c**다.
MB01 ADR/fixture 정리는 병행하고 준비된 계약에 한해 MB02d를 진행한다. MB03 및 이후 실제
기능 완료 gate는 낮추지 않는다. 채팅 상세 UX는 공통 기반 이후 로기챗 자체 설계로 이어간다.
표의 gate는 **단계 최종 완료 기준**이다. MB02a의 코드·컴파일·상태/격리 검사를 통과한
단위는 실기기 접근성 검사가 남아도 MB02b/c 조립을 계속할 수 있다. 미확인 기기·스크린리더
항목은 ledger에 남기고 사용성/기능 QA 완료나 공개 출시 완료로 보고하지 않는다. 제한을
명시한 내부 QA 빌드 배포는 기기 검증을 위한 수단으로 허용한다. 미확정 서버 계약·출처 단위만
보류하고 독립 구현을 진행하되, 인증·인가·프로덕션 격리 gate를 낮추지는 않는다.

QA 초안의 화면/역할 변경 시 입력 초기화는 preview 수명 정책이고 §6의 실서비스 영속 초안
보존/권한 철회 규칙을 대체하지 않는다.

PR은 (a) 서버 계약/fixture, (b) Android adapter/상태, (c) iOS adapter/상태, (d) 양 OS
통합 시나리오로 나눌 수 있다. 계약 PR을 기준으로 양 OS를 병행하고 한 OS만 기능 완성한 뒤
다른 OS를 뒤늦게 이식하는 순서를 피한다. MB02의 순수 화면/저장 기반은 provider 등록을
기다리지 않지만 MB03 완료를 합성 로그인으로 대체하지 않는다.

MB06에서는 M08 확정 DTO를 다시 읽는다. intent 생성→backend 업로드→처리 대기→READY
참조로 message enqueue를 분리한다. intent 생성/완료의 idempotency 계약 없이 자동 retry하지 않는다.
미디어 message도 동일 command를 재사용한다. 서명 URL은 영구 식별자/DB 원본이 아니며
60초 만료 후 현재 권한으로 재발급한다. multipart/background 재시작과 HEIC 변환 등은 실제
서버 지원 범위로 제한하고 미구현 영상/스티커를 성공처럼 표시하지 않는다.

MB07은 서버 M11/lifecycle 준비와 **C09 계약 합의** 뒤 실제 provider를 연결하고,
실기기 OS 표시/tap·계정 lifecycle 시험으로 C09/MB07 완료 gate를 닫는다. unregister가
offline에서 실패해도 UI logout을 무기한 지연시키지 않고 local fencing/알림 제거를 먼저 한다.
서버 session 폐기·binding revision과 발송 직전 권한 검사가 오래된 등록/job을 막아야 하며,
예전 unregister가 새 계정 binding을 제거하는 경쟁도 시험한다. 이 보장이 없으면 push gate를
닫지 않는다. 제공자 token/등록 식별자는 실제 SDK 계약에서 확정하며 영구 device ID로 가정하지 않는다.

MB07의 push payload는 최소 route hint로 취급한다. 현재 계정·방을 검증한 뒤 화면을 열며
토큰 갱신/사용자 전환 시 서버 binding을 정리한다. push 없이 foreground 복구가 가능해야 한다.
삭제·복구 원장·신고/차단·Apple 계정 lifecycle이 미완료면 공개 출시하지 않는다.

## 9. 검증 계획과 완료 증거

| 시험 | 최소 시나리오 | 실행 위치 |
|---|---|---|
| 계약 | nullable PATCH, 미지 variant, decimal version, privacy projection, 환경 혼용 | credential 없는 hosted CI, 같은 JSON fixture를 TS/Kotlin/Swift에 적용 |
| 실제 저장 | effects/cursor 중간 crash rollback, DB reopen, tombstone/history race, pending command 유지 | Room SQLite / GRDB SQLite 시험; 메모리 Map만으로 완료하지 않음 |
| 인증 | 2개 계정, login/link 취소·callback replay·PKCE 불일치·logout 후 callback·SOOP 충돌 | 격리 서버 fixture + 승인 QA 실제 provider/실기기 |
| 인가 | fan 2, streamer 2, admin, 비회원, 방 2; fan private/생일 숨김, 재입장·권한 철회 | 서버 통합 fixture + 양 OS adapter |
| 네트워크 | commit 뒤 ACK 유실, 요청 취소, timeout/429/5xx, 힌트 누락·중복, 재연결 | 합성 transport/서버 fault fixture; 실제 앱 종료·복귀도 별도 |
| 공통 shell/설정 | 상태별 route gate, 제한 계정의 설정/탈퇴 접근, 탭 재선택·복원·뒤로/닫기, 1방 자동 진입, 설정 load와 사용자 command 분리, 연속 토글 실패 역전 | 같은 intent/기대 결과 fixture + OS별 UI/기기 시험 |
| 알림/링크 | OS 허용/앱 preference/binding 독립, OS 설정 복귀, cold/warm tap·foreground 수신·중복·TTL·invalid URL·A 인가 중 B tap, 로그아웃/계정 교체/등록 회전·실패, 삭제 목적지 | parser/coordinator unit + platform adapter + MB07 실기기 전달 |
| UI | 키보드, history prepend, 긴 한글/이모지, font 확대, VoiceOver/TalkBack, private 대상 표시 | Compose/SwiftUI UI 시험 + iPhone/Android 실기기 |
| lifecycle | logout/account switch 중 모든 늦은 응답·push·media callback, backup/재설치 | OS별 저장/기기 시험 |
| 배포 | 환경/식별자/서명/버전 확인, 설치, API 왕복, TestFlight processing | 기존 QA release 도구와 private 결과 기록 |

필수 회귀 fixture에 다음을 추가한다: 동일 404의 상대 퇴장/인용 삭제/본인 퇴장/방 삭제,
재인가 중 계정 전환, manifest만으로 열린 방이 사라짐, 방 403 없이 재입장 scope 변경,
그 뒤 늦은 ACK/history/media 콜백, expired history cursor, profile generation 변경,
source deletion reset, snapshot 범위 밖 pending commit, reset 후 실제 철회.
`commit → ACK 유실 → 다른 기기에서 삭제 → 앱 재시작 → 동일 명령 replay → deleted receipt`
순서에서 본문이 되살아나지 않는지도 실제 SQLite와 UI에서 확인한다.

최소 지원 OS(Android 10/iOS 18)와 최신 지원 OS를 별도 확인한다. 실기기가 없거나 시험을
실행하지 못한 조합은 미확인으로 남긴다. 로컬 Xcode GUI/Simulator 상시 실행을 전제하지 않는다.
Node/Next 빌드·dev server는 로컬에서 실행하지 않고 hosted CI를 사용한다.
공개 CI에는 실제 Apple/Firebase/provider/cloud secret을 주지 않는다.

각 단계 완료 기록에는 source SHA, 계약 schema version, 시험 결과, 남은 gate를 남긴다.
실기기 계정/로그/스크린샷에 담긴 개인 정보와 서명 자료는 외부 private 위치에 보관한다.
공개 문서에는 합성 사례와 비민감한 결과만 기록한다. 자기 변경만 검사·commit·qa push하고
원격 CI를 확인한다. 테스트 배포와 main 승격/스토어 출시를 구별한다.

## 10. 선행 결정과 위험 관리

| 결정 | 기본 제안 | 확정 시점/근거 |
|---|---|---|
| D01 native session lifetime/refresh | 기존 폐기 가능한 opaque session, 만료 재인증. refresh는 별도 보안/복구 계약 없이는 추가하지 않음 | MB01 서버 Auth와 ADR; 앱이 토큰 포맷/만료를 추정하지 않음 |
| D02 계정/방 bootstrap | 현재 session·profile·manifest를 합성한 명시적 DTO, 방별 capability와 참여 scope 추가 | MB01 current transaction/인가 경계 검토 |
| D03 타임라인 정렬 | 공개 가능한 표시 순서와 opaque sync 위치를 분리 | MB01 fixture/ADR로 선택 확정; MB04 차단 항목 |
| D04 영속 DB/라이브러리 | Room/GRDB와 기존 플랫폼 기본 도구 우선 | MB02 최신 stable·compiler 조합·migration·실제 DB 시험 |
| D06 공통 shell/알림 범위 | 대화·설정 2개 root, 제한 계정 설정 접근 유지. 알림 설정은 포함, inbox/badge는 별도 정책/계약 전 보류 | 이 통합 계획에서 초기안 채택, 사용성 시험으로 세부 조정 |
| D07 native push transport/binding | 원본 runtime Firebase 설정은 미승계, APNs/FCM 선택과 SDK·식별자·binding revision을 C09로 확정 | MB07 착수 전 계약/서버 준비, 구현 후 OS 수신 시험으로 완료 |
| D05 실제 인증 외부 조건 | Apple capability/Services ID/환경별 callbacks, SOOP canonical subject/broker 검증 | MB03 시작 전 운영 담당 결과. provider 장애에 mock 성공으로 우회하지 않음 |

재사용 범위는 §2.1과 audit의 **비채팅 공통 기반**이다. 채팅 UX의 원본 계승은 제외한다.
정수 ID, sequence cursor, 화면별 socket, 새 ID 재전송, 다른 앱의 auth 의미/운영 설정은 이식하지 않는다. 소스 이식이
필요하면 파일·원본 commit·license를 별도로 기록하고 reference repo는 읽기 전용으로 유지한다.

## 11. 독립 리뷰 기록

문서 초안에 대해 backend/auth/contract와 native persistence/UX/실행 순서를 독립 리뷰한다.
구체적인 지적·반영 위치·재검토 결과는 [계획 리뷰 기록](mobile-implementation-review.md)에 남긴다.
이 리뷰는 계획의 검토이며 구현의 보안·성능·실기기 검증을 대신하지 않는다.

## 공식 참고 자료

- [Android notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)
- [Apple notification permission](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications)
- [Firebase registration lifecycle](https://firebase.google.com/docs/cloud-messaging/manage-tokens)
- [Android architecture recommendations](https://developer.android.com/topic/architecture/recommendations)
- [Android offline-first data layer](https://developer.android.com/topic/architecture/data-layer/offline-first)
- [OAuth for native apps / RFC 8252](https://www.rfc-editor.org/rfc/rfc8252)
- [Apple web authentication session](https://developer.apple.com/documentation/authenticationservices/webauthenticationsession)
- [Sign in with Apple verification](https://developer.apple.com/documentation/signinwithapple/verifying-a-user)

기존 탐색에서 확인한 공식 지침이다. 구체적 패키지 버전·스토어 요건은 해당 구현 PR에서
다시 조회하고 실제 채택·시험 결과를 기록한다.
