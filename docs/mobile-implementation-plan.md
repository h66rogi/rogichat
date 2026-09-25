# Android/iOS 세부 구현 계획

2026-09-20. 상태: **구현을 위한 계획이며 기능 완료 기록이 아니다.**
초기 조사 `6123ae2`, 첫 QA 와이어프레임 `9a028b9`에 공통 기반 재사용 조사를 통합했다.
**제1원칙: meloming-ios/android에서 가능한 구현을 최대한 가져와 재사용한다.**
화면·기능 흐름·공통 기반까지 적용하며, 멜로밍 채팅 UX는 제외한다.
사용자의 최신 보정에 따라 QA에도 **실제 출시용 MVP와 같은 제품 구성**을 사용한다.
이 원칙을 적용한 실제 코드·검증 범위는 [제품 구성 교체 기록](mobile-product-progress.md)에 있다.
후속 세션·프로필 연결과 구체적 발급/기기 블로커는 [네이티브 연결 기록](mobile-native-transport-progress.md)에 분리한다.
진행 중인 SOOP 클라이언트와 서명 준비는 [네이티브 인증 기록](mobile-native-auth-progress.md)에 기록한다.
실제 방 목록·계정별 SQLite의 구현 및 검증은 [방 저장소 기록](mobile-rooms-progress.md)에 기록한다.
그 후속인 실제 참여·나가기는 [방 명령 기록](mobile-room-mutations-progress.md)에 기록한다.
MB07의 서버 탈퇴 접수는 [후속 구현 계획](mobile-account-deletion-plan.md)으로 구체화했으며
동결된 양 OS 소스와 검증 경계는 [구현 기록](mobile-account-deletion-progress.md)에 있다.
이를 실제 접수·물리 삭제 완료로 집계하지 않는다.
방장 가입 전 실제 팬 전송은 [ROOM_OWNER 연결 기록](mobile-room-owner-progress.md)을 따른다.
기본방의 공개 READY와 내부 방장 결합을 구분하고, 다음 QA 배포는 통합된 한 묶음으로 만든다.
실제 서비스의 첫 통합 목표는 **인증 → SOOP 연결 → 방 입장 → 두 OS 간 텍스트 왕복 → 앱 종료 후 복구**다.

> [첫 QA 와이어프레임 기록](mobile-wireframe-progress.md)과
> [공통 기반 기록](mobile-common-foundation-progress.md)은 이전 구현의 증거다.
> 그 안의 QA 미리보기 배포 허용·샘플 계정 선택 정책은 폐기했고 해당 제품 진입 코드를 제거했다.
> 네이티브 인증·통신 연결과 실기기 사용성 검증은 아직 남아 있다.
> 실행 정책은 이 통합 계획을 따른다. 재사용 파일/심볼 근거는
> [공통 기반 조사](mobile-reuse-audit.md), 다관점 판정은 [리뷰 기록](mobile-implementation-review.md)에 있다.

## 1. 기준과 현재 상태

확정 정책은 [모바일 기반](mobile-foundation.md), [인증](mobile-authentication.md),
[백엔드 제품 정책](backend-design.md)을 따른다. 이번 문서는 구체적인 책임·의존성·작업
순서를 추가한다. API 변경 제안은 아래 MB01 계약 단계에서 백엔드와 함께 확정한다.
문서 작성 자체가 API 변경·실서비스 로그인·운영 승격을 승인하거나 완료하는 것은 아니다.

| 영역 | 조사 시점 증거 | 계획에서의 취급 |
|---|---|---|
| 네이티브 앱 | [제품 구성 교체](mobile-product-progress.md)와 [세션·프로필 adapter](mobile-native-transport-progress.md)가 QA에 통합되고 빌드 9로 배포됨 | 보호 credential 저장·REST·만료·로그아웃 경계가 구현됨. 제공자 발급·계정/방 DB·실기기 gate는 남아 MB02 전체 완료로 간주하지 않음 |
| 빌드/배포 | QA/prod 분리, 서명 도구, Firebase/TestFlight 시험과 테스터 그룹 연결 | 기존 [배포 절차](mobile-test-distribution.md) 재사용 |
| M03 인증 | 기존 웹 인증과 별도로 `ac69ca2`에서 native Bearer/session/logout/socket 계약 확정 | 실제 SOOP/Apple 발급·handoff·제공자 검증과 QA 왕복은 별도 gate |
| M04–M07 | 방·프로필·텍스트·삭제·sync·힌트·공개·반응과 합성 fixture | HTTP 계약을 확인하며 활용; live 성공과 구별 |
| 계약 패키지 | PR #17의 OpenAPI exporter와 응답 계약 시험이 QA에 통합됨. JS sync/interaction 참조 구현도 존재 | 현재 OpenAPI/실제 projector를 기준으로 Kotlin/Swift decode parity를 검증. 생성 DTO·versioned sync/socket·실제 SQLite adapter 완료로 확대 해석하지 않음 |
| M08–M09 | QA `8ece99d`까지 아바타 조회·스티커 메시지 변경 병합 | 확정 projection을 대조하며 후속 미커밋 형태를 생성 DTO로 취급하지 않음 |
| 백엔드 구조 | QA `0429d71`에 feature module/DTO/projector 보정 병합 | 이 기준의 인증·프로필 DTO를 읽어 앱 경계를 맞춤. 네이티브 인증 API 완료나 실제 운영 반영을 의미하지 않음 |

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

- 기본 선택은 **기존 구현의 수정 재사용**이다. 해당 기능의 원본 화면·상태 모델·탐색·
  OS 연결·테스트를 먼저 읽고, 로기챗에 적용 가능한 전체 흐름을 가져온다. 재사용을 작은
  row/button 함수로 제한하지 않는다. 필요한 컴포넌트 분리는 기능 이식을 위한 수단이다.
- 새 구현은 원본 부재, 로기챗 계약과의 구체적인 불일치, 확인된 결함 등 이유를 기록한 뒤
  선택한다. 원본을 읽고 새로 작성한 코드는 재사용 완료로 집계하지 않는다.
  기존 코드가 크거나 라이브러리가 오래됐다는 이유만으로 전체를 새로 쓰지 않는다.
- 화면의 유용한 구조·상호작용·상태 처리를 보존하고 로기챗 이름·토큰·목적지·계약으로
  수정한다. 관련 없는 사업 기능·운영 설정은 제거하며, singleton/DI 결합과 접근성 결함은
  필요한 경계에서 고친다. 최신 SDK/라이브러리 적용과 기존 앱 구현 재사용을 함께 수행한다.
- Android는 `core/design`, `feature/settings`, app navigation부터 책임을 분리한다.
  예: `SettingsRow/SettingsSection`, `AppNavigationBar/AppTopBar`, `AppRouter`.
  물리 Gradle 모듈 분리는 재사용 경계에 실제 코드가 생길 때 수행한다.
- iOS는 `Core/Design/SettingsRow.swift`, `Features/Settings`, app `AppRouter/AppShell`로
  추출한다. UI는 `@MainActor`/Observation으로 주입하고 delegate 입력은 Sendable 값으로
  정규화한다. actor 사이 raw notification dictionary를 전달하지 않고 await 뒤 generation을
  재확인한다. 경고를 blanket `@unchecked Sendable`로 숨기지 않는다.
- 제품 화면·상태 모델·앱 조립부는 main/shared 영역에 둔다. QA/prod는 같은 제품 경로를
  실행하고 endpoint·식별자·서명 등 환경 설정을 분리한다. 실제 계정/권한에 따른 분기는 유지한다.
  합성 계정·방·역할 선택·fake adapter는 격리된 자동 테스트에만 둔다. 제품 runtime과
  QA/prod target에 preview 진입이나 sample content를 넣지 않는다.
  QA flavor/`ROGICHAT_QA` 자체는 테스트 코드 격리 조건이 아니다. TestFlight/App Distribution
  산출물에도 합성 진입이 없어야 한다. 인증 전 private 화면은 양 환경 모두 실제 gate로 차단한다.
- 원본 고정 endpoint/ID/브랜드/서명/분석·결제·방송·고객지원 SDK를 제거한다. 사용자 재사용
  지시는 자체 코드 재사용 작업의 승인으로 취급한다. 출처/third-party 고지와 배포 권리를
  파일별로 확인하고 불명확한 코드·자산 단위만 보류한다. 전체 공통 기반 작업을 멈추지 않는다.

### 2.2 Shell·라우팅·설정의 책임

현재 shell은 **대화 / 채널 / 더보기 3개 top-level 목적지**를 사용한다. 채널 목적지는
멜로밍 채널 구현을 복사해 후로기 단일 채널의 공개 콘텐츠 계약으로 수정한다.
알림 설정은 더보기 내부에 둔다.
알림함·badge·별도 알림 탭은 현재 제품/API 계약이 없으므로 추가 확정 전 구현 완료 범위에서
제외한다. 멜로밍의 마켓 탭은 가져오지 않는다. 양 OS에서 같은 목적지 의미를
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
| SignedOut | 로그인·정책/지원·오픈소스 라이선스·기기 설정 | 개인 설정과 대화 진입 금지; content link 자체로 인증하지 않음 |
| LinkRequired / SOOP 재연결 필요 | 연결 안내, 내 계정·logout·탈퇴·지원/약관 | 대화 조회/등록/sync/push 금지, 설정 접근은 유지 |
| Ready | 대화/설정(iOS 표기는 더보기), 현재 허용된 방/프로필 | 처음 진입 시 방 하나면 재인가 후 바로 열 수 있음; 설정 접근은 항상 유지 |
| Blocked / AccountClosing | 서버 정책에 맞는 계정 종료/지원 | 일반 대화·알림/전송 작업 정지; 차단 사유 이상 데이터 추론 금지 |

테스트용 reducer와 역할 선택기는 실서비스 권한 정책이 아니다. MB02b에서 실제 이용 상태에
따라 설정/계정 관리에 진입하고, 제한 계정 시나리오는 테스트에서 검증한다. 방 하나 자동 진입은 bootstrap의
첫 진입 판단에만 적용하고 목록 뒤로 가기/설정 복귀 때마다 강제로 다시 chat을 열지 않는다.

설정 모델은 row/section, 값, enabled/loading/saving/error, action을 화면에 주입한다.
버전 정보와 정책 링크 같은 일반 설정, 기기별 OS 상태, 계정/환경별 서버 설정을 구분한다.
서버 설정의 초기 미조회 상태를 true/저장 완료로 표시하지 않는다. 로딩으로 값을 대입하는
것과 사용자 변경 command를 분리하고, 빠른 연속 토글은 직렬화 또는 revision으로 최신 의도를
보장한다. 실패 rollback이 더 최근 선택을 덮어쓰지 않아야 한다. destructive action은 확인
화면을 거친다. 실제 API 미연결 기능을 `저장 준비 중`·가짜 성공·작동하지 않는 메뉴로
배포하지 않는다. 화면/상태 모델은 완성하고 격리된 자동 테스트에서 상태를 검증한다.
필수 인증·계정 기능의 미연결은 통합 완료를 막는 블로커로 기록한다. 선택 기능은 완성될 때
제품 탐색에 연결한다. 실제 서비스 오류·빈 상태는 사용자에게 필요한 안내와 가능한 행동을 제공한다.

### 2.3 알림·링크·앱 복귀의 선행 기반

알림은 세 축을 분리한다: **OS permission/channel 상태**, **앱/서버 preference**,
**provider token/device binding 상태**. 권한 허용은 서버 등록 성공이나 실제 전달 성공이 아니다.
OS 설정 복귀 시 권한을 다시 읽는다. Android runtime permission뿐 아니라 전체 앱/채널 차단,
iOS notDetermined/denied/authorized/provisional 등 플랫폼 상태를 adapter에서 다룬다.

MB02c는 permission read/settings-open, route parser와 제품 UI까지 구현한다.
합성 provider는 테스트에 격리한다. 실제 OS adapter와 권한 요청은 맥락에 맞는 사용자 action에
연결하며, 권한/등록 상태를 사용자가 임의 선택하는 진단 UI를 제품에 노출하지 않는다.
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
| C01 | `ac69ca2`에 native REST/socket transport 계약 확정, 앱 연결·배포 검증은 후속 | 정확한 Bearer/client pair, web/native·환경 혼용 거부, 같은 DB 인가를 사용. 실제 credential 발급과 통합 왕복까지 확인 | 서버 Auth/Realtime + 앱 Session |
| C02 | SOOP 발급 후보 `de02c6a`에 start/launch/S256/exchange·오류 명시. 앱 복귀·Apple identity 처리는 후속 | 후보 계약 검토·QA 배포와 별개로 native client 구현 가능. broker canonical subject/운영 등록·실제 사용자 증거 필요. Apple native/web client별 audience와 callback allowlist, 재전송·취소·충돌 시험 | 서버 Auth + 앱 Auth |
| C03 | native `/auth/session` 계정 요약·SOOP 상태·만료·opaque generation 확정. 방/동기화 scope 연결은 남음 | 요약과 전체 프로필을 분리하고 제공자를 추정하지 않음. room의 joined/mode/actorId/next 보존, 방별 인가·scope 확인. capabilities는 서버 인가 대체 불가 | 서버 Auth/Rooms/Access |
| C04 | PR #34 `4002329`에 본인 command receipt 조회와 stable accountPartition 후보 구현. 기존 session account.userId는 호환 유지 | 기존 send의 동일 ID/정규화 payload와 receipt GET으로 ACK 유실을 조정. deleted는 terminal, 404는 미전송 증거나 새 ID 발급 허가가 아님. accountPartition은 인증/멤버십 fence가 아니며 키 회전 시 자동 replay 금지. QA 계약·멤버십 scope와 양 OS parity 검증 후 outbox 연결 | 서버 Messages/Sync + 앱 Outbox |
| C05 | 서버가 nullable counterpart와 required allowedActions 계약을 고정하고 독립 소스 리뷰를 통과했다고 전달. 게시 SHA·호스팅 CI·앱 parity는 후속 | 현재 viewer의 reply/publish/delete 힌트이며 인가를 대체하지 않음. 같은 version도 현재 scope의 전체 힌트를 교체하고 tombstone을 보존. 익명 공개본의 원 작성자/원본 연결 미노출 시험 | 서버 projector + 앱 Composer |
| C06 | PR #45 `691aff80`에 schemaVersion 2·membershipScope/authorizationRevision·표시 정렬과 terminal tombstone 보정 고정, 해당 hosted CI 통과. 앱 parity·동시 활성화는 후속 | `(createdAt,id)` 표시 정렬과 opaque pagination 분리. SEND는 현재 membershipScope를 receipt/dedupe보다 먼저 확인. 옛 pending을 새 멤버십에 자동 재결합하지 않음. 내부 order/숨은 gap을 노출하지 않음 | 서버 Sync + 양 OS DB |
| C07 | PR #17 OpenAPI exporter·응답 계약 시험이 QA에 통합됨. 양 OS의 세션/프로필 strict decode 구현 | 실제 exporter/projector를 기준으로 sync/socket versioned schema와 공통 JSON의 양 OS decode parity를 확정. nullable PATCH absent/null/value 및 unsigned bigint 문자열 비교 검증을 유지 | 서버 contracts + 양 OS API |
| C08 | `ac69ca2`에서 고정 7일 opaque credential·만료 시 재인증 확정 | 앱 보호 저장·복원·명시적 폐기·expiry/401/응답 경쟁 검증. refresh API는 없으며, 향후 도입 시 rotation/replay/응답 유실을 별도 검증 | 서버 Auth + 앱 Session |

C09는 이번 재사용 조사에서 구체화한 **후속 알림 계약**이다. MB01의 C01–C08 인증/텍스트
계약을 일괄 지연시키지 않고, MB02c의 순수 UI/parser와 독립적으로 준비한다.

| 후속 계약 | 현재/제안 구분 | 완료 조건 |
|---|---|---|
| C09 — native push/device/preferences | M11 PR #36 후보 `43d7bec`의 backend-m11-contract/m11.openapi를 후속 소비자 기준으로 검토. expectedGeneration은 필수 uint64 decimal이며 opaque accountGeneration과 별개. native는 실제 provider 준비 전 read/disable만 허용하고 enable/register/remove는 503 | MB03과 별도 변경으로 정확한 DTO·CAS·오류·늦은 응답을 연결. signed readContext/current membership, 토글 역전·계정 변경·OS 권한과 서버 선호 분리 검증. FCM/APNs 발송·표시/tap 실기기·SOOP/방 재인가는 source 구현이나 선호 조회만으로 완료 처리하지 않음 |

알림함 이력·미확인 badge·채팅 unread는 C09 기본 범위에 자동 포함하지 않는다. 필요 시
제품 의미와 서버 pagination/count/read-state 계약을 별도 확정한다. C09 통합 검증 미완료는 push 완료 선언/공개 출시를
차단하지만 공통 shell·설정·OS 상태 UI나 MB03/04 REST 기반 기능을 차단하지 않는다.

MB03 인증 소스를 고정한 뒤 M11 소비자는 별도 변경으로 진행한다. 기준은
[고정 계약](https://github.com/h66rogi/rogichat/blob/43d7bec2793d8c5f12719e3c3d9f5b4af68f9dd3/docs/backend-m11-contract.md)이며
계약 소스의 존재와 QA 배포·native provider 활성화를 구분한다.

양 OS의 후속 실제 구현과 재사용·검증은 [M11 진행 기록](mobile-notification-preferences-progress.md)에
모은다. Android `577fb9e`·iOS `6513439`의 앱 소스를 통합했으며 새 credential 형식이나
native push SDK를 추가하지 않았다. MB03 서명 단계와 별도 검증·배포한다.

1. `GET /v1/me/notification-preferences`의 실제 확인값과 generation을 사용한다.
   LINK_REQUIRED도 서버가 허용한 계정 조회 범위다. unknown/loading/error를 false/true
   기본값으로 바꾸지 않는다. OS 허용 상태와 서버의 계정 전체 설정은 별도 섹션으로 둔다.
2. 현재 native 계약에서 가능한 `PUT`의 `pushEnabled:false`만 연결한다. 실제 값이 true일
   때 다른 기기/웹에도 적용되는 계정 전체 알림 끄기임을 설명한다. provider 없는 켜기·등록
   동작이나 가짜 성공을 제공하지 않는다. `expectedGeneration`은 양의 uint64 문자열이며
   최대 `18446744073709551615`다. opaque accountGeneration·accountPartition과 섞지 않는다.
3. 멜로밍 설정 화면/VM/API 책임을 재사용하되 낙관적 토글·과거 값 rollback은 교체한다.
   확인된 응답으로만 값/세대를 갱신하고 한 번에 한 쓰기, 계정·요청·변경 revision을 적용한다.
   409나 PUT 응답 유실은 GET으로 다시 확인한 뒤 새 사용자 선택을 요구한다. 낡은 GET/PUT/401이
   새 계정이나 더 최신 확인값을 바꾸면 실패다.
4. room read-state는 typed client까지만 독립 준비한다. 실제 표시한 허용 messageId와
   현재 opaque readContext를 연결하는 작업은 C05/C06·방 lifecycle 이후다. null/누락/최대
   100개 응답에서 unread 수를 추정하거나 Web Push 형식에 FCM 토큰을 넣지 않는다.

C05/C06의 계약 결정은 전달받았지만 현재 MB03 서명 소스에 채팅 기능을 섞지 않는다.
고정 게시 SHA·서버 회귀 시험·양 OS decode/저장 검증은 MB04 전에 해결해야 하는 항목이다.
UUID 정렬이나 클라이언트 시각으로
commit 순서를 복원하지 않는다. 동일 timestamp, 역순 ACK, 오래된 메시지의 reaction upsert,
history와 delta 동시 도착, reset 후 페이지 도착을 양 OS에서 같은 fixture로 검증한다.
특히 같은 createdAt가 history 페이지 경계를 가로지르는 경우와 아직 로딩하지 않은 오래된
메시지가 reaction upsert로 처음 도착하는 경우를 포함한다.
승인된 C06은 내부 생성 순서의 페이지 경계를 먼저 캡처하고 선택된 결과를 표시 순서로
정렬한다. 이벤트 로그의 순서는 유지한다. complete manifest만 멤버십 교체의 근거이며,
부분 discovery로 기존 멤버십을 지우지 않는다. 계정·방·요청 generation과 현재 M/A를 함께
검증하고 reset의 null scope/빈 결과를 처리한다. 이 승인 자체를 QA 활성화로 기록하지 않는다.

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

실제 provider 연동이 막혀 있는 동안 화면과 상태 처리는 제품 코드로 개발하고 격리된 자동
테스트에서 검증한다. **QA Release의 synthetic adapter 허용 정책은 폐기한다.**
QA/prod 배포 산출물 모두 fixture/preview 진입이 없어야 한다. QA에서만 가짜 로그인으로
완성된 앱처럼 이동시키거나 prod를 별도의 축소된 시작 화면으로 유지하지 않는다.
hosted QA의 mock login·고정 사용자 토큰·인증 우회도 금지한다.

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

각 환경/서버 `accountPartition`별 DB를 열고 원래 승인된 session scope를 HTTP·DB commit·
화면 게시까지 전달한다. partition이 없는 호환 세션은 인증을 유지하되 durable 채팅을 열지
않고 userId로 DB key를 대체하지 않는다. partition 변경은 이전 DB/작업을 격리하며 자동
이동·replay하지 않는다. 설치 단위 deviceId,
계정 manifest의 cacheId, 방별 timeline cacheId, 방별 profile cacheId를 구분한다.
한 방의 snapshot/events/history는 같은 timeline cacheId를 사용한다. 계정 전환은 모든 scope를
교체한다. C03/C07에서 이 cacheId 사용이 서버 binding과 일치하는지 fixture로 확정한다.
테이블 개념은
`rooms`, `memberships`, `messages`, `profiles`, `reactions`, `sync_checkpoints`,
`manifest_staging`, `outbox`, `drafts`, 이후 `media_transfers`다. membership period는
C06의 `membershipScope`(M)를 사용하며 `authorizationRevision`(A)과 구분한다.
실제 DB schema와 migration은 MB02/04에서 검증해 확정한다.

- `messages`: server ID, resource version(십진 문자열), audience, 허용된 author/content,
  tombstone, generation. uint64 version은 canonical TEXT로 저장하고 문자열 사전순·
  signed SQL INTEGER·부동소수점으로 비교하지 않는다. 같은 account/room/cache generation과
  M/A의 terminal tombstone은 더 큰 version을 포함한 모든 later live를 거부한다.
  복구는 새 fenced generation과 authoritative snapshot으로 수행하며 ID 재사용은 없다.
- `outbox`: UUID clientMessageId, 계정/방/참여 scope, 불변 정규화 payload, 상태, 시도 시각,
  serverMessageId/receipt. 전송 전에 payload와 낙관 표시 항목을 한 transaction에 저장한다.
- 전송 상태: `queued → sending → committed`; 응답 유실은 `outcomeUnknown`, 명시적 거부는
  `rejected/blocked`, 서버 삭제 receipt는 `deleted` 종료 상태로 구분한다.
  사용자가 내용을 수정하면 기존 불명 명령 결과부터 확인하고
  별도 새 명령을 만든다. 앱 재시작 후 sending은 새 ID 없이 결과 불명 상태로 복구한다.
- outbox row/메시지/receipt mapping 반영은 원자적이다. ACK보다 sync가 먼저 와도 C04로
  합친다. 계정/방 철회 후 과거 outbox를 자동 재전송하지 않는다.
- snapshot에 없다는 사실은 미전송 증거가 아니다. 현재 권한·원래 M을 확인하고 C04 GET
  receipt를 먼저 조회한다. 404는 `outcomeUnknown`을 유지하며 재전송·새 ID 허가가 아니다.
  현재 권한과 동일 M이 계속 유효할 때만 원래 ID·payload·M으로 제한된 SEND 재시도를
  별도 결정한다. `deleted`이면 낙관 표시·본문을 지우고 최소 종료 표식만 남긴다.
  결과 확인 권한이 사라지면 미전송으로 단정하지 않고 송신 종료·해당 scope 정리를 적용한다.
  재입장 후 새 M을 오래된 command에 끼워 넣거나 같은 내용을 새 ID로 자동 생성하지 않는다.
- 명시적 400/409는 자동 반복하지 않는다. SEND의 timeout·연결 유실·5xx와 콜드 시작의
  sending은 결과 불명으로 보존하고 GET receipt만 수행한다. GET의 404도 자동 POST를
  허용하지 않는다. 첫 통합 구현은 결과 불명 명령의 자동 SEND 재시도를 제공하지 않는다.
  향후 명시적 재시도를 붙일 때도 실제 현재 권한·원래 M과 불변 ID/payload를 별도 검사한다.
  429의 대기 정보나 GET용 bounded backoff+jitter를 SEND 재실행 정책으로 공유하지 않는다.
  서버가 보낸 메시지 projection에는 clientMessageId가 없으므로 본문·시각 추정으로 pending을
  합치지 않고 실제 receipt의 serverMessageId만 사용한다.

같은 accountPartition의 콜드 복원은 인증·manifest를 재확인할 때까지 표시·전송 권한을 닫되,
결과 불명 명령의 불변 ID/payload/M을 먼저 삭제하지 않는다. 일시적인 미검증 상태와 실제
logout/401/partition 변경·확정된 접근 상실의 파괴적 정리를 분리한다. 실제 세션 restore와
DB close/reopen을 거친 시험에서 POST 0회·GET receipt 우선 복구를 검증한다.

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
| 방 snapshot/events/history | 해당 timeline generation·메시지/인용/반응·미디어 파생 cache·두 cursor 폐기, 방 송신 중지 | 새 timeline cacheId와 snapshot. outbox는 별도로 주차하고 현재 scope 확인 후 GET receipt 조회; SEND 재시도는 별도 결정하며 snapshot 부재로 재생성 금지 |
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
| MB00 — 기준 고정 | 없음 | 현재 baseline/미완료 gate 기록, 양 OS module skeleton, 원본→대상 재사용 목록, 제품 화면 목록 | 기존 환경·배포 도구 검증 유지; 계정/방 fixture는 테스트에만 포함 |
| MB01 — 계약 확정 | MB00, 서버 구조 보정 경계 합의 | C01–C08 ADR, 작은 auth/room/message/sync OpenAPI, JSON fixture, 고정 DTO generator | backend 응답과 양 OS 모델 parity, 공개 projection 검증, D 항목 결정 |
| MB02 — 앱 기반 | MB00; 서버 adapter만 확정 계약 의존 | 아래 MB02a–d: 원본 기능 흐름 재사용·제품 shell·설정·OS 경계부터, 이후 API/Session/DB | 재사용/신규 사유 ledger, QA/prod 공통 제품 경로, 배포 fixture 배제, gate/상태 복구와 adapter 시험 |
| MB03 — 실제 인증·방 | MB01/02, Apple/provider/broker 등록·실연동 | 시스템 인증, Apple/SOOP 연결, bootstrap, 방 입장, 초기 profile/settings, 최소 logout/작업 취소/세션·cache 정리 | Android/iPhone 실제 왕복·취소·재시작·충돌·기한 만료·계정 교체 시험 |
| MB04 — 텍스트와 복구 | MB03, C04/C05/C06 확정 | 로컬 outbox, snapshot/events/history, 기본 SHARED composer와 메시지 선택형 스트리머 PRIVATE 답장, 삭제, REST fallback, socket adapter | 팬 SHARED, 스트리머 SHARED/선택한 메시지 작성자에게 PRIVATE 답장의 두 OS 왕복, ACK 유실+강제 종료, 중복/역순/reset/철회 시험 |
| MB05 — 대화 UX | MB04, M07 확인 | 스와이프·답장 선택 UX/접근성, 전체공개 상태, 반응, scroll anchor | 대상 오발송 0, 익명 공개본 역추적 정보 0, 원본 삭제 연쇄 반영 |
| MB06 — 미디어 | MB04/05, M08 계약·실배포 검증 | picker/전처리, upload 상태 머신, 처리 대기·재시도, authorized URL loader, 스티커/아바타 | 권한/URL 만료/취소/재시작/크기·형식 거부 및 계정 전환 시험 |
| MB07 — 계정·알림·출시 UX | MB03/04, C09 계약 합의, 서버 lifecycle/push/moderation/delete 준비 | MB03 logout 확장, 서버 탈퇴, 신고/차단, 생일 공개 철회, MB02c adapter에 실제 push binding/선호 설정/재인가 연결 | 늦은 push/callback/응답의 계정 혼입 0, 데이터 삭제·정책 링크·접근성 |
| MB08 — 내부 기능 검증 | MB03–05, 서버 실데이터 gate | QA 서명 빌드와 승인된 실제 QA 계정 시나리오, 지원 OS 실기기 결과; 합성 상태는 별도 테스트 | 설치 성공과 기능 성공 분리, 알려진 제한 기록, 출시 기능은 MB06/07 포함 후 별도 승인 |

### MB04의 첫 구현 경계 — 교차 OS 리뷰 반영

후속 구현은 C04/C05/C06이 함께 들어 있는 서버 고정 소스
`f9197a31d61b7c34256e92f0bcb73ee255275d40`과 그 OpenAPI를 기준으로 한다.
개별 계약 브랜치는 변경 이력이며 DTO를 조합하는 구현 기준이 아니다. 이 소스는 공개 PR의
원격 SHA까지 확인했지만 아직 live 활성화 증거가 아니다. schema 2 서버·웹·양 OS의 호환성은
같은 활성화 계획에서 확인한다. `authorizationRevision`에 추가된 content_epoch도 불투명 값으로
처리하고 클라이언트가 M/A를 계산하지 않는다.

C06 `691aff80bbcc96903ffe11d76b2a7561859ddb02`의 schemaVersion 2와 C05 `492f2f7`,
C04 `4002329`를 기준으로 양 OS 설계를 독립 검토했다. C06 terminal tombstone은 같은
cache generation/M/A 안에서 높은 version을 포함한 모든 later live를 거부한다. 해당
reference helper·문서·회귀 보정은 고정 SHA에 포함됐다. 새 authority는 새 fenced generation과
authoritative snapshot으로 확인한다. 첫 단계의 소스 계약 블로커는 없으며, 실제 API 활성화는
웹·양 OS의 schema 2 대응과 rollback 경로를 함께 확인한 뒤 조정한다.

1. **MB04a**는 실제 discovery·complete membership manifest·계정별 on-disk DB와
   partition/session commit fence까지만 양 OS 동일하게 구현한다. Android Room과 iOS
   GRDB를 사용하며 원본 멜로밍에 대응 DB 구현이 없어 새 DB라고 기록한다. 기존 HTTP,
   repository·constructor/dispatcher 주입, 목록 loading/error 구조는 실제 원본을 재사용한다.
2. discovery는 페이지별 탐색 결과다. 여기에 담긴 joined/M/A가 늦게 도착해 더 최근의
   authoritative membership을 덮어쓰면 안 된다. 완전하고 같은 generation인 manifest만
   멤버십 교체·누락 방 정리의 근거다. empty complete, partial, reset, 오류를 구분한다.
   M/A는 manifest envelope가 아니라 각 room에 있다.
3. metadata/discovery/memberships/manifest staging/account checkpoint만 저장한다.
   아직 사용하지 않는 messages/profiles/outbox/drafts 테이블·receipt client는 추가하지 않는다.
   실제 SQLite rollback/reopen, 페이지 중 종료, 혼합 generation·중복·반복 cursor·schema 1
   거부, scope 변경과 최종 COMMIT 사이 경쟁, cleanup 실패 후 cold reopen을 시험한다.
4. 목록·참여 상태·새로고침·페이지/오류/재시도만 실제 결과로 보여준다. 미구현 대화 진입이나
   join/leave 자리표시 버튼을 제공하지 않는다. **입장/퇴장은 후속 mutation 단계**에서
   명시적 사용자 동작·서버 응답·완전 manifest 재확인을 함께 완성한다.
5. **MB04b/c**에서 실제 메시지 cache, C05 전체 projection 교체, 원자적 cursor/effect 저장,
   C04 GET receipt 복구와 원래 M이 불변인 durable outbox를 차례로 구현한다. 그 전에
   timeline·composer·SEND worker·읽음 보고·socket을 활성화하지 않는다.

MB03의 실제 provider/기기 gate는 유지하면서 위 코드·격리 검증은 독립 진행한다.
schema 2의 QA 활성화는 web/Android/iOS 소비자와 backend의 정확한 통합 SHA 및 동시
전환/rollback 계획을 조율한 뒤 수행한다. 코드 존재를 실제 계정·호스팅 왕복으로 대체하지 않는다.

MB04a의 후속 참여·나가기는 고정 C06의 `{}` POST만 한 번 전송하고 fresh complete
manifest로 전체 참여 상태를 재확인한다. 표시한 원본 scope/cycle/M을 coordinator admission과
실제 DB COMMIT까지 보존하며 화면 재생성이 전송·재확인을 중복 실행하지 못하게 한다.
GET의 현재 상태는 이전 POST 종료나 실패의 증거가 아니다. 결과 불명 안내는 조회 오류와
분리하고 old row callback·A→B→A·late response·DB 실패 회귀로 검증한다. 이 후속을 별도
메시지 단계로 바꾸지 않으며 MB04b/c의 cache/outbox/SEND 범위와 gate는 유지한다.

2026-09-20 실행에서는 MB04b/c의 실제 TEXT·수신·history·재시작 복구와 동시에 MB05–07의
독립 구현을 진행한다. 미디어, 메시지 동작·읽음·스크롤 복원, Apple/SOOP·push worker는
각자의 typed feature 코드를 소유한다. 각 OS의 기존 작성자가 보호 세션·원래 계정 DB·HTTP·
앱 조립·navigation·플랫폼 설정을 단독 소유하며 이 코드를 실제 제품 경로에 연결한다.
helper 작성·타입검사만으로 기능 완료라고 기록하지 않는다. 별도 테스트 배포를 작은 변경마다
만들지 않고 사용할 수 있는 대화 흐름과 검증 결과를 묶어 서명·배포한다.

현재 명령의 원래 M과 계정·credential 세대를 유지한다. 완전 manifest에서 M이 바뀌거나
방이 빠지면 이전 본문·인용·프로필·outbox payload가 새 참여 화면에 나타나지 않도록 정리한다.
A만 바뀌면 현재 projection/cache를 새로 확인하되 원래 M의 불명 전송을 새 SEND로 바꾸지
않는다. 개별 메시지의 403/404는 해당 projection의 표시 중단이며 방 권한 상실·삭제 완료로
추정하지 않는다. 서버 저장을 확인했더라도 현재 허용된 projection이 없는 메시지의 본문을
옛 outbox에서 대신 표시하지 않는다. 이 경계는 양 OS 실제 저장소와 화면 모델 회귀로 확인한다.

### MB02 실행 분할과 현재 우선순위

| 순서 | 구체적인 산출물 | 선행/통과 gate | 막힐 때 계속할 일 |
|---|---|---|---|
| MB02a — 재사용 단위·공통 UI | 원본 theme·navigation·settings·공통 상태의 구조와 유용한 구현을 수정 재사용. R01–R08도 원본 화면 맥락과 다시 비교하고 지나친 축소를 보정 | MB00 기준 SHA, 파일별 권리/의존 확인. 재작성 사유와 실제 추출 구분. 양 OS light/dark/긴 한글/큰 글자/스크린리더 확인 | 불명확 코드 단위만 보류; 독립된 화면/기능 재사용 계속 |
| MB02b — shell·설정 조립 | 원본 NavHost/MainTab/AppRouter, More/MyPage·프로필 흐름을 적용 가능한 범위에서 재사용. 대화/설정 루트(iOS 설정 표기는 더보기), 계정 gate, back/tab 복원. QA/prod 동일 제품 조립부 | MB02a. 합성 선택기/preview 진입을 배포 target에서 제거. SignedOut/LinkRequired/Ready/Blocked, 방 하나 자동 진입·설정 복귀, Activity 재생성/stack dismiss 시험 | 정책 URL/API 미확정 부분은 블로커 기록; 화면 상태·입력·복원은 격리된 자동 테스트로 검증 |
| MB02c — OS 알림·링크·lifecycle | 원본 알림 설정·권한·앱 복귀 흐름과 테스트를 재사용하고 기존 결함을 보정. 안전한 parser/pending intent, 실제 OS 상태와 서버 선호/등록 분리 | MB02b; OS 설정 복귀, cold/warm/중복/TTL/환경/계정 변경 시험. 합성 provider는 테스트 전용. 실제 등록/푸시 성공은 MB07까지 보류 | 서버 계약 없이 가능한 실제 OS 동작 완성; 제품 UI에 서버 미연동/provider 진단 행을 추가하지 않음 |
| MB02d — 서비스 adapter·영속 기반 | 원본 APIClient/오류·보호 저장의 적용 가능한 코드를 수정 재사용. C01/07/08에 맞춘 SessionManager와 계정별 저장소, Room/GRDB migration | 확정된 MB01 계약만 연결. 재작성 부분은 원본과 계약 불일치 근거 기록. 원본 refresh/WebView token/민감 logging 금지. 실제 SQLite·secure store 오류·취소·generation 시험 | 미확정 adapter는 port/fixture만, 다른 제품 코드 진행 |

`4e222de`까지의 [기존 기록](mobile-common-foundation-progress.md)은 이력으로 보존한다.
후속 [제품 구성 교체](mobile-product-progress.md)는 공통 제품 진입, 실제 NavHost/MainTab,
More/MyPage·프로필·알림 화면 재사용, 세션별 작업 폐기와 양 환경 fixture 제외 검사를 반영했다.
실제 이식과 신규 작성 사유는 [ledger R09–R22](mobile-reuse-audit.md)에 기록한다.
**MB02 전체 완료에는 native adapter·영속 기반·실기기 gate가 여전히 필요하다.**

다음 순서로 기존 MB02를 보정한다. 1–3의 코드 반영과 빌드/상태 검사는 위 진행 기록을
따르며, 3의 실기기 접근성 및 4의 실제 서비스 연결을 계속한다. 별도의 경쟁 단계 번호를 만들지 않는다.

1. **원본과 대상 대응 확정:** audit의 화면/기능별로 원본 View·상태 모델·라우팅·OS 연결·
   테스트를 함께 읽는다. 재사용/수정/제외/신규 사유와 대상 파일을 기록한다. 원본이 가진
   화면 완성도와 상태 처리를 일부 row 추출만으로 대체하지 않았는지 대조한다.
2. **제품 조립부와 배포 경계 교체:** Android QA/prod `AppEntry`, iOS `RogichatApp`의
   QA `WireframeHost` 분기를 공통 제품 조립부로 통합한다. 합성 시나리오는 격리된 자동
   테스트로 이동한다. `check_android.py`·`build_ios.py`의 **QA fixture 포함 필수**
   검사를 **양 배포 환경 fixture 제외** 검사로 바꾸고 실제 APK/실행 파일을 검사한다.
3. **설정·탐색·OS 기능 재사용 완성:** 원본의 적용 가능한 전체 화면 흐름을 MB02a–c에
   반영한다. 상태 소유권·복귀·실제 시스템 설정 이동과 접근성을 검증한다. 프로필 저장·탈퇴·
   서버 알림 선호 등 미연결 작업은 블로커로 남기며 가짜 작동 버튼을 배포하지 않는다.
4. **준비된 서비스 계약 연결:** MB01 ADR/fixture 정리를 병행하고 확정된 계약부터 MB02d와
   MB03에 연결한다. 필수 인증이 막혔다면 실제 이용 가능한 MVP 완료/로그인 성공으로
   보고하지 않는다. 채팅은 별도 설계로 MB04 이후 이어간다.

각 항목은 실제 코드 검증과 배포 경계 교체가 끝나야 완료다. 배포 여부는 문서나 빌드 성공만으로
판정하지 않고 해당 source SHA의 TestFlight/Firebase 처리 및 승인된 테스터 접근을 확인한다.
표의 gate는 **단계 최종 완료 기준**이다. MB02a의 코드·컴파일·상태/격리 검사를 통과한
단위는 실기기 접근성 검사가 남아도 MB02b/c 조립을 계속할 수 있다. 미확인 기기·스크린리더
항목은 ledger에 남기고 사용성/기능 QA 완료나 공개 출시 완료로 보고하지 않는다. 제한을
명시한 내부 QA 빌드 배포는 기기 검증을 위한 수단으로 허용한다. 다만 제품 구성·양 환경
fixture 배제 기준을 먼저 충족해야 한다. 미확정 서버 계약·출처 단위만 보류하고 독립 구현을
진행하되, 인증·인가·배포 품질 gate를 낮추지는 않는다.

기존 QA 초안의 화면/역할 변경 시 입력 초기화는 폐기되는 preview host의 정책이다.
제품에는 §6의 영속 초안 보존/권한 철회 규칙을 적용한다.

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

MB07의 push payload는 M11의 `{type:sync_required,version:1}` wake-only 신호로만 취급한다.
내용·방·이동 경로를 추론하거나 자동 이동하지 않고 현재 인증 범위에서 sync를 요청한다.
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
공개 문서에는 합성 사례와 비민감한 결과만 기록한다. 자기 변경만 검사·commit·task branch에
push하고 QA 대상 PR의 필수 검증을 통과시켜 병합한 뒤
원격 CI를 확인한다. 테스트 배포와 main 승격/스토어 출시를 구별한다.

## 10. 선행 결정과 위험 관리

| 결정 | 기본 제안 | 확정 시점/근거 |
|---|---|---|
| D01 native session lifetime/refresh | 기존 폐기 가능한 opaque session, 만료 재인증. refresh는 별도 보안/복구 계약 없이는 추가하지 않음 | MB01 서버 Auth와 ADR; 앱이 토큰 포맷/만료를 추정하지 않음 |
| D02 계정/방 bootstrap | 현재 session·profile·manifest를 합성한 명시적 DTO, 방별 capability와 참여 scope 추가 | MB01 current transaction/인가 경계 검토 |
| D03 타임라인 정렬 | 공개 가능한 표시 순서와 opaque sync 위치를 분리 | MB01 fixture/ADR로 선택 확정; MB04 차단 항목 |
| D04 영속 DB/라이브러리 | Room/GRDB와 기존 플랫폼 기본 도구 우선 | MB02 최신 stable·compiler 조합·migration·실제 DB 시험 |
| D06 공통 shell/알림 범위 | 대화·설정 2개 root(iOS 설정 표기는 더보기), 제한 계정 설정 접근 유지. 알림 설정은 포함, inbox/badge는 별도 정책/계약 전 보류 | 이 통합 계획에서 초기안 채택, 사용성 시험으로 세부 조정 |
| D07 native push transport/binding | 원본 runtime Firebase 설정은 미승계, APNs/FCM 선택과 SDK·식별자·binding revision을 C09로 확정 | MB07 착수 전 계약/서버 준비, 구현 후 OS 수신 시험으로 완료 |
| D05 실제 인증 외부 조건 | Apple capability/Services ID/환경별 callbacks, SOOP canonical subject/broker 검증 | MB03 시작 전 운영 담당 결과. provider 장애에 mock 성공으로 우회하지 않음 |

재사용 범위는 §2.1과 audit의 **비채팅 공통 기반**이다. 채팅 UX의 원본 계승은 제외한다.
정수 ID, sequence cursor, 화면별 socket, 새 ID 재전송, 다른 앱의 auth 의미/운영 설정은 이식하지 않는다. 소스 이식이
필요하면 파일·원본 commit·license를 별도로 기록하고 reference repo는 읽기 전용으로 유지한다.

## 10.1. 실제 제품 기능 통합의 검증 순서

[제품 통합 기록](mobile-product-integration-progress.md)에 현재 소스·CI·실배포 증거를
구분한다. 검증된 TEXT/영속 복구 checkpoint 뒤에 미디어·메시지 동작·Apple·native push·실시간을
기존 보호 세션과 Room/GRDB에 연결한 하나의 후보를 만든다. 추출 helper의 성공만으로
제품 연결이나 실제 provider 동작을 완료로 집계하지 않는다.

- 전송 직전에도 원래 계정·참여·권한 scope를 확인한다. 취소/로그아웃 이후 늦게 시작되는
  SEND·읽음·메시지 동작을 차단하고, 이미 불명 상태가 된 명령은 자동 재생하지 않는다.
- 푸시 REGISTER와 명시적 알림 ON은 실제 HTTP 실행 경계에서 OS 권한과 원래 세션을
  다시 확인한다. 연결 해제·알림 OFF는 권한이 없어도 가능해야 한다.
- 설정의 차단 관리에 계정별 `GET /v1/blocked-rooms` discovery를 연결한다. 방을 나간 뒤와
  새 로그인/기기에서도 복구하고, 비어 있지만 다음 cursor가 있는 페이지도 끝까지 읽는다.
  현재 서버가 허용한 nullable 이름만 표시한다.
- SDK pin·라이선스·개인정보 리소스를 실제 QA/Prod bundle과 서명 산출물에서 검사한다.
  실제 Firebase 환경 입력은 Git 밖에 두며 빌드의 로컬 검증과 업로드의 원격 대상 검증을 유지한다.
- 전체 후보의 플랫폼/영속 상태/배포 도구 검사 뒤 서명하고 TestFlight/App Distribution에
  배포한다. 기기/provider 인증과 실제 전달 증거가 없는 항목은 구체적 미검증 상태로 남긴다.

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


### Apple 서버 인증 배치 연결 (2026-09-20)

`task/apple-soop-link`의 [Apple 서버 구현](apple-auth-backend.md)과
[정확한 네이티브 DTO](apple-auth-client-contract.md)를 MB03/C02에 적용한다.
iOS native Apple 증명, Android Services ID 브라우저 callback과 원래 S256 완료
교환을 구현하며, 로그인 뒤 SOOP 필수 연결 gate는 유지한다. 직접 SOOP 로그인과
기존 SOOP 계정에서의 명시적 Apple 연결은 같은 user UUID를 유지하고 충돌을
자동 병합하지 않는다. 제공자 개발자 등록·실제 QA 계정 및 두 OS 왕복 증거는
별도 출시 gate이며 새 web Apple UI 배포는 이번 native 배치 범위가 아니다.


### 실제 심사 계정과 관리자 권한 소비 (2026-09-21)

ROOM_OWNER QA19 배포 소스와 분리한 후속 단계다. 서버가 부여한 실제 심사 계정은
`soopLinkStatus=REQUIRED`, `onboardingState=READY`, `capabilities.chat=true`를
반환할 수 있다. Android/iOS는 채팅 접근을 READY/chat으로 판단하고 SOOP 연결 표시는
VERIFIED일 때만 참으로 유지한다. 일반 미연결 계정의 SOOP_LINK_REQUIRED/chat=false
제한과 잘못된 조합의 거부는 유지한다. 권한 회수 후 재검증은 즉시 접근 범위를 철회한다.

후속 구현 계약은 실제 ID/비밀번호 로그인·변경, `/v1/me/capabilities`에 따른 관리자
진입, room capabilities와 self-only 임시 STREAMER 부여/조회/회수다. 비밀번호는
클라이언트에 영속 저장하지 않으며 기존 보호된 자격증명 설치·취소·로그아웃 경계를
재사용한다. 임시 역할은 서버가 sync room.role과 actor profile에 투영하며, 만료·회수의
authorizationRevision 변화로 기존 방 권한을 철회한다. 실제 소유자나 SOOP 신원은
바꾸지 않는다. 공개 가입·내장 계정·내장 비밀번호·가짜 성공은 제공하지 않는다.

위 후속 단계의 ID/PW 화면·실제 전송·보호 설치, 비밀번호 변경, 서버 capabilities 기반
관리자 진입과 기본방 임시권한 발급/조회/회수를 PR100에서 구현했다.
[구현·검증·배포 경계](mobile-password-admin-progress.md)를 따른다. QA19 산출물은
변경하지 않으며 후속 기능의 라이브 사용은 대응 백엔드 배포와 실제 계정 준비로 확인한다.
