# 실제 방 목록과 계정별 로컬 저장소

2026-09-20. MB04a는 방 탐색과 현재 참여 목록을 실제 API·SQLite에 연결하는 첫 단계다.
텍스트 전송·방 입장/퇴장·메시지 복구를 완료한 단계로 집계하지 않는다.
제품에서는 확인된 목록·빈 상태·오류·재시도를 제공하며 합성 계정이나 방으로 인증을 우회하지 않는다.

## 계약과 구현 범위

고정 입력은 C06 `691aff80bbcc96903ffe11d76b2a7561859ddb02`, C04
`400232973b60ce8d0cf39f3ed8bc5d92f325c16b`다. C05의 메시지 projection은 첫 저장소의
소비 대상이 아니며, timeline 단계에서 C05/C06을 합친 서버 계약과 다시 대조한다.

- 실제 rooms discovery와 schemaVersion 2 account membership manifest를 구분한다.
  부분 discovery에서 보이지 않거나 unjoined인 방을 참여 목록에서 삭제하지 않는다.
- 같은 generation의 manifest 페이지 전체를 staging한 뒤 한 transaction으로 참여 목록과
  checkpoint를 바꾼다. 완료 전 실패·reset·혼합 generation은 빈 목록 성공이 아니다.
- DB는 환경과 서버 `accountPartition`으로 구분한다. partition이 없는 호환 세션은
  인증을 유지하면서 durable rooms 접근을 닫고, userId를 대체 DB 식별자로 사용하지 않는다.
- 원래 session/credential/epoch를 HTTP 시작·응답·DB transaction·실제 COMMIT·화면 게시까지
  확인한다. A→B→A 전환이나 같은 계정의 새 로그인도 이전 작업을 살리지 않는다.
- 계정 전환·로그아웃 때 private 화면을 먼저 숨기고 저장소를 정리한다. 삭제 실패의 intent는
  재시작 후에도 남으며 정리를 완료하기 전에 과거 DB를 권한 있는 상태로 열지 않는다.

첫 schema는 실제 목록·참여·staging·checkpoint·lifecycle metadata만 저장한다. 아직 소비자가
없는 messages/profiles/outbox/drafts/media 테이블, receipt client, 가짜 방 열기 버튼은 넣지 않는다.
방 입장/퇴장은 실제 mutation과 응답 유실·manifest 재확인까지 연결하는 후속 단계다.

## 원본 재사용과 새 구현

Android 원본 `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`의 Channel API/repository와
dispatcher 주입, iOS `18a33bbf96fe52b28d0de361916e20549bdcce6b`의 repository 생성자와
목록 loading/error/cursor 구조를 대조했다. 실제 적용 파일·보존/변경한 동작은
[재사용 기록 R39–R43](mobile-reuse-audit.md)에 구분한다. 단순히 읽은 코드를 추출 완료로 집계하지 않는다.

대응하는 비채팅 DB 구현은 원본에 없어 Android Room과 iOS GRDB 저장소·migration·scope
fence는 새 구현이다. Talk/TalkV2의 화면·입력·scroll·socket·outbox는 가져오지 않는다.
Android는 [Room 2.8.5](https://developer.android.com/jetpack/androidx/releases/room)와
[KSP 2.3.12](https://github.com/google/ksp/releases/tag/2.3.12), iOS는
[GRDB 7.11.1](https://github.com/groue/GRDB.swift/releases/tag/v7.11.1)을 사용한다.
GRDB는 `b83108d10f42680d78f23fe4d4d80fc88dab3212`로 host와 Xcode resolved를 함께 고정하고
검사하며 자동 재해석을 차단한다. 실제 GRDB privacy bundle과 원본 MIT 고지를 app/IPA에서
검사한다. Room/KSP는 기존 strict Gradle lock과 Apache 고지를 확장한다.

## 설치 식별자와 개인정보

동기화용 deviceId는 앱이 만든 UUID다. 하드웨어 ID·광고 ID·분석 SDK를 사용하지 않는다.
환경별 backup 제외 저장소에서 설치 수명 동안 유지하고 로그아웃·계정 전환에는 바꾸지 않는다.
앱 데이터 제거·재설치 후에는 새 값을 만든다. `GET /v1/sync` 요청에서 현재 Bearer와 함께
전송하므로 익명 식별자라고 설명하지 않는다. cacheId는 별도 동기화 cycle/reset 식별자다.

서버 소스에서 deviceId는 계정·세션과 함께 암호화 cursor에 결합되고 별도 DB 저장은 없다.
실제 QA 경로도 Caddy access logging 비활성화와 기본 오류 로그의 URI/header 제거,
API logger의 URL/query/body/header 제외를 확인했다. 다만 이것을 모든 오류 경로의
미보관 증명으로 확대하지 않고 DeviceID를 계정 연계·앱 기능 목적·추적 없음으로 선언한다.
프로필 선언과 함께 실제 app/IPA의 privacy manifest를 검사한다. App Store Connect와
Play Console의 공개 스토어 응답은 제품 데이터 흐름 및 보관 정책과 맞춰 출시 전에 확인한다.
[Apple 정의](https://developer.apple.com/app-store/app-privacy-details/)와
[Google Play 지침](https://support.google.com/googleplay/android-developer/answer/10787469)을
기준으로, 설치 식별자를 익명으로 설명하거나 입증되지 않은 ephemeral 예외를 적용하지 않는다.

## 검증과 운영 경계

양 OS 소스의 독립 리뷰에서 실제 SQLite COMMIT 이전 잠금 해제, 정리 I/O보다 늦은 private
화면 초기화, credential 삭제와 DB purge intent 사이의 crash 경계를 점검하고 수정했다.
이후 Android `23c5200bc151e5b0ef16a6f648038cc43bfefce5`에서 QA 135개·Prod 127개 JVM
시험을 통과했다. 통합 후 QA/Prod의 Debug/Release 네 구성 빌드·lint·Release R8와 실제
APK의 환경·콜백·제품 fixture 제외 검사도 통과했다. 실제 API 36.1의 격리된 읽기 전용 emulator에서
Room 9개와 기존 보호 저장소 7개, 총 16개 계측 시험을 실행했고 실패·skip은 0개다.
앱과 테스트 APK의 해시를 기록했고 해당 emulator 종료·adb serial 제거도 확인했다.

iOS `1ee99aba37055b9f8162c1c4f26f0a2ed73b27ac`의 앱 소스를 통합하고 strict Swift 6
실행 파일 여섯 종과 실제 macOS host GRDB 시험 8개를 통과했다.
WAL/FULL, 부분 페이지·원자 교체·실패 rollback/reopen, actual SQLite COMMIT 중 무효화,
stale handle·cold purge 실패 복구를 확인했다. QA/Prod의 Debug/Release 네 기기 SDK 구성도
두 resolved-only 옵션으로 빌드했고 실제 GRDB privacy bundle·MIT·앱 DeviceID 선언을
검사했다. XcodeGen 재생성 diff는 0이며 배포·패키지 도구 시험 108개를 통과했다.
PR #58의 고정 소스 `d458f43d436ab07f5d7806be806d2d89e6291f04`에서 필수 hosted CI도 모두
통과했다. 원격 iOS의 GRDB 8개·도구 108개·네 기기 SDK 구성 검증 결과를 별도로 확인했다.

iOS의 로컬 Swift package도 제품 소스 검사에 포함한다. package Tests의 합성 fixture는
독립 실행하며, 앱/IPA에는 포함하지 않는다. 실제 GRDB 시험은 macOS host에서 실행하고
iOS는 기기 SDK로 컴파일한다. iOS Simulator/GUI는 사용하지 않는다.

Android 실제 저장소 시험은 GitHub-hosted의 별도 필수 CI에도 연결한다. 고정 API 36 이미지의
revision·ABI를 검사하고 자체 임시 AVD·adb 서버만 사용하며, 실패·skip·누락 suite를 성공으로
처리하지 않는다. 타임아웃·취소 때 소유 프로세스를 정리한다. 이 CI에는 배포 자격증명이나
실제 계정이 없으며, instrumentation APK를 배포물로 사용하지 않는다. 신규 hosted lane도
실행됐으며 API 36 revision 7에서 실제 저장소 시험 16개·실패/skip 0을 확인했다.

같은 clean 소스로 양 OS **빌드 13**을 서명·배포했다. Android는 실제 APK/AAB의 환경·콜백·
제품 fixture 제외 검사 후 한 번 업로드했고 원격 APK 해시와 승인 테스터 배포 응답을 확인했다.
APK SHA-256은 `7ea75c92778f969f4ac348419809421a53aded7d411683ab5a5e2e3189f1167b`,
AAB는 `237932b0bdc44ada25f8191050e1c504e66d9c0e088080fe1015e13a62f8b429`다.

iOS는 실제 서명 archive/IPA의 권한·privacy·GRDB 고지 검사를 통과했고 Apple validation 후
한 번 업로드했다. 처리 대기 중에는 상태만 재조회했으며 재업로드하지 않았다. 정확한
`VALID / IN_BETA_TESTING`과 한국어 노트·기존 내부 그룹 연결을 확인했다. IPA SHA-256은
`c3735998fc80e104f57ecc82dfbb378af08735f485cc780dc14e687147d59b1b`다. 원본 archive와
업로드용 복제본을 분리했고 receipt·테스터·서명 자료는 저장소 밖에 보관한다.

변경 symbol의 외부 영향도 읽기 전용으로 확인했다. DEV의 별도 Git 저장소 54개에서 native
accountPartition/membershipScope·앱 식별자·배포 도구/패키지 참조를 검색했으며 직접 참조는
발견되지 않았다. 같은 Rogichat 저장소의 API·웹은 C06 활성화 조정 대상으로 따로 추적한다.

QA API의 schema 2 활성화는 웹·Android·iOS의 준비와 rollback 경로를 조정한 뒤 진행한다.
SOOP canonical subject·broker 등록과 실제 사용자 발급은 별도 gate이며, 해당 장애를
테스트 credential이나 성공 화면으로 감추지 않는다. 실제 계정의 방 목록/영속 왕복,
물리 Android/iPhone 검증은 위 내부 배포 성공과 구분한다.
