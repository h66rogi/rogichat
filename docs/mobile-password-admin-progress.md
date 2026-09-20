# 네이티브 비밀번호 인증과 임시 방 권한

QA19 ROOM_OWNER 산출물과 분리한 PR100 후속 구현이다. 양쪽 제품 앱의 동일한
composition에 연결하며 공개 가입, 내장 계정·암호, 로컬 관리자/방장 우회를 제공하지 않는다.

## 구현

- 실제 `POST /v1/auth/password/login`과 `/change`에 각각 네이티브 clientId와
  `X-Rogi-Client`를 보낸다. Cookie/Origin/웹 CSRF 저장소는 사용하지 않는다.
  성공 응답은 기존 native Bearer/session DTO로 검증한다. 비밀번호는 정규화하거나
  자르지 않으며 12 Unicode scalar 이상, UTF-8 256바이트 이하 계약을 따른다.
- 멜로밍 로그인 입력·보안 필드·포커스 이동·IME·진행 상태를 기존 로기챗 폼에
  이식한다. 비밀번호와 확인 입력은 저장 가능한 UI 상태에 넣지 않고 제출·화면 종료·
  앱 비활성화 시 제거한다. 서버 비밀번호 기능이 있는 계정만 변경 메뉴를 표시한다.
- Android는 기존 auth attempt/epoch, protected credential store, 늦은 토큰 폐기,
  방 데이터 철회와 원래 계정 확인을 재사용한다. iOS는 기존 Keychain auth journal,
  원자적 install, UI acknowledge/discard, cold recovery를 재사용한다. password
  journal은 로컬 작업 기록이며 서버 OAuth transaction ID를 만들지 않는다.
- SOOP REQUIRED와 READY/chat=true가 함께 오는 실제 심사 권한은 허용하지만 SOOP
  연결 표시는 false로 유지한다. 일반 미연결 제한, 401·만료·계정 전환 처리는 유지한다.
- 설정은 실제 `GET /v1/me/capabilities`에 따라 관리자 진입과 비밀번호 변경을 표시한다.
  기본방은 페이지를 순회한 서버 room discovery의 isDefault로 찾는다. 방 ID나 소유자를
  앱에 내장하지 않는다. 참여/권한이 없거나 API가 실패하면 오류 및 재조회 상태를 표시한다.
- room capabilities와 test-grants 목록/다음 페이지, 5분·15분·1시간 self grant,
  사유 입력, 회수를 연결한다. 요청은 UUID requestId를 포함하며 대상 사용자 선택은 없다.
  불확실한 명령 응답은 성공으로 표시하거나 자동 재전송하지 않고 GET으로 다시 확인한다.
- 권한 변경 시 기존 방 scope/authority를 철회하고 재검증한다. 만료 시각은 화면 수명과
  분리된 세션 작업에서도 처리해, 설정을 떠나도 기존 권한을 철회하고 서버를 재조회한다.
  실제 권한은 서버 effectiveRole/authorizationRevision이 결정한다.

## 저장 호환성과 영향

앱 DB 스키마를 바꾸지 않는다. iOS protected schema3 journal은 password provider와
exchanging 단계의 로컬 기록을 추가로 해석한다. 진행 중인 이 기록을 예전 앱으로
다운그레이드하면 기존 fail-closed 정책에 따라 자동 복원하지 않는다. 완료된 credential
형식은 동일하다. 비밀번호나 임시권한의 로컬 플래그로 접근을 허용하지 않는다.

기존 Apple/SOOP 인증, 계정 삭제, 명시적 PRIVATE 답장, ROOM_OWNER outbox 형식은
유지한다. 참조 멜로밍 저장소는 읽기 전용이며 키·환경파일·운영 데이터를 복사하지 않았다.

## 검증과 배포 경계

Android 테스트는 실제 native request header/상태, self-only payload, 형식 제한,
로그인/비밀번호 교체, 취소 뒤 늦은 발급 토큰 폐기, 저장 실패, 다른 계정 응답 거부,
관리자 요청 후 계정 전환, 만료 시 GET 재조회와 authority 철회를 검사한다.
iOS는 전체 앱 컴파일과 기존 product/native/Keychain/SQLite suite에 더해 비밀번호
헤더·회전·취소·cold no-replay·저장 실패 및 관리자 stale-response 검증을 수행한다.
합성 계정과 응답은 격리된 test target에만 있다.

소스 구현/빌드 성공은 운영 인증 성공 증거가 아니다. 이 기능의 실제 QA 사용에는
대응하는 백엔드 password/admin API와 실제 서버 권한·계정의 배포가 필요하다.
고정 QA19는 이 후속 변경을 포함하지 않으며, 기존 ROOM_OWNER API 준비 확인 후
별도로 배포한다. Firebase 서비스 계정 IAM과 Apple 서버 SIWA 키 준비는 독립 항목이다.

독립 리뷰 후 만료 재검증 경계를 추가 검증했다. Android 만료 작업은 자신의 타이머
참조를 먼저 해제해 후속 capabilities GET이 현재 작업을 취소하지 못하도록 하고,
최종 session 재조회 및 새 generation 적용까지 테스트한다. iOS는 서버 응답을
기다리기 전에 AppSession의 화면용 roomsScope도 nil로 만들어 이전 권한의 대화가
남지 않게 한다. 제어된 지연 응답 테스트로 즉시 철회와 새 scope 복원을 확인한다.
