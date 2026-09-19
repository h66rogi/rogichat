# 백엔드 구현 계획: 다중 인스턴스·복구·보안

2026-09-20. 상태: **구현 전 권고안**. [제품 정책](backend-design.md)은 사용자 확정 사항을
유지한다. 이 문서의 기술 선택·성능 목표는 구현 spike와 QA 검증으로 확정한다.
[독립 리뷰 결과](backend-review.md)를 반영했으며 앱 코드·migration·인프라를 배포한 것은 아니다.
최신 결정: **1명 수준 저비용 MVP 운영**, 1,000명은 향후 확장 검토 기준이다.
실제 구현 순서·초기값·PR별 검증은 [MVP 실행 단계](backend-mvp-execution-plan.md)를 따른다.
이 문서의 분산 계약은 유지하지만 Redis·상시 복수 API·HA·1,000명 부하를 MVP 출시 조건으로 두지 않는다.

## 1. 현재 상태와 목표

검토 기준 `ad1f7f6`: `apps/api`는 README뿐이고 앱 package manifest, Nest 코드, DB schema,
메시지·세션·Socket.IO 구현은 없다. QA 인프라 문서는 EC2 앱 호스트와 Aurora MySQL writer 1개,
failover reader 없음, Caddy bootstrap을 기술한다. 이 리뷰는 live 자원을 조회하지 않았다.
이전 기반 리뷰의 구축 상태 문구를 현재 배포 증거로 사용하지 않는다.

목표는 단일 코드베이스의 모듈형 API를 단일 프로세스로 운영하되 필요 시 두 프로세스로 시험하고,
메시지 저장·현재 권한·재접속 복구를 특정 API 프로세스나 Redis 생존에 의존시키지 않는 것이다.
QA 단일 호스트에서 두 컨테이너가 정상 동작해도 호스트/AZ 장애에 대한 HA는 아니다.

## 2. 권장 기술 선택

| 영역 | 초기 권고 | 선택 이유와 경계 |
|---|---|---|
| API | NestJS + REST, 별도 Socket.IO gateway 모듈 | 기존 기반 방향 유지. 모든 mutation은 공통 command service를 통과 |
| 클라이언트 전송 | REST POST + 사용자별 멱등 키 | HTTP 응답을 저장 ACK로 사용. socket command는 초기 중복 구현하지 않음 |
| 실시간 | Socket.IO WebSocket-only, **본문 없는 sync hint** | 현재 권한으로 REST 변경분을 조회. websocket 미지원 시 앱 수준 HTTP polling |
| 원본 저장 | Aurora MySQL writer / InnoDB | 메시지·권한·세션·이벤트·outbox·작업 원장은 DB에 영속화 |
| ORM/SQL | Prisma 우선 spike, repository 경계 내부의 명시적 SQL | 복합 FK·locking·SKIP LOCKED·isolation이 정확히 구현되는지 먼저 시험. 실패하면 SQL query builder 대안 ADR |
| 서버 간 알림 | MVP local hint dispatcher, 확장 시 Redis adapter | API가 hint outbox를 소비. 상시 Redis는 초기 불필요 |
| 작업 실행 | 같은 코드베이스, 별도 worker process; MySQL durable job/outbox | 미디어·삭제·push가 HTTP/API 재시작에 종속되지 않음. API마다 cron 복제 금지 |
| 파일 | private R2 + API의 60초 GET 서명 | 기존 확정 정책 유지. 원본·썸네일·공개본 모두 인가 |
| 계약/테스트 | OpenAPI + versioned sync/socket schema + 공통 fixture | TS/Kotlin/Swift 모델·오류·재시도·복구 동작 일치 |

버전은 scaffold 시 공식 registry/호환표로 다시 검증해 lockfile과 image digest로 고정한다.
Redis/Valkey 호환 제품·클라이언트·adapter 조합도 실제 시험하며 이름만으로 호환을 가정하지 않는다.
공유 bus는 public port를 열지 않고 환경별 credential/ACL과 네트워크 경계를 분리하며,
호스트 간 연결은 TLS를 적용한다. bus에 연결할 수 있다는 사실로 사용자 인가를 부여하지 않는다.
Prisma 모델을 API 응답으로 직렬화하지 않으며 transaction scope 밖 DB handle 사용을 검사한다.

Socket.IO는 연결 내 이벤트 순서는 보장하지만 기본 도착 보장은 at-most-once다.
polling transport를 켜면 다중 노드에서 affinity가 필요하며 Redis adapter가 이를 대신하지 않는다.
초기 WebSocket-only는 affinity 의존을 줄이는 대신 제한된 네트워크에서 HTTP polling으로
낮은 실시간성을 제공한다. 네이티브의 Socket.IO protocol 호환성도 spike에 포함한다.
[전달 보장](https://socket.io/docs/v4/delivery-guarantees/),
[다중 노드](https://socket.io/docs/v4/using-multiple-nodes/).

Redis Streams adapter는 일시적인 Redis 연결 단절 복구에 유리하지만 원본 DB나 영구 업무 큐는 아니다.
다중 API 전환 시 payload-free hint와 DB 복구 위에 단순 Pub/Sub를 추가한다. 알림 지연이 실제 병목이면
Streams를 비교한다. Kafka, 독자 room actor, 마이크로서비스 분리는 초기 필수 의존성으로 두지 않는다.
[Redis adapter](https://socket.io/docs/v4/redis-adapter/),
[Streams adapter](https://socket.io/docs/v4/redis-streams-adapter/).

## 3. 모듈·데이터 경계

`auth`, `users`, `rooms`, `access-policy`, `messages`, `sync`, `media`, `reactions`,
`notifications`, `jobs`, `audit`를 Nest 모듈로 분리한다. gateway/controller는 입력 검증과
command/query 호출만 맡고, 인가·transaction·projection을 transport마다 복제하지 않는다.
worker는 API와 같은 domain/repository를 사용하지만 실행 권한·동시성·health를 분리한다.
MVP API는 `REALTIME_HINT` 목적 outbox만 소비하고, worker는 나머지 작업을 소비한다.
worker가 메모리 bus로 API 프로세스에 직접 emit할 수 있다고 가정하지 않는다. 준비 완료된 미디어/
publication 작업도 DB event+hint를 남겨 API가 전달한다. startup scheduler와 batch에 명시적 역할 필터를 둔다.

모델은 제품 설계의 공통 room/member/stream 구조를 유지한다. 추가 구현 항목:

- `room_event_counters`: 방별 내부 단조 순서, 외부 반환 금지.
- `command_receipts`: `(actor_id, room_id, client_message_id)` unique, 정규화 payload의 versioned HMAC digest,
  결과 resource 참조·상태. 과거 전체 응답/본문/Signed URL을 캐시하지 않음.
- `room_events`: durable sync journal. 변경 resource/version·원본 audience 경계를 기록하며
  재생 시 현재 권한과 현재 삭제 상태를 다시 적용. 본문 snapshot을 무조건 복제하지 않음.
- `outbox_deliveries` / `jobs`: 목적별 작업, unique dedupe key, due time, lease owner/token,
  attempts, status. socket hint 완료가 push/물리 삭제 완료를 뜻하지 않음.
- `account_auth_epoch`, `membership_acl_epoch`, `room_policy_epoch`: 세션·참여·접근 변경 경계.
  메시지마다 전역 권한 epoch를 증가시키지는 않음.
- `deletion_requests` / 최소 삭제 원장: 요청·대상·단계별 완료·복구 재적용 증거. 본문 제외.
- `upload_reservations`: 계정/방 quota 예약과 처리 완료/해제 상태, 중복 완료 방지.

plain hash를 장기 보관해 짧은 본문의 사전대입 확인자가 되지 않게 한다. HMAC key는 DB와
분리해 보관하고 version/rotation을 관리한다. 본문 삭제 후에는 digest도 제거하고 최소 사용·삭제
표식만 남길 수 있으며, 이 상태의 같은 키는 payload 비교 없이 삭제됨으로 처리해 재생성을 막는다.

사용자 PK는 UUIDv4, 외부 리소스도 UUIDv4. 초기 UUID 컬럼은 ORM 호환 고정 문자열 표현을
우선 시험하되 binary 저장 대비 index 크기·정렬·join 비용을 측정한 뒤 DDL을 확정한다.
room-bound 복합 FK, active membership 최대 1개, `(message_id,member_id)` reaction unique,
`(source_message_id,source_revision)` publication 멱등 제약을 DB로 검증한다.
인덱스는 `(room_id,stream_id,event_order)`, `(room_id,event_order)`, grant lookup,
job claim `(status,available_at,id)` 등 실제 쿼리의 EXPLAIN으로 결정한다.

## 4. 다중 API에서 메시지 저장

1. transport schema·요청 크기·세션·rate limit을 검사한다. caller/role을 body에서 받지 않는다.
2. 짧은 writer transaction에서 현재 계정/세션, 방/member/grant, 대상·첨부를 검증한다.
3. DB unique로 command receipt를 확보한다. 동일 키·다른 정규화 payload는 충돌이다.
4. 방 counter를 잠그고 증가시킨 뒤 message, attachment link, room event, outbox를 같이 기록한다.
5. commit 후 저장 ACK를 반환한다. Redis·push·다른 기기 수신까지 기다리지 않는다.

이는 발송 흐름이다. 작성자 삭제는 퇴장 후에도 소유권 기반 별도 command로 허용하며
현재 방 열람권을 복구하지 않는다. 계정 자체가 비활성이면 별도 본인 확인·삭제 요청 절차를 따른다.

계정·세션 → 방 → member(UUID 정렬) → stream/grant → message → asset → counter 순의
잠금 규칙을 기준으로 각 command의 lock set을 명문화하고 동시성 테스트한다. 필요 없는 행은
잠그지 않는다. 신규 member 생성 경쟁은 방/unique 제약으로 처리한다. 모든 room mutation이
같은 규칙을 따라야 하며 worker가 반대 순서로 잠그지 않게 한다. DB transaction 안에서
R2/Redis/broker/network 호출이나 디코딩을 하지 않는다.

deadlock/lock timeout은 **transaction 전체**를 제한된 횟수·jitter로 재시도한다.
commit 성공 후 연결이 끊겨 결과를 모르면 같은 멱등 키로 조회/재시도하며 새 키를 만들지 않는다.
앱 메모리 mutex나 Redis lock은 데이터 불변식의 최종 보장이 아니다.
방 counter와 배타 잠금하는 방 행은 hot room의 직렬 구간이다. 두 잠금의 대기/transaction
시간이 목표를 넘으면 먼저 작업을 짧게 하고 부하를 제한한다. 예약 sequence를 transaction 밖에서
미리 발급하거나 느린 fanout이 끝날 때까지 counter를 잡는 최적화는 금지한다.
[MySQL locking](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html).

ACK는 `clientMessageId`, `messageId`, `status=committed`, version 정도의 최소 receipt다.
다른 사용자의 키로 결과를 찾을 수 없으며 retry 시에도 현재 세션/계정과 결과 접근을 확인한다.
삭제된 메시지는 삭제 상태만 반환하고 본문이나 재생성 명령으로 바꾸지 않는다. 초기에는 receipt의
최소 dedupe 표식을 임의 TTL로 지우지 않는다. GC 도입 전 서버 검증 retry window와 만료 명령
거부 계약을 먼저 구현해야 하며, 오래된 offline retry를 새 메시지로 받아들이면 안 된다.

## 5. 실시간·재접속 프로토콜

### 소켓은 변경 힌트, DB sync가 전달 계약

초기 socket schema는 `sync.required { schemaVersion: 1 }` 같은 account-scoped 알림이다.
message/stream ID, 본문, fan identity, raw sequence, private 건수, Signed URL을 넣지 않는다.
서버가 인증한 principal channel만 join하며 클라이언트가 임의 user/room channel을 지정할 수 없다.
private 이벤트는 해당 fan/권한 있는 streamer에게만 힌트를 보내고 방 전체를 깨우지 않는다.
shared hint 수신자 확장은 MVP API hint dispatcher에서 chunk 단위로 처리하고 현재 참여권을
재검사한다. worker는 domain event와 hint outbox만 기록한다.
메시지 저장 transaction에서 전체 팬 수만큼 delivery row를 동기 생성하지 않는다.

gateway의 로컬 연결 상태는 휘발 가능하다. 세션 만료·로그아웃·강퇴에 disconnect를 시도하되
그 성공을 보안 경계로 삼지 않는다. **Socket.IO automatic connection-state recovery는 OFF**다.
과거 room/data/packet 복구 대신 재인증 후 DB sync한다. 나중에 payload socket fast-path를
도입하려면 수신자별 projection/현재 인가/철회 race를 별도 ADR과 테스트로 승인한다.
[자동 복구의 범위](https://socket.io/docs/v4/connection-state-recovery/).

힌트는 유실·중복·순서 뒤집힘이 가능하다. 기기당 sync 한 개만 진행하고 도중 힌트는 dirty flag로
합친 뒤 한 번 더 조회한다. 연결 직후/앱 foreground/명령 ACK 후와 **연결 유지 중에도 주기적**
sync를 한다. 임시 기준은 active foreground 15초 ± jitter, 힌트 fetch coalescing 100–250ms다.
socket 불가 시 foreground HTTP polling 3–5초 ± jitter를 시험한다. background 실행은 보장하지
않으며 복귀 sync와 최소 정보 push로 보완한다. 값은 부하 결과로 조정한다.

계정별 작은 `/v1/sync` manifest는 현재 참여 방의 opaque sync token·reset 상태를 제공한다.
다수 방은 인가된 pagination으로 조회하고 노출된 방만 상세 catch-up한다. 기본 fan 1,000명이
15초마다 조회하면 약 67 manifest 요청/초이며, shared 발송 1회는 최대 1,000기기 fetch를
유발한다. 힌트 지연 분산·batching·페이지 상한과 writer query 최적화가 필수다.

manifest에는 account membership generation을 두고, 같은 generation의 전체 페이지를 다 받은
뒤 membership set을 교체해 사라진 방 캐시를 제거한다. 중간 generation 변경은 enumeration을
다시 시작한다. 한 페이지에 없다는 이유로 퇴장을 판정하지 않는다. 기존 방을 여는 각 API도
현재 권한을 확인하므로 manifest 완료 전이라도 접근을 복구하지 않는다. hint가 오면 현재 열린
방을 직접 sync할 수 있으며 manifest+events의 추가 요청 비용을 부하 계산에서 누락하지 않는다.

### cursor·이벤트·초기 snapshot

`GET /rooms/:id/events`는 현재 권한으로 `{events,nextCursor,hasMore,resetRequired}`를 반환한다.
cursor는 계정·기기/cache generation·방·참여 기간·query·ACL epoch·내부 완료 위치에 묶인
authenticated opaque token이다. 클라이언트나 websocket event에서 임의 위치를 계산하지 않는다.
브라우저 탭/기기가 별도 cache를 쓰면 cursor도 분리한다. user-level 읽음 상태와 섞지 않는다.

- sync cycle 첫 페이지의 새 writer snapshot에서 인가와 upper bound H를 정한다. H는 opaque
  continuation에 넣어 같은 cycle 동안 고정한다. 각 페이지는 현재 인가를 새 snapshot으로 검사하고
  H 이하를 조회한다. 완료 경계까지만 cursor를 전진하고 다음 cycle에서 새 H를 정한다.
  응답 크기/쿼리 시간/페이지 수를 제한한다.
- outbox가 12번 힌트를 11번보다 먼저 보내도 DB의 11번을 건너뛰지 않는다. socket 최댓값,
  message version, timestamp는 sync 체크포인트를 대체하지 않는다.
- 페이지를 만드는 SQL에 ACL·history start를 포함한다. hidden event 개수·gap·전체 high-water를
  반환하지 않는다. `hasMore`도 접근 가능한 추가 결과 기준이다. 토큰은 고정 형태로 암호화한다.
- pagination 중 epoch가 바뀌면 이전 cursor를 거절하고 새 인가 snapshot으로 reset한다.
  새 grant로 과거 접근이 늘어나는 경우도 cursor 이후 이벤트만 읽지 말고 snapshot을 다시 받는다.
- 초기 snapshot은 최신 N개 bounded window와 같은 snapshot의 H에 묶인 cursor를 **한 번의
  짧은 transaction**에서 만든다. 이후 H 다음을 sync한다. 과거 기록 탐색은 별도 history cursor를
  사용하며 여러 HTTP 요청에 걸쳐 동일 DB snapshot을 유지한다고 주장하지 않는다.
- 클라이언트는 이벤트 반영과 cursor 저장을 같은 로컬 transaction으로 처리한다. resource version이
  낮은 응답은 덮어쓰지 않는다. 새 snapshot은 기존 cache와 무조건 merge하지 않고 generation을 교체한다.

sync는 과거 본문을 그대로 재연하는 event replay가 아니라 현재 resource 상태를 반영하는
state-delta다. event 순서는 스캔 기준, resource version은 덮어쓰기 기준이다. 현재 삭제된 메시지는
일반 `canReadMessage=false`로 이벤트 자체를 버리지 않고 최소 삭제 projection 또는 reset을 생성한다.

유효 메시지 보존과 sync journal의 물리 보존은 별개다. journal compaction은 만료 cursor에
`resetRequired`를 반환하고 해당 방 캐시를 폐기·재조회하는 프로토콜을 구현한 후에만 허용한다.
삭제된 private ID를 모든 신규 참여자에게 tombstone으로 알리지 않는다. 이전 가시 범위를
안전하게 판정할 수 없으면 메시지 ID 없는 room/cache reset을 사용한다.
방별 `journal_floor` 갱신과 해당 batch 제거를 같은 transaction으로 commit한다. sync는 인가·
floor·H·event를 같은 snapshot에서 읽고 floor보다 오래된 cursor에 빈 성공 대신 reset을 반환한다.

## 6. 현재 권한과 삭제의 일관성

본문·인용·프로필·반응·attachment URL 발급은 writer의 새 짧은 read-only
`REPEATABLE READ` consistent snapshot에서 세션/계정/member/grant/삭제 상태와 projection을
함께 읽는다. 초기에는 reader replica,
positive local auth cache, Redis 캐시만으로 허용하는 경로를 만들지 않는다.
모든 SELECT는 같은 transaction handle을 사용하며 첫 consistent read가 인가 시점이다.
READ COMMITTED의 SELECT별 snapshot이나 새 인가 locking read와 오래된 본문 snapshot을
섞지 않는다. 인가 DB 접근 불가면 fail-closed다. 목록 N개에 인가 N회가 되지 않도록 batch SQL을
사용하되 공통 User DTO를 쓰지 않는다.
[MySQL consistent reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-consistent-read.html).

선후 기준은 읽기의 새 DB snapshot과 mutation의 commit이다. 철회 commit 이후 시작된
인가 snapshot은 철회된 접근을 허용하지 않는다. 철회 전에 승인되어 이미 생성/전송 중인 응답은 이후 도착할
수 있다. wire-level 회수나 이미 다운로드한 bytes 삭제를 보장하지 않는다. 요청/transaction
deadline을 제한하고 timeout된 처리에서 늦은 발급/응답을 내보내지 않는다. 60초 URL 만료는
사용자가 수용한 별도 capability 경계이며 서명 요청 시작부터 무제한 지연 후 발급하면 안 된다.

REST 일관성은 disconnect broadcast 유실과 독립적으로 검증한다. role/grant 변경·재입장·
로그아웃은 epoch를 바꾸고 다음 manifest/sync에서 이전 cache/token을 거부한다. 권한 힌트를
못 받은 연결에도 다음 API 호출에서 즉시 이 기준을 적용한다.

공개/삭제는 동일 원본과 publication 상태를 잠그고 final publish 전에 재검사한다.
creator 자격, 방장/공개 capability, 과거 private 열람 grant는 별개다. 정당한 방장의 자기 방
모든 private 메시지 공개 권한은 사용자 확정대로 `canPublishSource`에서 검사하며 일반
`canReadMessage`의 과거 grant 부재로 축소하지 않는다. 단순 streamer 추가는 방장 승격이 아니다.
방장 지정/이전은 이 강한 권한을 옮기는 감사 대상이며 이전 UX/과거 조회 범위는 별도 설계한다.
원본 삭제 transaction이 공개본 접근을 먼저 회수하고 후속 worker가 R2 물리 삭제를 수행한다.
소스 삭제 여부를 조회 조건에 포함해 대량 공개본 정리 지연 중에도 접근을 차단한다.
인용된 메시지의 복사 본문도 원본 삭제 후 반환하지 않으며 revision/outbox/job/log에 남은
본문을 빠뜨리지 않도록 삭제 inventory를 만든다. 서명 URL을 job payload로 저장하지 않는다.
삭제는 인가된 외부 write-ahead intent → DB 차단 → 접수 ACK 순서로 기록한다.
삭제 원장은 복구할 DB snapshot과 독립적으로 보존하고 replay checkpoint를 추적한다.
복구 시 최신 삭제 이력의 완전성을 확인할 수 없으면 serving을 열지 않는다. 서비스 관리 본문·파일은
24시간 이내 삭제, 해당 콘텐츠를 포함한 백업은 요청부터 최대 30일 내 제거한다.
탈퇴는 본인 메시지·연결 공개본·첨부를 삭제하고 방 퇴장은 보존한다. 구체 작업은 MVP 실행 단계를 따른다.
공개본의 표시 작성자가 아니라 원본 content owner/deletion root의 탈퇴 상태를 모든 조회와
URL 발급·quote·publication finalize에서 확인한다. 생일 privacy revision은 streamer별 profile
동기화로 전파하고 전체 profile replacement로 보호 필드 캐시를 제거한다.

## 7. worker·파일·분산 제한

작업 claim은 짧은 DB transaction의 `FOR UPDATE SKIP LOCKED` 후보를 실제 Aurora 버전에서
시험한다. 작업 실행 전 claim commit, 외부 작업 후 결과 commit을 분리한다. lease 시간은 DB
시각을 쓰고 owner/token 일치 시에만 완료 갱신한다. 정지했던 이전 worker가 돌아와 새 worker의
결과를 덮어쓰지 못하게 fencing한다. lock은 작업 실행 동안 유지하지 않는다.
SKIP LOCKED는 queue claim에만 사용하며 사용자 history/sync/인가/순서 조회에 사용하지 않는다.

effect마다 `jobId/assetId/revision` 기반 멱등성을 둔다. R2는 immutable target key와 DB 상태
전이를 확인한다. push의 외부 수신까지 exactly-once라고 하지 않는다. timeout 결과 불명은
중복 가능성을 포함해 다룬다. retry는 backoff+jitter+상한, 실패 작업은 별도 상태/경보/재처리
경로를 둔다. 인가 실패/삭제된 원본은 성공 재시도 대상이 아니라 취소 대상이다.

DB fence는 이미 시작된 R2 PUT/COPY를 취소하지 못한다. attempt/generation마다 별도 key를
쓰고 READY key를 덮어쓰거나 재사용하지 않는다. 삭제 asset은 계속 조회 거부하며 DELETE 뒤
늦게 끝난 COPY의 orphan도 재정리한다. 물리 삭제 완료는 DELETE 1회 성공이 아니라 활성 쓰기
작업의 종료/만료와 reconciliation까지 확인한 상태다.
[Transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html).

hint 목적 outbox는 publish 시도 완료일 뿐 기기 전달 완료가 아니다. MVP는 API 로컬 전달,
확장 구성은 Redis publish를 사용한다. Redis 단절이면 재시도하되
DB sync는 계속 복구 경로다. notification/media/delete 목적 작업 상태를 같이 완료 처리하지 않는다.
Redis Pub/Sub는 단절 동안의 메시지를 보관하지 않는다.
[Redis Pub/Sub](https://redis.io/docs/latest/develop/pubsub/).

업로드 quota는 DB에서 예약하고 두 API가 같은 사용자의 한도를 동시에 통과하지 못하게 한다.
완료/거절/만료의 reservation 해제도 멱등이어야 한다. rate limit은 user/room/IP/command별
MVP에서는 DB 원자 counter와 작은 local burst 보호로 구현한다. 확장 시 Redis adapter로 전환할 수 있다.
Redis rate limiter를 도입한 후 장애 시 쓰기/로그인/서명 발급은 무제한 허용하지
않고 503 또는 검증된 보수적 DB 제한으로 전환한다. 단순 hint bus 장애와 구분한다.

미디어 worker는 API와 별도 CPU/memory/timeout/concurrency/임시 디스크 제한으로 실행한다.
디코더에는 앱 세션/DB 관리자 자격증명을 주지 않으며 네트워크 egress를 최소화한다.
quarantine 업로드를 검사한 고정 bytes로 final immutable object를 만들고 READY commit을 수행한다.
R2 key에 private 신원을 넣지 않으며 공개본에는 별도 key/attachment ID를 사용한다.
MVP 업로드는 backend의 실제 byte 제한·bounded scratch spool·known-length PUT을 사용한다.
사용자용 PUT presign/multipart는 후속이며 GET 발급은 현재 인가 후 60초를 유지한다.
실제 QA bucket에서 PUT 취소/고아 정리·GET presign 만료·CORS·Range·삭제 경쟁을 시험한다.
[R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## 8. 배치·장애·배포

| 구성 | 최소 검증 배치 | 보장하지 않는 것 |
|---|---|---|
| local/CI 기본 | API 1 + worker 1 + MySQL, 합성 계정; concurrency fixture는 별도 profile | Aurora/R2의 실제 동작, 호스트 HA |
| QA/MVP | 기존 승인 호스트 안 API 1 + worker 1, 기존 writer DB, Redis 없음 | 호스트·AZ·Caddy 장애 시 지속 서비스 |
| 확장 검증 profile | API A/B + worker A/B + MySQL + Redis + proxy를 임시 실행 | 상시 cloud 자원/구매 승인이나 HA 검증 아님 |
| HA 필요 시 별도 승인 | 다중 AZ app hosts + managed LB, Aurora failover reader, Redis 장애 전략, 분리 worker | 기존 QA 비용/plan으로 자동 승인된 구성이 아님 |

Aurora storage 중복과 DB compute failover 준비는 다르다. reader 없는 구성의 복구 시간을
HA 구성과 동일하게 안내하지 않는다. 향후 reader를 추가해도 보안 조회는 writer로 유지한다.
[Aurora HA](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html).

LB는 WSS upgrade와 idle timeout, trusted forwarded headers, connection limit를 명시한다.
초기 heartbeat 후보는 ping interval 25초/timeout 20초, proxy idle은 합보다 충분히 큰 값으로
실측 조정한다. Caddy reload/stream close 특성도 실제 연결로 시험한다.
HTTP polling fallback은 Socket.IO long-polling이 아니라 stateless REST sync다.
[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

MVP는 단일 migration job의 additive schema 적용 → 구 API admission 차단/drain → 종료 →
새 digest 기동/내부 smoke/readiness 순으로 짧은 점검 중단을 허용한다. rollback은 이전 digest로 한다.
무중단을 위해 초기 메모리·호스트 비용을 늘리지 않는다. API와 worker는 독립 교체한다.

다중 API 확장 후 배포 순서: 단일 migration job의 additive schema 적용 → 새 digest 기동/내부 smoke → readiness →
트래픽 편입 → 구 버전 내부 admission fence + readiness false → LB drain → bounded 종료.
readiness만 바꿔 기존 keep-alive/WS의 새 명령이 계속 들어오는 상태를 방치하지 않는다.
socket 종료 전 비민감 reconnect 힌트와 close를 보내고 클라이언트는 jitter로 재인증/sync한다.
worker는 새 claim 중지, 진행 작업 완료 또는 lease 만료 후 재처리한다. 강제 종료도 correctness가
깨지지 않아야 한다. Caddy/worker/API 전체를 동시에 내리는 배포를 기본으로 하지 않는다.

앱 rollback은 이전 digest로 하되 DB destructive down migration은 자동 수행하지 않는다.
구·신 앱/schema/event N/N-1 혼합 기간을 시험하고 contract 삭제는 별도 릴리스로 늦춘다.
모든 API가 시작 때 migration을 경쟁 실행하지 않는다. 실제 DB 변경은 승인된 환경 절차를 따른다.
runtime DB 계정은 DDL 권한 없이 운영하고 migration 전용 계정을 분리한다. online DDL도
metadata lock·timeout·rollback 영향을 실제 데이터 규모로 시험한다. Nest shutdown hook을
명시적으로 활성화하고 서버 disconnect 방식별 클라이언트의 재접속 동작을 검증한다.
[Nest lifecycle](https://docs.nestjs.com/fundamentals/lifecycle-events),
[MySQL online DDL 제한](https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-limitations.html).

DB pool 상한은 `Σ(배포 중 구+신 API 수 × API pool) + Σ(worker 수 × worker pool) +
migration/운영 여유 < 검증된 DB connection budget`으로 계산한다. 연결마다 새 pool을 만들지
않는다. acquire/query/transaction deadline, circuit breaker, 재접속 jitter를 둔다.
Aurora 장애 후 DNS/connection 갱신, uncertain commit 동일 키 재시도를 검증한다.

## 9. 관측과 확장 단계의 동접 1,000명 시험

아래 숫자는 **향후 확장 시험 목표**이며 MVP 출시 gate·운영 SLA·측정 결과가 아니다. 동일 리전 부하
발생기에서 client/API/DB 지연을 분리하고, 성능 시험 계정은 실제 사용자 데이터와 분리한다.

| 시나리오 | 초기 입력/목표 |
|---|---|
| 인기 방 | 1,000 foreground socket, fan private 20건/초 + shared 1건/초, 30분 |
| 순간 유입 | 위 연결 유지 중 private 100건/초 60초, 과부하 시 bounded 429/503 허용 |
| 다중 방/역할 | 10개 방 분산 + 2 streamer/2 fan/다중 기기, 다른 방·다른 팬 노출 0 |
| 정상 지연 | 저장 ACK p95 ≤ 500ms, 화면 동기화 p95 ≤ 1초·p99 ≤ 3초, 실패율 < 0.1% 목표 |
| 알림만 단절 | websocket은 유지하고 노드 B Redis 연결만 차단, 활성 화면 20초 안 sync 복구 목표 |
| API 종료 | 1,000연결 중 A 강제 종료, 재접속·새 snapshot 없이 정상 cursor 복구 30초 안 목표 |
| 내구성 | 성공 ACK 메시지의 유실/중복 row 0, 삭제 후 재등장 0, unauthorized 응답 0 |
| 장시간/미디어 | 2시간 soak + 업로드/영상 처리 병행, 메모리·pool·queue 무제한 증가 0 |

보안/내구성 기준은 부하에서 느려지더라도 완화하지 않는다. 1,000연결만 열고 idle 상태인 시험을
성능 검증으로 보지 않는다. 1,000명의 여러 기기, 공유 발송 빈도 증가, Redis polling fallback도
추가 곱셈 부하로 측정한다. 용량이 모자라면 먼저 제한·병목 결과를 보고하고 사양/HA 비용을 승인받는다.

필수 metric: commit/ACK/sync p95·p99, room lock wait/deadlock, pool wait/active,
outbox oldest age·retry·DLQ, job lease 충돌, Redis disconnect, socket count/reconnect,
event-loop lag, bounded buffer drop, upload reservation·검사 지연, 삭제 단계별 미완료,
인가 거부율·의도치 않은 DTO field 검사. 원문/URL query/token/생일은 로그에 넣지 않는다.
user/room UUID를 무제한 metric label로 사용하지 않는다. trace/request ID와 비민감 오류 분류로 조사한다.

slow consumer에는 힌트 하나만 유지하고 backlog bytes/개수 상한을 넘기면 연결을 닫아 DB sync를
유도한다. read API에도 페이지/배치/동시 요청 제한을 두어 한 기기가 writer를 고갈시키지 못하게 한다.
health는 process liveness, DB+schema 기반 serving readiness, Redis/worker degraded 상태를 나눈다.
Redis만 죽었다고 healthy REST까지 모두 제거하지 않되 무제한 쓰기 fallback도 금지한다.

## 10. 실행 단계와 완료 기준

| 단계 | 산출물 / 의존성 | 통과 기준 |
|---|---|---|
| P0 계약·spike | transport/sync/오류 schema, ORM/UUID/locking ADR, toolchain lock, 작은 test harness | 두 DB connection의 동일 키·삭제 race·writer snapshot·native 호환 실증 |
| P1 foundation | Nest scaffold, 설정 검증, health, 구조화 로그, 사용자/SOOP/session DB, projection 규칙 | secret 없는 CI, 세션 A발급→B조회/폐기, UUID·CSRF·CORS·DTO 부정 시험 |
| P2 방·인가 | room/member/period/grants, FAN/GROUP policy, epoch, 프로필/생일 scope | 2방/복수역할 matrix, join/rejoin 경계, admin deny, grants 변경 reset |
| P3 텍스트 vertical slice | REST send/delete, receipt, event counter/journal, outbox, snapshot/sync | A저장→B기기 표시, ACK 유실 retry, 삭제·동시 전송·cache 교체 시험 |
| P4 MVP 복구·작업 안정성 | local hint, worker lease/fencing, reconnect/polling/drain/backpressure | F01–F03/F05–F08을 단일 실행/임시 동시성 fixture로 검증. Redis는 확장 단계 |
| P5 개인답장·공개·반응 | private recipient, 오른쪽→왼쪽 swipe 계약, publication 상태, reaction unique | 오발송 금지, 원본 삭제 연쇄, 익명 DTO, 1 reaction 교체 동시성 |
| P6 미디어 | R2 intent/quota/검증/variant/서명/삭제 worker | 실제 QA R2 60초·Range·검사 중 덮어쓰기·두 worker 경쟁 통과 |
| P7 알림·읽음·보존 | 최소 정보 push, read-state, 삭제 inventory/원장/복구 절차 | 잘못된 사용자 push 0, 읽음과 sync 분리, 삭제 데이터 restore 후 노출 0 |
| P8 MVP 출시 검증 | 1명 실제 시나리오·소규모 합성 부하·복구·승인된 QA 배포/rollback | R2/삭제/백업/인가 evidence, 실제 route/digest 확인. 1,000명은 후속 |

인증 broker 변경/실제 SOOP canonical subject 검증은 P1의 외부 출시 의존성이다.
P0의 동시성 spike는 합성 최소 테이블/fixture로 선택을 검증하며 P3 전체 기능 구현을 선행 요구하지 않는다.
mock 로그인은 격리된 test 환경에서만 허용하고 P2–P4 병렬 개발을 돕되 실제 로그인 완료로 간주하지 않는다.
초기 일반 GROUP 방은 데이터/인가/계약 테스트 fixture로 포함하고 사용자 방 생성 UI까지 확대하지 않는다.
읽음의 타인 표시·편집·검색·음성·고정 메시지는 미결 제품 범위로 남긴다.

첫 구현 PR은 P0/P1의 최소 scaffold와 **단일 API/worker + MySQL test harness**로 제한한다.
후속 PR은 한 vertical slice씩 계약→인가→DB→API→복구→테스트 순서로 진행한다.
계획 작성 승인이 앱 구현이나 cloud apply 승인으로 자동 확대되지는 않는다.

### 재현 가능한 장애 시험 목록

| ID | 주입 | 필수 결과 |
|---|---|---|
| F01 | DB commit 직후 ACK 전 API kill, 다른 API에 동일 키 재시도 | 메시지/attachment/outbox 한 세트, 같은 receipt |
| F02 | worker publish 직후 완료 기록 전 kill + lease 만료 | 중복 hint 허용, 중복 domain mutation 없음 |
| F03 | 늦은 11번 작업보다 12번 hint 먼저 전달 | DB sync가 11번 포함, cursor skip 없음 |
| F04 | node B만 Redis 단절, socket 유지, 마지막 이벤트 hint 유실 | periodic sync로 마지막 이벤트까지 복구 |
| F05 | 강퇴/로그아웃/삭제 직후 B의 REST·sync·URL 발급, 기존 stale socket | 새 snapshot 거부, 본문 replay 0; 사전 승인 in-flight는 별도 계측 |
| F06 | 처음 snapshot 조회와 동시에 send/delete, pagination 중 grant 변경·journal GC | snapshot/cursor 경계 누락 없음, floor/epoch reset·cache purge |
| F07 | worker A lease 만료 후 B 성공, A가 뒤늦게 complete | stale fence update 0, final READY/publication 부활 없음 |
| F08 | A drain 중 기존 keep-alive 요청·소켓, 구/신 schema 혼합 | 새 명령 차단/재시도, B로 복구, migration 단일 실행 |
| F09 | 검사 중 overwrite, DELETE 성공 뒤 stale COPY 완료, 삭제와 URL 발급 | 검사한 bytes만 공개, source 삭제 우선, 늦은 고아 재정리 |
| F10 | 원본 공개와 삭제/반응/첨부 연결 동시 실행 | 삭제 원본 공개 불가, 원자적 1 reaction, cross-room attach 거부 |
| F11 | 과거 백업 복구 후 삭제 원장 재적용 전 serving 시도 | readiness 차단, 삭제 원본/공개본/미디어 재노출 없음 |
| F12 | 사용자 두 기기 cursor/read-state, 재입장·offline 장기 복귀 | 기기간 skip 없음, 현재 정책 재계산, compacted cursor는 reset |

MVP CI는 실제 MySQL와 별도 connection/process의 동시성 시험을 사용한다. Redis가 필요한 F04와
전체 다중 노드 profile은 실제 두 API를 운영하기 전 확장 gate다. mock만으로 내구성/인가 완료를 주장하지 않는다.
Aurora 장애/backup restore/R2/외부 브로커·실기기는 승인된 QA 환경에서 별도로 검증한다.

## 11. 확정된 후속 결정과 남은 구현 확인

사용자는 탈퇴 시 본인 메시지·공개본·첨부 삭제, live 24시간 삭제/백업 최대 30일,
운영자 등록 스티커, 예외 열람 비활성화를 승인했다. 생일 공개는 방별이 아닌 전역 설정 하나다.
운영은 1명 수준 저비용 MVP, HA는 초기 제외다. 숫자 예산·무중단 SLA를 승인받았다고 해석하지 않는다.
미디어·rate·pool·작업 빈도는 MVP 실행 단계의 조정 가능한 초기값을 따른다.
실제 소셜로그인 broker 운영/subject 확인, 복구 drill·청구 점검은 구현 중 증거를 확보할 작업이다.

본문 암호화/key custody는 storage encryption과 별도 위협 모델 ADR로 검토한다.
서버가 내용을 처리하는 구조이며 E2EE라고 안내하지 않는다. 스키마/성능 근거 없이
DB shard, Kafka, Redis distributed lock, reader offload를 추가하는 것은 이 계획의 선행조건이 아니다.
