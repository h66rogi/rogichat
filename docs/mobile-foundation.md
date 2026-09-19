# Android/iOS 시작 설계

2026-09-20. 사용자 결정: 기존 앱 버전에 구속되지 않고 최신 안정 라이브러리와 구조를
사용한다. 최소 지원 OS 선정은 위임받았다. Apple 로그인과 SOOP 필수 연결을 채택한다.
이 문서는 구현 기준이며 앱 생성·기능 시험·스토어 배포 완료 기록은 아니다.

## 지원 기준

| 항목 | 결정 | 이유 |
|---|---|---|
| Android 최소 OS | Android 10, API 29 | 신규 소규모 앱의 구형 OS별 저장소·화면 호환 시험 범위를 줄이는 제품 선택 |
| iOS 최소 OS | iOS 18.0, iPhone 우선 | Observation과 현대 SwiftUI를 기본으로 하고 구형 UI·인증 callback 분기를 줄임 |
| 빌드 도구 | 최신 stable 중 전체 호환 시험을 통과한 조합 | minSdk/deployment target과 컴파일 SDK 버전은 독립 |
| 언어 | Kotlin, Swift 6 language mode | 기존 앱의 Kotlin 2.0/Swift 5.9 설정을 복사하지 않음 |
| 환경 | QA/prod 식별자·세션·서명·푸시·associated domains 분리 | QA/prod 앱 동시 설치와 계정 환경 혼동 방지 |

OS 기준은 라이브러리가 강제한 최솟값이나 사용자 OS 분포 실측 결과가 아니다.
실제 이용자 호환 요청이 생기면 지원 범위를 다시 평가한다. 최신 OS도 함께 시험한다.
Android compileSdk/targetSdk는 scaffold 시 stable SDK와 Play 제출 요건을 확인해 고정한다.

## 버전 조사

2026-09-20 upstream metadata에서 조회한 stable 후보다. 의존성을 설치하거나 이 조합의
빌드를 완료한 것은 아니다. 첫 scaffold에서 정확한 버전·lockfile·wrapper checksum과
CI runner를 고정하고 실제 컴파일 결과를 기록한다. 동적 `+`/무제한 latest는 사용하지 않는다.

| 도구/라이브러리 | 조사 후보 | 원본 |
|---|---|---|
| AGP | 9.4.1 | [Google Maven](https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/maven-metadata.xml) |
| Gradle / JDK | 9.6.0 / 17 | [AGP 9.4 호환표](https://developer.android.com/build/releases/agp-9-4-0-release-notes) |
| Kotlin | 2.4.20 | [Maven](https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-gradle-plugin/maven-metadata.xml) |
| KSP | 2.3.12 | [공식 릴리스](https://github.com/google/ksp/releases/tag/2.3.12) |
| Compose BOM | 2026.09.00 | [Google Maven](https://dl.google.com/dl/android/maven2/androidx/compose/compose-bom/maven-metadata.xml) |
| Hilt | 2.60.1 | [Maven](https://repo.maven.apache.org/maven2/com/google/dagger/hilt-android/maven-metadata.xml) |
| Ktor | 3.6.0 | [Maven](https://repo.maven.apache.org/maven2/io/ktor/ktor-client-core/maven-metadata.xml) |
| Room | 2.8.5 | [Google Maven](https://dl.google.com/dl/android/maven2/androidx/room/room-runtime/maven-metadata.xml) |
| Socket.IO Java | 2.1.2 | [Maven](https://repo.maven.apache.org/maven2/io/socket/socket.io-client/maven-metadata.xml) |
| Xcode / Swift compiler | 27 / 6.4 | [Apple 호환표](https://developer.apple.com/xcode/system-requirements/) |
| 현재 개발 Mac용 호환 Xcode | 26.6 / Swift 6.3 | 현재 macOS 26.5.2에서 사용 가능한 stable. Xcode 27은 macOS 26.6+ 필요 |
| GRDB | 7.11.1 | [공식 릴리스](https://github.com/groue/GRDB.swift/releases/tag/v7.11.1) |
| Socket.IO Swift | 16.1.1 | [공식 릴리스](https://github.com/socketio/socket.io-client-swift/releases/tag/v16.1.1) |

AGP 9의 내장 Kotlin과 명시적 Kotlin/Compose compiler·KSP·Hilt 조합을 별도 spike로
검증한다. AGP 기본 Kotlin 버전이 최신 Kotlin과 같다고 가정하지 않는다.
[내장 Kotlin 전환](https://developer.android.com/build/migrate-to-built-in-kotlin).
Swift Socket.IO의 최신 릴리스가 오래됐더라도 최신 Swift concurrency 호환성까지 보장하지
않는다. actor/queue adapter와 서버 protocol 시험을 통과해야 채택한다.

## 앱 경계

- Android: Compose, ViewModel/StateFlow, Hilt, Ktor, Room. `app`, `core`,
  `feature:auth`, `feature:chat`, `feature:settings`로 시작하고 실제 의존에 따라 core를 분리한다.
- iOS: SwiftUI/Observation, `@MainActor` 화면 상태, async/await, URLSession,
  Keychain, GRDB. 명시적 Xcode 앱 프로젝트와 로컬 SPM Core, 앱 내부 Features로 시작한다.
- `packages/contracts`와 생성 Kotlin/Swift SDK, 공통 합성 fixture를 공유한다.
  전송 DTO와 UI 모델은 구별하고 세션 갱신·로컬 DB·화면 상태는 앱 계층이 소유한다.
- nullable PATCH의 생략/명시적 null, UUID, timestamp, 알 수 없는 콘텐츠 variant,
  오류·저장 receipt·sync reset을 같은 fixture로 검증한다.
- 새 로기챗 자산과 디자인 토큰을 사용한다. reference의 서명·Firebase·분석·결제·음성 SDK는
  가져오지 않는다. 이식한 소스는 원본 SHA·파일·라이선스를 기록한다.

## 사용자 경험

참여 방 하나면 마지막 대화로 바로 진입한다. 방 선택과 내 프로필/설정은 유지하되
방 ID나 스트리머 ID를 하드코딩하지 않는다. 동일 앱에서 방별 역할/capabilities를 사용한다.
팬은 공통 메시지와 자기 비공개 대화를 함께 본다. 스트리머 입력창은 전체발송과 개인답장
대상을 항상 명시한다. 오른쪽→왼쪽 스와이프는 추가 메뉴 없이 개인답장 입력에 진입한다.
권한 상실 시 초안을 보존하고 전송을 거부하며 전체발송으로 바꾸지 않는다.

방 전체공개는 별도 명령이며 팬 메시지가 스트리머에 의해 공개될 수 있음을 가입/방 안내에서
알린다. 공개본 작성자·원본 링크는 서버가 허용한 DTO만 표시한다. 키보드·스크롤 위치·
Dynamic Type·VoiceOver/TalkBack·제스처 대체 메뉴를 초기 채팅 시험에 포함한다.

## 전송·복구

UI → Repository → 로컬 DB/REST, socket hint → SyncCoordinator → REST → 로컬 DB
구조를 사용한다. 소켓은 원문을 직접 그리는 경로가 아니다.

1. 전송 전에 command ID·본문·대상·계정을 원자 저장한다. 동일 명령의 retry는 같은 ID와
   payload를 사용한다. 내용/대상이 바뀌면 별도 명령이며 이전 결과를 먼저 정리한다.
2. 저장 receipt와 상대방 읽음을 구분한다. 응답 유실은 결과 불명 상태이며 다른 ID로 다시
   보내지 않는다. UI의 로컬 메시지와 server message를 명령 ID로 한 번만 합친다.
3. 변경분과 opaque cursor를 같은 DB transaction으로 적용한다. socket/timestamp/최대
   sequence를 cursor로 사용하지 않는다. snapshot reset과 오래된 응답의 generation도 검증한다.
4. 기기당 한 sync만 실행하고 힌트를 합친다. foreground·재연결·명령 완료·주기적 sync로
   복구한다. 백그라운드 상시 socket/polling에 의존하지 않는다.
5. 계정·환경·방 참여 기간별로 캐시를 격리한다. 로그아웃/철회/reset 시 본문·미디어·검색
   파생 데이터·전송 큐를 정리한다. 탈퇴/접근 철회 후 큐를 자동 재전송하지 않는다.
6. 첫 출시는 private 기록의 완전한 오프라인 열람을 보장하지 않는다. cold start와 권한
   변경 후에는 현재 세션/방 인가 확인을 우선한다. 이미 열람한 데이터의 소급 회수는 보장하지 않는다.

인증은 [Apple 로그인과 SOOP 연결](mobile-authentication.md)을 따른다. 세부 sync 프로토콜은
[백엔드 구현 계획](backend-implementation-plan.md)을 사용하되 다중 서버·Redis를 모바일
기반 작업의 필수 운영 비용으로 만들지 않는다.

## 구현 순서와 통과 기준

| 단계 | 결과 | 검증 |
|---|---|---|
| M0 | 앱 scaffold, QA/prod 구성, 생성 SDK fixture, 빌드 CI | unsigned 빌드, 모델 parity, 최소/최신 OS 구성 |
| M1 | Apple/SOOP 인증과 연결 안내, 계정 관리 | 실기기 왕복, link 취소/충돌/replay, 미연결 계정의 서버 gate |
| M2 | 방 입장·텍스트·삭제·로컬 전송 큐·sync | Android↔iOS, ACK 유실, 앱 종료·복귀, 중복/누락/권한 시험 |
| M3 | 개인답장·전체공개·반응 | 잘못된 대상 전송 0, 팬 간 정보 비노출, 삭제 연쇄 |
| M4 | 미디어·스티커·FCM/APNs·설정 | upload 복구, 60초 URL 재인가, 계정 변경 후 push 오연결 0 |
| M5 | TestFlight/Android 내부 테스트와 출시 준비 | 실제 기기, 신고/차단/탈퇴, privacy·로그인 심사 검토 |

public PR CI에는 cloud/서명 자격증명을 주지 않는다. 서명 배포는 검토된 qa release 경로로
분리하며 main 승격은 별도 리뷰다. Action SHA, dependency lock, 생성 SDK drift를 검사한다.
기반 검증은 GitHub-hosted CI와 실기기를 사용하고 로컬 GUI/시뮬레이터 상시 실행을 요구하지 않는다.

## iOS 개발 환경 준비 기록

2026-09-20: 개발 볼륨에 Xcode 26.6(build 17F113)을 설치했고 설치 도구의 Apple 코드 서명·
security assessment 검사를 통과했다. `xcodebuild -version`으로 실제 설치 버전을 확인했다.
시스템 활성 경로는 기존 Command Line Tools를 유지하며 프로젝트별 DEVELOPER_DIR를 사용한다.
`xcodes` 2.1.0 공식 배포 CLI는 SHA-256과 Apple Developer ID 서명을 확인했다.
SDK 조회와 컴파일은 Apple 라이선스 동의·first-launch 초기 구성 대기다. SwiftUI/Observation,
Swift 6, iOS 18용 임시 unsigned 시험 프로젝트를 준비했으며 아직 빌드 성공을 주장하지 않는다.
최신 Xcode 27 사용에는 OS 업데이트가 필요하고, OS 재부팅/업데이트는 아직 수행하지 않았다.

다음 증거가 모두 있어야 개발 환경 완료로 기록한다.

- `DEVELOPER_DIR=<설치 앱>/Contents/Developer`로 `xcodebuild -version`, `-showsdks`,
  `xcrun --sdk iphoneos --show-sdk-path`와 Swift compiler 확인.
- 라이선스/first-launch 필요 여부 확인 및 운영자 처리 후 `-checkFirstLaunchStatus` 성공.
- 최소 SwiftUI 앱의 iphoneos unsigned compile/link. 로기챗 앱 빌드와 구별해 기록.
- 실제 device pairing/signing은 별도 확인. unsigned 빌드 성공을 실기기 설치·배포 성공으로
  표시하지 않는다. private signing key와 provisioning 자료는 공개 저장소에 저장하지 않는다.

Xcode 설치·DerivedData는 충분한 공간이 있는 개발 볼륨에 둔다. 시스템의 활성 개발 경로를
바꾸기 전에 프로젝트별 DEVELOPER_DIR로 먼저 검증한다. 기존 프로젝트의 toolchain을
무조건 교체하거나 다른 앱의 cache/아카이브를 정리하지 않는다.
