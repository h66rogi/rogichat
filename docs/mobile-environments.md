# 모바일 QA/prod 구성

QA와 운영 앱은 별도 설치·데이터 영역을 사용한다. 환경은 빌드 시 고정하며 앱 안에
서버 전환 메뉴를 두지 않는다. Debug/Release는 최적화·디버깅 설정이고 환경 선택과 독립이다.

| 항목 | QA | prod |
|---|---|---|
| 표시 이름 | 로기챗 QA | 로기챗 |
| Android applicationId / iOS bundle ID | `chat.rogi.rogichat.qa` | `chat.rogi.rogichat` |
| REST base URL | `https://api.qa.rogi.chat/v1/` | `https://api.rogi.chat/v1/` |
| Android flavor | `qa` | `prod` |
| iOS scheme | `Rogichat-QA` | `Rogichat-Prod` |
| iOS configurations | `Debug-QA`, `Release-QA` | `Debug-Prod`, `Release-Prod` |
| iOS Keychain service | `chat.rogi.rogichat.qa.session` | `chat.rogi.rogichat.session` |

식별자는 소스에 확정한 값이며 Apple/Google 포털 등록 완료를 뜻하지 않는다.
운영 API 주소는 설정만 했고 DNS·서버 배포·연결 성공은 별도다. 현재 화면은 앱 기동용
기본 화면이며 API 호출·로그인·계정 저장을 아직 구현하지 않았다.

## Android

Android 10/API 29 이상. compile/target API 37, Build Tools 37.0.0,
AGP 9.4.1, Gradle 9.7.1, JDK 17, Kotlin/Compose compiler 2.4.20,
Compose BOM 2026.09.00, activity-compose 1.13.0을 사용한다.
AGP 내장 Kotlin을 유지하며 별도 kotlin-android 플러그인을 적용하지 않는다.
컴파일러 2.4.20 선택은 생성된 dependency lock에서도 확인한다.

- 설정 원본: `apps/android/app/build.gradle.kts`, 버전: `gradle/libs.versions.toml`.
- Gradle wrapper 배포와 JAR는 공식 checksum으로 검증했다. 의존성은 `app/gradle.lockfile`로 고정한다.
- 네 variant를 함께 만들 수 있다. 같은 환경의 debug/release는 같은 ID여서 서로 대체한다.
  debug 키와 향후 release 키가 다르면 기존 앱을 제거해야 한다. QA와 prod는 함께 설치된다.
- Debug는 개발용 자동 생성 키를 사용한다. QA Release는 외부 QA 전용 키로 서명할 수 있다.
  외부 서명 설정이 없으면 Release는 unsigned이며 prod에는 QA 서명을 적용하지 않는다.
  [테스트 배포 절차](mobile-test-distribution.md)에 따라 APK/AAB와 TestFlight를 준비한다.
- HTTP cleartext를 허용하지 않고 앱 데이터의 cloud backup/device transfer를 제외한다.
- Hilt/Ktor/Room 등 기능 의존성은 해당 기반 구현 시 추가·검증한다.

```sh
cd apps/android
# JAVA_HOME: JDK 17, ANDROID_HOME: SDK 경로
./gradlew :app:assembleQaDebug :app:assembleQaRelease :app:assembleProdDebug :app:assembleProdRelease :app:test :app:lint --no-daemon
cd ../..
python3 tools/mobile/check_android.py
```

SDK Manager에서 `platforms;android-37.0`, `build-tools;37.0.0`을 설치한다.
로컬 SDK 경로는 환경변수 또는 Git에서 제외한 `local.properties`에만 둔다.
의존성 변경 시 위 Gradle 명령에 `--write-locks`를 붙인 뒤 lock diff를 검토한다.

## iOS

iOS 18.0 이상, iPhone 우선. Xcode 26.6(build 17F113), Swift 6 language mode.
SwiftUI 기본 앱이며 외부 SPM 의존성은 아직 없어 `Package.resolved`도 없다.

- `apps/ios/Rogichat.xcodeproj`를 열고 QA/prod scheme을 선택한다.
- `project.yml`은 생성 원본, `Config/QA.xcconfig`·`Prod.xcconfig`는 공개 환경 설정이다.
  생성된 프로젝트와 공유 scheme도 Git에 보관한다. `xcuserdata`는 제외한다.
- iOS plist의 URL은 xcconfig의 `//` 주석 처리 때문에 `https:/$()/...`로 표현한다.
  빌드 후 plist에 실제 `https://...`가 들어가는지 검증한다.
- AppEnvironment는 bundle ID·환경·URL 불일치 시 시작을 거부한다. 기본 Keychain 접근
  그룹을 공유하지 않으며, 후속 세션 저장 구현은 환경별 service를 사용해야 한다.
- Apple 로그인·APNs·associated domains·URL callback은 등록 전 허위 entitlement로
  활성화하지 않는다. 인증 기능 단계에서 서버 allowlist와 함께 연결한다.

```sh
# 저장소 루트, 설치한 Xcode의 Contents/Developer를 DEVELOPER_DIR로 지정
python3 tools/mobile/install_xcodegen.py
.tools/xcodegen-2.44.1/xcodegen/bin/xcodegen generate --spec apps/ios/project.yml
python3 tools/mobile/build_ios.py --derived-data /path/to/external/DerivedData/rogichat
```

XcodeGen은 공식 2.44.1 배포본·SHA-256으로 고정한다. 생성 후 Xcode 프로젝트 diff도 함께
검토한다. `build_ios.py`는 QA/prod × Debug/Release를 unsigned 빌드하고 실제 번들의
식별자·표시 이름·URL·최소 OS·iPhone target과 Mach-O 플랫폼을 검사한다.
서명·시뮬레이터 선택이 필요 없는 `xcodebuild -target Rogichat -sdk iphoneos` 경로를
사용하고, scheme의 Run/Test/Archive configuration 연결은 별도로 검사한다.
generic destination 문제가 발생하면 runtime 매핑·마운트와 IB Support 경로를
[CLI 진단 절차](mobile-test-distribution.md#xcode-cli-진단)로 확인한다.
실기기·시뮬레이터 실행 성공은 unsigned 컴파일 검증과 별개다.
실기기에서는 각 식별자를 개발자 계정에 등록하고 적절한 team/signing을 외부 설정으로
공급해야 한다. 개인 team ID·인증서·프로파일은 공개 저장소에 넣지 않는다.

## CI와 배포 경계

`Mobile foundation`은 GitHub-hosted Ubuntu/macOS에서 실행한다. Actions는 commit SHA로
고정했고 cloud·Apple·Google 서명 자격증명이 필요 없다. Android 빌드·단위 시험·lint·APK
검사, XcodeGen 재생성 drift 검사와 iOS 네 configuration의 unsigned 빌드를 수행한다.
이 workflow는 업로드·스토어 제출·운영 배포를 실행하지 않는다. prod 빌드를 확인하는 것과
`main` 운영 승격은 별개다.

등록·배포 단계에 남은 항목: 두 App ID와 Sign in with Apple capability, 환경별 APNs/FCM,
Universal/App Links의 서버 association 파일, Apple 팀/프로비저닝, Play upload key와
TestFlight/내부 테스트 트랙. Apple 로그인 후 SOOP 필수 연결 정책은
[모바일 인증 설계](mobile-authentication.md)를 따른다.

## 기준 문서

- [Android build variants](https://developer.android.com/build/build-variants)
- [AGP 9.4 호환표](https://developer.android.com/build/releases/agp-9-4-0-release-notes)
- [AGP 내장 Kotlin](https://developer.android.com/build/migrate-to-built-in-kotlin)
- [Android 17 SDK](https://developer.android.com/about/versions/17/setup-sdk)
- [Gradle wrapper 검증](https://docs.gradle.org/current/userguide/gradle_wrapper.html)
- [XcodeGen 2.44.1](https://github.com/yonaskolb/XcodeGen/releases/tag/2.44.1)
