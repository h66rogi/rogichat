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
| R10 | Android `DS/component/{MelomingNavigationBar,MelomingTopBar}.kt`, `APP/navigation/MelomingNavHost.kt` | `core/design/AppNavigation.kt`, `AppEntry.kt/ProductNavigation` | **수정 재사용**, R01/02/07 보정: animated tint·선택 icon·Surface/Row·top bar, 실제 Scaffold/NavHost와 `popUpTo(saveState)`·`launchSingleTop`·`restoreState` 유지. 대화/설정으로 줄이고 visible label·Tab semantics·가변 높이 보강 | Navigation Compose 2.10.1, Lifecycle 2.11.0, Phosphor 1.0.0. session별 VMStore 소유는 신규; 회전 보존·A→B→A 폐기 검사 |
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

소스·빌드 산출물 fixture 제외, OS별 빌드/상태 시험과 독립 리뷰 결과는
[제품 구성 교체 기록](mobile-product-progress.md)에 모은다. Android 실제 NavHost와 iOS
native tab 구성은 컴파일되지만 실기기 화면/스크린리더 결과를 대신하지 않는다.
네이티브 인증·원격 프로필 저장·logout/delete·방 입장·채팅·푸시는 구현 완료로 집계하지 않는다.
제품 앱은 실제 native adapter가 없으면 로그인 버튼이나 합성 계정을 제공하지 않는다.

iOS `Resources/PrivacyInfo.xcprivacy`는 원본에 대응 파일이 없어 **신규**로 작성한 플랫폼
메타데이터다. 실제 `@AppStorage`의 앱 전용 화면 모드 설정에 해당하는 UserDefaults
`CA92.1`만 선언했다. 필요하지 않은 원본 SDK/추적 선언은 가져오지 않는다.
선언 파일·정확한 앱 식별·서명 승격 경계는 [배포 준비 점검](mobile-release-readiness.md)을 따른다.
