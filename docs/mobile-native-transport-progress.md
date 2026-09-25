# 네이티브 세션·프로필 연결

2026-09-20. 제품 구성 교체(PR #16, QA `70ff52b`) 이후의 다음 구현 단계다.
이 문서는 실제 HTTP/보호 저장소 adapter 구현과 검증 경계를 기록한다. 네이티브 로그인이나
실제 계정 왕복이 완료됐다는 뜻은 아니다. 빌드·배포 완료 증거는 아래에서 구분한다.

## 확정된 입력

서버 계약은 커밋 `ac69ca2671300797bcc99994e12bbd7015d5df27`의
[native transport](https://github.com/h66rogi/rogichat/blob/ac69ca2671300797bcc99994e12bbd7015d5df27/docs/backend-native-transport.md)를 기준으로 한다.
계약 커밋, QA 배포, 실제 제공자 인증 성공은 각각 확인한다.

- credential은 환경·클라이언트에 묶인 opaque 값이며 고정 7일 만료다. refresh API는 없다.
- 요청은 정확한 `Authorization: Bearer …`와 `X-Rogi-Client: ios|android`를 사용한다.
  웹 cookie·CSRF·Origin을 만들거나 시스템 브라우저의 cookie를 가져오지 않는다.
- `/auth/session`은 계정 UUID·닉네임·avatar ID와 SOOP 상태·만료·opaque
  `accountGeneration`만 제공한다. 로그인 제공자나 생일 정보는 여기에 없다.
- `GET/PATCH /me/profile`은 별도 전체 프로필 경계다. 미조회 생일을 빈 생일로 간주하지
  않고 PATCH의 생략·명시적 null·값을 구분한다. 연결 제한 계정도 자신의 프로필을 관리한다.
- `POST /auth/logout`의 본문은 `{}`, 성공은 204다. 401은 현재 credential만 폐기하고,
  403 `SOOP_LINK_REQUIRED`는 인증 만료로 취급하지 않는다.

## 구현 범위

양 OS는 멜로밍의 해당 네트워크·저장소 구현을 먼저 대조하고, 적용 가능한 요청 래퍼와
비동기 상태 경계를 재사용한다. refresh, MFA, 원본 서비스 주소·식별자·로깅·cookie 주입은
로기챗 계약에 맞지 않아 이식하지 않는다. 구체적인 원본·대상·변경 이유는
[재사용 기록 R23–R28](mobile-reuse-audit.md)에 남겼다. 멜로밍의 채팅 UX는 계속 제외한다.

1. iOS Keychain과 Android Keystore 기반 저장소에 실제 credential을 보관한다.
   환경을 분리하고 백업·재설치·보호 저장소 오류를 처리한다. 비밀을 로그나 route에 넣지 않는다.
2. 실제 HTTP adapter로 세션 복원·foreground 재확인·프로필 조회/수정·로그아웃을 연결한다.
   HTTP 리다이렉트를 거부하고 지정한 API origin의 알려진 경로만 호출한다.
3. 로컬 취소 epoch와 서버 `accountGeneration`을 분리한다. 같은 계정이라도 서버 scope가
   변하면 private 화면·작업을 폐기한다. 응답 적용뿐 아니라 저장소 쓰기·삭제도 fencing한다.
4. timeout·연결 실패·503은 credential을 임의 삭제하지 않고 오류/재시도로 표시한다.
   보호 저장소를 읽을 수 없는 경우도 새 사용자로 위장하지 않는다.
5. 로그아웃은 이 기기의 credential과 private 상태를 먼저 제거한다. 서버 폐기 요청이
   실패하면 로컬 종료만 확인됐음을 표시한다. 보호 저장소 삭제 실패 뒤에는 삭제를
   재시도하기 전에 이전 credential을 복원하지 않는다.
6. foreground 재확인은 처음 시작하는 복원과 분리한다. 계정·권한·서버 generation이
   같으면 탭·프로필 draft·저장을 유지한다. 늦은 세션 조회가 나중에 확인된 프로필 저장을
   덮어쓰지 않도록 revision을 대조한다. 일시적 실패는 만료 전 계정과 draft를 유지하며
   재시도 안내를 표시하고, 실제 401·만료·보호 저장소 오류는 private 화면을 정리한다.

합성 credential을 주입하는 앱 메뉴나 QA 전용 로그인은 만들지 않는다. 최초 설치에는
credential이 없으므로 로그인하지 않은 실제 상태가 유지된다. 테스트의 합성 서버/계정은
격리된 테스트 소스에만 둔다.

## 아직 활성화하지 않는 기능

| 경계 | 구체적인 선행 조건 |
|---|---|
| SOOP 로그인·연결 | 서버 발급 후보 계약 검토·배포, 앱 transaction/launch/exchange·PKCE/state/취소 구현, broker canonical subject와 실제 제공자 증거 |
| Apple 로그인 | 정확한 native/Android 경로, Apple audience·nonce·code 검증, 운영 등록과 제공자 revoke/탈퇴 처리 |
| 앱 복귀 | QA/Prod 정확한 HTTPS origin/path, AASA의 webcredentials 및 applinks, Android assetlinks, 서명 entitlement와 실기기 왕복 |
| 계정 탈퇴 | 서버의 실제 탈퇴 endpoint·비동기 삭제/제공자 폐기·상태 확인 계약 |
| 방·채팅 | joined/mode/actorId/cursor 보존, 참여 인가·본문 repository·동기화·실제 화면 연결 |
| Production 배포 | 별도 앱 등록·profile/서명 설정·Play 권한, reviewed-main 빌드 및 Prod API 가동 검증 |

SOOP exchange의 예정 응답은 `{tokenType, accessToken, expiresAt, session}`이며 `session`은
native session DTO다. 이는 후속 계약이며 이 단계에서 구현되지 않은 경로를 호출하지 않는다.
후속 구현의 LINK는 최근 인증과 원래 세션을 확인한다. 로그인·연결에는 약관 동의
필수 조건을 두지 않는다. 계정을 몰래 전환하거나 다른 계정과 합치지 않는다.

후속 서버 후보는 PR #23의 `de02c6aa73d549edc56e38d726f0f85bc928c27b`다.
최초 계약 후보 `106d93c6` 이후 동시 첫 로그인 DB 처리 보정이 반영됐고 HTTP 계약은 유지됐다.
`backend-native-soop.md`와 `backend-native-auth-contract.md`에 start/launch/S256/exchange와
오류가 구체화됐지만 검토·CI·QA 배포는 별도다. 앱의 후속 client 구현은 이 계약을 검토해
진행할 수 있다. 실제 인증의 외부 차단 조건은 운영 broker가 아직 공식 canonical immutable
viewer/streamer subject, 등록 및 실제 사용자 증거를 갖추지 못해
`SUBJECT_CONTRACT_UNVERIFIED` 503을 반환하는 점이다. 설정 flag나 합성 성공으로 우회하지 않는다.

## 데이터 선언

프로필 PATCH는 닉네임과 선택한 생일 월/일·공개 설정을 서버 계정에 저장한다. 닉네임은
Apple의 screen name/handle에 해당하는 User ID로, 생일 월/일·공개 설정은 Other Data Types로
분류한다. 후자는 문서의 일반 분류를 현재 필드에 적용한 판단이다. 모두 계정에 연결되며
목적은 앱 기능 제공, 광고 추적은 없다. 메시지·사진 업로드나 분석 수집을 선언한 것으로
확대하지 않는다. 화면 모드는 앱 전용 UserDefaults `CA92.1`을 유지한다.

실제 연결 범위에 맞춰 `PrivacyInfo.xcprivacy`와 패키지 검사를 함께 갱신한다. 서버에
저장되는 데이터가 추가되면 이 선언과 스토어 개인정보 입력도 다시 확인한다.
근거: [Apple 데이터 분류·수집 정의](https://developer.apple.com/app-store/app-privacy-details/),
[privacy manifest 작성](https://developer.apple.com/documentation/technotes/tn3184-adding-data-collection-details-to-your-privacy-manifest).

## 검증 기록

- iOS: Swift 6 strict-concurrency host 실행 파일 3종 통과. Debug/Release × QA/Prod 네
  device SDK 빌드·실제 .app identifier/origin/minimum OS/iPhone-only/Mach-O/PrivacyInfo 및
  제품 fixture 제외 검사 통과. Xcode GUI·Simulator는 사용하지 않았다.
- iOS 저장소 시험은 실제 atomic 파일·fsync·재설치/삭제 intent를 사용하고 raw Keychain
  driver만 주입한다. 실제 서명된 iOS 기기의 Keychain·제공자 로그인 검증은 별도 남아 있다.
- 독립 읽기 전용 리뷰에서 Android 응답/저장 완료 후 만료 검사와 iOS 응답 메모리 소비
  제한을 보강했다. URLSession 자체 내부 버퍼 크기까지 고정됐다고 주장하지 않는다.
- Android: strict dependency lock 상태에서 QA 58개·Prod 50개 JVM 테스트, 네 가지
  Debug/Release APK 빌드와 release R8/resource shrink·lint 및 패키지 검사를 통과했다.
  실제 API 36.1의 격리된 읽기 전용 에뮬레이터에서 Keystore/AtomicFile 및
  ActivityScenario.recreate 계측 테스트 2개를 통과했다(실패·skip 0).
  계측 키·파일은 별도 namespace이며 제품 credential은 비어 있는 상태를 확인했다.
- Android 화면 유지 중 만료는 네트워크 없이 현재 generation·expiry를 대조해 삭제한다.
  이전 scope의 늦은 타이머가 새 계정을 종료하지 않는 회귀 시험을 포함했다.
- 공통 도구는 finalizer `ea83a5b` 통합 후 Python 테스트 74개를 disposable keychain
  검증을 포함해 통과했다(skip 0).
  공개 저장소 검사와 생성된 Xcode 프로젝트 일치, 문서 상대 링크 검사도 통과했다.
- 서명 빌드 9는 clean 커밋 `d4be7bdc226fe7de54d2c91073a4d336129ee4b5`에서 생성했다.
  Android APK/AAB 서명·패키지 검사와 iOS Archive/IPA 및 Apple validation을 통과했다.
- 동일 SHA의 PR #26 원격 필수 검사도 모두 통과했다. Android·iOS CI는
  [Mobile foundation 35491167249](https://github.com/h66rogi/rogichat/actions/runs/35491167249)다.
- 원본 서명 R8 APK를 별도 테스트 에뮬레이터에 설치해 설치 파일의 전체 SHA-256 일치를
  확인했다. 버전 9·non-debuggable·탭/뒤로가기/설정·다크 모드 강제 종료 후 복원·실제 OS
  알림 설정 왕복·추가 라이선스 표시/스크롤을 통과했고 앱 crash 0건이었다. 제품 계정/데이터를
  주입하지 않았다. 테스트 후 해당 에뮬레이터는 스냅샷을 저장하지 않고 종료했다.
- 빌드 9 Firebase 업로드 후 승인된 테스터 1명에 대한 분배 응답과 등록을 확인했다.
  원격 APK의 SHA-256은 로컬 원본
  `652582663176a3e389b220ad3059e2536f61c41775dcc15e392aad1d70890787`와 일치한다.
- 빌드 9 TestFlight는 `VALID / IN_BETA_TESTING`, 기존 승인 내부 그룹의 빌드 연결·테스터
  존재·정확한 한국어 테스트 안내를 확인했다. Xcode 업로드 후에도 canonical archive
  전체 해시는 원래 manifest와 같고, 업로드 메타데이터는 독립 작업 복사본에만 추가됐다.
  양 플랫폼의 private `finalization.json` 및 서명·검증·화면 증거는 Git 밖에 보존했다.
  이는 테스터의 실제 설치·로그인 성공 또는 iOS 실기기 실행의 증거가 아니다.

실제 발급 credential이 없는 상태에서 테스트 대역의 성공을 사용자 로그인 성공이나
QA 인증 API 왕복으로 보고하지 않는다. 합성 credential·계정·응답은 배포 APK/IPA에 포함하지 않는다.
