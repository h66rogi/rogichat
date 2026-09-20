# 네이티브 SOOP 인증 구현과 운영 준비

2026-09-20. MB03 SOOP 클라이언트와 QA 서명 경계를 구현했다. 이 기록은 제공자 로그인 성공이나
MB03 전체 완료를 의미하지 않는다. [통합 계획](mobile-implementation-plan.md)의
meloming 구현 재사용·QA/prod 공통 제품·합성 데이터의 테스트 격리 원칙을 유지한다.

Android 구현 `3fa9ea8`은 독립 검토와 QA 91개/Prod 83개 단위 시험을 통과해 통합했다.
QA lint·Prod 컴파일과 QA APK의 실제 App Link filter·환경·서명 검사를 통과했다.
iOS 구현 `6e5ffa0`과 합친 제품 소스에서 아래 검증을 마쳤다. 새 서명 배포 결과는
실제 외부 검증이 끝난 뒤 별도로 기록한다.

- Android QA/Prod Debug/Release 네 구성, R8·resource shrink·전체 lint·패키지의 환경/링크/fixture
  제외 검사 통과. 테스트 값은 시험 소스에만 있으며 제품에 계정·proof를 주입하지 않았다.
- Android API 36.1의 격리된 읽기 전용 에뮬레이터에서 계측 시험 7개 통과(skip 0).
  실제 비추출 KeyStore 키·AtomicFile로 pending proof 복원, 환경 AAD·변조·크기 제한,
  영속 소비 후 오래된 암호문 거부, logout clear stamp 변경을 검증했다. 기존 credential
  저장·Activity 재생성도 포함한다. 시험 전용 UUID 경로/키만 사용하고 소유 emulator를 종료했다.
- iOS QA/Prod Debug/Release 네 구성을 iPhone 기기 SDK로 빌드하고 개인정보·제품 fixture
  제외·식별자·최소 OS를 검사했다. Xcode GUI/Simulator는 사용하지 않았다.
- 공통 runner에서 Swift 6 strict concurrency 실행 파일 네 종(탐색·제품 상태·native transport·
  SOOP auth)을 통과했다. 실제 iPhone Keychain·접근성·provider 왕복 결과를 대신하지 않는다.
- 독립 코드 리뷰에서 선예약 이전/설치 이후 취소, 브라우저 operation 전달, 만료 timer 자기
  취소, cold LINK 오류와 최신 세션 보호를 수정하고 회귀 시험을 추가했다. 해당 범위의
  잔여 P1/P2는 없으며 외부 활성화 gate는 유지한다.

## 고정된 이전 단계

QA `d98ff28`은 네이티브 세션·프로필 adapter `1478765`를 포함한다.
실제 분배된 빌드 9의 소스 `d4be7bd`와 해당 QA 커밋의 `apps/android`, `apps/ios`는
동일하다. PR #28의 Android/iOS 필수 검사는 모두 통과했다.
빌드 9의 Firebase 원격 APK 해시·승인 테스터 분배, TestFlight `VALID`와 기존 내부
그룹의 `IN_BETA_TESTING`은 확인됐다. 빌드 9에는 아직 제공자 인증 발급 기능이 없다.

## 구현 계약과 계정 경계

서버 후보 `de02c6a`의 실제 controller/service/회귀 시험을 기준으로 구현한다.
start의 `intent`는 `login`/`link`이며, `login`은 공개 요청과 이용 안내
`2026-09-20`의 명시적 동의를 사용한다. `link`의 start/exchange는 시작 시점의 동일한
native Bearer에 묶인다. 웹 cookie·Origin·CSRF·URL에 포함된 token을 재사용하지 않는다.

- 독립 난수의 PKCE S256과 return state, 환경별 정확한 authorize URL/HTTPS callback을
  검증한다. 중복/추가 query·다른 origin/path·틀린 state를 수용하지 않는다.
- 제한 시간은 서버의 transaction 600초, launch 60초, completion 120초다.
  교환은 한 번만 수행하고 응답을 잃으면 동일 코드를 자동 재전송하지 않는다.
- pending proof는 보호 저장한다. 교환 전과 새 credential 저장 전에 계정·취소·세션
  경계를 재검사한다. 로그아웃 이후의 늦은 성공은 새 credential만 폐기하며 현재 계정을
  바꾸거나 되살리지 않는다.
- 서버 callback은 검증된 identity를 transaction에 저장한다. 계정 연결·새 credential
  발급·이전 LINK 세션 폐기는 exchange 트랜잭션에서 수행한다. cold LINK 복귀도 원래
  계정/credential에 계속 묶인다.
- `LINK_SESSION_CHANGED`는 해당 인증 시도만 종료하며 더 최신 credential을 지우지 않는다.
  충돌은 계정을 덮어쓰지 않는다. 이용 안내/최근 인증 오류를 자동 `link → login`으로
  바꾸지 않고 사용자가 명시적으로 재로그인 경로를 선택하도록 한다.
- UI는 웹의 검토된 이용 안내와 `/rules`를 따른다. 확정되지 않은 법적 약관이나
  Apple 로그인·계정 삭제 성공을 만들어내지 않는다.

추가 계약 `4002329`의 `session.accountPartition`은 있을 때 canonical base64url
32바이트로 검증하고 없던 응답도 수용한다. 기존 `account.userId` UUID와 프로필 binding은
유지하며 이 값을 credential이나 revocation generation으로 사용하지 않는다. 알려진
필드의 타입/필수값을 검사하되 session의 호환 가능한 추가 필드는 거부하지 않는다.

## QA 서명 준비

기존 QA Bundle ID에 [Associated Domains capability](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleidcapabilities)를
추가하고 재조회했다. 기존 배포 인증서를 사용한 새 `IOS_APP_STORE` profile을 생성했다.
CMS 내부 app/team/certificate, associated-domain permission, 배포 종류와 유효기간을
검증하고 로컬 프로파일·외부 QA export 설정에 반영했다. 기존 프로파일/빌드 9는 보존한다.
프로파일·Apple 계정 식별자·인증서 자료·API 응답은 공개 Git 밖에 보관한다.

서명 검사 도구는 실제 archive/IPA에서 `applinks:qa.rogi.chat`과
`webcredentials:qa.rogi.chat` 두 값만 허용한다. 프로젝트 텍스트만으로 완료 판정하지 않는다.
archive의 development profile과 TestFlight IPA의 distribution profile을 구분하며,
IPA는 정확한 QA app ID, 디버깅 불가, 기기 제한 없는 배포 profile이어야 한다.
빌드 10의 실제 archive와 exported IPA에서 이 검사를 통과했다. Apple의 업로드 전
검증도 통과했으며 제공자 로그인·실제 iPhone 복귀 검증과는 구분한다.

Android는 실제 APK의 compiled manifest를 읽어 같은 환경의 HTTPS host와 정확한
`/mobile/auth/complete`, 단일 `autoVerify` filter, 활성화된 exported MainActivity를
검사한다. 다른 meta-data에 같은 문자열이 있는 것으로 통과하지 않는다. 비활성화나
추가 permission으로 브라우저 진입이 막힌 app/activity도 거부한다. 최종 QA debug APK에
검사를 적용했다. 빌드 10의 실제 signed QA release APK에도 같은 검사를 통과했다.

배포 도구의 순수 검증과 격리 Keychain 검증은 83개를 통과했다(skip 0).

## iOS 빌드 10·Android 빌드 11의 외부 검증

제품 소스는 `80940d4d4924d34fef3c054de59c92c2193b30d6`이며 양 OS의 manifest가
같은 커밋과 `source_dirty:false`를 기록한다. PR #41의 해당 소스에 대한 Mobile required checks를 포함한
필수 CI가 모두 통과했다. Android APK/AAB와 iOS archive/IPA 서명·환경·제품 guard를
검증했다. iOS는 1회 업로드 후 `VALID`와 승인된 기존 내부 그룹의 `IN_BETA_TESTING`,
한국어 안내를 재조회했다. 정본 archive는 업로드용 복사본과 분리해 해시를 보존했다.

QA 공개 AASA/assetlinks를 HTTPS `200`, redirect 없음, `application/json`, `no-store`로
독립 확인했다. AASA의 QA app ID·webcredentials·정확한 callback 경로, assetlinks의 QA
package와 빌드 10 실제 APK 서명 지문도 일치한다. 설치된 Android의 domain verification은
`qa.rogi.chat: verified`였다. 물리 iPhone·SOOP provider 왕복까지 검증한 것은 아니다.

Android 빌드 10의 실제 오류 화면에서 상태 표시줄과 인증 안내가 겹치는 문제를 발견해
Firebase 업로드를 보류했다. 배너가 있을 때만 custom top bar에 safeDrawing의 상단·좌우
inset을 적용하고, NavHost가 이미 적용한 Scaffold inset을 소비해 중첩 화면의 중복 여백도
방지한다. [Android 공식 inset 안내](https://developer.android.com/develop/ui/compose/system/material-insets)를
따르며 과거 산출물을 덮어쓰지 않았다.

수정 소스 `fe07bcfbb42b52866d1ab521818c984ff081fbc0`의 PR #41 필수 CI는 모두 통과했다.
Android 빌드 11의 signed APK/AAB와 실제 설치 버전을 확인했고, 글자 200%의 세로/가로
화면에서 오류 안내와 상태 표시줄 분리, 닫기, 본문 스크롤을 통한 로그인 버튼 접근, 설정
이동을 검증했다. 앱의 fatal crash 기록은 0개였다. 초기 에뮬레이터 OS 응답 지연은 별도로
기록했으며 앱·OS 전체 안정성을 검증했다는 뜻은 아니다. 소유한 읽기 전용 emulator는 종료했다.

빌드 11의 Firebase 원격 APK 해시 일치·승인 테스터 분배·등록을 재조회했다. Android 빌드
10은 업로드하지 않고 보존했다. iOS 빌드 10의 앱 소스는 `fe07bcf`와 동일하며 Android
레이아웃 수정 때문에 같은 iOS 앱을 다시 올리지 않았다. 테스트 배포와 실제 계정 왕복은
별개다. 인증·멤버십·채팅의 미완료 gate는 아래에 남긴다.

## 계속 남는 실제 gate

- SOOP broker는 canonical immutable subject 계약·운영 등록·실제 사용자 증거가 없으면
  `SUBJECT_CONTRACT_UNVERIFIED`를 반환하며 앱 경계에서는 `AUTH_UNAVAILABLE`다.
  실제 provider 검증 없이 설정으로 우회하거나 성공 응답으로 대체하지 않는다.
- QA 공개 association과 서명 일치는 확인했다. 실제 기기/provider 복귀는 후속 검증이며
  API health 200과 profile 생성만으로 OAuth 성공을 주장하지 않는다.
- Apple 로그인·계정 삭제·native push의 미확정 계약은 별도로 추적한다.
- Prod app 등록/서명/Play 및 App Store 권한은 [배포 준비 상태](mobile-release-readiness.md)의
  별도 경로다. QA 내부 배포 artifact를 Prod artifact로 승격하지 않는다.
