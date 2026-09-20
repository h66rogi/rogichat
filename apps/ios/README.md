# 로기챗 iOS

Swift 6 / SwiftUI, iOS 18 이상, iPhone 전용 앱이다. QA와 prod는 같은
`RogichatApp → ProductRootView` 제품 경로를 실행한다. 환경은 endpoint, 앱 식별자,
서명 설정으로만 분리한다.

멜로밍의 `MainTabView`, `MyPageView`, `ProfileSettingsView`,
`NotificationSettingsView`, `Loadable/LoadableView`를 로기챗 계약에 맞게 수정 재사용한다.
출처와 구체적인 변경은 [재사용 기록](../../docs/mobile-reuse-audit.md)을 따른다.
채팅 UX는 멜로밍에서 가져오지 않는다.

- 대화/설정의 독립적인 네이티브 탐색, 화면 모드 저장/복원, 실제 기기 알림 상태 조회와
  시스템 설정 이동, 버전 정보가 제품 경로에 연결되어 있다.
- 프로필 Form은 표시 이름, 생일 월/일과 스트리머 공개 설정을 검증한다. nullable PATCH는
  변경 없음과 명시적인 삭제를 구별한다. 전체 프로필은 `GET /v1/me/profile`로 읽고
  `PATCH /v1/me/profile`로 저장하며, 세션 요약에 없는 생일이나 로그인 방식을 추정하지 않는다.
- `NativeSessionService`가 확정된 네이티브 Bearer 계약으로 세션 복원·프로필·로그아웃을
  연결한다. 쿠키, CSRF, Origin 위장, 토큰 새로고침, 리디렉션 전달은 사용하지 않는다.
  QA/prod 별 Keychain과 백업 제외 설치/로그아웃 기록을 사용한다. 만료 또는 권위 있는
  401만 현재 자격 증명을 제거하며, 연결·취소·저장소 오류를 미로그인으로 숨기지 않는다.
  로그아웃은 기기에서 먼저 제거하고 서버 종료 확인 실패를 별도로 안내한다.
- SOOP 로그인과 기존 계정 연결은 각각 공개 LOGIN / 원래 Bearer에 고정한 LINK로 시작한다.
  이용 안내의 현재 버전에 명시적으로 동의한 뒤 PKCE S256과 독립 return state를 생성하고,
  시스템 인증 브라우저의 HTTPS 반환을 검증한다. 보호된 임시 증명과 인증 epoch를 저장하며
  교환은 한 번만 요청한다. 취소·로그아웃·새 작업·프로세스 재시작과 늦은 응답을 구분한다.
  QA/prod의 `applinks`와 `webcredentials`는 각 환경 도메인에 한정된다.
- Apple 로그인·탈퇴·채팅 발신은 실제 계약이 연결될 때까지 활성화하지 않는다. 토큰 입력·
  합성 계정·샘플 방은 없다. 실제 SOOP 발급은 서버 배포, 도메인 연결 및 공식 provider subject
  검증에 달려 있다. 404/503이나 연결 오류를 성공으로 표시하지 않으며, 이 구현의 빌드·자동
  검증은 실제 기기/provider 로그인 성공을 의미하지 않는다.
- 알림 설정의 계정 영역은 실제 GET 확인값을 표시하며, 켜진 계정은 확인한 세대로 전체
  기기·웹 알림을 끌 수 있다. 충돌·응답 유실은 GET으로 재확인하고 자동 PUT 재전송은 하지
  않는다. 기기의 권한 조회·시스템 설정 이동과 독립적이며, 로그인하지 않아도 기기 영역은 유지된다.
  네이티브 푸시 켜기·등록·권한 요청은 연결하지 않는다. 읽음 상태는 타입과 닫힌 전송만 있으며
  실제 메시지 표시·순서·읽음 UI와의 연결은 C05/C06 계약 이후에 진행한다.
- 테스트 fixture는 `Tests/Fixtures`, 제품 상태 검증은 `Tests/Product`에 있다.
  `Sources`와 Resources만 Xcode 앱 target에 포함한다.

CLI로 검증한다. Xcode GUI와 실행 중인 시뮬레이터를 사용하지 않는다.

```sh
xcodegen generate --spec apps/ios/project.yml
python3 tools/mobile/check_ios_wireframe.py
python3 tools/mobile/build_ios.py --derived-data /Volumes/hyeonwoo-ext/DerivedData/rogichat-ios
```

서명과 TestFlight 절차는 [테스트 배포 문서](../../docs/mobile-test-distribution.md)를 따른다.
프로비저닝 프로파일, API 키, 인증서와 산출물은 저장소 밖에 보관한다.
