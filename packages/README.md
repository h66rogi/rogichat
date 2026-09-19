# Shared packages

첫 구현은 `contracts`, 생성 SDK, `design-tokens`를 우선 검토한다.
TypeScript/Kotlin/Swift는 언어 중립 스키마와 fixture를 공유한다.
React UI는 웹끼리만, 네이티브 UI는 각 플랫폼 구현을 유지한다.
DB 엔티티·secret config를 클라이언트 패키지에 넣지 않는다.
실제 소비자가 생기면 패키지를 추가하고 workspace/Gradle/SPM 그래프에 등록한다.
