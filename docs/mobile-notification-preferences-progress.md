# 계정 알림 설정의 실제 서버 연결

2026-09-20. MB03 인증과 별도 변경으로 M11의 계정 알림 설정을 연결한다.
기준은 서버 후보 `43d7bec`의 `backend-m11-contract.md`와 `m11.openapi.json`이다.
이 작업은 푸시 등록·발송·수신이나 채팅 읽음 처리의 완료를 의미하지 않는다.

## 실제 제품 동작

- 기존 멜로밍 기반 알림 설정 화면에 실제 서버 계정 설정을 결합한다. OS 알림 권한과
  계정 전체 설정은 별개이며, 로그아웃 상태에서도 OS 설정을 확인하고 열 수 있다.
- `GET /v1/me/notification-preferences`의 확인된 값만 표시한다. 응답 전이나 오류 시
  true/false 기본값을 만들어내지 않는다. 서버가 허용하는 연결 대기 계정도 조회할 수 있다.
- 현재 native 계약은 `PUT`의 `pushEnabled:false`만 허용한다. 켜져 있는 실제 값을
  확인한 경우에만 계정 전체 알림 끄기를 제공하고 웹·다른 기기에 미치는 영향을 설명한다.
  provider 없는 켜기·등록·삭제 동작은 제공하지 않는다.
- 저장은 확인된 `expectedGeneration`으로 한 번만 요청한다. 409나 응답 유실 뒤에는
  GET으로 현재 상태를 확인하고 사용자의 새 선택을 기다린다. 자동 PUT 재전송이나
  낙관적 성공·과거 값 rollback을 사용하지 않는다.

`generation`은 양의 canonical uint64 decimal 문자열이며 최대값은
`18446744073709551615`다. 계정 generation·accountPartition·local epoch·readContext와
서로 다른 타입과 책임을 유지하고 JSON 숫자나 signed Long/Double로 변환하지 않는다.

## 계정과 요청의 경계

화면이 승인한 원래 계정 범위를 서비스 호출까지 전달한다. 비동기 실행을 기다리는 동안
계정이 바뀌어도 새 계정의 credential을 선택해 이전 화면의 저장을 실행하지 않는다.
같은 계정으로 돌아오는 A→B→A도 이전 요청을 다시 허용하는 이유가 아니다.

Android는 immutable 계정 ID/local epoch, iOS는 서비스 epoch에서 발급한 clientScope를
전달한다. 서비스 진입·전송 전·응답 후에는 범위, 캡처한 credential, 만료를 확인한다.
현재 401만 해당 credential을 무효화하며 늦은 이전 응답은 새 계정을 변경하지 않는다.
계정 변경 시 기존 화면의 서버 값은 제거하고 기기 전역 preference에 저장하지 않는다.
PUT 시작 시 변경 revision을 올려 오래된 GET이 저장 결과를 덮어쓰지 못하게 한다.

독립 리뷰에서 발견한 UI 검사와 service 진입 사이의 계정 변경 문제를 양 OS에서 수정했다.
원래 scope를 전송 전에 검사하는 회귀 시험과 반환 후 응답 검사를 별도로 유지한다.
Android의 UI owner A→B→A 시험을 실제 provider 계정 세 번 로그인으로 과장하지 않는다.

## 읽음 상태와 재사용 범위

room read-state는 정확한 GET/PUT route와 DTO를 검증하는 typed client까지만 준비한다.
lowercase UUIDv4, canonical 32-byte readContext, 필수이면서 nullable인 messageId,
최대 100개 items를 확인한다. 제품 UI 호출·자동 보고·unread 추정·대기열은 연결하지 않는다.
C05/C06의 실제 표시·현재 방 권한·context lifecycle이 준비된 뒤 연결한다.

멜로밍의 설정 화면·ViewModel·API endpoint·repository 경계에서 가져온 구현과 새 CAS/
계정 범위 로직은 [재사용 기록](mobile-reuse-audit.md)에 구분한다. 원본의 default-true,
양방향 onChange, 낙관적 토글, FCM·알림함·읽음 badge·Talk UX는 가져오지 않는다.
현재 HTTP/보호 저장/설정 컴포넌트를 확장하며 별도 네트워크 stack이나 SDK를 추가하지 않는다.

## 검증과 활성화

Android `577fb9e`와 iOS `6513439`를 별도 통합 worktree에 합쳤다. Android는 QA 113개/
Prod 105개 JVM 시험(각 환경 M11 22개), QA lint와 양 환경 컴파일을 통과했다. iOS는
변경 범위의 Swift 6 실행 suite 네 종과 Debug-QA 기기 SDK·패키지 검사를 통과했다.
양 OS의 독립 읽기 리뷰와 각 commit/push 보안 검사는 통과했다. 이것을 통합 runner의
다섯 suite·네 구성 matrix나 실제 배포 결과로 대신하지 않는다.

부모 통합본에서도 Android QA/Prod Debug/Release 네 구성을 빌드하고 R8·전체 lint·
실제 APK 환경/콜백/제품 fixture 제외 검사를 통과했다. 구성된 JVM 시험은 QA Debug
113개와 Prod Debug 105개이며 실패·오류·skip은 0개다. Release 단위 시험을 별도 실행했다고
집계하지 않는다. iOS는 strict Swift 6 실행 파일 다섯 종과 네 기기 SDK 구성·패키지 guard,
XcodeGen 재생성 diff 0을 확인했다. iOS Simulator/GUI는 사용하지 않았다.

PR #51의 고정 소스 `1d5ecfd2e9cda6755159c9ebfe2aa8b40bcdff75`는 필수 hosted CI를 모두
통과했다. 같은 clean 소스에서 양 OS **빌드 12**를 서명·배포했다. Android는 실제 APK/AAB의
환경·콜백·제품 fixture 제외 검사 후 한 번 업로드했고, 원격 APK 해시 일치와 승인 테스터
등록·배포 응답을 확인했다. APK SHA-256은
`add6f54ba01ba76c9752cf8245d11a827d60040ec1e43641b1df0b2cf5c5e910`이다.

iOS는 실제 archive/IPA의 서명·associated domains·환경·privacy 검사를 통과했고 Apple
validation 후 한 번 업로드했다. 정확한 앱/버전/빌드의 `VALID / IN_BETA_TESTING`, 한국어
릴리스 노트와 기존 내부 그룹 연결을 조회해 확인했다. IPA SHA-256은
`bd643fa62f1eb2730fd537e5a6fe39f475a3cc22d8e4e3d1fd7702d0d130aad2`다.
업로드용 복제본과 별도로 canonical archive 해시는 유지한다. 배포 receipt·테스터 정보·
서명 자료는 저장소 밖에 보관한다. 이 단계 artifact 재검사는 해당 소스 `1d5ecfd`의 도구를 사용한다.

이것은 내부 배포 증거이며 QA 브랜치 병합·서버 활성화·실제 계정 설정 왕복이나 물리 iPhone
검증의 대체가 아니다. 합성 서버 응답·credential은 자동 테스트에만 존재하며 앱·QA 배포물에
포함하지 않는다.

M11 서버의 QA 활성화와 실제 발급 credential을 이용한 설정 영속 왕복은 별도 검증이다.
서버가 준비되지 않았거나 요청이 실패하면 오류와 재시도를 제공한다. 실제 provider,
FCM/APNs 등록·발송·OS 표시·tap 검증 없이 native push가 작동한다고 보고하지 않는다.
