# iOS

최소 iOS 18.0, iPhone 우선. Swift 6/SwiftUI/Observation과 SPM 기반.
qa/prod bundle ID, API 주소, signing 환경을 분리한다.
최신 stable Xcode/Swift와 CI macOS runner 호환 검증 후 생성한다.
Swift concurrency, Socket.IO adapter, Keychain, GRDB transaction, nullable PATCH를 검증한다.
기존 team ID·인증서·프로비저닝·push 자산은 가져오지 않는다.

[모바일 기반 설계와 버전 후보](../../docs/mobile-foundation.md),
[Apple 로그인·SOOP 필수 연결](../../docs/mobile-authentication.md)을 따른다.
현재 개발 Mac에 Xcode 26.6(build 17F113)을 설치했다. Apple 라이선스 동의와 초기 구성,
SDK·unsigned 빌드 검증은 대기 중이다. Xcode 27에는 macOS 26.6+가 필요하다.
앱 프로젝트·Package.resolved·모바일 CI는 아직 생성하지 않았다.
