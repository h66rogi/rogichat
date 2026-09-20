# 실제 대화 구현과 검증 경계

2026-09-20. Android·iOS는 같은 QA/Prod 제품 조립부에서 실제 방 선택, snapshot/events/history,
방 프로필, SHARED/PRIVATE TEXT 입력과 서버 접수 확인을 연결한다. 구현 기준은 C04/C05/C06을
통합한 서버 소스 `f9197a31d61b7c34256e92f0bcb73ee255275d40`이다. 이 문서는 진행 중인
통합 기록이며 실제 사용자 로그인·기기 간 송수신·스토어 배포 성공 기록은 아니다.
Android 대화 소스는 `d1b5bd816f12b34f36ad98d4fe966f6aab94ecd6`, iOS는
`f17c031fd614be40afd4dbf3c0a6a41cb19ad673`로 고정했다.

## 제품 동작과 저장 경계

서버가 허용한 메시지를 실제 계정별 SQLite에 저장한다. 빈 응답, 로딩, 조회 실패와 재시도를
구분한다. 없는 계정·메시지·전송 성공을 만들지 않는다. 원래 계정과 credential 세대, 방의
membershipScope(M), authorizationRevision(A), cache generation을 HTTP와 DB COMMIT까지
확인한다. 기존 멜로밍에서 추출한 공통 HTTP·repository 주입·목록 상태·navigation을 확장하고
채팅 UX, wire 계약과 durable outbox는 로기챗용으로 구현한다.

명시적인 전송 의도는 원래 M과 불변 clientMessageId·본문·수신 대상·인용을 실제 DB에 기록한
후 한 번 전송한다. 화면이 사라져도 이미 접수한 작업의 소유권은 세션 계층에 남는다.
timeout·응답 유실·재시작 이후에는 결과를 GET으로 조회한다. 404나 snapshot 누락으로
미전송을 단정하거나 새 ID·새 M으로 자동 전송하지 않는다. 현재 메시지 ID는 정확한 서버
접수 결과로만 연결하며 내용·작성 시각이 같은 메시지를 임의로 합치지 않는다.

완전한 membership manifest에서 M이 바뀌거나 방이 사라지면 이전 참여의 본문·프로필·outbox를
정리한다. A만 바뀌면 수신 projection과 cursor/cache를 폐기하고 다시 확인하지만 같은 M의
불명 전송 의도는 원본 그대로 보존한다. 공개된 표시 순서 `(createdAt, id)`와 opaque cursor를
구분하고 uint64 version의 정밀도를 잃지 않는다. terminal tombstone은 같은 cache/M/A에서
나중에 도착한 live 메시지보다 우선한다.

C05 author/counterpart/allowedActions/content는 같은 version에서도 전체를 교체한다.
인용 중인 메시지도 현재 projection으로 바꾸며 답장 권한·대상이 바뀌면 선택을 해제한다.
개별 메시지의 403/404는 해당 표시만 중단하고 방 권한 상실이나 삭제 완료로 추정하지 않는다.
그때 확인된 메시지 본문을 이전 committed outbox에서 대신 표시하지 않는다. 서버 접수와
현재 허용된 실제 DTO를 함께 확인한 명령은 본문과 반복 접수 조회를 정리한다.

timeline 페이지 크기는 20이며 기존 1 MiB 응답 상한을 유지한다. 합법적인 최대 TEXT와 인용이
모인 페이지가 클라이언트 상한을 넘지 않도록 요청을 제한한다. 합성 응답·계정은 테스트에만
있으며 앱 target과 산출물에는 포함하지 않는다.

## 실행한 검사와 남은 검증

- 이전 계정 탈퇴 통합 SHA `8216b8f35b45a1ab1a2e3c1b570a42a17b5178fe`의 원격 전체 검사와
  실제 Android 저장소 19개는 [별도 기록](mobile-account-deletion-progress.md)을 따른다.
  그 결과를 새 대화 소스의 검증 결과로 간주하지 않는다.
- iOS 대화 checkpoint의 strict Swift 6 화면 모델·transport 실행, 실제 GRDB 25개,
  새 NativeSessionService/AppSession과 실제 DB 재개방을 연결한 복구 harness가 통과했다.
  복구 중 기존 전송은 총 한 번, cold start의 새 전송은 0회였다. Debug-QA 기기 SDK 빌드와
  실제 앱의 제품·개인정보 패키지 검사도 통과했다.
- 최종 iOS 고정 소스에서 실제 GRDB 27개가 모두 통과했다. A-only pending 보존과
  receipt/current-message version 차이의 추가 DB 회귀 두 개도 실제로 실행했다.
  화면 모델·transport 검사는 페이지 제한과 오류 분류 보강까지 통과했다.
- 통합 커밋 `5a5e423a962ed8b92599a9b5df55d6f20571b7c4`에서 strict Swift 10개
  시험 묶음, 실제 GRDB 27개와 세션/SQLite 복구 harness를 모두 다시 실행해 통과했다.
  Python 배포 도구 122개도 통과했으며 실제 일회용 Keychain의 로컬 opt-in 1개만 생략됐다.
  [통합 PR #74](https://github.com/h66rogi/rogichat/pull/74)의 원격 전체 검사는 별도로 진행한다.
- Android 고정 소스는 QA JVM 197개(실패·오류·skip 0), lint와 앱·androidTest Kotlin
  컴파일을 통과했다. 신규 저장소 8개를 포함한 실제 Room/Keystore 27개 실행, Prod/R8와
  전체 variant 검사는 통합 원격 검사에서 별도로 확인한다.
- 양 OS 전체 통합 검사, 배포용 서명·업로드 및 실제 제공자 로그인·기기 간 송수신은
  최종 결과와 정확한 source SHA를 확인한 뒤 갱신한다.
- iOS host 저장소 시험은 격리 ByteStore·실제 GRDB를 사용한다. 앱의 실제 Keychain 실행,
  APNs/FCM 수신 또는 실제 사용자 SOOP 인증을 대신하지 않는다.

## 병렬 통합과 배포

미디어, 메시지 동작·읽음·스크롤 복원, Apple/SOOP·push는 독립적으로 구현한다. 각 OS의
작성자가 원래 보호 세션·DB·HTTP·navigation·플랫폼 설정에 실제로 연결한다. helper나 UI
코드만 존재하는 것을 제품 기능 완료로 표기하지 않는다. 각 계약의 고정 소스·실제 서버
활성화와 현재 앱의 호환성을 별도로 확인한다.

실제 인증 API 활성화와 사용자 제공자 인증 가능 여부, Android Firebase 재인증, Prod의
스토어 앱 등록·서명·승격은 각각 별도 경계다. [서명 준비](mobile-prod-signing-progress.md)와
[배포 절차](mobile-test-distribution.md)를 따른다. 작은 변경마다 테스터 빌드를 추가하지 않고
사용 가능한 흐름·회귀 검사·알려진 한계를 묶어서 배포한다.

QA의 네이티브 SOOP transaction·launch·completion-exchange 경로는 서버 소스
`397d2f0b59868c1a0579c92ef74a1852c5ce66e6` 배포에서 실제 활성화됐다. 이전 404는
해소됐고 잘못된 completion·재사용·client mismatch·browser Origin 거부도 확인됐다.
이 결과는 실제 제공자 인증 완료나 C04/C05/C06·미디어·Apple·native push 전체 계약의
QA 활성화 증거를 대신하지 않는다.
