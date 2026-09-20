# 모바일 첫 구현: QA 와이어프레임

2026-09-20. 사용자가 백엔드 병행 개발 중에도 앱 구성과 미연동 화면부터 진행하도록
요청한 첫 구현이다. [세부 구현 계획](mobile-implementation-plan.md)의 MB00/MB02 중
**화면 경계와 탐색 흐름**을 먼저 구성했다. MB01 계약 확정, 실제 인증, 저장소, 동기화,
메시지 전송의 완료를 뜻하지 않는다.

> 후속 구현: [공통 기반 진행 기록](mobile-common-foundation-progress.md)에서 2탭 shell,
> 제한 계정의 설정 접근, 실제 OS 알림 조회 및 최신 blocker를 확인한다. 아래는 첫 구현의 기록이다.

## 현재 사용할 수 있는 범위

QA 앱을 실행하고 `연결 안내부터 미리보기` → `연결 이후 화면 미리보기`를 누른다.
이 버튼은 UI 탐색만 수행하며 로그인·SOOP 연결·계정 생성을 수행하지 않는다.
화면 상단에는 항상 `QA · 화면 미리보기 / 샘플 데이터 · 실제 로그인 및 전송 안 됨`을 표시한다.

| 화면 | 직접 확인할 수 있는 동작 | 아직 연결하지 않은 동작 |
|---|---|---|
| 시작 | Apple/SOOP 진입 위치, 필수 연결 안내 | 실제 provider 로그인 |
| SOOP 연결 | 연결 필요 상태와 다음 화면 미리보기 | 연결·충돌·재인증 |
| 대화방 목록 | 합성 방 2개, 팬/스트리머 관점, 목록/로딩/빈 목록/오류 전환 | 참여 판정, REST 목록, 재시도 |
| 대화방 | 합성 타임라인, 개인/전체 구분, 텍스트 입력 연습 | 전송·영속 초안·sync·소켓 |
| 스트리머 작성 | 팬 2명 중 답장 상대 선택, 전체 대화 전환 | 실제 권한 판정·답장·공개 전환 |
| 설정 | 프로필/계정 관리로 이동, 알림·앱 정보 자리 | 시스템 권한·약관 링크·문의 |
| 프로필 | 표시 이름 입력, 선택 동의 UI | 저장·실제 생일 입력·이미지 업로드 |
| 계정 관리 | 미리보기 종료 및 입력 초기화 | 로그아웃 요청·계정 연결 해제·탈퇴 |
| 신고/차단 | 신고 사유 선택 | 대상 지정·신고 제출·차단 |

샘플 팬 2명과 스트리머/방 2개는 앱 내부의 합성 표시 데이터다. 실계정·세션·운영 데이터와
연결하지 않는다. 비회원/관리자 및 실제 서버 계약 fixture는 MB01에서 추가한다.
Android 시스템 뒤로 가기와 화면 뒤로 버튼, iOS NavigationStack의 뒤로 버튼/제스처를
동일한 경로 정책으로 처리한다.

## 구현 경계

- **Android:** `src/main/.../core/design` 공통 카드/테마, `feature/auth` 시작 화면,
  `MainActivity` 조립부. `src/qa`의 `AppEntry`와 `preview`가 QA 상태/샘플/화면을 소유한다.
  `src/prod/AppEntry`에는 준비 중인 시작 화면만 있다. Gradle source set으로 분리한다.
- **iOS:** `Sources/Core/Design`, `Features/Auth`, `RogichatApp` 조립부.
  `Sources/QA`는 `ROGICHAT_QA` 조건 안에서만 컴파일된다. 조건은 QA xcconfig에만 있다.
  프로덕션 Debug/Release 양쪽에는 QA 화면·fixture가 포함되지 않는다.
- **상태:** `WireframeState`는 UI 전용 값이며 session/domain/서버 DTO가 아니다.
  `linkPreviewPassed`는 화면 탐색 조건이며 인증·권한 판정에 재사용할 수 없다.
  새 HTTP 클라이언트, token, 쿠키, API mock server, DB, analytics는 추가하지 않았다.
- **수명:** 메모리만 사용한다. 프로세스 재시작 시 시작 화면으로 돌아간다.
  Android Activity 재생성(회전 포함)도 미리보기를 초기화한다. 실제 앱의 세션/초안 복구는
  추후 ViewModel/저장소 수명으로 구현한다.
- **초안 격리:** 다른 방/역할/답장 상대/개인↔전체로 변경하면 입력을 비운다.
  스트리머의 개인 답장은 상대를 고르기 전 입력할 수 없다. 팬에게 전체 전환은 없다.
  신고 화면을 보고 같은 채팅으로 돌아올 때만 해당 초안을 유지한다.
- **로컬 편집:** 프로필/신고 폼은 화면 안에만 존재한다. 저장 성공이나 전송 성공을 연출하지 않는다.
  2,000자 입력 제한은 미리보기 메모리 제한이며 서버 계약의 최대 길이로 확정하지 않는다.

화면 책임이 확정되면 QA 화면을 `feature:rooms/chat/settings` 및 iOS `Features`로 분리하고
외부에서 주입받는 ScreenModel/상태 모델로 바꾼다. Android 멀티모듈/Hilt/Ktor/Room,
iOS 로컬 SPM/GRDB/Session actor는 실제 책임과 계약이 생기는 단계에 추가한다.
현재 UI 프로토타입만을 위해 빈 모듈이나 사용하지 않는 의존성은 생성하지 않았다.

기존 계획의 “테스트 fixture만 사용” 경계를 이번 요청에 맞춰 **QA 설치 앱의 명시적
오프라인 화면 미리보기**까지 확장한다. hosted QA 로그인 우회나 프로덕션 mock 기능은
만들지 않는다. QA/프로덕션 패키지 검사에서 샘플 방 식별자의 포함/미포함을 검사한다.

## 블로커와 다음 진행 경로

아래 항목은 와이어프레임 개발을 멈추게 하지 않는다. API 동작을 임의로 가정해 구현하지 않고,
해결 증거가 생겼을 때 해당 기능을 연결한다. C 번호는 세부 계획의 계약 항목이다.

| 항목 | 실제 연동의 선행 조건 | 그동안 진행 가능한 작업 | 해제 증거 |
|---|---|---|---|
| 인증 C01/C02/C08 | native credential, Apple/SOOP handoff, 만료 정책 | 로그인/연결 진행·취소·재시도 화면 | 합의한 DTO·callback·양 OS 인증 fixture |
| 계정/참여 C03 | 계정 scope, SOOP 상태, 방별 capability | 비회원·연결 필요·참여 불가 화면 | bootstrap/manifest 계약 및 인가 시험 |
| 메시지 C04/C05/C06 | own command ID, 상대/허용 동작, 표시 순서 | 메시지 셀·날짜·답장 대상·입력 UI | receipt/sync/history 공통 fixture와 ADR |
| DTO C07 | 백엔드 구조 보정 및 안정된 계약 생성 | View와 데이터 adapter 경계 정리 | 버전 고정 OpenAPI와 Kotlin/Swift decode 검사 |
| 미디어 M08 | 업로드/예약/접근 정책 안정화 | 첨부·진행·실패·취소 표시 컴포넌트 | 미디어 계약 및 만료/권한 fixture |
| 프로필/계정/신고 | 동의·탈퇴·신고/차단 정책 및 API | 폼 검증·오류/확인 화면 | 제품 정책과 API 회귀 시험 |
| 알림 C09 | native transport/device binding/preference 계약 및 서버 M11 | OS 권한/설정 UI, parser/pending route, 합성 provider | push 계약과 계정 전환·권한 상실·token 회전 시험 |
| 재사용 단위 | 출처 불명 third-party 단위 또는 새 의존성 호환성 미확인 | 다른 독립 컴포넌트 추출, shell/상태 시험 | 파일별 provenance·의존 고정·양 OS 검증 |
| 기기 QA | 테스트 기기에서 설치/실행 | 정적 빌드·상태 검사·패키지 격리 | 작은 화면/큰 글자/키보드/다크 모드/뒤로 동작 확인 |

2026-09-20 사용자 보정으로 이전의 “채팅 상세화 우선”을 교체했다. 다음 작업은
**MB02a 멜로밍 공통 컴포넌트 추출 → MB02b shell/설정 → MB02c OS 알림·안전한 링크·
앱 복귀 기반**이다. [통합 계획](mobile-implementation-plan.md)의 순서와
[재사용 조사](mobile-reuse-audit.md)의 파일/심볼을 따른다. 멜로밍 채팅 UX/코드는 이식하지 않는다.
현재 QA의 rooms→settings 제약은 LinkRequired의 실제 계정 관리 정책과 다르므로 MB02b에서
수정하며, preview 입력 초기화는 실서비스 영속 초안 규칙으로 승격하지 않는다.
계약이 확정된 부분은 MB02d adapter → MB03 실제 인증/목록 → MB04 영속 전송/복구로 연결한다.
서버에서 막힌 항목은 이 표와 통합 계획에 남기고 다음 공통 UI/미연동 화면으로 이동한다.

## 검증

- Android: QA/prod Debug/Release 컴파일, JUnit, lint. QA reducer 검사는 링크 단계 우회,
  잘못된 방 선택, 팬의 전체 전환, 상대 미선택 입력, 대상 변경 시 초안 폐기,
  방/역할 변경 및 뒤로 가기, 입력 길이 제한을 포함한다.
- iOS: 동일 정책을 실제 Swift 상태 소스로 host CLI 검사한다. Simulator를 띄우지 않는다.
  Xcode 네 가지 구성의 실제 iPhoneOS 번들을 빌드한다.
- `tools/mobile/check_android.py`, `build_ios.py`: ID/환경/서명 경계와 QA fixture 격리 검사.
  iOS Debug의 companion dylib도 검사한다.
- `.github/workflows/mobile.yml`: 기존 빌드 검사에 Swift 상태 검사를 추가했다.
- 실기기 화면/키보드/스크린 리더와 TestFlight/App Tester 설치 검증은 아직 수행하지 않았다.
  이번 문서는 빌드 성공을 사용성 QA나 실제 서비스 기능 완료로 취급하지 않는다.

```sh
# Android, JDK 17 및 Android SDK 환경이 설정된 상태
cd apps/android
./gradlew :app:assembleQaDebug :app:assembleQaRelease :app:assembleProdDebug :app:assembleProdRelease :app:test :app:lint :app:lintQaDebug :app:lintQaRelease :app:lintProdRelease --no-daemon
# 저장소 루트로 복귀
cd ../..
python3 tools/mobile/check_android.py
# macOS, DEVELOPER_DIR가 고정 Xcode를 가리키는 상태
python3 tools/mobile/check_ios_wireframe.py
python3 tools/mobile/build_ios.py --derived-data /path/to/external/DerivedData/rogichat
```

서명 APK/AAB/IPA 및 테스터 배포는 기존 [로컬 배포 절차](mobile-test-distribution.md)를 사용한다.
