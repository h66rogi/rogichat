# 모바일 QA 테스트 배포

Android는 서명 APK를 Firebase App Distribution에 올리고, 테스터는 App Tester로 설치한다.
Play Console에 직접 올릴 서명 AAB도 함께 만든다. iOS는 서명 Archive → IPA export →
Apple validation → TestFlight 업로드 순서다. `4e222de`까지의
[오프라인 와이어프레임](mobile-wireframe-progress.md) 제품 방향은 폐기됐다.
현재 [제품 구성 교체](mobile-product-progress.md)는 [통합 계획 §2.1·§8](mobile-implementation-plan.md)의
**멜로밍 구현 최대 재사용, QA/prod 공통 제품 구성, 양 배포 산출물 fixture 제외**를 적용한다.
네이티브 로그인·프로필·채팅과 후속 미디어/메시지 동작은 실제 API에 연결한다.
현재 통합 및 실행 증거는 [기능 통합 기록](mobile-product-integration-progress.md)을 따른다.
내부 테스트 배포만으로 실제 제공자 로그인·기기 간 대화나 정식 출시 검증을 대신하지 않는다.
이 설명은 기존 TestFlight/App Tester 업로드가 최신 소스라는 뜻이 아니다. 배포된 source SHA와
build number는 개별 release manifest로 확인한다. 이 도구는 `chat.rogi.rogichat.qa`만 처리한다.

사용자 최신 운영 지시: 로그인·실제 대화·복구처럼 함께 사용할 수 있는 기능 묶음을 구현·검증·
커밋한 뒤 두 QA 배포 경로에 업로드하고 처리/테스터 접근을 확인한다. 작은 변경마다 별도
테스터 빌드를 만들거나 그 업로드를 기다리느라 다음 구현을 중단하지 않는다. 순수 검사와
격리된 hosted CI는 코드 작업과 병렬로 진행하고 로컬 Gradle/Xcode/에뮬레이터는 공유 자원을 조율한다.
테스터 식별자는 공개 문서에 기록하지 않는다.

`product_guards.py`가 제품 소스와 APK/AAB·iOS 앱/IPA의 기존 합성 host·샘플 계정/방·미리보기
진입을 차단한다. 서명 빌드와 업로드 전에도 같은 검사를 실행하며, 테스트 fixture는
Android `src/testQa`·iOS `Tests`에만 둔다. 배포 manifest의 source SHA와 `dirty=false`,
산출물 SHA-256, 원격 처리 상태와 테스터 접근 확인은 Git 밖의 배포 기록에 보관한다.

## 로컬 설정

Python 3.11 이상, JDK 17, Android SDK/Build Tools 37, Firebase CLI, Xcode 26.6을 사용한다.
`JAVA_HOME`, `ANDROID_HOME`, `DEVELOPER_DIR`는 설치 경로에 맞춘다. Gradle 캐시와
빌드 산출물은 공간이 충분한 외부 볼륨을 권장한다. 저장소 루트에서 실행한다.

```sh
mkdir -p ~/.config/rogichat
chmod 700 ~/.config/rogichat
cp tools/mobile/qa-release.example.json ~/.config/rogichat/mobile-qa.json
chmod 600 ~/.config/rogichat/mobile-qa.json
```

이미 설정 파일이 있으면 덮어쓰지 않는다. 템플릿의 경로와 빈 값을 로컬에서 채운다.
설정·서명 키·비밀번호 파일·Apple API 키·산출물·업로드 로그는 **모든 Git 저장소 밖**에 둔다.
개인 team/key/issuer ID, Firebase 프로젝트/app ID는 외부 설정에만 보관한다.
기존 Apple API 키는 원래 외부 위치를 참조할 수 있지만 다른 앱의 인증서·환경 파일을 복사하지 않는다.
App Distribution 업로드 인증과 앱의 FCM 설정은 별개다. 앱의 FCM 입력은 Git 밖의
환경별 mode 600 파일을 사용하며, [서명 준비 기록](mobile-prod-signing-progress.md)의 정확한
형식과 대상 검사를 따른다. SDK 설정 경로가 완전히 없으면 푸시만 사용할 수 없고 서명
빌드는 가능하다. 명시했지만 잘못된 설정이나 다른 앱/환경의 설정은 빌드를 차단한다.

Firebase 배포는 개인 OAuth 로그인 대신 **전용 서비스 계정**을 사용한다. 프로젝트 관리자가
한 번 서비스 계정을 만들고 `roles/firebaseappdistro.admin`을 부여한다. 이 역할에는
배포 및 앱 확인에 필요한 `firebase.clients.list`도 포함된다. Owner/Editor나 다른 제품의
관리 역할을 부여하지 않는다. JSON 키는 모든 Git 밖의 mode 600 파일에 저장하고 외부
설정의 `firebase.credentials_file`에 그 절대 경로를 지정한다. 앱의 FCM 설정 파일과 다르다.

```sh
python3 tools/mobile/qa_release.py doctor
```

`doctor`, APK 업로드, 업로드 후 검증이 모두 같은 서비스 계정을 사용한다. 개인 사용자
세션과 `FIREBASE_TOKEN`은 배포 인증에 사용하지 않으며, 매 배포마다 로그인/문자 인증할
필요가 없다. 짧은 access token은 자동 발급·갱신한다. 서비스 계정이나 키가 폐기되거나
조직 정책으로 만료되면 관리자가 자격 증명을 복구해야 한다. 무조건 영구 유효한 토큰을
저장하는 방식은 아니다. 로컬 키는 이 신뢰된 Mac에서만 사용하고 공개 PR job·앱 바이너리·
로그·GitHub Secrets로 복사하지 않는다. 향후 CI federation은 별도 신뢰/권한 검토 대상이다.

`zsh: command not found: firebase`는 CLI 탐색 경로 문제다. NVM을 불러오고 Firebase CLI가
설치된 Node 버전을 선택한다. 배포 도구는 `node`와 `firebase`를 PATH에서 찾는다.
기존 사용자 로그인이나 배포 기록을 지울 필요는 없다.

새 환경에서는 QA 전용 Firebase 프로젝트와 Android 앱을 CLI/콘솔로 등록한 후 외부 설정에
ID를 넣는다. App Store Connect에는 iOS 앱을 이름 `로기챗 QA`, 기본 언어 한국어,
Bundle ID `chat.rogi.rogichat.qa`, SKU `rogichat-qa`로 등록한다.
Apple API 키에는 해당 앱 조회와 signing/upload에 필요한 권한이 있어야 한다.
Cloud signing 권한을 사용할 수 없으면 유효한 Apple Distribution 인증서와 개인 키를
Mac 키체인에 준비한다. 현재 로컬 QA 환경은 별도 배포 인증서/키체인을 사용한다.
외부 설정의 선택 항목 `ios.keychain`, `ios.keychain_password_file`을 지정하면 해당
키체인만 빌드/export 전에 잠금 해제한다. 비밀번호 파일은 mode 600이어야 한다.
키체인은 사용자 검색 목록에 등록해야 하며 인증서 만료 전에 갱신한다.
현재 서명 경로는 archive부터 `ios.provisioning_profile`(설치한 profile의 정확한 이름
`Rogichat QA App Store Capabilities v2`)과 `ios.signing_certificate`(배포 인증서 SHA-1)를 함께 요구한다. Profile은
정확한 QA Bundle ID/team/인증서 및 Apple 로그인·푸시·Associated Domains에 연결한다. 다른 앱의
인증서를 폐기해서 자리를 만들지 않는다. 키와 키체인 비밀번호는 비공개 백업 대상이다.

## Android

새 QA 키가 필요한 경우에만 실행한다. 기존 키를 덮어쓰지 않으며 비밀번호도 자동 생성한다.
배포를 시작한 후에는 같은 키를 유지하고 별도 비공개 백업을 보관한다.

```sh
python3 tools/mobile/qa_release.py android-init-key
python3 tools/mobile/qa_release.py android-build --build-number 10 --version 0.1.0
```

`artifact_root/android/10/`에 APK, AAB, 검증 로그, `release.json`이 생성된다.
`qaRelease`만 외부 QA 키로 서명한다. 일반 Debug는 개발 키, 외부 서명 설정이 없는 Release와
Prod Release는 각 환경의 외부 서명 입력이 없으면 unsigned다. 별도 Prod 서명은
`prod_release.py`와 [Production 준비 절차](mobile-prod-signing-progress.md)를 따른다. build number는 업로드한 값보다 크게 지정한다.
이미 존재하는 산출물 디렉터리는 덮어쓰지 않는다.

검증 항목은 APK 서명·QA ID·버전·표시 이름·API 주소·debuggable 비활성화와
AAB 구조·ID·버전·JAR 서명이다. 소스 커밋과 파일 SHA-256을 manifest에 기록한다.
모바일 소스에 미커밋 변경이 있는 상태에서도 로컬 검증은 가능하지만 업로드는 차단한다.
커밋 후 새 build number로 다시 빌드한다.

Firebase 업로드는 별도 명령이다. `RELEASE_DIR`와 릴리스 노트 경로를 실제 외부 경로로 지정한다.

```sh
python3 tools/mobile/qa_release.py android-upload \
  --manifest "$RELEASE_DIR/android/10/release.json" \
  --notes-file "$RELEASE_DIR/qa-notes.txt"
```

업로드 전에 Firebase app ID와 QA package name을 대조한다. 성공 응답은 같은 디렉터리의
`firebase-receipt.json`에 저장한다. 이 명령은 테스터/그룹을 지정하지 않는다.
Firebase 콘솔에서 사용할 그룹을 선택해 배포하면 테스터가 초대를 수락하고
Firebase App Tester에서 내려받을 수 있다. 업로드 성공과 테스터에게 배포된 상태는 구별한다.
기존 debug 앱은 서명이 달라 삭제 후 QA release를 설치해야 할 수 있다.

Play Console 수동 업로드에는 같은 디렉터리의 `.aab`를 사용한다. AAB는 직접 설치하는
파일이 아니다. QA package의 별도 Play 앱과 Play App Signing/upload key 설정이 필요하며
prod 앱에는 이 QA 파일을 올리지 않는다. 현재 도구는 Play 업로드를 자동 실행하지 않는다.

## iOS / TestFlight

```sh
python3 tools/mobile/qa_release.py ios-archive --build-number 10 --version 0.1.0
python3 tools/mobile/qa_release.py ios-export --manifest "$RELEASE_DIR/ios/10/release.json"
```

Archive는 `Rogichat-QA` / `Release-QA` / generic iOS destination을 사용한다.
외부 설정의 정확한 v2 App Store profile과 배포 인증서로 수동 서명한다.
QA ID·버전·API URL·iPhone 전용 설정·코드 서명·프로비저닝과 Apple 로그인/푸시/도메인
entitlement를 검사하고 Archive 전체 checksum을 기록한다. Export와 upload에는 각각
검증된 별도 작업 복사본을 사용해 canonical Archive를 보존한다. IPA export 후 같은 앱/버전인지 검사하고 `altool --validate-app`을 통과해야 한다.
빌드 번호는 명령 인자로 고정하며 export가 임의로 올리지 않도록 설정한다.

```sh
python3 tools/mobile/qa_release.py ios-upload --manifest "$RELEASE_DIR/ios/10/release.json"
python3 tools/mobile/qa_release.py ios-status --build-number 10
```

업로드는 `xcodebuild -exportArchive`의 `app-store-connect` / `destination=upload`를 사용한다.
**내부 TestFlight 전용** export이며 외부 테스터/정식 App Store 제출에는 별도 배포 정책이 필요하다.
API에서 같은 build number가 이미 보이거나 로컬 업로드 시도 기록이 있으면 재업로드를 차단한다.
네트워크 실패/처리 지연 시 상태와 비공개 로그부터 확인한다. 처리 지연을 이유로 같은 빌드를
다시 보내거나 무작정 번호를 올리지 않는다.

명령 종료는 전송 완료일 뿐이다. `processingState=VALID`를 확인한 뒤 App Store Connect에서
수출 규정 질문 등 필요한 정보를 실제 앱 내용에 맞게 처리하고 내부 테스트 그룹에 빌드를
연결한다. 테스터가 TestFlight에서 설치 가능한지까지 확인해야 테스트 배포 완료다.
이 도구는 테스터 초대나 외부 심사 제출을 자동으로 수행하지 않는다.

현재 iOS 앱은 GRDB·SocketIO·Starscream을 사용하며 외부 라이브러리가 없다고 간주하지 않는다.
현재 plist의 `ITSAppUsesNonExemptEncryption=false` 선언은 실제 제품의 암호화 사용 범위에
대한 스토어 제출 검토와 함께 유지한다. 암호화 기능이나 의존성을
추가할 때에는 [Apple의 해당 키 설명](https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption)에 따라 선언을 다시 검토한다.

## Xcode CLI 진단

Xcode GUI나 Simulator 앱을 띄우지 않아도 빌드할 수 있지만, asset catalog 컴파일에는
정상 설치·마운트된 iOS runtime이 필요하다.

```sh
xcodebuild -checkFirstLaunchStatus
xcrun simctl runtime list
xcrun simctl list runtimes
xcrun simctl runtime match list
xcodebuild -showdestinations -project apps/ios/Rogichat.xcodeproj -scheme Rogichat-QA
```

디스크 이미지가 Ready여도 실제 runtime 목록이 비면 `xcrun simctl runtime scan-and-mount`로
마운트를 점검한다. SDK와 설치된 같은 OS runtime의 build 매핑이 다르면 `simctl runtime match`
도움말을 따라 **실제로 설치된 build**에 매핑하고 destination을 다시 검증한다. 버전 문자열만
보고 임의 build를 지정하지 않는다. Xcode 업데이트 후에는 override를 재검토한다.
`IB Support/Simulator Devices` 생성 오류는 `~/Library/Developer/Xcode/UserData/IB Support`의
끊어진 심볼릭 링크 여부도 확인한다. `/tmp` 대상으로 연결했다면 재부팅 후 대상이 사라질 수 있다.

## CI

`Mobile foundation`은 네 Android variant 검사와 iOS 네 configuration 빌드를 수행한다.
추가로 업로드 안전장치 단위 검증과 임시 QA 키를 이용한 APK/AAB 빌드를 실행한다.
임시 키는 runner의 저장소 밖에 생성하고 CI 종료 시 폐기한다. 실제 계정 자격증명·배포 키는
CI/PR에 제공하지 않으며 CI에서 Firebase/TestFlight 업로드를 수행하지 않는다.

참고: [Firebase 서비스 계정 인증](https://firebase.google.com/docs/app-distribution/authenticate-service-account?platform=android),
[Firebase APK 배포](https://firebase.google.com/docs/app-distribution/android/distribute-cli),
[App Tester 설정](https://firebase.google.com/docs/app-distribution/get-set-up-as-a-tester?platform=android),
[Apple 빌드 업로드](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/),
[TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

## 업로드 후 확인 명령

APK 업로드와 TestFlight 전송 이후 승인된 테스터 분배, 원격 산출물·테스트 내용·내부 그룹
확인은 [모바일 QA 업로드 후 확인](mobile-release-finalization.md)을 따른다. 명시적 로컬
운영자 명령이며 업로드를 다시 실행하지 않는다. 외부 journal로 중복 실행과 불확실한
응답을 관리하고, 실제 원격 읽기 확인까지 통과해야 해당 단계를 완료로 기록한다.
