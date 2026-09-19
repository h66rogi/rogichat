# Android

Kotlin/Jetpack Compose, Hilt, Ktor 기반 구조를 참고한다.
Gradle module과 공통 Kotlin SDK를 사용하며 qa/prod applicationId와 signing을 분리한다.
최신 stable AGP/Kotlin/KSP/Hilt 호환 검증 후 생성하고 secret 없는 unsigned CI부터 시작한다.
기존 signing·Firebase·고객지원 SDK 설정은 가져오지 않는다.
