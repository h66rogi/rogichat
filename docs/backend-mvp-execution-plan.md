# 저비용 MVP 백엔드 실행 계획

2026-09-20. **M01–M11 기능과 M12 검증·복구 작업을 통합 중이며, 실제 QA 배포·provider 연동·복구 증거는 별도 gate다.**

실제 SOOP 로그인·초기 프로필·기본방 및 후속 권한 기능의 확인 결과는
[운영 경로 검증 기록](backend-live-acceptance.md)을 참조한다. 아래 구현 단계의
완료 조건, 격리 테스트 통과, 실제 공급자/운영 검증은 서로 대체하지 않는다.
최신 immutable source와 hosted 검증 결과는 [통합 기록](backend-integration-m10-m11.md)을 따른다.
아래 단계별 기록은 구현 당시의 순서와 수락 기준이며, 옛 테스트 수를 현재 전체 결과로 해석하지 않는다.
사용자 최신 결정: 초기 1명 수준 사용, 상시 비용 최소화, 구조상 확장성 유지.
제품 정책은 [백엔드 설계](backend-design.md), 동시성·sync 상세는
[기술 구현 계획](backend-implementation-plan.md), 이번 재검토는 [MVP 리뷰](backend-mvp-review.md)를 따른다.
이 문서는 이전의 상시 다중 API·Redis·1,000명 출시 gate 제안을 대체한다.

## 1. 결정 원장과 범위

| 구분 | 이번 기준 |
|---|---|
| 확정 | 초기 후로기 방 하나, 운영 규모 1명 수준. 복수 사용자·스트리머·방 모델은 유지 |
| 확정 | 생일 월·일 선택 입력, 기본 비공개, **전역 설정 하나**가 현재/미래 참여 방 스트리머에게 적용 |
| 확정 | 기록은 삭제 요청 전까지 유지. 방 퇴장은 기록 삭제 아님 |
| 확정 | 계정 탈퇴는 본인 메시지·공개본·첨부 삭제. 운영자 예외 private 열람은 MVP에서 비활성 |
| 확정 | 삭제 시 신규 접근 차단, 서비스 관리 본문·파일 24시간 내 삭제, 해당 백업 최대 30일 내 제거 |
| 확정 | 스티커는 운영자 등록·검수, 팬/스트리머 모두 미디어·스티커 전송; 방별 제한 지원 |
| 유지 | UUID, 현재 권한 검사, 60초 R2 GET URL, 무제한 시점 작성자 삭제, 반응 1개/교체, 스와이프 개인답장 |
| 엔지니어링 초기값 | API 1 + worker 1, Redis 없음, DB rate counter, 미디어 한도·pool·poll 주기 |
| 후속 | 실제 다중 서버·managed bus/LB·DB reader·1,000명 부하·무중단 운영 |

“1명”은 비용·규모 기준이지 소유자를 첫 로그인 유저로 자동 지정하거나 테스트 계정을 하나만
쓰라는 뜻이 아니다. 최소 fan 2·streamer 2·admin·비회원·방 2개를 합성 fixture로 유지한다.
일반 GROUP 방은 core/API 테스트로 검증하고 self-service 방 생성 UI까지 초기 범위를 늘리지 않는다.
모바일/웹 UI 전체 구현은 별도 작업이나 DTO·오류·스와이프/동기화 fixture는 함께 제공한다.

## 2. 상시 운영 구성과 비용 경계

MVP는 기존 승인된 앱 호스트의 Caddy 뒤에 API 1개, 같은 호스트에 worker 1개를 둔다.
DB는 별도 인프라 작업에서 준비한 Aurora writer를 사용하고 사용자 파일은 private R2에 둔다.
앱 호스트/DB를 새로 만들거나 축소·삭제하는 지시가 아니다. 당시 인프라 기록은
[readiness](infrastructure-readiness.md)에 있고 이번 계획에서 live/청구를 재검증하지 않았다.

- 새 ALB, Redis/ElastiCache, Aurora reader, Kafka, 별도 미디어 서버, 유료 영상 SaaS를 요구하지 않는다.
- API/worker는 같은 image의 다른 entrypoint이며 CPU 작업만 별도 프로세스/컨테이너로 제한한다.
- 로컬과 public CI는 MySQL 컨테이너·합성 데이터, 소수 테스트 프로세스로 검증한다. 테스트를 위해
  cloud 서버를 상시 두지 않는다. private QA credential을 public PR job에 전달하지 않는다.
- 현 EC2/Aurora·storage/I/O/backup/R2·로그·CI 비용이 0이라고 하지 않는다. 이미 존재하는 자원과
  RI 할인을 이유로 비용을 추정하지 않는다. 배포 전 실제 청구/사양을 운영 담당 작업에서 확인한다.
- 업로드 한도·고아 정리·bounded logs를 먼저 구현한다. 예산 초과 예방은 **신규 업로드 제한**으로
  처리하며 정상 채팅/첨부를 자동 삭제해 비용을 맞추지 않는다.
- 초기에는 점검 배포의 짧은 중단을 허용한다. 정량 월 예산이나 24시간 on-call/HA SLA는 미승인이다.

확장은 측정 뒤 별도 실행한다. CPU/메모리·DB pool/lock 대기·ACK/sync 지연·작업 backlog가
소규모 목표를 지속적으로 넘으면 원인을 확인하고 API/worker 분리·bus·호스트 추가 중 필요한
것만 제안한다. 코드의 multi-room 모델을 운영 HA 자원 구매와 묶지 않는다.

## 3. 단일 배치에서도 유지할 구현 불변식

1. DB commit 전 메시지 전송 성공을 응답하지 않는다. 소켓 수신/읽음은 별개다.
2. 멱등 키·메시지·event·outbox를 한 transaction에 기록하고 서버 재시작 뒤에도 복구한다.
3. 권한과 본문 projection은 fresh writer snapshot을 공유한다. mutation은 정해진 lock 순서를 따른다.
4. private 메시지·활동·생일을 다른 팬에게 전달하지 않는다. 관리자 메뉴가 인가를 우회하지 않는다.
5. 현재 권한으로 REST sync하며 힌트는 유실 가능하다. 연결 중 주기 sync도 유지한다.
6. 단일 worker여도 lease/fence·멱등 완료·재시작 복구를 구현한다. 재배포 중 이전 프로세스가 남을 수 있다.
7. 삭제/탈퇴를 최종 상태로 두며 retry·공개·변환 작업·백업 복구로 콘텐츠를 되살리지 않는다.

### Redis 없는 실행 경로

`POST message → DB commit → ACK` 뒤 API의 작은 dispatcher가 `REALTIME_HINT` outbox를
claim해 자기 소켓에 `sync.required`를 보낸다. worker는 `MEDIA`, `PUBLICATION`, `PURGE`,
`PUSH`, `LEDGER_EXPORT` 등 별도 목적만 claim한다. worker 완료도 DB에 event+hint를 기록한다.
프로세스가 다르므로 worker 내부 EventEmitter가 API 소켓까지 전달된다고 가정하지 않는다.
dispatcher의 publish 완료는 기기 수신 증거가 아니며 주기 sync가 누락을 복구한다.
shared 수신자 확장은 MVP API hint dispatcher가 chunk별 현재 권한 검사로 수행한다.
worker는 shared 수신자를 emit하지 않고 event와 hint 작업만 만든다.

`HintTransport.publish(principals)` 경계의 첫 구현은 local이다. 다중 API 전환 때만 Redis adapter를
추가한다. `local` 모드 배포 명세는 API replica/Node process 1개를 강제하고 무검증 PM2 cluster나
blue-green 동시 serving을 금지한다. 임시 두 API 테스트는 DB 일관성과 polling 복구만 검증한다.
실제 cross-node 실시간 운영 승인은 별도의 shared-bus gate를 통과해야 한다.

DB-backed `RateLimiter`는 짧은 원자 counter transaction과 만료된 bucket 정리 작업으로 구현한다.
계정/방/명령 key와 짧은 IP HMAC key를 쓰며 무제한 고유 key를 만들지 않게 ingress/local burst
제한을 보조로 둔다. DB 장애 시 비용 유발 mutation은 503, 기존 민감 조회도 fail-closed다.
bucket 시계는 DB UTC이며 key lock 순서를 통일하고 GC는 활성 bucket을 지우지 않는다.
확장 시에도 부하 검증된 SQL limiter를 유지할 수 있다. Redis 전환은 선택 사항이다.

## 4. 코드 위치·계약과 공통 검증 도구

현재 구현은 [NestJS 구조 교정 계획](backend-nestjs-architecture-correction.md)의
domain module·DI·Service/Repository·DTO/projection 경계로 분리되어 있다.
Prisma CRUD와 transaction deadline, 현재 ACL 및 최소 출력 DTO는 후속 통합에서도 유지한다.

아래는 코드 책임별 안내다. 실제 실행 명령과 생성 OpenAPI 계약은 [API README](../apps/api/README.md)에 있다.
domain modules·Prisma schema·단계별 migration과 OpenAPI export는 현재 소스에 포함된다.

| 위치 | 책임 |
|---|---|
| `apps/api/src/main.ts`, `worker.ts` | 각각 HTTP/gateway, background worker bootstrap |
| `apps/api/src/modules/{auth,users,rooms,access,messages,sync,media,reactions,notifications,jobs,audit}` | domain/repository/DTO 경계 |
| `apps/api/prisma/schema.prisma`, `migrations/` | 신규 MySQL schema와 단계별 additive migration |
| `apps/api/test/{unit,integration,e2e,fixtures}` | 인가 matrix·SQL race·HTTP/socket·합성 데이터 |
| `packages/contracts/{openapi,sync,fixtures}` | 출력 allowlist·OpenAPI·versioned event·언어 공통 예제 |
| `tools/testing/` | 격리된 MySQL/proxy/fault fixture 및 opt-in 다중 프로세스 profile |
| `docs/runbooks/` | 삭제/복구/배포/rollback/장애 진단 절차; private 값은 외부 ops |

Nest REST DTO에서 OpenAPI를 생성하고 sync/socket schema는 별도 versioned 계약으로 관리한다.
입력 validation의 unknown field 거부와 출력 projection allowlist를 따로 시험한다.
Prisma/UUID 컬럼/명시 SQL의 실제 MySQL 회귀와 migration manifest 검사를 유지한다. private ref repo에서
전체 migration·로그·환경 파일·Git history를 복사하지 않는다.

`lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `contracts:check`는
현재 package script다. `pnpm --filter @rogichat/api <script>`로 실행한다.
PR별 unit/integration + `git diff --check` + public scanner를 수행하고 자기 파일만 commit/push한다.
실행 안 한 테스트는 체크하지 않는다. M01은 API/worker build와 단위·HTTP·프로세스·MySQL
fixture 검증을 제공하며 제품 기능·실제 QA 배포 검증과 구분한다.

## 5. 초기 운영값 — 조정 가능한 구현 시작점

다음 수치는 플랫폼 한도나 사용자에게 약속한 상품 정책이 아니라 **엔지니어링 초기값**이다.
room policy는 이 값보다 낮출 수 있고 운영자는 검증 후 올릴 수 있다. 초과 시 구조화된 오류와
남은 대기시간을 주며, SDK는 파일 업로드 전 표시하되 최종 검증은 서버가 한다.

| 항목 | 초기값/규칙 |
|---|---|
| 텍스트 | 4,000 Unicode code point, UTF-8 16 KiB 이하; 전체 JSON 64 KiB 이하 |
| 사진 | JPEG/PNG/WebP, 파일당 10 MiB, 메시지당 최대 4개, decode 후 20 MP 이하 |
| 영상 | MP4/MOV 입력, 파일당 50 MiB·60초·입력 최대 1080p, 메시지당 1개 |
| 영상 결과 | 검증된 MP4/H.264/AAC 한 가지 rendition + poster; 적응형 다중 화질은 후속 |
| 스티커 | 운영자 등록 정적 PNG/WebP, 1 MiB·512×512 이하; 사용자 pack 업로드 없음 |
| 발송 | 사용자/방 30건/분, 순간 5건/초; 반응은 별도 60회/분 |
| 업로드 | 계정별 미완료 intent 2개, intent 10개/분, 합계 입력 200 MiB/일 |
| 업로드 ingress | backend 경유, 환경 전체/계정 각각 동시 2개, idle 30초/전체 5분, scratch 총 256 MiB |
| 미디어 용량 | 환경별 관리 quota 10 GiB 시작안, 80% 경고/100% 신규 업로드 차단; 정상 원본은 보존 |
| sync | 페이지 기본 50/최대 100 event, foreground 15초±jitter; 힌트 coalesce 100–250ms |
| 소켓 불가 | foreground REST polling 3–5초±jitter, background는 복귀 sync+push |
| DB pool | API 최대 5, worker 최대 2 시작; migration/운영 예산 별도, 실측 후 조정 |
| dispatcher | 연결이 있으면 250ms–1초, 유휴 5초 시작; 겹치는 poll 금지, claim batch 20 |
| worker | 일반 claim batch 10, 영상 동시 실행 1, 삭제 작업 우선; lease/timeout은 작업별 |
| DB 복구 | 초기 목표: 알려진 restore point에서 RPO 24시간 이하, 수동 RTO 24시간 이하; drill로 확인. 미디어 자체 손실 복구 보장 아님 |

HEIC 등 미지원 파일은 클라이언트 변환 또는 명시적 오류로 처리하며 확장자를 바꿔 통과시키지 않는다.
사진·영상 혼합 묶음, animated sticker, 외부 URL import는 MVP 후속이다. 파일 크기만으로 CPU 사용을
제한했다고 하지 않는다. decoder 실행시간·RAM·scratch 한도와 프로세스 강제 종료를 따로 검증한다.
private/public 양쪽, 팬/스트리머 모두 같은 안전 검사를 받고 방별 policy로 제한을 조절한다.

10 GiB quota에는 READY·quarantine·variant·publication 복사본·예약량을 포함한다. 원본 입력만
계산하지 않는다. 변환/publication 전 예상 추가량을 예약하고 부족하면 기존 파일을 지우지 않고
작업을 거부/보류한다. 실제 byte 크기로 정산하고 삭제 완료 전에는 용량을 돌려주지 않는다.
MVP는 사용자에게 PUT URL을 주지 않고 backend가 실제 입력 byte 상한을 집행한다.
변환 결과도 예약한 최대 출력 byte를 넘기면 중단한다. quota는 관리 객체·예약량의 통제이며
provider 청구액의 절대 상한은 아니다. 실패 고아·외부 관리 작업까지 inventory로 대조한다.

## 6. PR 단위 실행 순서

M01·M02의 구현 기록은 아래와 [M02 상세](backend-m02-implementation.md)를 따른다. 의존 단계의 검증을 통과해야 다음 기능을 올린다. 구현 중 작은 PR로
분할할 수 있지만 인가·삭제·복구를 “나중에 붙일 기능”으로 떼지 않는다.

### M01 — scaffold와 재현 가능한 개발 환경

상태: 구현됨. Node 24.21.0/Nest 12.0.3/pnpm 12.4.2 고정, 실제 MySQL 8.0.44 격리 시험,
API/worker 실행·SIGTERM, 안전한 로그·health 계약 시험을 추가했다. CI는 credential 없는
hosted runner 검증이며 운영 배포가 아니다. [사용법·M01 schema gate](../apps/api/README.md)를 따른다.

- 의존: 없음. Node/Nest/pnpm/ORM의 지원 버전·호환성을 다시 조회해 lockfile/digest 고정.
- 변경: workspace 최소 설정, API/worker entrypoint, config validation, health, secret redaction,
  local MySQL fixture, 역할별 실행 script, lint/typecheck/unit/integration CI.
- `/live`와 `/ready` 분리, DB/schema 불일치 readiness 실패. inspector/public debug endpoint 없음.
- 완료: secret 없는 clean checkout build, API/worker 각각 실행·SIGTERM 종료, 누락 설정 fail-fast.
- 제외: Redis, 신규 cloud 자원, 모바일/웹 전체 scaffold, 구 서비스 모듈 통째 복사.

### M02 — DB 기본 schema와 transaction 경계

상태: 로컬 구현 및 실제 MySQL 검증 완료. M01 리뷰 수정과 M02 리뷰 보완 반영.
QA migration·앱 image 배포 및 원격 CI는 별도 실행 검증으로 추적한다.

- 의존: M01. 변경: users/identity/session, room/member/period/grant 기본 migration과 repository.
- UUIDv4 user PK, `(room_id,id)` scoped unique/FK, membership 최대 1개, UTC와 문자열 collation 확정.
- room commit-order counter와 원자 rate bucket primitive도 이 단계에서 만든다. M03 인증 제한과
  M04 입장 시 history 경계가 이를 사용하고 M05는 발송과의 실제 경쟁 시험을 추가한다.
- 실제 MySQL connection 2개로 join/join, commit order, rollback, deadlock bounded retry 시험.
- read-only fresh REPEATABLE READ snapshot과 mutation current reads를 구분하고 모든 query에
  같은 transaction handle 전달. mock/SQLite로 MySQL locking 검증을 대체하지 않음.
- 완료: 빈 DB와 직전 schema 모두 migrate 성공, cross-room FK 실패, migration 전용/runtime DDL 권한 분리.

### M03 — 인증·계정·세션

구현·리뷰·외부 의존 상태: [M03 기록](backend-m03-implementation.md).

- 의존: M02. 변경: SOOP broker adapter, login transaction, UUID user 연결, 세션 digest/만료/폐기.
- [인증 계약](soop-authentication.md)을 구현. broker client 등록/실제 canonical subject는 별도
  외부 의존 작업이며 mock 통과를 실제 로그인 완료로 표시하지 않는다.
- cookie/CSRF/Origin/CORS, 로그아웃/계정 정지, 요청별 현재 세션 확인. test auth는 test process에서만 허용.
- 완료: 성공/거부/timeout/state 변조/code 동시 소비/QA-prod 혼동/다른 브라우저 공격 fixture 통과.
- 실제 사용자 투입 gate: 웹 실제 로그인과 대상 모바일 인증 계약 확인, mock login runtime 활성화 불가.

### M04 — 프로필·생일·방 정책·접근 제어

구현·DTO·후속 sync 경계: [M04 기록](backend-m04-implementation.md).

- 의존: M03. 변경: profile/month/day/global visibility, 방 목록·입장/퇴장·history snapshot,
  `canReadMessage`, `canPublishSource`, DTO projection과 admin capability.
- `birthday_visible_to_streamers=false`가 기본. true이면 대상과 동일 방에서 둘 다 현재 활성이고
  열람자가 streamer인 경우에만 월·일 반환. 신규 방 입장에도 true가 그대로 적용된다.
- 공개 해제는 user profile privacy version을 올린다. room별 값을 복제하지 않는다. streamer
  응답에 생일이 포함될 때만 viewer-specific projection; 팬/일반 admin/비참여 streamer에게 필드 자체 제외.
- streamer별 profile revision/refresh manifest를 별도로 동기화한다. 설정 변경은 해당 streamer에게만
  body-free hint를 주고 주기 sync/오프라인 복귀도 revision을 검사한다. profile은 부분 merge가 아닌
  전체 replacement로 적용해 제외된 생일을 캐시에서 제거한다. 팬에게 생일 변경 활동을 알리지 않는다.
  M04는 revision/projection 계약까지 구현하고 실제 hint/sync 연결·캐시 제거 통합시험은 M06에서 수행한다.
- 2월 29일 포함 유효한 월·일 검사, 출생연도/나이 저장 금지. room actor는 전역 user PK와 구분.
- 운영 등록으로 최초 방/방장 지정, 첫 로그인 자동 owner 금지. 계정 creator와 room owner는 별개.
- 완료: A방 streamer/B방 fan·미참여 streamer/신규방·공개 해제 matrix, 가입/퇴장/재입장 history 경계.
- 산출: `profile.contract.spec`, `access-matrix.spec`, `membership-race.spec` 후보 테스트.

### M05 — 텍스트 발송·최소 삭제·멱등 영속화

구현·인가·queue 경계: [M05 기록](backend-m05-implementation.md). 로컬 92개 시험 통과
(unit 47, 실제 MySQL 29, HTTP/process 14, contract 2). 원격 CI/QA rollout은 별도 확인한다.

- 의존: M04. 변경: messages, counter, command receipt, room events, 목적별 outbox, deletion request.
- 공통 job claim/lease/fence/조건부 완료/retry primitive를 여기서 구현해 M06 dispatcher에 제공한다.
- shared/private intent를 명시하고 typed content 검증. 같은 키에 target/content가 다르면 conflict.
- 짧은 transaction으로 저장 ACK, timeout은 unknown outcome으로 같은 키 retry. payload digest는
  versioned HMAC이고 과거 성공 DTO/본문을 receipt에 보관하지 않는다.
- 모두에게 삭제는 작성자가 기간 제한 없이 실행. 방 퇴장 뒤에도 소유권 기반 삭제는 허용하되 본문
  열람권은 복원하지 않는다. 요청 즉시 tombstone/연결 접근 거부; 실제 purge는 M10에서 완성한다.
- 완료: commit 직후 응답 유실·프로세스 kill 후 retry 원본 1개, 삭제 후 retry 부활 0,
  source quote 삭제 후 복사 본문 노출 0, private→shared fallback 0.
- 공개 사용자 데이터는 M10/M12 전 넣지 않는다. 테스트에서만 미완성 purge 경로 사용.

### M06 — REST sync·소켓·로컬 hint dispatcher

구현·클라이언트 계약·운영 경계: [M06 기록](backend-m06-implementation.md).
로컬 117개 시험 통과(unit 61, 실제 MySQL 40, HTTP/process 14, contract 2).

- 의존: M05. 변경: `/v1/sync`, room snapshot/events/history, account membership generation,
  opaque cursor, Socket.IO gateway, API 전용 hint consumer.
- 최신 N개+H 초기 snapshot, cycle 내 고정 H, 페이지별 새 인가, 기기/cache별 cursor와
  local apply+cursor 원자 저장 fixture를 구현. history pagination과 sync cursor를 구분한다.
- 같은 generation의 전체 manifest 수신 후 사라진 방 cache purge. 중간 generation 변경은 재시작.
- 자동 socket packet recovery OFF, 내용 없는 principal별 hint. 연결 유지 중 주기 sync와
  foreground/reconnect/ACK 후 sync. 서버 종료 방식별 클라이언트 reconnect fixture.
- MVP journal compaction은 **비활성**. 이벤트가 작을 때 복잡한 GC를 먼저 구현하지 않는다.
  본문 없는 event도 비용을 계측하고 floor+atomic GC+reset 시험을 통과한 뒤 후속 활성화한다.
- 완료: 힌트 drop/중복/역순, snapshot 중 send/delete, 오프라인 강퇴/재입장, cache generation 교체,
  slow consumer의 bounded buffer, 타 fan private 활동 room-wide 알림 0.
- dispatcher claim 직후 kill/lease 만료/reclaim/stale complete 거부를 시험한다. 합성 worker
  transaction의 event→API hint 소비를 M06에서, 실제 worker end-to-end를 M07에서 시험한다.

### M07 — worker 내구성·기본 제한·개인답장/공개/반응

상태: 구현·Sub Agent 리뷰 반영·로컬 검증 완료. 상세 계약/검증은
`backend-m07-implementation.md` 참고. 실제 QA 배포와 후속 미디어/삭제 운영 gate는 별도다.

- 의존: M06. 변경: 공통 lease 기반 worker consumer/failed jobs, 명령별 rate 정책, publication 상태와 reaction unique.
- worker는 목적 allowlist로 claim하고 API의 hint 목적을 가져가지 않는다. claim transaction은 짧게,
  외부 I/O는 밖에서 수행, 완료는 현재 lease generation 조건부 update.
- 텍스트 publication부터 구현. 방장의 모든 private source 공개 capability는 일반 read grant와
  구분하고 원본 삭제/제재/타 room은 거부. 공개본은 새로운 UUID·익명 DTO·반응을 가진다.
- 오른쪽→왼쪽 swipe는 개인답장 composer 진입만 한다. 대상·private 표시, 명시 전송, target
  퇴장/권한 회수 시 초안 보존·실패이며 전체 전송으로 변경하지 않는 계약 fixture를 제공한다.
- emoji 1개/다른 emoji 교체, member-message unique. 집계+내 반응만 반환, 다른 fan identity 제외.
- 완료: paused worker lease 탈취 후 stale complete 거부, publish/delete/react 경쟁,
  같은 제한을 여러 connection에서 동시에 호출해 초과 불가, worker 중단 후 job 재개.

### M08 — 사진·avatar·스티커

상태: 업로드·검사·권한별 다운로드·avatar·스티커 구현이 통합되었다. 격리 저장소/decoder
검증과 실제 R2 접근·삭제 운영 증거는 구분한다.

- 의존: M07. 변경: upload intent/quota reservation, quarantine/READY asset, attachment/variant,
  R2 adapter, 검증 worker, 60초 access endpoint, 운영자 sticker 등록 command.
- intent 생성/업로드/첨부에 현재 권한 재확인. `POST /v1/media/upload-intents/:id/content`에서
  인증·CSRF·quota 예약 후 DB transaction을 닫고 실제 bytes를 센다. Content-Length만 신뢰하지 않는다.
- 기본 구현은 제한된 scratch spool → 알려진 길이의 서버 PUT → private quarantine이다.
  파일 전체 RAM buffering/arrayBuffer/memoryStorage 금지, bounded chunk/backpressure 사용.
  비공개 scratch 경로·256 MiB 총 예약·파일별 상한·idle/전체 timeout을 강제하고 재시작 시 청소한다.
  API 업로드와 worker 변환 scratch의 예산/소유를 분리하고 모두 backup 대상에서 제외한다.
  클라이언트 종료/초과/timeout/R2 실패 시 취소·객체/임시본 정리 후 예약량을 멱등 회수한다.
- R2 쓰기 전 attempt를 등록하고 SDK known-length PUT/취소 동작을 spike로 확인한다.
  입력 완료 응답은 UPLOADED/PROCESSING이며 worker 검사 뒤에만 READY다. 업로드 중 DB lock 유지 금지.
  사용자용 presigned PUT/multipart는 후속. 다운로드는 backend 현재 인가 후 60초 Signed GET을 유지한다.
- 임의 bucket/key 입력 금지, avatar preview도 별도 인가한다. backend 경유 EC2→R2 네트워크·TLS/CPU
  비용은 별도 실측한다. 추가 상시 서버가 없다는 뜻이지 전송 비용이 0이라는 뜻은 아니다.
- magic bytes·decode/pixel/size·EXIF 제거·재인코딩, immutable attempt별 final key. 검사 중 PUT
  overwrite·stale COPY 이후 삭제 재정리. decoder에 API/DB 관리자 자격증명을 전달하지 않는다.
- 실제 QA R2를 써서 CORS/만료/변조/타 room/검사 전 조회를 시험하고 값/URL query는 로그에 남기지 않는다.
- 완료: 정책 한도 경계·2 API quota race fixture·final READY 이전 접근 0·공개본 별도 key,
  sticker 비운영자 등록 거부. 미완료/미첨부 quota 회수와 object 정리 일치.
- 50 MiB+1/거짓 Content-Length/chunked/slow upload/abort/scratch 고갈을 시험한다.

### M09 — 제한된 영상 처리

상태: 제한된 영상 처리와 worker 복구 구현이 통합되었다. 실제 배포 image와 기기 재생,
장시간 미디어·채팅 동시 부하는 별도 검증 항목이다.

- 의존: M08. 변경: 영상 검사/단일 rendition/poster, 작업 timeout·메모리/scratch 제한.
- 동시 변환 1개, 같은 호스트라도 별도 제한된 프로세스. API event loop에서 디코딩 금지.
- 50 MiB/60초/1080p 입력 이내에서도 잘못된 container/codec/변환 폭탄을 거부. metadata만 신뢰하지 않음.
- seek/Range의 URL 만료는 backend 재인가·재발급 후 위치 복원. 모든 variant가 원본 삭제 상태를 확인.
- 완료: 미디어 부하 중 텍스트 ACK/sync 정상, timeout worker kill 뒤 job 복구, 고아 파일·예약량 회수,
  삭제와 변환 완료 경쟁, 브라우저/네이티브의 지원 codec fixture. 무제한 원본 저장 fallback 금지.

### M10 — 계정 탈퇴·24시간 purge·백업/삭제 원장

상태: 탈퇴·content/media purge·원장 연계와 Apple revocation 구현이 통합되었다.
실제 외부 삭제·백업 inventory·복구 후 재삭제 및 보존 기한 준수 증거는 운영 gate다.

- 의존: M09. 기존 M05의 즉시 접근 차단을 유지하면서 삭제 완료까지 닫는다.
- 외부 write-ahead intent 뒤 `deletion_requests`와 item checkpoint는 `BLOCKED → PURGING →
  LIVE_PURGED → BACKUPS_EXPIRED`를 구분한다. 일부 실패를 전체 성공으로 표시하지 않는다.
- 계정 탈퇴는 최근 재인증+CSRF로 접수. account를 DELETING으로 바꾸고 세션/입장/신규발송/
  공개/업로드를 차단한다. 작성자의 모든 room 원본과 연결 공개본은 account 상태 조건으로 즉시
  조회 차단하고 batch worker가 실제 rows/assets를 정리한다. 큰 계정을 한 transaction으로 순회하지 않는다.
- 공개본의 표시 작성자와 **원본 content owner/deletion root**를 분리한다. 모든 read/sync/reset,
  quote/URL 발급/publication finalize가 원본 계정의 DELETING/DELETED를 확인한다. 단순 정지는
  탈퇴 삭제와 구분하고 상대방이 작성한 독립 답장은 보존한다.
- 미완료 auth/link transaction을 폐기하고 검증 subject의 HMAC 기반 가입 guard를 둔다.
  guard는 최대 auth transaction 수명과 탈퇴 완료까지 유지한 뒤 정리한다. 늦은 callback은
  재가입으로 바꾸지 않는다. 이후 명시적 신규 가입은 새 UUID이며 기존 room/grant/owner 권한을 복원하지 않는다.
- profile/birthday/identity/session/push endpoint·reactions·hidden/read state도 삭제 inventory에 포함.
  다른 작성자의 독립 본문은 삭제하지 않되 탈퇴자 quote/프로필 복사값은 제거한다.
- 운영자도 private 내용을 읽어 삭제하지 않는다. 상태/개수/작업 ID·실패 유형만 관리한다.
- 완료: 아래 보존 표·실패 시험·외부 ledger·백업 inventory/restore gate까지 증거 확보. 이 단계는
  “사용자 1명이라서” 미룰 수 없는 실제 데이터 투입 전 gate다.

### M11 — 최소 정보 push·내 읽음·클라이언트 계약

상태: 읽음·알림 설정·WEB 및 네이티브 provider 경로가 통합되었다. hosted fixture 통과는
실제 APNs/FCM/Web Push 전달이나 foreground/background 실기기 복귀 증거가 아니다.

- 의존: M10. 변경: device subscription, 내 read-state, `PUSH` job, notification preferences.
- 웹 SW 요구 유지. endpoint SSRF/redirect/내부 IP 방어, QA/prod VAPID 분리, 404/410 정리.
- 기본 알림에는 본문·fan identity·Signed URL 없음. 발송 직전 현재 권한/계정/설정 재검사.
- 읽음은 실제 표시한 허용 메시지 기준, 다른 기기의 sync cursor와 분리. 타인 읽음 표시 UI는 후속.
- 완료: 로그아웃/계정 전환·탈퇴·강퇴 직후 발송 거부, 오래된 job 본문 부활 0, 중복 push의
  클라이언트 처리, foreground/background 실기기 복귀 sync. worker ACK를 실제 알림 전달로 표시하지 않음.

### M12 — 저비용 MVP 출시 증거

상태: credential 없는 검증과 복구 구현을 진행한다. 아래 항목은 수락 기준이며 실행 결과가 아니다.
짧은 preflight와 source-23 soak는 미래 source-24의 전체 성능·복구 수락을 대신하지 않는다.

- 의존: M01–M11. 상시 자원 증설 없이 승인된 환경에서 설정·schema·image digest·실제 route를 확인.
  실제 Aurora restore drill의 일시 자원/비용/정리는 별도 승인된 운영 계획에 의존한다.
- 합성 계정 matrix, 실제 1명 사용 시나리오, 10개 연결의 30분 soak·1건/초 텍스트·영상 1개 동시 처리,
  API/worker 재시작, ACK 유실, 삭제/restore, 단일 API 배포/이전 digest rollback을 검증한다.
- 정상 목표 시작점: ACK p95 500ms 이하, 화면 sync p95 1초 이하, 단절 후 foreground 복구 20초 내.
  테스트 부하는 여러 합성 계정에 분산해 per-user 정책과 충돌하지 않게 한다. 목표 미달은 병목 분석 후 조정한다.
- 출시 불가: unauthorized field/content 1건 이상, ACK된 원본 유실/중복, 삭제 데이터 부활,
  24시간 purge/30일 백업 상한을 지킬 경로 없음, 실제 로그인 불가, mock auth 활성.
- 결과 문서에 실행 명령·fixture version·통계·실패·미실행 항목을 기록하되 민감한 값은 private ops.
  public CI 성공만으로 app/부하/보안 검증 완료라고 하지 않는다.

## 7. 삭제·백업의 구체 운영 계약

### 보존 대상별 처리

| 대상 | 처리와 기한 |
|---|---|
| 정상 메시지·연결 미디어 | 삭제 요청 전 만료 없음. quota 초과가 삭제 권한을 뜻하지 않음 |
| 삭제 원본·공개본·인용 본문 | 요청의 권한 차단 commit부터 신규 조회 거부, 24시간 안 live rows/revisions/copy 정리 |
| 삭제 asset/variant/임시 변환본 | 신규 GET 발급 거부, worker 직접 DELETE·재확인, stale write/generation orphan 포함 24시간 |
| 계정 탈퇴 profile/identity/구독 | 탈퇴 차단 즉시, live 개인정보 24시간 안 제거. 비활성 UUID tombstone은 최소 내부 참조만 |
| DB 자동/수동/최종 snapshot·export | MVP 보존 7일 시작안, 모든 복사본 inventory·expiry 확인. 삭제 요청부터 30일이 절대 상한 |
| 미디어 백업 | MVP 별도 복제 없음. R2 자체 객체 손실/오삭제 복원은 보장하지 않음. DB 복원 뒤 미존재 asset은 READY로 표시하지 않음 |
| 삭제 ledger | 본문 없는 request UUID·대상 opaque ID·시각·scope·진행 상태, 독립 private 보존 경로 |
| command dedupe tombstone | 본문·생일·token 제외. 초기 임의 TTL GC 금지, expired-retry 거부 계약 도입 전 재생성 방지 |
| 임시 intent/quarantine | 만료 1시간 시작, orphan sweep/직접 DELETE; lifecycle은 안전망만 |

“24시간 실제 삭제”는 서비스에서 관리하는 DB content rows와 R2 object/임시본 제거다.
스토리지 장치의 forensic 덮어쓰기, provider 내부 복제본 즉시 소거, 이미 받은 파일의 회수까지
약속하지 않는다. 기한 초과 시 장애로 기록·통지하고 차단 상태를 유지하며 성공으로 숨기지 않는다.
삭제 요청 시각은 인가 후 외부 intent에 고정한 최초 요청 UTC를 DB에도 그대로 기록하며
retry/requeue로 deadline을 다시 시작하지 않는다.

worker는 삭제 작업을 우선 처리한다. purge pending age는 1시간 경고·12시간 긴급 경고,
24시간 breach로 관측한다. worker 장애/용량 부족 때문에 계속 대기하면 일반 변환을 제한하고
삭제 재처리를 우선한다. 상태는 사용자에게 “삭제 요청/접근 차단/실제 삭제 완료”로 구분한다.
기존 외부 운영 경로에서 호스트 heartbeat와 삭제 backlog를 확인한다. 같은 worker만 경보를
발생시키지 않는다. 12시간 escalation의 담당자/대체 purge 실행 runbook을 출시 전 지정한다.
24시간 RTO 목표가 purge 기한을 보장하지 않으며 장애 중에도 삭제 시계는 계속 흐른다.

모든 R2 write attempt는 외부 I/O 전에 source deletion root와 함께 등록한다. ingress 전체 5분,
변환·COPY job 전체 10분을 초기 최대 실행시간으로 두고 hard kill/abort와 orphan sweep을 시험한다.
LIVE_PURGED는 관련 쓰기 종료/만료와 객체 부재 재확인을 모두 요구한다. lease 만료만으로
외부 쓰기가 끝났다고 판단하지 않으며 늦은 쓰기를 이유로 최초 deadline을 연장하지 않는다.

R2 lifecycle은 삭제가 지연될 수 있으므로 24시간 요구를 lifecycle TTL 하나에 맡기지 않는다.
[R2 lifecycle 동작](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
60초 URL은 이미 발급된 capability이며 만료 전 재사용·진행 중 전송의 한계는 유지한다.
[R2 Signed URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

### 백업 시계와 복구 gate

“30일”은 backup 생성일이 아니라 **삭제 요청일 기준 최종 제거 상한**이다. 24시간 live purge
뒤에도 backup에 잔존할 수 있으므로 snapshot을 30일씩 보관해 상한이 31일이 되게 하지 않는다.
초기 DB backup 7일은 비용/여유를 위한 구현값이며 수동·final snapshot·export에도 expiry를
강제한다. 이미 있는 cloud retention 설정은 별도 승인 작업에서 read-back/수정하고 이번 문서로
바뀌었다고 간주하지 않는다. 자동 backup 만료가 manual snapshot을 지워준다고 가정하지 않는다.
운영 담당의 앱과 분리된 기존 automation이 매일 automatic/manual/final/AWS Backup/export를
inventory하고 만료 자원을 정리한 뒤 실제 부재를 read-back한다. 앱 worker에 AWS 관리자 권한을
주지 않는다. TTL tag만으로 BACKUPS_EXPIRED를 표시하지 않고 마지막 retirement snapshot도 포함한다.
[Aurora backup 구분](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Backups.html).

삭제 ledger는 복구 대상 DB와 같은 snapshot에만 두지 않는다. 기존 private object storage의
운영용 별도 bucket 등 접근 분리된 경로에 최소 기록을 남기며 본문/서명 URL은 넣지 않는다.
비용이 큰 별도 queue service 대신 기존 job과 작은 object로 처리하고 암호화/credential을 분리한다.
R2의 bucket scope 권한을 prefix 단위 IAM으로 오해하지 않는다.

접수 순서는 **fresh 인증·소유권 검사 → 외부 durable intent → DB 접근 차단 commit → 접수 ACK**다.
외부 intent에는 request UUID·인가된 대상·최초 UTC를 고정한다. 같은 키의 내용 변경은 거부하고
선택 SDK의 조건부 최초 생성/응답 유실 재조회 계약을 spike로 검증한다. DB transaction 안에서
R2를 호출하지 않는다. 외부 기록 실패는 503 미접수이며 성공을 표시하지 않는다.
외부 성공 뒤 DB 실패/crash는 동일 request ID로 worker가 replay한다. 응답을 못 받은 요청도
이미 durable intent가 있으면 삭제가 진행될 수 있다. intent는 취소 가능한 초안이 아닌 인가된 명령이다.
DB job이 아직 없을 수 있으므로 같은 worker의 독립 ledger reconciler가 외부 intent를 주기 탐색해
누락된 DB request/job을 멱등 생성한다. 시간 watermark만으로 건너뛰지 않고 겹침 재탐색/전체 대조를
수행한다. 외부 write 직후 DB 기록 전 kill 후 API 재요청 없이 복구되는 시험을 필수화한다.
접수 ACK는 DB 차단 뒤에만 반환한다. 각 경계 kill/응답 유실/DB restore를 시험해 DB에만 존재하다
유실된 삭제 요청이 없게 한다. 최종 물리 삭제 완료는 별도 상태다.

restore는 격리된 DB/네트워크에서 진행한다. 최신 삭제 ledger의 검증·재적용 → 계정/공개본/
미디어 deny 재구성 → orphan reconciliation → 합성 접근 시험 → 운영자 release 순서다.
ledger 완전성을 증명할 수 없거나 pending 접수의 손실 가능성을 해소하지 못하면 serving을 열지 않는다.
복원된 삭제 데이터를 다시 backup/export해 보존 시계를 연장하지 않는다.
복원 cluster가 새로 만드는 자동 recovery point도 inventory에 포함해 원래 삭제 deadline 전에 제거한다.
ledger는 최소 31일 유지하고, 연결 backup/export가 모두 만료·제거되고 진행 중 restore가 없음을
검증한 뒤 정리할 수 있다. 최소 재생성 방지 표식은 ledger 본문과 별개로 관리한다.
Aurora restore는 새 cluster를 생성하므로 일시 자원 비용·생성/정리 승인을 별도 운영 단계로 둔다.
로컬 MySQL 복구 시험을 실제 Aurora restore 증거로 대체하지 않는다. 복구한 세션은 전부 폐기하고
cache/cursor epoch를 교체한다. 생일 공개는 안전하게 OFF로 재설정해 백업 이후 공개 철회를
되돌리지 않으며 사용자가 다시 선택하게 한다. R2 정상 객체가 남은 DB 복구와 미디어 자체 손실은 구분한다.
백업 이후 강퇴·퇴장·grant 철회·owner 이전도 되돌려서는 안 된다. MVP는 최신 권한을 독립 증거로
확인하지 못한 복원 membership/positive grant/owner·admin capability를 전부 비활성으로 두고,
운영자의 명시 재승인 전까지 fail-closed한다. 단순 재로그인/재입장이 과거 private grant나 owner를
복구하지 않는다. 강퇴·방장 이전 전 backup을 복구한 뒤 옛 권한자의 조회/공개가 거부되는지 시험한다.

## 8. 테스트·배포·확장 gate

### 매 PR / 실제 데이터 투입 전

- 매 PR: lint/typecheck/unit + 변경 domain의 실제 MySQL integration, contract drift/금지 필드,
  public scanner, 자기 변경만 commit/push, 원격 CI 확인.
- 실제 데이터 전: SOOP login, 권한 matrix, 데이터 삭제/backup/restore, QA R2 서명·Range,
  실제 HTTPS/WSS, 승인된 digest/설정, API+worker memory/CPU와 비용 증가 항목 확인.
- 배포: 별도 migration 계정의 단일 실행 → API admission 차단/drain/종료 → 새 digest 시작 →
  health/로그인/채팅 smoke. 실패하면 이전 digest 복구. 자동 destructive down migration 없음.
- 복구 가능한 이전 image와 state를 보존하고 `down -v`, 광범위 prune을 사용하지 않는다.

### 첫 두 번째 API를 운영하기 전 추가할 것

1. shared hint transport, private network/TLS/ACL; single 모드 config gate 해제. SQL limiter는 검증 후 유지 가능.
2. API A/B·worker A/B·proxy fault fixture에서 기존 [F01–F12](backend-implementation-plan.md)의
   다중 노드 버전을 통과. 특히 B의 Redis만 끊긴 상태의 tail-loss 복구.
3. 모든 replica의 pool 합산, graceful rolling drain, Socket.IO transport/affinity 검증.
4. 예정 peak+여유 부하와 비용을 검증. 1,000명 지원을 표방하기 전 별도 집중 방 capacity 시험을 수행.

이 후속 gate를 MVP PR 앞에 배치하지 않는다. 지금 구현하는 UUID/DB constraint/receipt/outbox/
sync/lease는 교체하지 않고 adapter와 배치만 확장할 수 있게 만든다.

## 9. 남은 확인과 완료 기준

사용자에게 이미 승인받은 생일 범위·탈퇴·삭제 기한·스티커 등록·저비용 방향을 다시 묻지 않는다.
미디어 수치/DB pool/작업 빈도는 위 초기값으로 시작해 실측 조정한다. 외부 broker 등록/subject,
R2 credential/backup expiry/실제 비용과 복구 증거는 개발·운영 검증 항목이다.
계정 탈퇴 시 sole owner인 방의 보존/운영자 재지정은 새 메시지 차단 상태로 안전하게 처리하며
임의 팬을 owner로 승격시키지 않는다. 재지정은 운영 command로 별도 감사한다.

새 메시지 admission은 room owner를 Prisma로 한 건 발견한 뒤 해당 account PK를 current
`FOR UPDATE`로 잠그고, 기존 room lock 아래 owner pointer와 동일 방의 STREAMER/활성
membership·period를 다시 검증한다. 발견 snapshot과 현재 pointer가 다르면 CONFLICT로
종료하며 stale snapshot으로 새 owner를 반복 탐색하지 않는다. owner 없음/부적격 또는
DELETING/DELETED는 NOT_FOUND로 새 발송을 차단한다. SUSPENDED는 방 폐쇄/탈퇴로
간주하지 않으며 기존 recipient/session 정책은 그대로 적용한다.

owner account lock은 room/member/counter/message/job보다 먼저 얻고 commit까지 유지한다.
계정 탈퇴 admission이 방 전체를 잠그거나 scan할 필요가 없다. 기존 actor session/account
lock과 cross-account 경합은 기존 confirmed-rollback bounded retry와 8초 transaction 예산을
유지한다. owner fence는 기존 committed/deleted receipt 처리 뒤 NEW command에만 적용한다.
과거 receipt의 payload conflict·현재 read ACL 검증, 독립 작성 콘텐츠 조회·작성자 삭제는
그대로 유지하고 room status/owner/role을 자동 변경하지 않는다.

publication은 authenticated publisher/current account lock과 현재 room owner 검증을 이미
수행하며 worker도 publisher account → room → publication/source 순서로 재검증한다.
미디어 upload/변환 자체는 이 send fence의 대상이 아니지만 PHOTO/VIDEO/STICKER를 포함한
모든 새 send는 attachment/counter 생성 전에 같은 fence를 통과한다. 소유자 탈퇴가 독립
작성자의 기존 미디어/메시지 read ACL을 일괄 차단하지 않는다.
검증은 `room-owner-send-fence.test.mjs`의 실제 MySQL 두 connection 양방향 경합,
RR stale snapshot, FAN/GROUP, receipt·조회·삭제·SUSPENDED·invalid owner 회귀로 수행한다.
이 코드 검증은 QA 배포나 계정 탈퇴 전체 구현 완료를 의미하지 않는다.

제품 완료란 M01–M12의 코드·tests·실제 QA evidence가 갖춰진 상태다. M01 완료는 개발 골격과
격리 테스트·CI까지이며 인증·채팅 기능이나 운영 배포 완료와 구분한다.
