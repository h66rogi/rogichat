# Android

Android 10/API 29 이상, Kotlin/Compose 기반 로기챗 기본 앱.
QA/prod flavor와 Debug/Release 빌드를 분리했다.

| flavor | applicationId | 표시 이름 |
|---|---|---|
| qa | `chat.rogi.rogichat.qa` | 로기챗 QA |
| prod | `chat.rogi.rogichat` | 로기챗 |

JDK 17, Android SDK 37.0/Build Tools 37.0.0을 준비하고 실행한다.

```sh
./gradlew :app:assembleQaDebug :app:assembleProdRelease --no-daemon
```

QA debug는 개발 키로 서명한다. QA release는 외부 QA 키로 서명할 수 있고 prod release는 unsigned다.
두 환경의 동시 설치를 지원한다. QA 앱은 로그인 안내·SOOP 연결 안내·방 목록·채팅·설정의
오프라인 와이어프레임을 제공한다. prod에는 로그인 대기와 일반 설정 shell만 포함된다. 실제 로그인·전송은 미연동이다.
[공통 기반·재사용·QA 탐색·블로커](../../docs/mobile-common-foundation-progress.md)를 확인한다.

[서명 APK/AAB 빌드와 Firebase 테스트 배포](../../docs/mobile-test-distribution.md)를 따른다.

[환경 설정·전체 검증 명령](../../docs/mobile-environments.md),
[모바일 기반 설계](../../docs/mobile-foundation.md),
[Apple 로그인·SOOP 필수 연결](../../docs/mobile-authentication.md)을 따른다.
