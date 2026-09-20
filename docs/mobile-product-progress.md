# 모바일 제품 구성 교체

2026-09-20. [통합 계획](mobile-implementation-plan.md) MB02의 교체 구현이다.
멜로밍의 적용 가능한 실제 화면·기능 구현을 수정 재사용한다. 이전 QA 미리보기 앱의
확장이나 로그인·채팅 통합 완료로 취급하지 않는다.

이 문서는 **빌드 8의 교체 범위**를 기록한다. 후속 실제 세션·프로필 adapter 작업은
[네이티브 연결 기록](mobile-native-transport-progress.md)을 따른다. 아래 블로커의 기준은
교체 시점이며, 후속 계약 확정만으로 실제 로그인 성공을 집계하지 않는다.

## 바뀐 제품 구성

- Android는 `src/main/AppEntry`, iOS는 `RogichatApp → ProductRootView` 한 경로를
  QA/prod가 공유한다. 환경별 endpoint·식별자·서명 분리는 유지한다.
- 배포 소스의 QA host, 역할·이용 상태 선택, 합성 계정/방, 가짜 채팅과 미리보기 종료를
  제거했다. 유용한 순수 상태 fixture는 Android `src/testQa`, iOS `Tests/Fixtures`로 이동했다.
- 멜로밍 탐색/설정 화면 구조를 가져와 대화·설정 탭과 설정 상세를 구성한다.
  설정의 프로필 영역·그룹별 메뉴·아이콘·간격·기본 상태 처리를 함께 재사용한다.
- 화면 모드는 시스템/라이트/다크 선택을 실제 로컬 설정에 저장한다. 알림은 실제 OS
  상태를 읽고 시스템 설정을 열며 앱 복귀 때 다시 조회한다. 서버 알림 선호/기기 등록이
  성공했다고 표시하지 않는다. 버전은 실제 빌드 정보에서 읽는다.
- 프로필은 표시 이름·선택 생일 월/일·스트리머 공개 범위를 편집한다. 저장 중 입력 차단,
  오류 표시, 미저장 변경 취소 확인을 구현한다. 서버 `UpdateProfileDto`와 같은 NFC/trim/
  Unicode scalar 길이, 2월 29일 포함 날짜 규칙과 변경 없음/명시적 삭제를 구분한다.
- 계정 관리의 연결·로그아웃·탈퇴는 실제 adapter가 제공하는 작업만 노출한다.
  비동기 응답이 다른 계정이나 종료된 화면에 적용되지 않도록 상태 범위를 분리한다.
  실제 로그인/저장/탈퇴 API 연결 완료를 의미하지 않는다.
- 작동하지 않는 약관·문의·저장 버튼과 개발용 provider/서버 상태 설명 행을 제거했다.
  계정 기능을 테스트하려고 합성 계정으로 진입하는 배포 메뉴를 만들지 않는다.

원본별 파일·심볼과 수정/신규 구분은 [재사용 ledger](mobile-reuse-audit.md)에 기록한다.
탐색 상태의 전체 신규 구현을 원본 `AppRouter` 이식으로 집계하지 않으며, 로그인 화면의
일부 표현 재사용을 로그인 기능의 이식 완료로 집계하지 않는다.

## 배포 경계

`tools/mobile/product_guards.py`가 공통 entry point와 제품 소스의 fixture 제외를 검사한다.
이 검사는 unsigned 빌드뿐 아니라 서명 APK/AAB, iOS archive/IPA와 업로드 직전 검사에도
적용된다. QA fixture 포함을 요구하던 이전 검사는 폐기했다. 두 환경 모두 기존 합성 host,
샘플 방/역할 선택기/미리보기 진입 문자열을 포함하면 실패한다.

fixture를 DEX 추가 파일, 앱 리소스, iOS debug dylib/Framework, IPA에 다시 넣는 변형 검사를
포함한다. 플랫폼 자체 Preview API나 일반 메시지 미리보기 기능을 일괄 금지하지 않는다.
이 검사가 임의의 모든 가짜 기능을 자동 판별하는 것은 아니므로 화면 코드 리뷰도 함께 수행한다.

iOS는 실제 화면 모드 저장에 필요한 UserDefaults 사용 사유 `CA92.1`을 개인정보 manifest에
선언하고 app/IPA의 포함 여부와 내용을 검사한다. Apple 앱 검색은 접두사 일치를 허용하지
않고 반환된 identifier/bundleId의 정확한 일치를 확인한다. Prod 서명·운영 자동화의 실제
준비 상태와 잔여 항목은 [배포 준비 점검](mobile-release-readiness.md)에 기록한다.

## 독립 리뷰에서 보정한 경계

- Ready 상태는 실제 계정과 SOOP 연결을 요구한다.
- 로그아웃/계정 변경 시 private 화면과 저장 작업의 범위를 폐기한다. 이전 프로필·방 목록의
  늦은 응답이 새 계정에 나타나지 않게 한다.
- Android는 Activity가 보유한 session scope가 같은 경우 기기 회전 후에도 ViewModel을
  유지하며, generation/계정/접근 권한이 바뀌면 이전 store와 작업을 폐기한다.
- iOS는 세션 복구를 시작할 때 private 상태부터 지우고 늦은 쓰기 결과를 차단한다.
  복구 취소 후 busy가 풀리고 재시도가 가능하다.
- 프로필 저장은 중복 실행을 막고 서버 응답의 계정 ID를 확인한다. 프로필 응답으로
  인증 방식/SOOP 연결 상태를 갱신하지 않는다. 빈 ID·잘못된 이름/생일은 적용하지 않으며
  생일 picker도 잘못된 month에서 유효하지 않은 range를 생성하지 않는다.
- 로딩 실패 상태의 잘못된 동등성, 화면 모드 표시와 실제 선택의 불일치, 다크 모드의
  강조색 대비를 보정한다. 원본의 결함을 재사용 이유로 보존하지 않는다.

## 남은 통합 블로커

| 항목 | 현재 증거 | 계속 필요한 작업 |
|---|---|---|
| C01/C02/C08 네이티브 인증 | QA `0429d71`의 `modules/auth/auth.controller.ts`·`auth-context.ts`·`auth.service.ts`는 웹 cookie/Origin/CSRF, SOOP callback의 웹 redirect만 제공 | native credential·Apple 검증·PKCE/앱 복귀·만료 계약과 실제 adapter |
| C03 실제 계정/방 | default adapter는 계정을 생성하지 않고 SignedOut, 인증 capability 없음 | 실제 bootstrap/참여 인가 뒤 계정·방 저장/조회 연결 |
| 프로필/계정 명령 | `modules/users/dto/update-profile.dto.ts`, `users-core.service.ts`의 필드/검증은 확인; native 인증 transport 부재 | 실제 프로필 GET/PATCH, logout/delete 계약 연결·왕복 검증 |
| 채팅/미디어 | 원본 Talk/TalkV2는 이식하지 않음. room 목록은 별도 주입형 경계 | MB04–06의 실제 입장·메시지·영속 전송·복구 구현 |
| C09 알림 | 기기 알림 상태/설정 이동만 실제 동작 | 서버 선호·기기 binding·FCM/APNs 등록/전달/해제 |
| 정책/지원 | 확인된 로기챗 게시 주소·지원 경로 없음 | 실제 게시된 정책/지원으로 연결, legacy URL 승계 금지 |
| 기기 사용성 | Android API 36.1 읽기 전용 에뮬레이터에서 서명/R8 앱 실행·설정·재실행 저장·글자 200% 확인. 물리 Android/iPhone 미연결 | 지원 OS 실기기·다양한 화면·키보드·VoiceOver/TalkBack 확인 |

기본 제품은 `현재 버전에서는 앱 로그인을 지원하지 않아요.`라고 상태를 명시한다.
존재하지 않는 endpoint, 웹 Origin 위장, cookie 추출, 가짜 Apple/SOOP 성공으로 위 블로커를
우회하지 않는다. 따라서 이 교체 빌드는 **로그인해서 대화할 수 있는 MVP나 스토어 출시 완료가 아니다.**
사용자가 승인한 TestFlight/App Distribution은 구현된 제품 코드의 기기 검증 경로다.

## 검증 기록

- 서명 도구·배포 경계 Python 회귀 테스트 43개를 모두 통과했다. 개인정보 manifest·Apple
  앱 정확한 식별 검사를 추가했으며 macOS 일회용 keychain 검사도 실행했다.
- Swift 6 strict concurrency host 검사 통과: 기존 순수 상태/route race 및 새 제품 상태.
  생일/PATCH null, 중복 저장, 인증 메타데이터 보존, 로그아웃 중 늦은 저장, 잘못된 세션,
  SOOP gate, 미지원 로그인의 계정 생성 방지, 복구 중 쓰기·취소/재시도·잘못된 생일을 검사했다.
- 최종 iOS 소스의 Debug-QA/Release-QA/Debug-Prod/Release-Prod 4종 컴파일과 실제 앱의
  식별자·endpoint·최소 OS·iPhone 전용·서명 자료 제외·fixture 제외 검사를 모두 통과했다.
- Android QA/prod Debug/Release 4종과 Release R8/resource shrink, 엄격한 lint 및
  단위 테스트 60개(QA 34/prod 26, 실패·skip 없음)를 통과했다. 수동 화면 모드와 시스템
  표시줄 색의 불일치를 수정한 뒤 동일 전체 검사를 다시 통과했다.
- Android 서명 산출물의 실제 시작·설정/라이선스·dark 모드 재실행 복원·OS 설정 복귀와
  글자 200%를 추가 확인했다. OS가 아직 제공하지 않는 조작을 암시하던 알림 설명은
  현재 기기 설정의 확인 기능을 정확히 설명하도록 양 OS에서 수정했다.
- 제품 소스 guard, 공개 저장소 보안 scanner, 변경 Markdown의 상대 링크 검사를 통과했다.
  참조 저장소 두 곳은 수정하지 않았으며 API/DB·웹·인프라 변경을 포함하지 않는다.

커밋 이후 서명 산출물의 source SHA·해시·버전·양 플랫폼 원격 처리 상태와 테스터 접근은
Git 밖의 release manifest/배포 영수증으로 검증한다. unsigned 빌드 통과만으로
TestFlight/App Distribution 배포 완료를 판정하지 않는다.

빌드 8은 제품 소스 `ae3f34d`로 서명했고 QA 병합 `70ff52b`의 모바일 tree와 일치한다.
해당 QA 커밋의 전체 CI와 이미지 발행이 통과했다. Android는 원격 APK SHA 일치,
승인된 단일 테스터 분배 요청 승인과 프로젝트 등록을 확인했다. iOS는 `VALID`와
`IN_BETA_TESTING`, 기존 내부 그룹의 테스터 2명·빌드 연결·한국어 안내를 확인했다.
메일 수신·기기 설치나 실제 계정 로그인 성공을 확인한 것으로 확대하지 않는다.

Xcode 업로드가 원본 archive Info.plist에 `Distributions`를 추가하는 현상을 발견했다.
해당 메타데이터를 포함한 archive를 보존한 뒤, 추가 항목만 제거해 이전 Info의 정확한
SHA와 전체 archive SHA가 기존 manifest와 일치함을 검증했다. manifest 변경이나
재업로드는 하지 않았다. 이후 업로드 도구는 검증된 작업용 archive 복사본을 사용한다.
