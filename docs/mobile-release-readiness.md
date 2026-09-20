# 모바일 배포·Production 준비 상태

2026-09-20. [제품 구성 교체](mobile-product-progress.md)와 함께 확인한 실제 준비 상태다.
QA·Prod는 같은 제품 소스를 사용하고 환경·식별자·서명만 분리한다. 테스트 배포 완료,
서버 기능 완료, Production 스토어 출시를 서로 대신하는 증거로 사용하지 않는다.

## QA 검증과 배포 경로

- public `Mobile foundation` CI는 양 OS의 QA/prod 구성, 상태 시험, 배포 도구와 산출물
  검사를 자동 실행한다. PR 작업에는 실제 배포 자격증명을 제공하지 않는다.
- 승인된 로컬 Mac의 별도 서명 설정으로 APK/AAB와 iOS Archive/IPA 생성이 검증됐다.
  도구는 QA 식별자·API origin·버전·서명·소스 커밋·해시·제품 fixture 제외를 검사한다.
- iOS는 앱 전용 화면 모드 저장에 사용하는 UserDefaults를 `PrivacyInfo.xcprivacy`의
  `CA92.1`로 선언한다. 현재 구성은 추적 SDK나 원격 데이터 수집을 연결하지 않았다.
  선언 파일이 실제 app/IPA에 들어 있는지도 검사한다. API/분석 SDK를 연결할 때 실제
  데이터 흐름에 맞춰 이 선언과 스토어 개인정보 정보를 다시 검토한다.
- Android 서명/R8 산출물을 API 36.1의 격리된 읽기 전용 에뮬레이터에서 실행했다.
  탭/뒤로가기·설정·앱 정보·라이선스·화면 모드 재실행 복원·실제 OS 알림 설정 이동과
  글자 200% 표시를 확인했다. 이는 물리 기기·TalkBack·모든 지원 OS의 검증을 대신하지 않는다.
- Firebase 업로드 뒤 승인된 비공개 테스터 목록으로 분배하고 원격 APK 해시와 등록 상태를
  확인한다. TestFlight는 `VALID` 처리, 기존 내부 그룹의 빌드 접근, 한국어 테스트 내용을 확인한다.
  개인 식별자가 있는 manifest/영수증/스크린샷은 Git 밖에 둔다.

현재 로컬 도구의 실제 사용 절차는 [테스트 배포](mobile-test-distribution.md),
서명 비밀 취급은 [키체인 보호](mobile-signing-security.md)를 따른다.
UserDefaults 선언 근거는 [Apple required-reason API 문서](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype)다.

## Production 서명과 등록

| 항목 | 확인된 준비 | 남은 준비·검증 |
|---|---|---|
| Android | `chat.rogi.rogichat` prodRelease, Prod API origin, min29/target37, R8 및 패키지 검사 통과 | 의도적으로 unsigned. 전용 Prod/upload key, Play 앱·Play App Signing 및 업로드 권한, 별도 외부 Prod 설정의 검증 증거 없음 |
| iOS 앱 구성 | `Rogichat-Prod` Release-Prod, `chat.rogi.rogichat`, iPhone 전용·Prod API origin 검사 통과 | 현재 인증 계정에서 정확히 일치하는 Prod Bundle ID/App Store Connect 앱 조회 결과 0개 |
| iOS 서명 | 기존 배포 인증서와 대응 로컬 개인 키가 사용 가능하며 2027-09-19 UTC까지 유효 | Prod Bundle ID에 연결된 provisioning profile·외부 Prod 설정 없음. 새 인증서 발급 자체가 필수라고 판단하지 않음 |
| Apple 권한 | 현재 API 인증으로 앱/Bundle ID/프로파일 조회 성공 | 등록 생성·변경 권한은 읽기만으로 확인되지 않음. Production 리소스를 쓰기 시험으로 생성하지 않음 |
| native 기능 등록 | 환경별 app ID와 endpoint가 코드에 고정됨 | Apple 로그인, Services ID, native callback/association, APNs 및 관련 capability·entitlement는 계약/운영 등록 후 연결 |

Apple API의 `filter[identifier]` / `filter[bundleId]`는 접두사가 겹치는 QA 레코드를 반환할 수
있었다. **응답 개수만으로 앱을 판정하지 않고 실제 identifier/bundleId의 정확한 일치**를
확인한다. QA 도구를 ID 상수만 바꾸어 Production 도구로 사용하지 않는다.

QA APK/AAB는 Production Play 앱에 업로드하지 않는다. QA iOS export는 내부 TestFlight
전용이므로 외부 테스트·스토어 제출용으로 승격할 수 없다. 검증된 소스를 별도의 검토된
`main` 승격 절차를 거쳐 Prod 구성으로 다시 빌드하고, 정확한 앱 등록/서명/profile과
스토어 제출 가능한 export 정책을 별도 확인해야 한다. 이 점검은 스토어 제출을 실행하지 않는다.

## 반복 배포 자동화의 경계

현재 public CI는 검증 전용이다. 점검 시 모바일 배포 trigger/환경과 전용 trusted Mac
release worker가 등록돼 있지 않았다. 로컬 서명 성공을 무인 CI 배포 준비 완료로 간주하지 않는다.
인프라 조정자에게 다음 구현·운영 경계를 전달했다.

1. private workflow 또는 통제된 Mac 서비스가 필수 CI를 통과한 merged-QA의 불변 SHA만
   받아 재빌드한다. 공개 PR checkout/artifact에서 자격증명 보유 작업을 실행하지 않는다.
2. Git 밖의 배타 lock과 SHA/build별 journal로 동일 소스 중복 업로드·빌드 번호 충돌을 막는다.
   Android/iOS 번호와 기존 원격/로컬 번호를 대조하고 완료 단계는 재실행하지 않는다.
3. 현재 서명·검증 도구를 재사용하고 Firebase 분배/해시 확인, TestFlight processing/그룹/노트
   확인을 후속 단계로 자동화한다. iOS의 이미 시도한 업로드를 맹목적으로 재전송하지 않는다.
4. Production은 별도 reviewed-main lane, 외부 설정, 정확한 앱 등록/서명, 별도 산출물 경로를
   사용한다. QA 보호 검사를 건너뛰는 옵션으로 구현하지 않는다.

## 실제 서비스 연결 블로커

네이티브 인증·앱 복귀·세션 수명은 [계약 C01/C02/C03/C08](mobile-implementation-plan.md)에
남아 있다. 현재 웹 cookie/Origin/CSRF와 SOOP 웹 redirect를 앱 credential로 취급하지 않는다.
첫 native 버전은 폐기 가능한 opaque session과 만료 시 재인증으로 시작할 수 있으며,
존재하지 않는 refresh API를 선행 조건으로 강제하거나 임의 호출하지 않는다.

API 가동 여부는 QA `api.qa.rogi.chat`과 Prod `api.rogi.chat`의 실제 경로로 검증하고
인프라 조정자가 소유한다. HTTP health 성공만으로 native 인증 계약이나 채팅 왕복을 완료로
집계하지 않는다. 데이터가 없는 성공 응답은 빈 상태, 연결 실패는 오류/재시도로 처리하고
제품에 가짜 계정·메시지·저장 성공·서버 기능 진단용 상태 선택기를 제공하지 않는다.

2026-09-20 모바일 세션의 독립 재확인에서 QA `/live`는 `200 {status:ok}`, `/ready`는
`200 {status:ready}`, 인증 정보 없는 `/v1/auth/session`은 `401`이었다.
이전 503 관측 이후 QA 경로가 살아난 증거이며, 앱 credential 발급·로그인 성공의 증거는 아니다.
