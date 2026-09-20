# 실제 방 참여와 나가기

2026-09-20. [MB04a 방 목록·저장소](mobile-rooms-progress.md)의 후속 범위다. 실제 discovery
행의 참여와 확인된 membership의 나가기를 연결한다. MB04b/c의 메시지 cache·전송·복구를
완료한 단계로 집계하지 않는다. QA/Prod는 같은 구현을 사용한다.

## 고정 계약과 동작

C06 `691aff80bbcc96903ffe11d76b2a7561859ddb02`의 실제 controller/service/DTO를 기준으로
양 OS 설계와 구현을 대조했다. `POST /v1/rooms/{UUIDv4}/join`과 `/leave`의 body는 `{}`다.
참여는 정확한 200 JSON의 actorId·historyPolicy·UInt32 policyVersion·M/A를 검증하고,
나가기는 정확한 204와 빈 body만 허용한다. join 응답에 없는 role이나 roomId를 추정하지 않는다.
409는 공통 충돌이며 소유자라고 단정하지 않는다.

화면에 실제 표시한 계정 scope·방·목록 cycle과 나가기 확인의 원래 M을 전달한다. 새 목록이
도착한 뒤 옛 행의 callback을 실행해도 최신 cycle에 재결합하지 않는다. 계정 A→B→A나
같은 계정의 재로그인도 옛 선택을 살리지 않는다. 나가기 확인에는 실제 방 이름과
“나가도 보낸 메시지는 삭제되지 않아요.”를 표시한다.

명령은 화면 수명보다 오래 유지되는 coordinator가 소유한다. 첫 suspension 전에 이전
목록의 동작 권한을 닫고, 원본 credential·scope를 검사한다. 기존 membership 행을
미확인 상태로 유지하면서 새 cacheId·빈 staging·불완전 checkpoint를 실제 DB COMMIT까지
반영한 뒤 POST를 한 번만 전송한다. 저장 실패는 POST 0회다. 설정·로그아웃은 계속 이용할 수 있다.

응답 이후 같은 owner가 새 complete manifest를 먼저 모으고 discovery를 갱신한다. 다른 방의
authorizationRevision도 함께 바뀔 수 있으므로 한 행만 낙관적으로 바꾸지 않는다. 부분 페이지,
reset의 빈 배열, discovery 누락, 오류는 membership 삭제 증거가 아니다.

## 응답 유실과 현재 조회값

서버 ACK, 요청 결과 불명, 현재 조회한 참여 상태를 구분한다. timeout·유실·비정상 응답 뒤에는
GET만 재확인하며 POST를 자동 반복하지 않는다. GET 성공은 이전 POST의 종료·실패를
증명하지 않는다. 이전 POST가 조회 이후 늦게 commit될 수 있으므로 결과 불명 안내를
조회 오류와 별도로 유지한다. 새로고침·실패·화면 재생성으로 안내가 사라지지 않는다.

fresh complete manifest 이후 사용자가 새 동작을 선택할 수 있으나, 이는 새 명시적 선택이다.
이전 요청의 취소·실패 확정이나 서버 실행 순서 보장이 아니다. 앱 재실행은 기존 cold authority
초기화 후 실제 GET만 수행한다. pending POST 복원·재전송 큐나 반대 동작을 통한 보상은 없다.

현재 서버에는 expected M/CAS·idempotency key·membership command receipt가 없다.
서버 처리 전 다른 기기에서 나가기→재참여가 일어난 경우 현재 membership에 명령이 적용될 수
있다. 클라이언트의 선택 검사를 서버 기간 CAS처럼 설명하거나 미정 필드를 보내지 않는다.

## 실제 재사용과 검증 경계

Meloming의 비채팅 설정·리뷰 화면에서 native 확인창, 선택 대상 고정, 취소/destructive,
진행·스크롤·버튼 상태 패턴을 수정 재사용한다. 기존 typed HTTP/repository·목록·테마도
확장한다. 원본의 즉시 목록 삭제·성공 toast·MFA business나 Talk/TalkV2 UX는 가져오지 않는다.
새 command 소유권·원래 선택 검사·실제 DB COMMIT·전체 manifest 조정은 현재 계약에 맞춘
신규 구현이다. [재사용 기록 R44–R46](mobile-reuse-audit.md)에 원본과 대상을 구분한다.

독립 리뷰에서 동시 재확인, GET 실패 시 결과 불명 안내 소실, 옛 행의 최신 cycle 재결합,
204의 공백 body 허용, 이전 목록을 복원할 때 action이 다시 열리는 경계를 점검했다.
실제 화면 모델과 저장소·서비스 회귀로 각 경계를 검증했다. Android 앱 고정 소스
`84dfc93a9fb53cf1329ab1373b81e7422499771a`는 QA 155개·Prod 147개 Debug JVM 시험과
QA 컴파일·lint를 통과했고 실패/error/skip은 0개다. 이번에 추가한 회귀는 20개다. 기존 실제
Room 계측 16개는 MB04a의 별도 증거이며 이번 JVM 시험으로 대체하거나 새 실행으로 집계하지 않는다.

iOS 앱 고정 소스 `d2e132e35cae1526ac41bc33a414d9b8150cfc94`는 strict Swift 6 실행 시험
일곱 종과 실제 GRDB 16개, Debug-QA 기기 SDK·패키지 guard를 통과했다. 새 시험은 실제
RoomsScreenModel/RoomsFeatureOwner를 직접 실행하며 보존한 이전 목록의 동작 권한 차단,
재연결·옛 행·결과 불명·조회 오류를 확인한다. 통합 후 Android QA/Prod의 네 구성 빌드·lint·
Release R8·실제 APK guard, iOS 일곱 실행 시험·GRDB 16개·네 기기 SDK 구성과 패키지 검사를
모두 통과했다. XcodeGen 재생성 diff는 0이다. hosted CI와 이 단계의 서명 배포는 아직
대기 중이며 완료 후 증거를 기록한다.

DEV의 별도 Git 저장소 54개에서 새 command/owner 참조를 읽기 전용으로 검색했고 직접 참조는
없었다. 같은 저장소의 API·웹과는 고정 C06 계약을 대조한다. 서버 필드·DB schema·라이브러리·
새 추적 데이터는 추가하지 않는다. fixture는 자동 테스트에만 존재하며 제품 소스·패키지에서 검사한다.

실제 QA 계정 왕복에는 SOOP 발급, schema 2의 웹/앱/API 동시 활성화와 실제 방 데이터가
필요하다. 컴파일·격리 시험·내부 배포를 실제 사용자 성공이나 메시지 기능 완료로 대신하지 않는다.
