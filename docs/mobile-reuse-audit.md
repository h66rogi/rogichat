# 모바일 공통 기반 재사용 조사

2026-09-20. 사용자의 방향 보정에 따른 추가 조사다. **채팅 UX/구현은 재사용 대상에서 제외**한다.
탐색·설정·알림·공통 UI·앱 기반의 실제 구현 단위를 찾았다. 계획의 단일 기준은
[통합 구현 계획](mobile-implementation-plan.md)이며, 이 문서는 출처와 판단 근거다.
기존 앱의 출시 여부만으로 아래 코드의 사용성·정합성·보안이 검증됐다고 주장하지 않는다.

## 제1원칙 보정 — 기존 구현을 최대한 재사용

사용자의 최신 지시는 **적용 가능한 멜로밍 구현을 최대한 가져오는 것**이다. 아래 초기
후보 표의 작은 단위 추출은 상한이 아니다. 원본 화면·상태 모델·탐색·OS 연결·테스트를 함께
검토하고, 로기챗과 무관한 부분을 덜어내며 나머지 구조와 동작을 보존하는 것이 기본이다.
원본이 크거나 오래됐다는 이유, 새 wrapper 작성이 쉽다는 이유만으로 전체 재작성을 선택하지 않는다.
채팅 UX 제외, 참조 저장소 읽기 전용, 운영 설정/서명/브랜드 자산 미이식 경계는 유지한다.

R01–R08은 기존 작업의 실제 추출 증거이며 **충분한 재사용이나 제품 완성의 증거는 아니다.**
특히 R07 shell과 이후 notification/lifecycle 신규 구현은 원본의 적용 가능한 구현을
버린 부분이 없는지 다시 대조한다. 재사용 가능한 코드가 확인되면 수정 이식을 우선한다.
실행 순서와 제품/테스트 경계는 [통합 계획 §2.1·§8](mobile-implementation-plan.md)을 따른다.

후속 변경마다 다음을 기록한다. 이 기록은 아직 수행하지 않은 소스 이식을 완료로 집계하지 않는다.

| 판단 | 필요한 근거 |
|---|---|
| 그대로 또는 수정 재사용 | 원본 commit·파일·심볼, 대상 파일, 보존한 동작과 변경한 부분, 관련 테스트 |
| 원본 일부 제외 | 불필요한 사업 기능·운영 의존·확인된 결함 등 해당 부분의 구체적인 이유 |
| 신규 작성 | 대응 원본 부재 또는 계약/플랫폼 차이, 수정 재사용으로 해결하기 어려운 이유 |
| 서버 계약 대기 | 의존 계약 ID와 해제 증거, 그동안 완성할 수 있는 제품 화면/상태/OS 구현 |

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
| `APP/navigation/MelomingNavHost.kt` | 탐색 구조 수정 재사용 우선 | 탭 `saveState/restoreState`, `launchSingleTop`과 목적지 연결 구조. 상품·결제·analytics graph 제거, 로기챗 인증 계약 적용 | app navigation; back·중복 진입·로그아웃 stack 폐기 |
| `MORE/MoreScreen.kt`, `MoreUiState.kt`, `MoreNavigation.kt` | 설정 화면·상태·진입 흐름 수정 재사용 우선 | section/row만이 아니라 적용 가능한 전체 화면 구조·프로필/설정 탐색 재사용. 사업 기능과 사용자 model은 로기챗 계약으로 조정 | `feature/settings` + 공통 UI; 상태별 접근성과 destructive action 분리 |
| `MORE/NotificationSettingsScreen.kt` | 화면과 OS 연결 흐름 수정 재사용 우선 | 권한 설명·OS 설정 이동 재사용. **복귀 권한 재조회 보강**. 기존 알림 종류·서버 토글 API는 로기챗 계약으로 교체 | `feature/settings`, notification permission adapter |
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
| `Presentation/Navigation/MainTabView.swift`, `AppRouter.swift` | 탐색 구조 수정 재사용 우선 | 탭/NavigationStack/목적지 연결 재사용. 전역 결합과 공유 mutable path 보정, 서비스별 탭·Int ID 교체 | app shell + `@MainActor` router; tab restore·back·dismiss·session reset |
| `Presentation/More/MyPageView.swift`와 내부 `MyPageSection`, `MyActionRow` | 설정 화면·진입 흐름 수정 재사용 우선 | **실제 MainTab의 활성 설정 진입은 MyPage**. 적용 가능한 전체 화면 구조·프로필/설정 탐색과 section/row 재사용. wallet/order 제거, auth 결합은 로기챗 계약으로 조정 | `Features/Settings`, `Core/Design`; 접근성·Dynamic Type |
| `Presentation/More/MoreView.swift` | 보조 후보 | 단순 설정 표현 참고 가능하나 활성 화면이라고 가정하지 않음 | 사용 경로·중복 여부 확인 후 필요한 단위만 |
| `Presentation/Notifications/NotificationSettingsView.swift` | UI/OS 연결 단위 수정 재사용 | 설명·OS 설정 이동·재조회. 기존 preference 종류와 등록 여부 판단은 교체. load 시 PATCH 및 연속 toggle rollback race 방지 | permission adapter와 설정 model 분리 |
| `Presentation/Common/Components/{LoadingView,ErrorView,FlowLayout}.swift`, `Core/State/{Loadable,LoadableView}.swift` | 수정 재사용 우선 | 단일 resource 화면 상태·retry UI. `Error` 노출·Equatable 및 Sendable 의미 재검토. 이전 값은 현재 권한이 확인된 같은 scope에서만 유지 | `Core/Design/State`; 단일 resource용, 여러 축 상태를 한 enum에 합치지 않음 |
| `Core/Push/PushNotificationManager.swift` | lifecycle 경험/adapter 추출 | cold start payload 임시 보관·consumer 준비 뒤 1회 전달. 직접 navigation, 전역 singleton·계정 fence 없는 처리는 제외 | coordinator; foreground/tap 구분, 중복 소비·늦은 콜백 시험 |
| `Core/Notifications/NotificationBadgeManager.swift`, `Presentation/Notifications/NotificationsView*.swift` | 표시 후보, 서버 기능 보류 | badge view/목록 상태만 후보. 기존 unread 기준·이력 API는 채택하지 않음 | 알림함/읽음 계약 확정 후 선택 구현 |
| `Core/Network/{APIClient,APIEndpoint,APIError}.swift` | transport 구현 수정 재사용 우선 | 적용 가능한 request 생성/취소/오류 분류 코드 보존. 기존 envelope·refresh·전역 auth 결합은 계약에 맞게 교체 | URLSession adapter, C01/C07/C08; cancellation/비JSON/401·403 구분 |
| `Core/Auth/KeychainService.swift` | wrapper 수정 재사용 우선 | 원본은 직접 SecItem이 아닌 **KeychainAccess actor wrapper**. 보호 저장 구현을 우선 검토하고 고정 service·`try?` 오류 은폐·access/refresh 전제를 보정. 저장 API를 교체하면 이유 기록 | bundle별 service, 설치 marker, 접근성 옵션과 실패 전파 시험 |
| `Core/Version/{VersionCheckService,ForceUpdateView}.swift` | 로컬 버전과 서버 정책 분리 | 버전/업데이트 안내 UI 후보. 기존 endpoint·store ID·실패 시 차단 정책 제외 | 설정 앱 정보 먼저, 원격 업데이트 정책은 별도 계약 |
| `Presentation/More/MoreView.swift`의 `SafariView`, `Presentation/Navigation/SafariView.swift`의 `RouterSafariURL` | 수정 재사용 후보 | SFSafariViewController wrapper와 typed sheet item 추출; 전역 URL Identifiable 확장은 제외 | HTTPS allowlist, 민감 URL 로그 없음, 실패/닫기 UI |
| `Presentation/Common/Components/InAppWebView.swift` | 제외 | 원본 auth-cookie 주입 WebView를 정책/인증 browser adapter로 재사용하지 않음 | 인증은 시스템 인증 세션, 정책/지원은 위 제한된 browser 경로 |

원본 Swift 5.9/iOS 16 구현은 Swift 6/iOS 18에 맞춰 수정 재사용한다. 화면 구조를 보존하면서
상태 소유권은 명시적 주입/Observation, session 작업은 actor 경계에 맞춘다.
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
  옮기지 않고 새 계약에 맞게 기존 구현을 수정한다. iOS refresh 대기 continuation 정리,
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

위 표는 **최초 후보 조사**이며 실제 반영 상태는 아래 추출 기록을 따른다.
원본을 읽고 전부 새로 작성한 경우는 “신규”로 기록한다. 실제 이식은
화면/기능의 적용 가능한 흐름을 기준으로 공통 UI·화면 상태·탐색·OS adapter를 함께 검토하고,
서버 adapter는 계약 확정 후 연결한다. 원본 test 중 의미 있는 규칙도 적응해 이식한다.
원본 git history·환경 파일·private 운영 자료는 가져오지 않는다.

## 실제 추출 기록 — 공통 기반 1차

2026-09-20. 아래 단위는 고정 SHA의 파일을 직접 읽어 작은 구현 단위로 수정 추출했다.
원본 조사 경로는 clean 상태였고 파일을 수정하지 않았다. 각 단위에서 별도 third-party 소스
헤더/자산을 발견하지 않았으며 사용자의 자체 코드 재사용 지시 범위로 반영했다. 원본 전체
저장소에 대한 라이선스 추정은 하지 않는다. 추가 SDK/아이콘 묶음/운영 설정은 가져오지 않았다.

| ID | source SHA / 파일·심볼 | 대상 (앱 루트 기준) | 방식·변경 | 직접 의존 / 검증·잔여 |
|---|---|---|---|---|
| R01 | Android `ecb3dbe` / `DS/component/MelomingNavigationBar.kt`의 bar/item | Android `.../core/design/AppNavigation.kt` | 수정 추출: Surface/Row/weight/inset 구조, icon-only를 텍스트 label·선택 Role.Tab으로 교체, 고정 높이를 최솟값으로 | 기존 Compose; 빌드/lint, 실제 TalkBack·큰 글자 확인 남음 |
| R02 | Android `ecb3dbe` / `DS/component/MelomingTopBar.kt`의 기본 top bar | 같은 `AppNavigation.kt` | 수정 추출: Surface/Row/title/navigation slot, 가변 높이·뒤로 버튼, 미사용 중앙 정렬 variant 제외 | 기존 Compose; 긴 제목 실기기 확인 남음 |
| R03 | Android `ecb3dbe` / `MORE/MoreScreen.kt`의 SectionTitle/MenuItem | `.../core/design/SettingsComponents.kt` | 수정 추출: section·row spacing/action, subtitle을 다중 행으로 분리, 사업 icon/모델 제거, disabled·Role.Button 보강 | 기존 Compose; gate/state 검사, 실제 접근성 확인 남음 |
| R04 | Android `ecb3dbe` / `DS/component/{LoadingIndicator,EmptyView}.kt` | `.../core/design/ScreenStatus.kt` | 수정 추출: Column/indicator/title/description, Phosphor icon 제외. retry callback은 신규 보강 | 기존 Compose; 목록 loading/empty/error 시나리오 연결 |
| R05 | iOS `18a33bb` / `Presentation/More/MyPageView.swift`의 MyPageSection/MyActionRow | `Sources/Core/Design/SettingsComponents.swift` | 수정 추출: section background·row label/icon/subtitle/chevron/contentShape, 1줄 제한 제거, Button/disabled·접근성 병합 | SwiftUI·SF Symbols; 네 구성 컴파일, VoiceOver/Dynamic Type 확인 남음 |
| R06 | iOS `18a33bb` / `Presentation/Common/Components/LoadingView.swift`, `ErrorView.swift`의 EmptyStateView | `Sources/Core/Design/ScreenStatus.swift` | 수정 추출: VStack/ProgressView·message/action 배치, legacy logo/이미지·raw Error 제거 | SwiftUI; QA 상태 화면 연결 |
| R07 | 양 OS 원본 tab/stack 분리 방식 참고 | Android `.../core/design/AppShell.kt`, iOS `Sources/Core/Design/AppShell.swift`, 양쪽 `Core/Navigation` | **신규 작성**: 기존 거대 NavHost/router를 복사하지 않음. 원본과 같은 책임 구분을 로기챗 gate/2탭에 적용 | 기존 Compose/SwiftUI; 탭별 path·제한 계정·상태 reset 검사 |
| R08 | Android `ecb3dbe` / `DS/component/MelomingButton.kt`의 primary button | `.../core/design/AppButton.kt` | 수정 추출: shape/padding/zero elevation/content slot, 높이 48dp를 최소 높이로 변경 | 기존 Material3; 시작/QA 진입 화면 연결 |

위 SHA의 전체 값과 약어 경로는 앞의 조사 표를 따른다. 실제 Kotlin 대상 `...`는
`app/src/main/java/chat/rogi/rogichat`이다. 알림 OS 조회, 3축 설정 상태, route parser와
pending queue는 **신규 작성**이며 멜로밍의 provider/auth 의미를 이식하지 않았다.
Swift/Compose 기본 API 호출이라는 이유만으로 원본 코드 재사용 건수를 늘리지 않는다.

## 실제 추출 기록 — 제품 구성 교체

2026-09-20. R01–R08만 추출했던 범위를 다시 대조해 적용 가능한 화면·탐색·상태 구현으로
확장했다. 아래 원본 SHA는 Android `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`,
iOS `18a33bbf96fe52b28d0de361916e20549bdcce6b`로 고정한다. 원본은 읽기 전용이다.
`DS`, `APP`, `MORE` 약어는 앞 표와 같고 Android 대상은
`apps/android/app/src/main/java/chat/rogi/rogichat/`, iOS 대상은 `apps/ios/Sources/` 기준이다.

| ID | source 파일·심볼 | 대상 | 방식·보존한 동작과 변경 이유 | 직접 의존 / 검증·잔여 |
|---|---|---|---|---|
| R09 | Android `DS/theme/{Theme,Color,Typography}.kt`의 MelomingTheme·Shapes·전체 typography scale | `core/design/{RogichatTheme,AppTypography}.kt` | **수정 재사용**: 양 색상 scheme·shape·theme 조립, 전체 글자 크기/굵기/행간/tracking 유지. 브랜드는 로기챗 색, 본문 대비 보강. 원본 폰트 파일은 가져오지 않고 system font 사용 | 기존 Material3; 4개 variant 빌드·lint. 실제 글자 확대/기기 대비 확인 남음 |
| R10 | Android `DS/component/{MelomingNavigationBar,MelomingTopBar}.kt`, `APP/navigation/MelomingNavHost.kt` | `core/design/AppNavigation.kt`, `AppEntry.kt/ProductNavigation` | **수정 재사용**, R01/02/07 보정: animated tint·선택 icon·Surface/Row·top bar, 실제 Scaffold/NavHost와 `popUpTo(saveState)`·`launchSingleTop`·`restoreState` 유지. 대화/설정으로 줄이고 visible label·Tab semantics·가변 높이 보강 | Navigation Compose 2.10.2, Lifecycle 2.11.0, Phosphor 1.0.0. session별 VMStore 소유는 신규; 회전 보존·A→B→A 폐기 검사 |
| R11 | Android `MORE/MoreScreen.kt`의 ProfileSection·SectionTitle·MenuItem·Divider·계정 확인 dialog | `feature/settings/{SettingsScreen,AccountScreen}.kt`, `core/design/SettingsComponents.kt` | **수정 재사용**: 프로필 먼저 배치한 설정 허브·그룹 메뉴·파괴적 작업 확인 흐름. 상점/캐시/채널/Pro/개발 메뉴는 제외. 실제 계정·SOOP 상태·작업별 capability로 연결 | 기존 Compose, 주입 SessionActions. 실제 logout/delete transport는 C01/C08 대기 |
| R12 | Android `MORE/ProfileSettingsScreen.kt`의 ProfileSettingsScreen·FieldRow·ProfileSettingsViewModel/UiState | `feature/settings/{ProfileScreen,ProfileViewModel}.kt` | **수정 재사용 + 도메인 보강**: top bar save·BasicTextField·IME·조회/편집/저장/서버 오류 흐름. 원본 이메일/본인인증 대신 실제 프로필 DTO, 실패 시 draft 보존·미저장 취소·응답 계정 확인. 생일/PATCH 모델은 신규 | Lifecycle/ViewModel; 중복·취소·늦은 저장·불량 응답 검사. API 왕복은 native auth 대기 |
| R13 | Android `MORE/NotificationSettingsScreen.kt`의 OS 설정 action·row/divider·오류 표시 | `feature/settings/NotificationSettingsScreen.kt` | **부분 수정 재사용**: OS 부분과 화면 구성. 기존 서버 토글의 기본값/rollback race는 제외, 실제 OS 조회·설정 이동·foreground 재조회 연결 | 기존 NotificationSystem; 실제 FCM/binding/서버 선호는 C09 대기 |
| R14 | Android `core/data/.../preferences/DeveloperPreferences.kt`의 load·MutableStateFlow/asStateFlow·apply/publish, `MORE/OpenSourceLicensesScreen.kt`의 LicenseItem/list | `core/design/AppearancePreferences.kt`, `feature/settings/LicensesScreen.kt` | **수정 재사용**: 환경/개발 설정을 제거하고 실제 화면 모드 저장에 preference 구현 적용. 라이선스 목록 구성을 실제 의존성·전체 고지로 교체. appearance 선택 UI는 원본에 없어 신규 | SharedPreferences/StateFlow, assets/licenses. 원본 환경 값·운영 ID 미이식 |
| R15 | Android `feature/auth/.../LoginScreen.kt`의 LoginContent | `feature/auth/WelcomeScreen.kt` | **부분 표현 재사용**: scroll·브랜드/제목/설명·provider 배치. 이메일/MFA/기존 인증 URL은 계약 불일치로 제외. 로기챗 SOOP 연결 안내는 신규 | Compose; 실제 인증 flow/AuthRepository 이식으로 집계하지 않음 |
| R16 | iOS `Meloming/Presentation/Navigation/MainTabView.swift` | `Core/Design/AppShell.swift` | **부분 수정 재사용**, R07 보정: modern Tab/legacy tabItem 분기·selected binding·native 탭·tint. 탭별 NavigationStack과 로기챗 목적지 적용 | SwiftUI; `ShellNavigation`은 로기챗 신규 상태 모델이며 원본 AppRouter 추출이 아님 |
| R17 | iOS `Meloming/Presentation/More/MyPageView.swift`의 profileHub·MyProfileHero·MyPageSection·MyActionRow | `Features/Settings/SettingsScreen.swift`, `Core/Design/SettingsComponents.swift` | **수정 재사용**: 프로필 허브·LazyVStack 간격28/padding20·이름/상태 위계·그룹/색상 icon tile·inset divider/background. wallet/order/channel은 제외. guarded profile/account route 연결 | SwiftUI/SF Symbols; 큰 글자 줄바꿈 유지, VoiceOver 실기기 검증 남음 |
| R18 | iOS `Meloming/Presentation/More/MoreView.swift`의 ProfileSettingsView | `Features/Settings/ProfileScreen.swift` | **부분 화면 흐름 수정 재사용**: Form/Section·binding·비동기 saving/progress/error·저장 중 비활성·성공 dismiss. 닉네임 규칙·생일/공개 범위·명시적 취소는 로기챗 DTO에 맞게 보강 | SwiftUI; 실제 session이 주입한 account만 편집. 프로필 API 연결 대기 |
| R19 | iOS `Meloming/Presentation/Notifications/NotificationSettingsView.swift` | `Features/Settings/NotificationSettingsScreen.swift` | **부분 수정 재사용**: native List/Section·외부 설정 action·설명 footer. 기존 서버 토글/default true/rollback은 제외하고 실제 OS adapter와 foreground 재조회 연결 | UserNotifications/UIKit; 실제 push 등록/전달 완료를 표시하지 않음 |
| R20 | iOS `Meloming/Presentation/Auth/LoginView.swift` | `Features/Auth/WelcomeScreen.swift` | **부분 표현 재사용**: centered brand/title/subtitle·scroll·social button group·busy/error 배치. 로고/기존 provider와 signup URL 제외. benefit card·SOOP 안내는 신규 | SwiftUI; AuthManager/실제 로그인 기능 이식으로 집계하지 않음 |
| R21 | iOS `Meloming/Core/State/{Loadable,LoadableView}.swift` | `Core/State/{Loadable,LoadableView}.swift` | **구현 수정 재사용**: loading/value/failure 분기·표시 구현 유지. 비반사적인 Error Equatable 구현은 제거 | SwiftUI; 전체 구성 컴파일 및 각 분기 호출부 확인 |
| R22 | 대응 원본과 계약 대조: Android auth repository, iOS AuthManager/APIClient, 양 OS Talk/TalkV2 | 양 OS `Core/Session`, product root, `Features/Rooms`, profile DTO; iOS AppTheme/Appearance·About | **신규**: 원본 bearer/refresh/MFA는 웹 cookie뿐인 로기챗 native 계약과 불일치. session scope/capability·응답 fence를 명시적 주입으로 구현. 채팅 UX는 사용자 제외 범위. 생일·PATCH·화면 모드 선택은 원본에 같은 기능 없음 | 원본 network/secure store를 복사했다고 주장하지 않음. 실제 native adapter·DB·chat은 MB01/02d/03 이후 |

### 출처·고지와 제외 근거

- 자체 코드 재사용은 사용자 명시 지시 범위다. 원본 root LICENSE 부재를 공개 라이선스로
  간주하지 않으며, 이번 직접 추출 소스에서 추가 third-party 소스 헤더/자산은 발견하지 않았다.
- Android Phosphor는 실제 사용 library로 유지하고 Adamglin(2024)·Phosphor Icons(2023)
  MIT 고지, Kotlin·Apache 라이선스 전문을 앱 `assets/licenses`와 고지 화면에 포함했다.
  iOS 외부 dependency는 추가하지 않았다. 원본 폰트/이미지/아이콘 자산 묶음은 복사하지 않았다.
- 원본 history·환경 파일·서명/운영 자료·analytics·기존 app/provider ID·WebView cookie
  주입을 이식하지 않았다. 채팅 버블/입력/답장/scroll·Talk/TalkV2는 이식하지 않았다.
- Navigation/Lifecycle은 [AndroidX Navigation](https://developer.android.com/jetpack/androidx/releases/navigation),
  [Lifecycle](https://developer.android.com/jetpack/androidx/releases/lifecycle)에서 stable을 확인하고
  strict dependency lock을 갱신했다. Phosphor 출처는
  [compose-phosphor-icon](https://github.com/adamglin0/compose-phosphor-icon)이다.

### 검증과 미완료 경계

아래 문단은 제품 구성 교체 단계(빌드 8)의 경계다. 이후 native adapter 반영은 다음 기록을 따른다.
소스·빌드 산출물 fixture 제외, OS별 빌드/상태 시험과 독립 리뷰 결과는
[제품 구성 교체 기록](mobile-product-progress.md)에 모은다. Android 실제 NavHost와 iOS
native tab 구성은 컴파일되지만 실기기 화면/스크린리더 결과를 대신하지 않는다.
네이티브 인증·원격 프로필 저장·logout/delete·방 입장·채팅·푸시는 구현 완료로 집계하지 않는다.
제품 앱은 실제 native adapter가 없으면 로그인 버튼이나 합성 계정을 제공하지 않는다.

iOS `Resources/PrivacyInfo.xcprivacy`는 원본에 대응 파일이 없어 **신규**로 작성한 플랫폼
메타데이터다. 실제 `@AppStorage`의 앱 전용 화면 모드 설정에 해당하는 UserDefaults
`CA92.1`만 선언했다. 필요하지 않은 원본 SDK/추적 선언은 가져오지 않는다.
선언 파일·정확한 앱 식별·서명 승격 경계는 [배포 준비 점검](mobile-release-readiness.md)을 따른다.

## 실제 추출 기록 — 네이티브 세션·프로필 연결

2026-09-20. 원본 고정 SHA와 읽기 전용 원칙은 R09–R22와 같다. 서버 계약은
`ac69ca2`의 native transport와 현재 프로필 DTO를 사용한다. 제공자 인증·채팅 UX는
이 단계의 재사용 범위가 아니다.

| ID | source 파일·심볼 | 대상 | 방식·보존한 동작과 변경 이유 | 직접 의존 / 검증·잔여 |
|---|---|---|---|---|
| R23 | iOS `Meloming/Core/Network/APIClient.swift`의 actor-owned URLSession·request/response 경계 | `Sources/Core/Network/NativeAPIClient.swift` | **수정 재사용**: actor 소유, 30/60초 timeout, cache 제외, 비동기 요청과 HTTP/Decodable 경계. refresh/replay·singleton·환경 관리자·로깅·404→nil 해석은 제외. native 고정 origin/route/status·리다이렉트 거부·client binding·중첩 오류 코드는 보강 | Foundation/URLSession, 외부 SDK 없음. 1 MiB 응답 읽기 제한·취소·DTO 시험. 실제 발급 credential 왕복은 미검증 |
| R24 | iOS `Meloming/Core/Auth/KeychainService.swift`의 read/write/clear 책임 대조 | `Sources/Core/Session/NativeCredentialStore.swift` | **신규**: 원본 third-party wrapper·오류 무시·분리된 access/refresh 슬롯은 미이식. Security.framework의 환경별 ThisDeviceOnly 단일 레코드, 동기 잠금과 compare-and-replace, 백업 제외 설치/삭제 intent를 구현. 실패한 삭제는 재실행에서 먼저 마침 | Security/Foundation. 실제 파일 fsync·재설치·오류 시험은 주입한 raw Keychain driver로 수행. 서명된 iOS 실기기 Keychain 검증 남음 |
| R25 | R18·R21의 ProfileSettingsView·LoadableView | `Features/Settings/{ProfileScreen,ProfileDraft}.swift`, `Core/Session/AppSession.swift` | **기존 추출 구현 재사용**: 편집 전 전체 프로필 조회, 비동기 저장/오류/취소/미저장 draft 흐름 유지. session summary에 없는 생일·provider를 만들지 않음. foreground 동기화가 같은 계정의 탭·draft·저장을 폐기하지 않도록 분리 | SwiftUI, 주입 service. 늦은 세션 응답 대 프로필 저장·scope 변경·만료 경쟁 시험 |
| R26 | 양 OS 원본의 auth DTO/refresh 계약 대조 | 양 OS native session/profile DTO·coordinator/service | **신규**: 로기챗 opaque credential·서버 generation·고정 만료와 원본 계약이 다름. local epoch/서버 generation 분리, current-token 401 clear, 403 연결 제한, 오류/재시도, 로컬 종료와 원격 폐기 확인을 구분 | 합성 credential·서버 대역은 tests만. 제공자 발급·탈퇴·채팅 capability 미활성 |
| R27 | Android `core/network/src/main/java/com/meloming/android/core/network/api/ApiClient.kt`의 client·get·patch·postWithoutResponse·handleResponse·ApiException | `core/network/ApiClient.kt` | **수정 재사용**: 실제 Ktor/OkHttp 요청과 HTTP verb wrapper·오류 경계. 원본 Auth plugin/refresh·절대 URL override·로깅·이메일/비밀번호 오류 가정 제거. 고정 origin/route·native header·engine까지 redirect/replay 차단·응답 한도·중첩 error.code 보강 | Ktor 3.6.0, serialization 1.11.0, strict lock. 취소·상태 코드·정확한 요청·한도 시험 |
| R28 | Android `core/network/src/main/java/com/meloming/android/core/network/auth/TokenStorage.kt`의 protected get/save/clear 책임 대조 | `core/session/{CredentialStore,AndroidCredentialStore}.kt` | **신규**: deprecated EncryptedSharedPreferences/MasterKey와 원본 access/refresh/MFA/FCM 슬롯·비동기 apply는 미이식. AndroidKeyStore AES-GCM, 환경 AAD·고정 만료, noBackup AtomicFile·지속 삭제 marker 적용 | Android 플랫폼 crypto/storage. JVM 암호 envelope·실패 복구 시험과 별도 계측 테스트. 테스트 키/파일은 독립 namespace로 제한 |

Android 신규 runtime의 OkHttp·Okio·Kotlinx IO·serialization·Ktor·SLF4J 고지와 정확한 tag
출처를 `assets/licenses/network.txt` 및 실제 앱 고지 목록에 포함했다. 안정 버전 artifact와
strict lock을 사용하며 pre-release는 선택하지 않았다. 플랫폼 저장소로 바꾼 근거는
[AndroidX Security Crypto deprecation](https://developer.android.com/jetpack/androidx/releases/security),
Ktor 버전 근거는 [Ktor 3.6.0](https://ktor.io/docs/whats-new-360.html)이다.

앱 기능 목적의 User ID/Other Data Types 개인정보 선언은 프로필 데이터 흐름에 맞춘
로기챗 **신규 메타데이터**다. 원본 SDK·서비스 주소·운영 ID·서명 자료는 이식하지 않았다.
세부 검증과 남은 경계는 [native 연결 기록](mobile-native-transport-progress.md)을 따른다.

## 실제 추출 기록 — 네이티브 SOOP 인증

원본은 Android `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`, iOS
`18a33bbf96fe52b28d0de361916e20549bdcce6b`를 읽기 전용으로 대조했다.
아래 Android 대상 경로는 `apps/android/app/src/main/java/chat/rogi/rogichat/`,
iOS는 `apps/ios/Sources/` 기준이다. 기능 성공·배포 gate는 [인증 진행 기록](mobile-native-auth-progress.md)에 분리한다.

| ID | source 파일·심볼 | 대상 | 실제 수정 재사용과 신규 구현의 경계 | 의존·검증·잔여 |
|---|---|---|---|---|
| R29 | Android `core/common/src/main/java/com/meloming/android/core/common/util/ExternalBrowserHandler.kt`의 openUrl/openInCustomTabs | `core/auth/ExternalBrowserHandler.kt` | **수정 재사용**: CustomTabsIntent builder·제목·launchUrl·실패 경계. provider package를 명시적으로 선택하고 공유·URL 로그·임의 fallback은 제외 | AndroidX Browser 1.10.0 stable·strict lock. 실제 provider 왕복은 별도 gate |
| R30 | Android `app/src/main/java/com/meloming/android/MainActivity.kt`의 onCreate/onNewIntent/handleOAuthCallback, `feature/auth/.../LoginScreen.kt`·LoginViewModel의 URL event와 loading/error/확인 dialog | `MainActivity.kt`, `AppEntry.kt`, `core/session/SessionViewModel.kt`, `feature/auth/SoopAuthPresentation.kt` | **부분 수정 재사용**: cold/warm intent 진입과 즉시 intent.data 정리, browser event 수집·동의 dialog·비동기 오류 흐름. token/refresh URL 추출·성공 toast·MFA·FCM·analytics와 원본 provider handler는 제외 | Compose/Lifecycle. 동의문구는 현재 웹 이용 안내, 전체 checkbox label semantics·큰 글자 버튼 배치 보강 |
| R31 | iOS `Meloming/Core/Auth/AuthManager.swift`의 loginWithGoogle(:79), GoogleAuthPresentationContext(:471) | `Core/Auth/SOOPBrowserSession.swift` | **수정 재사용**: checked continuation·ASWebAuthenticationSession callback/error·presentation context·connected window 조회. HTTPS callback, session/continuation 소유·start 실패·취소 once·operation ID를 보강. 원본 URL token은 미이식 | AuthenticationServices/UIKit. host test에서 platform bridge를 분리하고 기기 SDK로 컴파일 |
| R32 | 같은 iOS AuthManager의 OAuthCallbackValidator(:380) | `Core/Auth/SOOPAuthContract.swift`의 SOOPCallback | **수정 재사용**: URLComponents scheme/host/path/credentials/port/fragment/query guard 구조. 환경별 HTTPS·정확한 경로·유일한 허용 query·독립 state 검증으로 변경 | Foundation. 잘못된 callback이 현재/새 인증을 완료하거나 취소하지 않도록 회귀 시험 |
| R33 | Android TokenStorage의 save/get/clearMfaChallenge·StoredMfaChallengeRecordCodec.restore, iOS `Meloming/Core/Auth/MfaChallengeStore.swift`의 restore/consume 책임 대조 | 양 OS `Core/Auth` pending/coordinator와 기존 credential store 확장 | **신규**: 원본 별도 비동기 저장·오류 무시·자동 corrupt 삭제·MFA 필드는 원자적인 계정 연결에 맞지 않음. 기존 로기챗 보호 저장소를 확장해 proof/계정/취소/설치 소유권을 묶고 일회성 교환·응답 유실·늦은 발급 폐기를 구현 | R24/R28 기반. 합성 credential·서버 대역은 테스트에만 존재. 실제 provider/기기 검증 남음 |

R23/R27의 실제 HTTP adapter와 R15/R20의 로그인 화면은 별도 대체 stack 없이 확장한다.
PKCE/state CSPRNG·동일 Bearer LINK·일회성 교환·새 발급 credential과 publication 경계는
동일한 원본 서버 계약이 없어 **신규 구현**이다. 책임을 참고한 것만으로 이식 건수를 늘리지 않는다.
Talk/TalkV2, 원본 provider 주소·앱 식별자·서명·운영 설정은 이식하지 않는다.
Browser의 stable은 [AndroidX 공식 릴리스](https://developer.android.com/jetpack/androidx/releases/browser)와
Google Maven에서 확인했고 기존 Apache 전문 고지에 실제 사용 라이브러리를 추가했다.

## 실제 추출 기록 — M11 계정 알림 설정

원본 SHA·읽기 전용 경로는 R29–R33과 같다. MB03과 별도 단계로 기존 설정 화면과
native HTTP/session adapter를 확장한다. [동작·검증 경계](mobile-notification-preferences-progress.md)는
실제 계정 선호와 OS 권한, native push 등록·발송, 채팅 읽음 처리를 구분한다.

| ID | source 파일·심볼 | 대상 | 실제 수정 재사용와 신규 구현의 경계 |
|---|---|---|---|
| R34 | Android `feature/more/.../NotificationSettingsScreen.kt`의 Screen·SettingActionRow·Divider·NotificationSettingsViewModel | `feature/settings/NotificationSettingsScreen.kt`, `NotificationSettingsViewModel.kt` | **수정 재사용**: 기존 scroll/top bar/section·OS 설정 action, StateFlow·초기 load·viewModelScope·repository 결과 흐름. default-true·양방향 switch·낙관적 rollback은 제외하고 실제 확인값·계정 전체 끄기 확인·revision/CAS를 추가 |
| R35 | Android `core/network/.../api/NotificationApi.kt`의 get/updatePreferences, `core/domain/.../repository/NotificationRepository.kt`와 `core/data/.../repository/NotificationRepositoryImpl.kt`의 대응 메서드 | `core/network/M11Dtos.kt`, NotificationPreferencesRepository·기존 NativeSessionCoordinator | **수정 재사용**: typed API→Result repository 책임. 현재 고정 origin의 GET/PUT false+expectedGeneration으로 변경. 원본 PATCH/FCM/알림함 cache·광범위 runCatching/logging 제외 |
| R36 | iOS `Meloming/Presentation/Notifications/NotificationSettingsView.swift`:3–43, 같은 파일 ViewModel:48–87 | `Features/Settings/NotificationSettingsScreen.swift`, `AccountNotificationSection.swift`, `AccountNotificationModel.swift` | **수정 재사용**: List/Section header/footer·OS action, MainActor loading/request/error 흐름. GET/rollback이 PUT를 일으킬 수 있는 Toggle.onChange 대신 명시적 사용자 command·확인 응답·single-write·GET 재조정 구현. 원본 알림함 repository를 선호 repository로 가져왔다고 주장하지 않음 |
| R37 | iOS `Meloming/Core/Network/APIEndpoint.swift`:273–280, 529–530, 1105–1124 | `Core/Notifications/M11Endpoint.swift`, 기존 NativeAPIClient | **수정 재사용**: 닫힌 endpoint/body 책임을 기존 native client에서 유지. 정확한 GET/PUT와 M11 409/503 분리. 원본 byType/quiet-hours/FCM route·운영 ID 제외 |
| R38 | 양 OS 원본 NotificationPreferences 모델·계정 저장 책임 대조 | 양 OS M11 DTO, NotificationAccountScope/clientScope, read-state typed client | **신규**: required boolean·uint64 decimal CAS·원래 계정의 전송 전 admission·변경 revision은 원본 계약에 없음. 원본 알림함 readAt/badge/markAllRead와 무관한 room readContext는 새 계약으로 검증하고 제품 화면에는 아직 연결하지 않음 |

R34–R38은 새 외부 SDK나 의존성을 추가하지 않는다. 실제 비추출 보호 저장소·세션 만료,
현재 credential 401 처리, 기존 공통 confirmation/설정 컴포넌트를 그대로 사용한다.
계정 값은 기기 전역 설정에 캐시하지 않고 서버 응답으로만 확인한다. 실제 provider나
방 lifecycle이 없는 부분을 UI 토글·가짜 완료·테스트 credential로 대신하지 않는다.

## 실제 추출 기록 — MB04a 방 목록과 SQLite

원본은 Android `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`, iOS
`18a33bbf96fe52b28d0de361916e20549bdcce6b`다. 읽기 전용으로 원본과 대상의 책임·코드를
대조했다. [저장소 진행 기록](mobile-rooms-progress.md)은 코드 적용과 실행 검증을 구분한다.
아래 Android 대상은 기존 app `java/chat/rogi/rogichat/`, iOS는 `apps/ios/` 기준이다.

| ID | source 파일·심볼 | 대상 | 실제 수정 재사용와 신규 구현의 경계 |
|---|---|---|---|
| R39 | Android `core/network/.../api/ChannelApi.kt`의 getPopularChannels/searchChannels/getMyChannels, `core/data/.../repository/ChannelRepositoryImpl.kt`의 searchChannels/getMyChannels | 기존 `core/network/ApiClient.kt`, RoomsApi, `feature/rooms/RoomsScreen.kt`의 RoomsRepository와 NativeSessionCoordinator | **수정 재사용**: 주입 API의 typed 요청·parameters.append·repository 결과 경계. 원본 채널 route/정수 ID/페이지 번호·실패를 빈 배열로 바꾸는 동작·Timber 로그는 제외. 새 room/manifest DTO와 원자적 staging은 별도 신규 구현 |
| R40 | Android `core/common/.../di/DispatchersModule.kt`의 providesIoDispatcher/providesApplicationScope, NetworkModule/DataModule의 API/repository 주입 | 기존 ProductServices와 `core/rooms/AndroidRoomsStore.kt`, RoomsViewModel | **부분 수정 재사용**: transport 수명·명시적 IO dispatcher·repository 주입과 기존 추출 StateFlow/loading/error 흐름. Hilt graph 전체를 복제하지 않음. credential mutex/DB COMMIT·purge fence는 로기챗 신규 책임 |
| R41 | iOS `Meloming/Domain/Repositories/NotificationRepository.swift`의 protocol/adapter/init와 cursor 요청, ChannelRepository/NewsRepository의 생성자 주입 | `Sources/Core/Rooms/NativeRoomsRemote.swift`, `Packages/RogichatRooms/Sources/RogichatRooms/RoomsRepository.swift` | **수정 재사용**: protocol·생성자 client 주입·typed cursor 요청. Notification DTO·낙관적 mark-read는 미이식. 기존 R23 HTTP client를 확장하고 실제 manifest/DB/revision 조정은 새 계약으로 구현 |
| R42 | iOS `Meloming/Presentation/Notifications/NotificationsViewModel.swift`의 Loadable·refresh/loadMore 분리 | `Sources/Features/Rooms/RoomsScreen.swift`, 기존 `Core/State/Loadable.swift` | **부분 수정 재사용**: MainActor 목록 상태·로딩/오류·refresh와 다음 페이지. 원본의 약한 중복/세대 검사와 낙관적 알림 읽음, News의 detached refresh는 제외. 방 행은 확인된 metadata만 표시하고 가짜 대화 진입을 제공하지 않음 |
| R43 | Android의 Room 의존 선언과 양 OS 비채팅 DB 코드 검색 | Android `core/rooms/{RoomsDatabase,AndroidRoomsStore}.kt`, iOS local package RoomsDatabase/RoomsStorage/RoomsContract | **신규**: 원본에 실제 DB/DAO/migration/SQLite coordinator가 없어 이식할 구현이 없음. 환경/accountPartition DB, schema 2의 완전 manifest 교체, durable cleanup, 실제 COMMIT fence 및 on-disk 회귀는 로기챗용으로 구현. 원본을 읽은 사실을 DB 재사용으로 집계하지 않음 |

Room/KSP와 GRDB의 exact 버전·lock 및 고지/리소스 검사를 app/IPA 배포 guard에 강제한다.
rooms 단계의 실제 bundle·서명 app/IPA 검사와 빌드 13의 양 OS 내부 배포를 통과했다.
GRDB host 시험과 Xcode 앱의 서로 다른 resolved 파일이 같은 revision을 가리키도록 검사하고
자동 재해석을 차단한다. 설치 UUID의 생성·전송·개인정보 선언도 새 데이터 흐름에 맞춘
로기챗 메타데이터다. 원본의 주소·운영 ID·서명·analytics·Talk/TalkV2는 이식하지 않는다.

## 실제 추출 기록 — 방 참여·나가기

원본 SHA는 R39–R43과 같다. 기존 방 목록과 native HTTP 구현을 확장하며 새 라이브러리를
추가하지 않는다. [명령 진행 기록](mobile-room-mutations-progress.md)은 결과 불명과 실제
현재 상태, 로컬 선택 검사와 서버의 current-membership 명령을 구분한다.

| ID | source 파일·심볼 | 대상 | 실제 수정 재사용와 신규 구현의 경계 |
|---|---|---|---|
| R44 | Android `feature/more/.../MoreScreen.kt` logout AlertDialog, `feature/reviews/.../MyReviewsScreen.kt` deleteTarget, `MfaSecuritySettingsScreen.kt` MfaEnrollmentDialog | `feature/rooms/RoomsScreen.kt` | **수정 재사용**: 선택 대상 native 확인창·destructive/cancel·스크롤 본문·진행/버튼 렌더링. 실제 방 이름·원본 scope/cycle/M에 결합. 원본 review 삭제 즉시 filter·성공 toast·MFA business는 제외 |
| R45 | iOS `Meloming/Presentation/Reviews/MyReviewsView.swift` reviewPendingDelete/presenting alert, `More/MyPageView.swift` logout alert, `MfaSecuritySettingsView.swift` ProgressView/disabled | `Sources/Features/Rooms/RoomsScreen.swift`, `Sources/Core/Rooms/RoomsScreenModel.swift`의 model·owner | **수정 재사용**: 선택 대상 확인·cancel/destructive·진행 표시, 기존 Loadable/List. source의 view-local flag를 명령 소유권으로 쓰거나 낙관적 history 삭제를 가져오지 않음 |
| R46 | R39/R41의 기존 typed HTTP/repository와 원본 review command/refresh 책임 대조 | 양 OS room command DTO·service/coordinator·실제 DB invalidation 및 재확인 | **기존 추출 확장 + 신규**: closed POST adapter는 기존 구현을 확장. strict UInt32/200/204, 원본 선택·scope fence, view보다 긴 one-shot 소유권, COMMIT-before-POST·전체 manifest 조정은 원본에 대응 계약이 없어 새 구현. 단순 refreshAfterMutation 참고를 내구성 구현 이식으로 집계하지 않음 |

## 실제 추출 기록 — 계정 탈퇴 접수

원본 SHA는 R39–R43과 같다. [구현 기록](mobile-account-deletion-progress.md)은 최종 동결
소스와 실제 실행 범위를 구분한다. 원본의 웹 탈퇴와 신규 native transaction을 혼동하지 않는다.

| ID | source 파일·심볼 | 대상 | 실제 수정 재사용와 신규 구현의 경계 |
|---|---|---|---|
| R47 | Android `feature/more/.../{ProfileSettingsScreen,MoreNavigation,MoreScreen}.kt`의 onNavigateToWithdrawal·getWithdrawalUrl·destructive confirm; iOS `Meloming/Presentation/More/{MoreView,MyPageView}.swift`의 설정 section·withdrawal entry·logout alert | 양 OS AccountScreen과 기존 ConfirmationPrompt/native alert, 탈퇴 결과 화면 | **부분 수정 재사용**: 설정 위치·선택 대상·cancel/destructive·진행/오류 UI. 원본 탈퇴는 authenticated WebView 진입이다. URL·cookie/token bridge나 웹 business는 이식하지 않음 |
| R48 | Android `core/network/.../api/ApiClient.kt`, `auth/TokenStorage.kt`의 TokenStorage/StoredMfaChallengeRecordCodec; iOS `Core/Network/APIClient.swift`, `Core/Auth/KeychainService.swift` | 기존 closed HTTP·Android credential/pending·iOS credential envelope와 DB purge 경계 | **기존 추출 확장**: typed DELETE 경로와 보호 저장 primitive·주입·직렬화 경계를 재사용. 기존 원본의 refresh·운영 주소·analytics는 가져오지 않음 |
| R49 | 원본 웹 탈퇴와 native 저장소 책임 대조 | 양 OS AccountDeletion contract/journal/state, NativeSessionCoordinator/NativeSessionService의 admission·owned request·복구 | **신규**: strict blocked receipt·unknown·최근 인증, 원래 scope CAS, 보호 admission과 DB 정리, crash no-replay·ACK 보존·기록과 표시 분리는 원본에 대응 구현이 없음. 원본을 읽은 사실을 native transaction 재사용으로 집계하지 않음 |

## 실제 추출 확장 — TEXT 대화와 복구

원본은 Android `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`, iOS
`18a33bbf96fe52b28d0de361916e20549bdcce6b`이며 읽기 전용으로 확인했다.
[진행 기록](mobile-conversation-progress.md)은 작성·실행·배포 상태를 구분한다.
이번 변경에 대응하는 별도 Meloming 채팅 UX나 outbox를 이식했다고 주장하지 않는다.

| ID | source 파일·심볼 | 대상 | 실제 재사용와 신규 구현의 경계 |
|---|---|---|---|
| R50 | Android `core/network/.../api/ApiClient.kt`의 get/post/handleResponse, ChannelApi·ChannelRepositoryImpl의 getMyChannels/getChannel; iOS `Core/Network/APIClient.swift`, `Domain/Repositories/NotificationRepository.swift`의 protocol/client 생성자 주입 | 기존 NativeApi/NativeAPIClient, NativeRoomsRemote·ConversationGateway·ConversationFetching | **기존 추출 확장**: 단일 HTTP client, typed 요청·응답과 주입된 repository 경계를 실제 재사용. 원본 route·정수 ID·empty-on-error·payload logging은 이식하지 않음. C04/C05/C06 endpoint·DTO·실제 계정 인가는 신규 계약 |
| R51 | Android MoreNavigation·MoreScreen·ProfileSettingsScreen에서 이미 추출한 공통 navigation/StateFlow/lifecycle; iOS `Presentation/Notifications/NotificationsViewModel.swift`의 init·Loadable·load/refresh/next-page 구조 | AppEntry/기존 ProductPage 및 ConversationViewModel, 기존 NavigationStack·Loadable과 ConversationScreenModel | **기존 추출 확장 + 제한된 수정 재사용**: 공통 화면 진입·계정 gate·loading/error·constructor 주입을 유지. iOS 알림 모델의 실제 load-if-empty/refresh/다음 페이지 구조를 적용하되 낙관적 mark-read는 제외. 새 timeline·composer·인용 UX를 원본 채팅 UX 재사용으로 집계하지 않음 |
| R52 | 양 OS 원본 비채팅 저장소·상태 책임 대조 | ConversationContract, 실제 Room/GRDB timeline·profiles·outbox 및 coordinator, cold recovery harness | **신규**: immutable command·원래 M·receipt-only 복구·동일 version 전체 projection 교체·terminal tombstone·실제 COMMIT fence는 대응 원본 구현이 없음. 기존 보호 세션·계정별 DB를 확장하며 두 번째 인증 client나 cache 체계를 추가하지 않음 |

TEXT sender/recipient/body에 맞춘 iOS messages 개인정보 선언과 Android 메시지 데이터 고지
검토는 로기챗 데이터 흐름의 책임이다. 새 대화 단계 자체는 외부 SDK를 추가하지 않는다.
원본 운영 ID·endpoint·서명·analytics·Talk/TalkV2는 제품에 포함하지 않는다.

## 독립 feature 추출 — 미디어·메시지 동작·인증/알림

아래는 각 feature 코드의 추출 기록이다. 보호 세션·DB·플랫폼 callback·제품 화면에 연결한
상태와 실제 운영 검증은 각 [미디어](mobile-media-progress.md),
[메시지 동작](mobile-message-actions-progress.md),
[인증·push](mobile-identity-push-progress.md) 기록에서 구분한다. 원본 SHA는 R50–R52와 같고,
해당 원본 파일·history·설정은 수정하거나 가져오지 않았다.

| ID | source 파일·심볼 | 대상 | 실제 재사용와 신규 구현의 경계 |
|---|---|---|---|
| R53 | Android `feature/channel/.../ChannelSettingsScreen.kt`의 photoPickerLauncher | `feature/media/MediaPicker.kt` | **수정 재사용**: rememberLauncherForActivityResult/PickVisualMedia·선택 URI·ContentResolver/MIME 흐름. UI thread의 무제한 readBytes와 JPEG 추정을 제거하고 취소 가능한 크기 제한 파일 복사·영상 모드 추가 |
| R54 | iOS `Meloming/Presentation/Channel/ChannelSettingsView.swift`의 ProfileImagePicker | `Features/Media/MediaPicker.swift` | **수정 재사용**: PhotosPicker 선택·import 중 비활성·선택 변경 처리. 전체 Data 읽기와 고정 JPEG 표기 대신 file Transferable·실제 MIME·제한 복사·취소·정리·영상 모드 적용 |
| R55 | Android MelomingAsyncImage/ProfileImage와 iOS APIClient의 이미지/전역 cache 책임 대조 | MediaDownload·AuthorizedMedia·MediaUpload·journal protocol | **신규**: 원본 URL 전역 cache는 원래 scope와 만료되는 접근 권한에 맞지 않음. 인증된 작업은 기존 HTTP에 연결하고 다운로드는 credential 없이 수행. 실제 접근 권한 갱신·private scratch·원래 대상별 표시 수명은 신규 책임 |
| R56 | Android `feature/reviews/.../MyReviewsScreen.kt`의 deleteTarget/AlertDialog(:85), iOS `Presentation/Reviews/MyReviewsView.swift`의 reviewPendingDelete/presenting alert(:170) | 양 OS MessageActionsPanel | **수정 재사용**: 대상이 담긴 destructive/cancel 확인창과 dismiss 후 dispatch 구조. 현재 화면의 가변 대상을 읽지 않고 원래 action token을 전달하도록 변경 |
| R57 | 원본 MyReviewsViewModel/deleteReview와 기존 Rogichat M11Dtos·ReadContext·StrictAuthJson | MessageActionState/MessageActionWire·MessageReadWire·journal/anchor protocol | **기존 추출 확장 + 신규**: 실제 기존 read-state 계약과 strict parser를 재사용. boolean 성공·즉시 행 삭제로는 불명 결과를 표현할 수 없어 typed action·원래 scope·영속 journal·스크롤 복원은 신규 구현 |
| R58 | iOS `Meloming/Core/Auth/AuthManager.swift`의 loginWithApple | `Core/Identity/AppleAuthorization.swift` | **수정 재사용**: provider/createRequest/scopes/controller/delegate/credential 추출. 강한 수명 소유·nonce/state·한 번의 취소를 추가하고 원본 API·이메일 기반 계정 추정·로그 제거 |
| R59 | iOS `Core/Push/PushNotificationManager.swift`의 requestAuthorization/checkAuthorizationStatus; Android `core/data/.../push/PushNotificationManager.kt`의 checkPermissionStatus/onPermissionResult | ApplePushPermission·AndroidPushPermission | **수정 재사용**: 실제 OS permission/options/status·원격 알림 등록 요청·요청 여부 보존. OS 앱 전체 차단을 확인하고 callback Boolean보다 실제 OS 상태를 우선. 원본 Firebase singleton·무시된 오류·로그 제외 |
| R60 | 양 OS 원본 push manager, Android MelomingFirebaseMessagingService, iOS AppDelegate | 각 OS 작성자의 기존 서비스/delegate 연결 지점 | **검토·연결 책임 전달**: callback 파일은 독립 worker의 소유 범위 밖이므로 추출 완료로 집계하지 않음. 실제 연결 시 원본 URL/type/channel 라우팅과 토큰 로그를 가져오지 않음 |
| R61 | 기존 Rogichat PendingRouteQueue/AuthProof/SOOP exchange validators 및 원본 bearer 수명 책임 대조 | PushRouteGate·AppleIdentityContract·PushLifecycle/native push wire | **실제 기존 코드 재사용 + 신규**: queue/proof/검증된 응답은 직접 재사용. 영속 epoch·설치 binding CAS·sync wake 검증은 원본 서버 계약과 달라 새 구현. 제품 연결·실제 provider 등록 완료는 별도 gate |


## 실제 추출 확장 — native realtime 수명

| ID | source 파일·심볼 | 대상 | 실제 재사용와 신규 구현의 경계 |
|---|---|---|---|
| R62 | Android `core/network/.../socket/SongLiveSocketManager.kt`의 connect/callbackFlow/awaitClose, iOS `Meloming/Core/Network/SongLiveSocketManager.swift`의 connect/disconnect/setupEventHandlers/deinit; 원본 SHA는 R50–R52와 동일 | 양 OS NativeRealtimeManager와 실제 Socket.IO driver | **수정 재사용**: retained manager/socket, event registration, connect와 teardown을 실제 재사용. 원본 join/song payload·polling·로그는 제외. 원래 보호 session epoch, REST 재인가 후 명시 reconnect, cookie/Origin 없는 iOS engine은 새 서버 계약에 필요한 신규 구현. callback 등록만으로 실제 QA 수신을 완료했다고 집계하지 않음 |

[실시간 추출 기록](mobile-native-realtime-progress.md)은 SDK 원본의 cookie/Origin 처리와
공식 engine seam을 선택한 근거, 정확한 pin·라이선스, 실제 loopback 검사의 범위를 기록한다.
[제품 통합 기록](mobile-product-integration-progress.md)에서 실제 앱 연결과 최종 검증을 구분한다.


## 실제 SOOP 기본 프로필·기본방 소비

| ID | 원본·대상 | 재사용와 새 계약의 경계 |
|---|---|---|
| R64 | Android `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`의 `core/designsystem/.../MelomingAsyncImage.kt:ProfileImage`, `feature/more/.../ProfileSettingsScreen.kt`; iOS `18a33bbf96fe52b28d0de361916e20549bdcce6b`의 `Meloming/Presentation/More/MyPageView.swift:MyProfileHero`; 대상 양 OS SettingsScreen/ProfileScreen | **기존 추출 확장·수정 재사용**: 프로필 중심 헤더·원형 crop·이름/보조 정보·수정 화면을 유지하고 실제 self-profile GET의 SOOP ID를 표시한다. session 요약에 없는 값을 추정하지 않는다. 이미지 엔진은 기존 AuthorizedMedia/MediaDownload를 직접 재사용한다. 별도 Coil/Kingfisher 캐시나 인증 client는 추가하지 않는다. |
| R65 | 기존 Rogichat MediaClient·AuthorizedMedia·계정/대화 scope·Room/GRDB profile projection; 대상 동일 구현 | **기존 코드 직접 재사용 + 계약 추가**: 기본 사진의 body 없는 self/actor 조회권을 기존 60초 lease·인증 없는 다운로드·크기/형식/취소 검증에 연결한다. 직접 올린 asset을 우선하고 provider 사진은 갱신 때 실제 bytes도 다시 읽는다. raw provider URL/ID는 self 응답 밖으로 전파하거나 DB에 저장하지 않는다. actor는 현재 room profile 허용 범위에서만 표시하고 익명 author에는 연결하지 않는다. |
| R66 | 기존 RoomsScreen·RoomsViewModel/RoomsScreenModel·Room/GRDB discovery 저장 경로 | **기존 구현 확장**: 실제 default room의 선택 필드 `isDefault`, `availability`를 저장·표시한다. `OWNER_PENDING`이면 방장 확인 대기를 표시하고 join을 보내지 않는다. 방 ID·owner를 앱에서 생성/추정하지 않는다. Android DB 3→4는 기존 row/outbox를 보존하는 additive migration, iOS 기존 JSON은 필드 부재 시 이전 계약으로 읽는다. 채팅 UX는 멜로밍에서 추출하지 않았다. |

추가 API 필드는 이전 배포에서 없거나 self-profile에서 null일 수 있다. 표시 ID는 계정
subject·partition·권한 키가 아니다. 수동 이름·사진·사진 삭제의 보존은 서버가 결정하며
클라이언트는 실제 GET/PATCH 결과를 표시한다. 테스트 합성 프로필·방은 test target에만 있다.


| ID | 원본·기존 구현 | 대상 | 재사용와 새 계약의 경계 |
|---|---|---|---|
| R67 | R55/R64와 같은 원본 이미지 cache·ProfileImage 대조; 기존 MediaClient/MediaDownload 직접 재사용 | provider 전용 URL 검증·ProviderAvatarLoads | **기존 전송 재사용 + 새 권한 수명 처리**: provider 조회권은 설정된 API origin의 `/v1/profile-images`와 단일 opaque ticket만 허용하고 JPEG/WebP 2 MiB로 제한한다. 원본의 URL 전역 cache는 만료되는 계정/방 권한과 맞지 않아 그대로 이식하지 않는다. 계정/방의 원래 scope+actor별 활성 화면에서만 요청·bytes를 공유하고 마지막 화면 종료 때 취소·폐기한다. 동시 전송 2개, 대기 15초, 갱신 시 새 조회권과 bytes를 함께 받는다. 일반 asset의 서명 URL 계약은 유지한다. |


## 방장 수신함 전송 확장

| ID | 원본·대상 | 재사용와 새 계약의 경계 |
|---|---|---|
| R68 | 기존 Rogichat ConversationScreen/ViewModel, TextCommand, Room/GRDB outbox, MediaClient/ConversationMedia; 기반 원본은 R64 이전의 공통 UI·상태 재사용 항목 | **기존 제품 구현 직접 확장**: ROOM_OWNER를 기존 전송·영속·receipt 복구·미디어 명령에 추가한다. 멜로밍 채팅 UX는 사용자 제외 조건을 유지하며 가져오지 않는다. 멜로밍의 원본 일반 로그인·설정은 이 새 수신함 계약을 구현하지 않으므로 별도 채팅 계층 복사로 대체하지 않는다. 서버가 결정한 FAN 권한 및 실제 recipient projection을 그대로 사용한다. |
| R69 | Meloming `18a33bbf`의 `Presentation/Talk/Components/TalkInputBar.swift`와 기존 Rogichat `ConversationScreen`, `MediaPicker`, `ConversationFeatureModel` | **기존 Rogichat 흐름 확장 + 신규 카메라 어댑터**: 메시지 명령·영속 전송·미디어 업로드·스티커 picker는 그대로 연결하고 iOS 대화방에 단독 입력바, 첨부 확장판, 카메라 촬영, 메시지 묶음 표시를 적용한다. Meloming Talk/TalkV2 입력바·버블은 사용자가 재사용을 제외했으며 로기챗의 첨부·비공개 답장·영속 전송 계약과도 맞지 않아 이식하지 않는다. `Features/Media/CameraCapture.swift`는 기존 카메라 촬영 구현이 없어 신규 작성했다. |

R66의 `OWNER_PENDING` 처리 코드는 과거 계약의 호환 처리다. 실제 팬 접근이 가능한
기본방은 방장 미가입 여부와 무관하게 READY이며, 이번 앱은 그 상태에서 수신 actor 없이
ROOM_OWNER로 전송한다. 구체적인 계약·복원 경계는 [전송 기록](mobile-room-owner-progress.md)에 있다.


| ID | 원본·대상 | 재사용와 새 계약의 경계 |
|---|---|---|
| R69 | 기존 NativeDtos/NativeSessionDTO, SessionSnapshot/AppSession 세션 투영과 복원·재검증 | **기존 세션 구현 직접 확장**: 실제 서버 심사 권한을 SOOP 연결 사실과 분리한다. 멜로밍 로그인 화면의 자격증명 폼은 후속 폼 이식 대상이며, 로기챗의 REQUIRED+READY+chat 계약을 제공하지 않는 원본 세션 정책으로 대체하지 않는다. 백엔드가 권한을 결정하고 UI는 사실만 표시한다. |

## 비밀번호 인증·계정 보안 확장

| ID | 원본 commit/path | 대상과 재사용 | 필요한 변경 |
|---|---|---|---|
| R70 | meloming-android `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`, `feature/auth/.../LoginScreen.kt` LoginContent의 자격증명 필드·focus/IME·비밀번호 마스킹/표시·submit guard | Android PasswordForm: 기존 구조와 포커스·보안 입력 동작을 이식 | 이메일을 ASCII loginId로 변경, 로기챗 기본 입력 스타일, 실제 native 요청/약관 동의, 저장하지 않는 암호 상태, 가입/MFA/다른 OAuth 제외 |
| R71 | meloming-ios `18a33bbf96fe52b28d0de361916e20549bdcce6b`, `Meloming/Presentation/Auth/LoginView.swift` labeled form·SecureField·error/loading·button admission | iOS PasswordForm 및 WelcomeScreen 실제 ID/PW 진입 | username/newPassword autofill 구분, 변경 확인 입력, 로기챗 계약/약관·비활성화 시 삭제, 기존 보호 세션 publication 사용 |
| R72 | R01 이후 이식된 SettingsSection/SettingsRow와 MyPage/More 전체 설정 허브; 원본 `Presentation/More/MfaSecuritySettingsView.swift`, `feature/more/.../MfaSecuritySettingsScreen.kt` 추가 대조 | 양쪽 AccountAccessSettings는 기존 설정 허브·section/row·실제 비동기 권한/오류 재조회 구조 직접 확장 | MFA 자체는 복사하지 않는다. self-only 임시 grant/서버 만료·role/revision 계약은 원본에 없어 새 closed request와 scope 철회 구현이 필요하다. 기존 SOOP 신원이나 방 소유자를 덮어쓰지 않는다. |

상세 경계와 검증은 [비밀번호·관리자 구현 기록](mobile-password-admin-progress.md)에 있다.


| ID | 원본·대상 | 재사용과 변경 경계 |
|---|---|---|
| R73 | QA20 `d95a34adf71c38f888ddddc759bd6fce7d921046`의 Android/iOS `AuthorizedMedia` provider-avatar decoder | **기존 구현 직접 재사용**: BitmapFactory bounds/downsample와 ImageIO index-0 thumbnail을 테스트 가능한 ProviderAvatarDecoder로 옮긴다. 기존 20 MP/256 기준을 보존하고 provider MIME에만 GIF를 추가한다. 멜로밍 채팅 UX·다른 이미지 라이브러리·원본 설정을 가져오지 않는다. 합성 GIF는 테스트 소스에만 둔다. |

## 메시지 반응과 인용 원문

| ID | 원본 commit/path | 대상과 재사용 | 필요한 변경 |
|---|---|---|---|
| R74 | meloming-ios `18a33bbf96fe52b28d0de361916e20549bdcce6b`, `Meloming/Presentation/TalkV2/CoreV2TalkRoomView.swift`의 반응 표시 및 `meloming-android` `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`, `feature/talk/.../components/MessageBubble.kt` 확인 | Android/iOS 기존 Rogichat `ConversationMessage`, 캐시, `ConversationScreen`, 액션 전송을 직접 확장 | Meloming Talk/TalkV2 채팅 UX는 사용자 제외 범위라 이식하지 않는다. 기존 로기챗 API의 메시지별 `reactions`와 `quote.authorName`을 최초 응답과 캐시에 보존해 말풍선 아래 반응과 원문 이동을 구현한다. |
