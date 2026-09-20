# 네이티브 계정 탈퇴 접수 계획

2026-09-20. MB07의 서버 탈퇴 항목을 구체화한 후속 계획이다. 구현·실제 접수·물리 삭제 완료
기록이 아니다. 현재 방 참여/나가기와 충돌하지 않도록 세션 소유권과 보호 저장소의 경계를
먼저 양 OS에서 검토한다. 가짜 성공이나 접수 여부를 추정하는 우회 경로는 만들지 않는다.

## 고정 서버 계약

PR #53 `b251b9aef72c350aa475630654daaa1eec3a75cc`의 controller/service/repository,
exception filter, DTO와 통합 시험을 기준으로 한다.

| 항목 | 소비할 계약 |
|---|---|
| 요청 | 원본 Bearer와 native client header로 `DELETE /v1/me/account`, JSON `{}`를 한 번 전송. target 계정·시각·임의 idempotency key를 추가하지 않음 |
| 접수 확인 | exact 200의 `{requestId, status:"blocked"}`만 ACK. 계정 접근 차단이며 데이터 물리 삭제 완료가 아님 |
| requestId | lowercase RFC variant UUID v4 또는 v5. 방의 v4-only parser를 재사용하지 않음 |
| 최근 인증 | DB 시각으로 session.created_at이 미래가 아니고 15분 경계보다 엄격히 최근이어야 함. expiresAt이나 앱 타이머로 대체하지 않음 |
| 재인증 안내 | exact 403 `RECENT_AUTH_REQUIRED`만 이 흐름. 일반 403을 재인증으로 바꾸지 않음 |
| 인증 거절 | 401 `UNAUTHENTICATED`. 이전 요청 접수 여부를 확정하는 근거가 아님 |
| 서비스 불가 | 503 `UNAVAILABLE`. 원장 접수 이후 처리 실패도 포함할 수 있으므로 미접수 증거가 아님 |
| SOOP 연결 | 본인 인증이 기준이며 endpoint 자체가 SOOP 연결을 필수로 요구하지 않음. LinkRequired 계정에 불필요한 새 조건을 추가하지 않음 |

200 body의 필수 타입·enum·UUID·중복 JSON·크기·UTF-8을 검증한다. 202/204·빈 body·다른
status 값을 완료로 대체하지 않는다. 미지 오류는 안전한 메시지로 표현하며 raw body/credential을
화면이나 로그에 넣지 않는다. 기존 origin 고정·redirect/cookie/retry 금지와 보호 HTTP를 재사용한다.

현재 공개 receipt/status GET는 없다. 응답 유실 후 GET session 200이나 401은 조회 시점의
접근 상태만 설명하며, 과거 DELETE의 접수·종료·실패를 증명하지 못한다. 따라서 이를 접수 확인
기능으로 추가하지 않는다. 확정적인 접수 재조회는 별도 서버 계약이 필요한 항목으로 남긴다.

## 사용자 흐름과 상태

현재 계정 설정에서 실제 대상 계정을 확인하고 native destructive/cancel 확인창으로 진입한다.
확인창의 계정 scope·epoch·환경·작업 identity를 보존하며, 기다리는 동안 A→B→A나 재로그인이
발생하면 전송하지 않는다. 전송 전 취소는 DELETE 0회다. 전송 뒤 화면을 닫는 것은 서버 요청
취소가 아니며, 재인증 이후에도 새로운 확인 없이 DELETE를 실행하지 않는다.

- 200 blocked: “탈퇴 요청이 접수됐어요.” 계정 이용 차단과 데이터 삭제 완료 미확인을 구분한다.
  접수 번호는 실제 서버 requestId만 사용한다.
- exact RECENT_AUTH_REQUIRED: 다시 로그인해야 한다고 안내하고 명시적 선택으로 로그아웃·
  실제 로그인 흐름을 연다. provider 불가일 때 재인증 성공을 대신하지 않는다.
- timeout/IO/503/비정상 성공 응답: “탈퇴 요청의 접수 여부를 확인하지 못했어요.” 접수되었을
  가능성과 이 기기의 계정 정보 정리를 구분한다. 자동 재요청·취소 완료·물리 삭제 완료는 없다.
- 로컬 정리 실패: 실제 ACK 또는 결과 불명을 유지하며 로컬 정리만 재시도한다. 이 버튼이
  DELETE 재전송으로 연결되지 않도록 한다.

`준비/전송/접수 확인/결과 불명/최근 인증 필요/명시적 거절`과 `로컬 정리 대기`는 별도 상태다.
결과 불명과 조회 오류를 섞지 않으며 화면 재생성·앱 재실행으로 성공이나 실패를 추정하지 않는다.

## 보호 저장소와 세션 수명

세션 계층의 유일한 coordinator가 원본 credential과 immutable intent를 검사한다. 첫
suspension 전에 private route·profile/M11/rooms 작업을 닫고, 전송 전에 보호 저장소에
내구성 있는 admission/결과 불명 marker를 원자적으로 기록한다. 이는 재전송할 command queue가
아니다. 기존 rooms purge marker와 실제 DB close/delete를 재사용한다. 필수 marker·DB
무효화가 실패하면 DELETE 0회와 저장 오류를 표시한다.

Android의 보호 AtomicFile/Keystore, iOS의 Keychain envelope와 기존 설치 marker를 확장한다.
token·계정 ID·receipt를 평문 Preferences/UserDefaults·로그에 추가하지 않는다. envelope의
버전·마이그레이션·generic logout marker와의 차이는 구현 전에 양 OS 설계에서 고정한다.

교차 리뷰에서 Android는 별도 보호 journal v1과 기존 clearStamp·credential 삭제를 POST 전에
완료하는 방식을, iOS는 schema 3 journal과 credential 격리를 선택했다. Android의 삭제/복원과
journal 기록 사이 crash phase·원본 fingerprint CAS를 명시하고 stamp 불일치만으로 현재
계정 전체를 정리하지 않는다. iOS 구버전의 명시적 초기화나 앱 제거 후 receipt 생존은 보장하지
않는다. 구버전 호환 보장은 자동으로 옛 인증을 복원하지 못하게 하는 범위다.

HTTP는 원본 Bearer로 한 번만 전송하며 화면 관찰자 취소와 별개로 소유한다. 원본 scope의
200 ACK는 receipt를 보호 저장한 뒤 pending auth를 취소하고 원본 credential·DB를 정리한다.
ACK 보존과 정리 성공은 별도이므로 파일 삭제 실패가 ACK를 지우거나 재전송을 허용하지 않는다.

결과 불명에도 원본 credential·DB를 정리하면서 protected unknown marker를 보존한다. 제한된
session GET로 결과를 해결하는 기능은 추가하지 않는다. 새 로그인으로 떠나는 것이 서버 탈퇴
취소라는 의미도 아니다. exact RECENT_AUTH_REQUIRED는 현재 source의 pre-ledger 거절로
분리하되, 과거의 별도 unknown 요청까지 미접수로 바꾸지 않는다.

최근 인증 거절의 원본 credential 복구는 실행 중 받은 strict 응답에서만 허용한다. 원래 작업·
epoch·fingerprint·미만료·명시적 로그아웃 미발생을 확인하고 기존 실제 세션 조회로 재검증한다.
콜드 복구에서는 격리 token을 정리하고 재로그인을 안내한다. 새 B의 credential 설치는 이전
dispatch 종료·결과 분류·로컬 정리를 완료한 뒤 허용한다. 늦은 A 응답은 자기 operation 기록만
CAS로 갱신한다. UI도 원본 scope를 먼저 검사하며 stale A 확인이 B의 화면을 닫아서는 안 된다.

콜드 시작은 marker와 남은 로컬 정리를 먼저 처리한다. sending/preparing이 남았어도 DELETE를
복원 실행하지 않는다. 손상된 marker를 조용히 무시해 private session을 복원하지 않는다.
late 200/401/503이나 옛 cleanup이 새 계정 B의 credential·DB·로그인 callback을 지우지 않도록
원본 작업과 현재 설치/계정 scope를 확인한다.

정상 ACK/UNKNOWN 기록은 자동으로 퇴거하지 않는다. 최대 16개 기록과 auth/pending 저장
공간을 분리해 제한하며, 한도를 넘으면 새 DELETE를 보내지 않는다. 손상된 journal은 자동
삭제하지 않는다. 다만 사용자가 명시적으로 이 기기의 정보 초기화를 선택하면 서버 요청의 취소나
접수 확인이 아니라는 점과 로컬 기록 소실을 알린 뒤 해당 설치의 로컬 기록을 지울 수 있다.

## Meloming에서 실제 재사용할 부분

Android 원본 `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`의 ProfileSettingsScreen·
MoreNavigation 탈퇴 진입은 실제로 웹 화면을 여는 구조다. iOS
`18a33bbf96fe52b28d0de361916e20549bdcce6b`의 MoreView도 인증 웹뷰 진입이다. 설정 section과
탈퇴를 찾는 위치는 재사용하되 원본 URL·cookie/token bridge를 가져오거나 native 탈퇴
transaction을 이식했다고 집계하지 않는다.

이미 추출한 More/MyPage 확인창, cancel/destructive, 진행·오류 렌더링, typed HTTP와 보호
credential·pending auth·DB purge primitive를 우선 재사용한다. native receipt/unknown
coordinator는 대응하는 원본 구현이 없어 신규 작성이다. 휴대폰 본인인증/MFA를 서버의 최근
로그인 조건으로 대체하지 않으며 Talk/TalkV2 UX는 사용하지 않는다.

## 검증과 운영 gate

필수 회귀는 원본 선택 A→B→A의 DELETE 0회, 중복/화면 재생성의 최대 1회 전송, preHTTP
marker/DB 실패, 200/UUID v4·v5/403/503의 정확한 decode, 응답 유실과 late ledger apply,
receipt 저장·credential clear·DB purge 사이 crash/reopen, 새 계정으로 늦은 응답 유입이다.
새 보호 marker는 실제 Android 저장소·Keychain/GRDB 경계 시험으로 검증한다. 큰 글자와
스크린리더, 취소·로컬 정리 재시도가 서버 명령과 분리되는지도 확인한다.

추가 owner SEND fence는 PR #54 `cd7af58f57498905d90dec505a89d5be6804556c`에 있다.
현재 owner의 상태·활성 membership을 새 SEND commit 전에 확인하는 코드와 회귀를 확인했으며,
기존 receipt 조정은 새 commit과 구분한다. 이 소스의 존재를 QA 활성화로 집계하지 않는다.
원장·전용 guard key·실제 provider, 승인된 schema/서버 배포, 물리 삭제·미디어·백업 보관 후속은
별도 gate다. 앱이 삭제 완료 시각·보관 기한·재가입 가능성을 만들어내지 않는다. 스토어 설명과
공개 개인정보 안내도 실제 운영 범위에 맞춰 별도로 확인한다.
