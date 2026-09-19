# iOS

iOS 18.0 이상, iPhone 우선. Swift 6/SwiftUI 기반 로기챗 기본 앱.
Xcode 26.6(build 17F113), Swift compiler 6.3.3, iOS SDK 26.5를 사용한다.

`Rogichat.xcodeproj`를 열고 scheme을 선택한다.

| scheme | bundle ID | 표시 이름 |
|---|---|---|
| Rogichat-QA | `chat.rogi.rogichat.qa` | 로기챗 QA |
| Rogichat-Prod | `chat.rogi.rogichat` | 로기챗 |

Run은 해당 환경의 Debug, Archive는 Release를 사용한다.
원본은 `project.yml`과 `Config/*.xcconfig`이며 프로젝트 생성기는 XcodeGen 2.44.1이다.
기본 앱에는 외부 SPM 의존성이 없어 `Package.resolved`는 아직 없다.
현재 앱은 시작 화면만 제공하며 로그인·채팅·실기기 서명·스토어 등록은 후속 단계다.

```sh
# 저장소 루트, DEVELOPER_DIR를 Xcode 26.6의 Contents/Developer로 지정
python3 tools/mobile/build_ios.py --derived-data /path/to/external/DerivedData/rogichat
```

[환경 설정·서명 경계·재생성](../../docs/mobile-environments.md),
[모바일 기반 설계](../../docs/mobile-foundation.md),
[Apple 로그인·SOOP 필수 연결](../../docs/mobile-authentication.md)을 따른다.
