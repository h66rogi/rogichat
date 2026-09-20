# 모바일 배포·Production 준비 상태

2026-09-20. [제품 구성 교체](mobile-product-progress.md)와
[네이티브 세션·프로필 연결](mobile-native-transport-progress.md)의 준비 상태다.
후속 [SOOP 인증 구현](mobile-native-auth-progress.md)의 서명·도메인 준비도 함께 추적한다.
실제 [계정 알림 설정](mobile-notification-preferences-progress.md)은 빌드 12로 배포했다.
이어지는 [방 저장소 단계](mobile-rooms-progress.md)는 빌드 13으로 내부 배포했다.
QA·Prod는 같은 제품 소스를 사용하고 환경·식별자·서명만 분리한다. 테스트 배포 완료,
서버 기능 완료, Production 스토어 출시를 서로 대신하는 증거로 사용하지 않는다.

## QA 검증과 배포 경로

- public `Mobile foundation` CI는 양 OS의 QA/prod 구성, 상태 시험, 배포 도구와 산출물
  검사를 자동 실행한다. PR 작업에는 실제 배포 자격증명을 제공하지 않는다.
- 승인된 로컬 Mac의 별도 서명 설정으로 APK/AAB와 iOS Archive/IPA 생성이 검증됐다.
  도구는 QA 식별자·API origin·버전·서명·소스 커밋·해시·제품 fixture 제외를 검사한다.
- iOS는 화면 모드 저장용 UserDefaults `CA92.1`과, 프로필 API의 닉네임·생일 월/일·공개
  설정에 해당하는 User ID/Other Data Types를 선언한다. 계정에 연결된 앱 기능 목적이며
  추적은 없다. 선언 파일과 정확한 내용이 실제 app/IPA에 들어 있는지도 검사한다.
  이는 빌드 8의 로컬 설정만 있던 선언에서 변경된 부분이다. 스토어 제출 전 실제 기능
  범위에 맞춰 App Store Connect 개인정보 입력도 확인한다.
- 방 저장소 단계는 인증된 동기화 요청에 설치 UUID를 보내므로 Device ID도 계정 연계·
  앱 기능 목적·추적 없음으로 선언한다. 실제 경로의 로그 제외 설정을 확인했지만 미보관
  예외를 단정하지 않는다. 추가 GRDB SDK의 privacy bundle과 원본 MIT 고지를 실제
  app/IPA에서 확인한다. 이 변경은 빌드 12 이후 소스에 적용된다.
- Android 서명/R8 산출물을 API 36.1의 격리된 읽기 전용 에뮬레이터에서 실행했다.
  탭/뒤로가기·설정·앱 정보·라이선스·화면 모드 재실행 복원·실제 OS 알림 설정 이동과
  글자 200% 표시를 확인했다. 이는 물리 기기·TalkBack·모든 지원 OS의 검증을 대신하지 않는다.
- Firebase 업로드 뒤 승인된 비공개 테스터 목록으로 분배하고 원격 APK 해시와 등록 상태를
  확인한다. TestFlight는 `VALID` 처리, 기존 내부 그룹의 빌드 접근, 한국어 테스트 내용을 확인한다.
  개인 식별자가 있는 manifest/영수증/스크린샷은 Git 밖에 둔다.

빌드 8·9는 Android 승인 테스터 분배·원격 APK 해시 일치와 iOS `VALID`·기존 내부 그룹의
`IN_BETA_TESTING`까지 확인했다. 테스터 설치·실제 로그인 성공을 의미하지 않는다.

후속 SOOP 클라이언트는 Android 빌드 11(`fe07bcf`)의 승인 테스터 분배·원격 해시,
iOS 빌드 10(`80940d4`, iOS 앱 소스는 `fe07bcf`와 동일)의 `VALID`·기존 내부 그룹
`IN_BETA_TESTING`·한국어 안내를 확인했다. Android 빌드 10은 실제 화면에서 inset 문제를
발견해 업로드하지 않았으며 11에서 수정 후 글자 200%의 세로/가로 표시를 재검증했다.

계정 알림 설정은 양 OS 빌드 12(`1d5ecfd`)의 서명·검증·내부 배포를 마쳤다. Android의
원격 APK 해시와 승인 테스터 배포 응답, iOS의 Apple validation·`VALID / IN_BETA_TESTING`·
한국어 안내·기존 내부 그룹을 확인했다. 해당 PR의 필수 CI도 통과했다. 실제 provider가 발급한
계정의 설정 영속 왕복이나 native push 등록/전달 성공을 의미하지 않는다.

방 목록·계정별 SQLite는 양 OS 빌드 13(`d458f43`)의 실제 서명·내부 배포를 마쳤다.
PR #58의 필수 CI와 새 Android hosted 기기 저장소 시험 16개가 통과했고, Firebase의
원격 APK 해시·승인 테스터 응답과 TestFlight의 `VALID / IN_BETA_TESTING`·한국어 안내·
내부 그룹을 확인했다. 이 빌드는 방 참여/나가기·메시지 전송 완료를 뜻하지 않는다.

방 참여·나가기는 고정 소스 `649c02c`의 전체 hosted CI를 통과했다. iOS 빌드 14는
Apple validation·`VALID / IN_BETA_TESTING`·한국어 안내·기존 내부 그룹까지 확인했다.
Android 빌드 14는 서명 APK/AAB 검증을 마쳤지만 Firebase 인증 만료로 업로드 전 조회에서
중단돼 재인증을 기다린다. 이를 Android 배포 완료로 집계하지 않는다.

인증 PR #41과 알림 PR #51은 일반 병합으로 QA `cf54f2438971fd82227c0f044659bd80993cd9e2`에
통합됐고 원격 ref 및 QA push의 모바일·백엔드·보안·인프라·웹 필수 검사를 확인했다.
기존 서명 앱 소스는 바뀌지 않아 중복 업로드하지 않았다. 방 저장소/명령의 PR #58/#64는
별도 workflow trust 검토 대상이며 이 병합으로 서버 schema 2가 활성화되지 않는다.

현재 로컬 도구의 실제 사용 절차는 [테스트 배포](mobile-test-distribution.md),
서명 비밀 취급은 [키체인 보호](mobile-signing-security.md)를 따른다.
UserDefaults 선언 근거는 [Apple required-reason API 문서](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype)다.

다음 실제 TEXT 전송 묶음은 계정에 연결된 메시지 본문·수신자·인용 식별자를 서버로 보낸다.
iOS manifest와 실제 앱/IPA 검사는 기존 선언에 `EmailsOrTextMessages`, linked=true,
tracking=false, AppFunctionality를 함께 추가해야 한다. 이 분류는 발신자·수신자·본문을
포함한다는 [Apple의 수집 데이터 정의](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype)에 따른다.
Play의 대응 분류는 [Data safety의 Other in-app messages](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)다.
실제 스토어 공개 설명·수집/공유 답변도 연결해 확인하며, manifest 변경을 스토어 설정 완료로
집계하지 않는다. 아직 전송하지 않는 사진/동영상 업로드까지 구현됐다고 선언하지 않는다.

## Production 서명과 등록

| 항목 | 확인된 준비 | 남은 준비·검증 |
|---|---|---|
| Android | `chat.rogi.rogichat` Prod 구성·R8 검사, Git 밖의 별도 RSA 3072 PKCS12 upload key/인증서와 외부 Prod 설정 준비 | 새 키를 사용한 실제 Prod APK/AAB 빌드·서명 검증, Play 앱 등록·Play App Signing·업로드 권한 확인 |
| iOS 앱 구성 | `Rogichat-Prod` Release-Prod와 정확한 `chat.rogi.rogichat` Bundle ID 생성·재조회 완료 | App Store Connect의 정확한 Prod 앱 레코드는 아직 없음. 기존 CLI의 앱 등록 세션도 확인되지 않음 |
| iOS 서명 | 유효한 기존 배포 인증서/로컬 개인 키와 연결된 별도 Prod App Store profile, 외부 Prod 설정 준비 | 실제 Prod archive/IPA의 서명·entitlement·App Store 검증은 새 기능 묶음에서 실행 |
| Apple capability | QA/Prod 모두 Associated Domains·Apple 로그인·Push capability와 별도 Capabilities v2 App Store profile 생성·재조회·설치 완료 | 프로파일의 Apple Default·aps production 허용은 실제 앱 entitlement나 provider 전달 성공의 증거가 아님 |
| native 기능 등록 | 기존 QA HTTPS callback 서명·AASA/assetlinks 검증, QA/Prod v2 profile의 정확한 bundle/team/cert 연결 및 외부 설정 참조 확인 | Apple Services ID·APNs/FCM provider 설정·실제 기기 복귀와 알림 전달은 별도 검증 |

Apple API의 `filter[identifier]` / `filter[bundleId]`는 접두사가 겹치는 QA 레코드를 반환할 수
있었다. **응답 개수만으로 앱을 판정하지 않고 실제 identifier/bundleId의 정확한 일치**를
확인한다. QA 도구를 ID 상수만 바꾸어 Production 도구로 사용하지 않는다.

QA APK/AAB는 Production Play 앱에 업로드하지 않는다. QA iOS export는 내부 TestFlight
전용이므로 외부 테스트·스토어 제출용으로 승격할 수 없다. 검증된 소스를 별도의 검토된
`main` 승격 절차를 거쳐 Prod 구성으로 다시 빌드하고, 정확한 앱 등록/서명/profile과
스토어 제출 가능한 export 정책을 별도 확인해야 한다. 이 점검은 스토어 제출을 실행하지 않는다.

## 반복 배포 자동화의 경계

현재 public CI는 검증 전용이다. 점검 시 모바일 배포 trigger/환경과 전용 trusted Mac
release worker가 등록돼 있지 않았다. 인프라 조정자는 우선 명시적 로컬 운영자 경로를
유지하기로 했다. 로컬 서명 성공을 무인 CI 배포 준비 완료로 간주하지 않는다.

PR #22의 `android-finalize`·`ios-finalize`는 PR #20과 함께 QA `90a73e1`에 병합됐다.
기존 업로드 후 분배/해시 확인과
TestFlight 처리/그룹/한국어 안내 확인을 자동화한다. 빌드별 배타 잠금과 fsync journal,
불변 입력으로 중복 변경을 막고, 불확실한 업로드·분배는 맹목적으로 반복하지 않는다.
실제 빌드 8의 완료 확인 뒤 재실행이 원격 읽기만 수행하는 것도 검증했다.
Xcode가 업로드 중 메타데이터를 쓰는 아카이브는 독립 작업 복사본으로 분리했다.
이는 상주 runner·빌드 번호 할당·QA merge trigger를 설치한 것이 아니다.

산출물 재확인은 해당 제품 버전의 검토된 검사 정책으로 실행한다. 빌드 8은 로컬 설정만
사용하는 개인정보 선언이므로 후처리 도구 `ea83a5b`로 확인한다. native 프로필 연결 이후의
도구는 새 수집 선언을 요구하며 빌드 8을 의도적으로 거부한다. 과거 산출물을 재확인하려고
새 빌드의 검사를 완화하거나 기존 manifest·아카이브를 수정하지 않는다.
SOOP 앱 복귀용 권한을 추가하기 전의 빌드 9는 도구 `1478765`로 재확인한다.
계정 알림 빌드 12는 도구 `1d5ecfd`로 재확인한다. 후속 rooms의 설치 식별자 전송·DB 의존성
검사는 새 소스와 새 artifact에 적용하며, 과거에 포함되지 않은 수집/라이브러리를 가정하지 않는다.
MB03의 서명 검사는 실제 archive/IPA의 두 QA callback entitlement와 profile의 app/team,
만료, IPA의 배포 종류를 추가로 요구한다. 과거 서명 산출물에 없는 권한을 있다고 취급하지 않는다.

인프라 조정자에게 다음 후속 운영 경계를 전달했다.

1. private workflow 또는 통제된 Mac 서비스가 필수 CI를 통과한 merged-QA의 불변 SHA만
   받아 재빌드한다. 공개 PR checkout/artifact에서 자격증명 보유 작업을 실행하지 않는다.
2. Git 밖의 배타 lock과 SHA/build별 journal로 동일 소스 중복 업로드·빌드 번호 충돌을 막는다.
   Android/iOS 번호와 기존 원격/로컬 번호를 대조하고 완료 단계는 재실행하지 않는다.
3. 현재 서명·검증 및 업로드 후 확인 도구를 통제된 실행 경로에서 호출한다.
   iOS의 이미 시도한 업로드를 맹목적으로 재전송하지 않는다.
4. Production은 별도 reviewed-main lane, 외부 설정, 정확한 앱 등록/서명, 별도 산출물 경로를
   사용한다. QA 보호 검사를 건너뛰는 옵션으로 구현하지 않는다.

## 실제 서비스 연결 블로커

고정 7일 native credential, 세션 조회, 프로필 GET/PATCH, 현재 credential 로그아웃 계약은
커밋 `ac69ca2`로 확정됐고 양 OS 실제 HTTP/보호 저장소 adapter를 연결했다.
제공자 인증을 통한 credential 발급·SOOP 연결·앱 복귀·Apple 로그인·탈퇴는
[계약 C01/C02/C03/C08](mobile-implementation-plan.md)의 후속 구현·운영 등록이 필요하다.
웹 cookie/Origin/CSRF와 SOOP 웹 redirect를 앱 credential로 취급하지 않는다.
만료 시 재인증하며 존재하지 않는 refresh API를 호출하지 않는다. 최초 설치에는
credential이 없으므로 가짜 계정이나 QA 전용 로그인으로 이 선행 조건을 건너뛰지 않는다.

API 가동 여부는 QA `api.qa.rogi.chat`과 Prod `api.rogi.chat`의 실제 경로로 검증하고
인프라 조정자가 소유한다. HTTP health 성공만으로 native 인증 계약이나 채팅 왕복을 완료로
집계하지 않는다. 데이터가 없는 성공 응답은 빈 상태, 연결 실패는 오류/재시도로 처리하고
제품에 가짜 계정·메시지·저장 성공·서버 기능 진단용 상태 선택기를 제공하지 않는다.

2026-09-20 모바일 세션의 독립 재확인에서 QA `/live`는 `200 {status:ok}`, `/ready`는
`200 {status:ready}`, 인증 정보 없는 `/v1/auth/session`은 `401`이었다.
이전 503 관측 이후 QA 경로가 살아난 증거이며, 앱 credential 발급·로그인 성공의 증거는 아니다.

QA native 인증은 서버 `397d2f0b59868c1a0579c92ef74a1852c5ce66e6` 배포로
transaction·launch·completion-exchange 경로가 활성화됐다. 실제 provider의 최종 인증과
네이티브 credential 발급·기기 간 채팅은 아직 별도 검증 대상이다. 진행 중인 native23,
Apple·미디어·채팅 전체 계약을 이 배포로 활성화됐다고 간주하지 않는다.
