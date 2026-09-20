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
QA 앱은 로그인 안내·SOOP 연결 안내·방 목록·채팅·설정의 오프라인 와이어프레임을 제공한다.
`ROGICHAT_QA` 컴파일 조건으로 prod에는 시작 화면만 포함한다. 실제 로그인·전송은 미연동이다.
[구현 범위·QA 탐색 방법·블로커](../../docs/mobile-wireframe-progress.md)를 확인한다.
상태 전이는 `python3 tools/mobile/check_ios_wireframe.py`로 Simulator 없이 검사한다.
[서명 Archive·IPA 검증·TestFlight 업로드](../../docs/mobile-test-distribution.md)를 따른다.

```sh
# 저장소 루트, DEVELOPER_DIR를 Xcode 26.6의 Contents/Developer로 지정
python3 tools/mobile/build_ios.py --derived-data /path/to/external/DerivedData/rogichat
```

[환경 설정·서명 경계·재생성](../../docs/mobile-environments.md),
[모바일 기반 설계](../../docs/mobile-foundation.md),
[Apple 로그인·SOOP 필수 연결](../../docs/mobile-authentication.md)을 따른다.
