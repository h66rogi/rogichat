# Android

최소 Android 10(API 29). Kotlin/Jetpack Compose, Hilt, Ktor, Room으로 시작한다.
최신 stable AGP/Kotlin/KSP/Hilt 호환 세트를 검증하고 기존 앱의 버전은 복사하지 않는다.
Gradle module과 생성 Kotlin SDK를 사용하며 qa/prod applicationId와 signing을 분리한다.
secret 없는 빌드 CI부터 시작하며 기존 signing·Firebase·고객지원 SDK 설정은 가져오지 않는다.

[모바일 기반 설계와 버전 후보](../../docs/mobile-foundation.md),
[Apple 로그인·SOOP 필수 연결](../../docs/mobile-authentication.md)을 따른다.
현재는 설계 단계이며 Gradle 앱·lockfile·모바일 CI는 아직 생성하지 않았다.
