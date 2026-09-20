# 모바일 공통 기반 재사용 조사

2026-09-20. 사용자의 방향 보정에 따른 추가 조사다. **채팅 UX/구현은 재사용 대상에서 제외**한다.
탐색·설정·알림·공통 UI·앱 기반의 실제 구현 단위를 찾았다. 계획의 단일 기준은
[통합 구현 계획](mobile-implementation-plan.md)이며, 이 문서는 출처와 판단 근거다.
기존 앱의 출시 여부만으로 아래 코드의 사용성·정합성·보안이 검증됐다고 주장하지 않는다.

## 조사 기준과 경계

| 대상 | 고정한 기준 | 확인 범위 |
|---|---|---|
| meloming-android | `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17` | main의 공통 UI, app navigation, More/settings, notifications, network/storage |
| meloming-ios | `18a33bbf96fe52b28d0de361916e20549bdcce6b` | main의 MainTab/AppRouter, 실제 MyPage 진입, notifications, common state, network/Keychain |
| 로기챗 | 모바일 구현 `9a028b9`; 조사 시 저장소 HEAD `c110863` | QA 와이어프레임과 기존 MB00–08/C01–08 설계 |

원본은 읽기 전용으로 조사했다. 진행 중인 로기챗 백엔드 변경을 확정 API로 취급하지 않았다.
아래 경로는 각각 원본 저장소 루트 기준이다. 이 문서 작성 시 소스를 복사하지 않았다.

## Android 후보

경로 약어: `DS = core/designsystem/src/main/java/com/meloming/android/core/designsystem`,
`APP = app/src/main/java/com/meloming/android`,
`MORE = feature/more/src/main/java/com/meloming/android/feature/more`.

| 단위/근거 파일 | 재사용 판단 | 가져올 범위와 바꿀 점 | 대상/확인 기준 |
|---|---|---|---|
| `DS/component/MelomingNavigationBar.kt`, `MelomingTopBar.kt` | 수정 재사용 우선 | navigation item·선택·label·click·insets 구조. 브랜드/탭 목록/도메인 제거, route 자체는 주입 | `core/design`, app shell; 선택 의미·TalkBack·큰 글자 |
| `APP/navigation/MelomingNavHost.kt` | 필요한 로직 추출 | 탭 `saveState/restoreState`, `launchSingleTop` 처리. 상품·결제·analytics·인증 graph 전체는 제외 | app navigation; back·중복 진입·로그아웃 stack 폐기 |
| `MORE/MoreScreen.kt`의 `SectionTitle`, `MenuItem` | 작은 함수 수정 재사용 우선 | 설정 section/row·보조 설명·클릭 영역. 전체 screen의 사업 기능/사용자 model은 제외 | `feature/settings` + 공통 row; 상태별 접근성과 destructive action 분리 |
| `MORE/NotificationSettingsScreen.kt` | UI와 OS 연결 단위 추출 | 권한 설명·OS 설정 이동 추출. **복귀 권한 재조회는 신규 보강**. 기존 알림 종류·서버 토글 API는 미채택 | `feature/settings`, notification permission adapter |
| `DS/component/MelomingButton.kt`, `LoadingIndicator.kt`, `EmptyView.kt`, `SectionHeader.kt` | 수정 재사용 우선 | disabled/loading/empty 표현 추출. **오류/retry 상태는 신규 보강**. 리소스·색상·문구 교체 | `core/design`; loading/empty/error 분리, 중복 클릭 방지 |
| `APP/push/NotificationRouter.kt`, 해당 `app/src/test/.../push/NotificationRouterTest.kt` | parser/시험 발상 추출 후 재설계 | 미소비 route 개념·payload 정규화. replay=1을 소비 확인 없이 재생하거나 미지 URL 외부 실행하는 fallback은 제외 | route parser/coordinator; consume·dedupe·인가·URL allowlist |
| `core/data/.../push/PushNotificationManager.kt` | OS/provider adapter 단위 수정 재사용 | 권한 조회·provider callback 처리 단위. 권한 허용/등록 성공 혼동, 오류 미전파, 계정 generation 없는 binding은 재설계 | MB02c mock port, MB07 실제 등록; 늦은 token callback/로그아웃 시험 |
| `feature/notifications/.../NotificationsScreen.kt`, `NotificationsUiState.kt` | 표시 컴포넌트 후보, 범위 보류 | 로딩/오류/항목 표시 재사용 후보. 기존 알림함 DTO·읽음·badge 계산은 복사하지 않음 | 알림함 채택/계약 확정 후에만 기능화 |
| `core/network/.../di/NetworkModule.kt`, `api/ApiClient.kt`, `auth/TokenStorage.kt` | 구현 단위별 수정, 그대로 채택 금지 | client 조립은 ApiClient 참고; **명시적 timeout 정책은 신규 보강**. 보호 저장 책임 분리 참고. 기존 refresh·Bearer 의미·민감 logging·저장 namespace 교체 | C01/C08 확정 후 adapter; 환경/계정 격리·오류 시험 |
| `DS/component/MelomingAsyncImage.kt` | 일반 이미지 표시 wrapper 후보 | URL→Coil 및 null URL placeholder 추출. **error/cancel은 신규 보강**. private 첨부는 권한·URL 만료·cache scope 확인 뒤 연결 | MB06; 범용 image cache에 private URL/body 미잔류 |
| `core/data/.../repository/VersionRepositoryImpl.kt`, `core/network/.../api/VersionApi.kt` | 버전 표시와 정책 분리 | 로컬 앱 버전 정보는 즉시 사용 가능. 서버 강제 업데이트/스토어 링크 정책은 후속 | 버전 API/배포 정책 없이는 강제 차단하지 않음 |

`...`는 해당 패키지의 `src/main/java/com/meloming/android/core/{data,network}` 또는
`feature/notifications/src/main/java/com/meloming/android/feature/notifications`를 생략한 것이다.
원본 library/catalog 버전을 복사하지 않는다. 현재 로기챗 AGP 내장 Kotlin과 Compose 조합을
유지하고 필요한 의존성만 최신 stable·호환성을 다시 확인해 고정한다.

## iOS 후보

경로 약어: 아래 경로의 루트는 `Meloming/`이다.

| 단위/근거 파일 | 재사용 판단 | 가져올 범위와 바꿀 점 | 대상/확인 기준 |
|---|---|---|---|
| `Presentation/Navigation/MainTabView.swift`, `AppRouter.swift` | 필요한 로직 추출 | 탭/NavigationStack/목적지 분리. 전역 singleton, 서비스별 탭·Int ID·공유 mutable path는 제외 | app shell + `@MainActor` router; tab restore·back·dismiss·session reset |
| `Presentation/More/MyPageView.swift`의 `MyPageSection`, `MyActionRow` | 작은 view 수정 재사용 우선 | **실제 MainTab의 활성 설정 진입은 MyPage**. section/row·icon·subtitle·action 추출. wallet/order/auth 결합 전체 view 제외 | `Features/Settings`, `Core/Design`; 접근성·Dynamic Type |
| `Presentation/More/MoreView.swift` | 보조 후보 | 단순 설정 표현 참고 가능하나 활성 화면이라고 가정하지 않음 | 사용 경로·중복 여부 확인 후 필요한 단위만 |
| `Presentation/Notifications/NotificationSettingsView.swift` | UI/OS 연결 단위 수정 재사용 | 설명·OS 설정 이동·재조회. 기존 preference 종류와 등록 여부 판단은 교체. load 시 PATCH 및 연속 toggle rollback race 방지 | permission adapter와 설정 model 분리 |
| `Presentation/Common/Components/{LoadingView,ErrorView,FlowLayout}.swift`, `Core/State/{Loadable,LoadableView}.swift` | 수정 재사용 우선 | 단일 resource 화면 상태·retry UI. `Error` 노출·Equatable 및 Sendable 의미 재검토. 이전 값은 현재 권한이 확인된 같은 scope에서만 유지 | `Core/Design/State`; 단일 resource용, 여러 축 상태를 한 enum에 합치지 않음 |
| `Core/Push/PushNotificationManager.swift` | lifecycle 경험/adapter 추출 | cold start payload 임시 보관·consumer 준비 뒤 1회 전달. 직접 navigation, 전역 singleton·계정 fence 없는 처리는 제외 | coordinator; foreground/tap 구분, 중복 소비·늦은 콜백 시험 |
| `Core/Notifications/NotificationBadgeManager.swift`, `Presentation/Notifications/NotificationsView*.swift` | 표시 후보, 서버 기능 보류 | badge view/목록 상태만 후보. 기존 unread 기준·이력 API는 채택하지 않음 | 알림함/읽음 계약 확정 후 선택 구현 |
| `Core/Network/{APIClient,APIEndpoint,APIError}.swift` | transport 경계 재작성 우선 | request 생성/취소/오류 분류 경험 후보. 기존 envelope·refresh·전역 auth coupling은 교체 | URLSession adapter, C01/C07/C08; cancellation/비JSON/401·403 구분 |
| `Core/Auth/KeychainService.swift` | wrapper 단위 재작성 우선 | 원본은 직접 SecItem이 아닌 **KeychainAccess actor wrapper**. 책임 분리만 참고하고 선택한 저장 API로 재작성. 고정 service·`try?` 오류 은폐·access/refresh 전제 제거 | bundle별 service, 설치 marker, 접근성 옵션과 실패 전파 시험 |
| `Core/Version/{VersionCheckService,ForceUpdateView}.swift` | 로컬 버전과 서버 정책 분리 | 버전/업데이트 안내 UI 후보. 기존 endpoint·store ID·실패 시 차단 정책 제외 | 설정 앱 정보 먼저, 원격 업데이트 정책은 별도 계약 |
| `Presentation/More/MoreView.swift`의 `SafariView`, `Presentation/Navigation/SafariView.swift`의 `RouterSafariURL` | 수정 재사용 후보 | SFSafariViewController wrapper와 typed sheet item 추출; 전역 URL Identifiable 확장은 제외 | HTTPS allowlist, 민감 URL 로그 없음, 실패/닫기 UI |
| `Presentation/Common/Components/InAppWebView.swift` | 제외 | 원본 auth-cookie 주입 WebView를 정책/인증 browser adapter로 재사용하지 않음 | 인증은 시스템 인증 세션, 정책/지원은 위 제한된 browser 경로 |

원본 Swift 5.9/iOS 16 구현을 그대로 Swift 6/iOS 18에 옮기지 않는다. 순수 View는 작은
단위로 유지하고 상태 소유권은 명시적 주입/Observation, session 작업은 actor 경계에 맞춘다.
기존 전역 manager를 새 이름의 전역 manager로 바꾸는 것만으로 이식을 완료하지 않는다.

## 추가 재사용 후보와 결함 보정

- Android `core/common/.../util/ExternalBrowserHandler.kt`는 외부 browser 실패 UI,
  `di/DispatchersModule.kt`, `result/Result.kt`는 dispatcher 주입/결과 분리 후보다.
  URI fallback·URL 로그·cancellation을 삼키는 관례는 그대로 채택하지 않는다.
- iOS `App/MelomingApp.swift`의 scenePhase와 `App/AppDelegate.swift` delegate 연결은
  lifecycle 신호 수집 경험만 추출한다. 고정 splash delay/auth polling과 모든 SDK 일괄 boot는 제외한다.
- Android 원본 navigation bar의 icon-only 선택 semantics, iOS MyActionRow의 subtitle 1줄
  제한은 수정 대상이다. `selected/Role.Tab`, 큰 글자·긴 한글·단일 VoiceOver action을 시험한다.
- 실제 APIClient/secure store는 기존 refresh endpoint·access/refresh pair·silent failure를
  옮기지 않고 새 계약으로 경계를 다시 구현한다. iOS refresh 대기 continuation 정리,
  Android BODY logging·URL token callback처럼 별도 위험이 있는 경로는 추출 목록에서 제외한다.
  위험 분석은 로기챗 채택 범위 판정이며 원본 서비스 보안 검증 전체를 뜻하지 않는다.

## 공통 제외와 실제 재사용 증거

- `Talk`, `TalkV2`, 입력바·버블·채팅 scroll/reply UX와 socket/outbox 구현은 재사용 범위에서 제외.
  로기챗의 채팅 정책·DTO·DB·복구 규칙으로 새로 설계한다.
- 기존 provider 로그인/refresh 정책, 결제/상점/방송/analytics/고객지원 SDK 및 운영 설정은 제외.
  공통 버튼에 사업 분기가 남거나 factory가 원본 singleton을 생성하면 분리가 끝난 것이 아니다.
- Firebase App Distribution 설정과 runtime FCM 채택은 별개다. 원본 Firebase/Apple 설정·ID·키를
  복사하지 않고, runtime provider SDK가 실제 필요할 때 로기챗 환경으로 구성한다.
- 양 원본에서 tracked root LICENSE/NOTICE/COPYING을 찾지 못했다. 자체 코드에 대한 사용자의
  재사용 지시는 작업 승인으로 취급한다. 파일별 출처/저작권·third-party 표시를 확인하고,
  권리가 불명확한 외부 코드 단위만 보류한다. 라이선스 파일 부재를 공개 라이선스로 간주하지 않는다.
  앱의 오픈소스 고지 화면만으로 자체 코드·포함 자산의 재배포 권리가 입증되지는 않는다.

각 실제 추출 PR은 다음 열을 갖는 ledger를 이 문서에 추가한다:

`ID | source SHA/path/symbol | 대상 path | 수정 재사용/그대로/신규 | 변경 이유 |
직접 의존성 | 출처·권리·고지 확인 | 검증 결과 | 미해결 blocker`

현재 표는 **후보 조사**다. 아직 이식 완료한 단위가 없으므로 코드 재사용률이나 이식 완료를
보고하지 않는다. 원본을 읽고 전부 새로 작성한 경우도 “신규”로 기록한다. 실제 이식은 순수
컴포넌트 → 화면 조립 → OS adapter → 서버 adapter 순으로 진행하고, 원본 test 중 의미 있는
규칙도 적응해 이식한다. 원본 git history·환경 파일·private 운영 자료는 가져오지 않는다.
