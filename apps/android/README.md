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

QA debug는 개발 키로 서명하며 release는 unsigned다. 두 환경의 동시 설치를 지원한다.
현재 앱은 시작 화면만 제공하며 로그인·채팅·서명 배포는 후속 단계다.

[환경 설정·전체 검증 명령](../../docs/mobile-environments.md),
[모바일 기반 설계](../../docs/mobile-foundation.md),
[Apple 로그인·SOOP 필수 연결](../../docs/mobile-authentication.md)을 따른다.
