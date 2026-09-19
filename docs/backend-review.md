# 백엔드 설계 독립 리뷰

2026-09-20. 기준 commit: `ad1f7f6`. 서브 에이전트 3개가 읽기 전용으로 독립 검토했고,
주 에이전트가 공식 기술 문서와 원문을 대조해 [구현 계획](backend-implementation-plan.md)으로 통합했다.
검토 관점은 실시간·분산 처리, 권한·데이터 보안, 구현 순서·운영 안정성이다.
파일/줄 근거는 **리뷰 전 기준 commit**의 위치이며 이후 설계 보강으로 줄 번호가 이동할 수 있다.

## 요약

공통 room/member/stream 모델, UUID, 최소 DTO, DB 선저장/outbox, private R2, 원본 삭제의
공개본 전파는 유지한다. 현재는 실제 앱 구현이 없어 아래 항목을 운영 취약점이나 실측 장애로
보고하지 않는다. P1은 공개 사용자 데이터/다중 서버 기능을 출시하기 전 해소할 설계 게이트,
P2는 안정성·용량·운영 위험이다. 문서 반영은 구현·검증 완료와 다르다.

주요 결론은 **현재 권한을 적용하는 DB sync를 전달 원본으로 삼고, 소켓은 내용 없는 힌트로
시작하는 것**이다. API 프로세스 2개와 worker 2개를 초기 통합 시험에 포함한다.
동접 1,000명은 사용자가 선택한 검토 기준이며 처리 가능성이나 HA가 검증된 수치가 아니다.

## 발견 사항과 반영

| ID / 우선순위 | 근거 | 위험·영향 | 구현 계획에 반영한 대응 / 완료 시험 |
|---|---|---|---|
| BR-01 / P1 | `backend-design.md:265`, `architecture.md:97` | Redis 연결만 끊기고 소켓은 살아 있으면 마지막 알림을 영구 누락할 수 있음 | 연결 유지 중 periodic sync, hint와 delivery 구분. F04 |
| BR-02 / P1 | `backend-design.md:260`, `:265` | 여러 outbox worker의 역순 발행에서 live cursor로 전진하면 앞선 이벤트를 건너뜀 | 서버 DB scan 완료 경계만 cursor로 사용, 기기별 상태, snapshot 경계. F03/F06/F12 |
| BR-03 / P1 | `backend-design.md:266`, `:355` | Socket.IO 자동 recovery가 철회된 room/과거 payload를 복원할 수 있음 | 자동 recovery OFF, principal-scoped hint-only, REST 현재 인가. F05 |
| BR-04 / P1 | `backend-design.md:135`, `:269`, `:297` | stale cache/reader/유실된 disconnect에 의존하면 다른 노드에서 철회 후 내용을 반환 | fresh writer snapshot으로 인가+projection, fail-closed, in-flight 한계 명시. F05 |
| BR-05 / P1 | `backend-design.md:110`, `:265`, `:321` | lease가 끝난 이전 worker가 새 worker 결과를 덮거나 외부 작업을 중복 확정 | lease generation/fence, effect별 멱등 키·상태 전이, 목적별 delivery 상태. F02/F07/F09 |
| BR-06 / P1 | `backend-design.md:255`, `:258` | retry 성공 DTO 캐시가 삭제된 본문을 돌려주거나 키 GC 후 메시지를 재생성 | body-free receipt, 재인가, unknown outcome 동일 키 retry, dedupe tombstone. F01/F10 |
| BR-07 / P1 | `backend-design.md:199`, `:230`, `:355` | 같은 메시지라도 myReaction/생일/capabilities는 수신자별인데 공통 payload로 섞일 수 있음 | 개인화 projection 분리·strict schema·viewer fixture; shared 응답 캐시 초기 제외 |
| BR-08 / P1 | `backend-design.md:116`, `:165`, `:232` | 복합 FK만으로 삭제/공개/반응/첨부/재입장 동시성을 해결하지 못함 | mutation lock set/order·unique·조건부 update·bounded deadlock retry. F06/F10 |
| BR-09 / P1 | `backend-design.md:312`, `:317`, `:324` | 두 API의 quota 통과·검사 중 overwrite·이전 worker finalization 경쟁 | DB 예약 quota, 고정 bytes, immutable final key, sandbox worker. F07/F09 |
| BR-10 / P1 | `backend-design.md:168`, `:287`, `:289` | revision/outbox/변환본/백업 복구에 삭제 콘텐츠가 남거나 되살아남 | 삭제 inventory·최소 ledger·restore serving gate. F11, 운영 기한은 출시 전 확정 |
| BR-11 / P1 | `runtime/README.md:13`, `:14` | readiness만 내리면 기존 소켓·keep-alive·작업이 계속 실행되고 migration이 경쟁 | admission fence→drain, 단일 migration, N/N-1 호환·worker fence. F08 |
| BR-12 / P2 | `backend-design.md:65`, `:260`, `:361` | API 증설로 hot-room lock·DB pool·노드별 rate limit 한계가 악화 | 배포 overlap 포함 connection budget, 공유 limiter·장애 정책, 1,000명 집중 부하 |
| BR-13 / P2 | `backend-design.md:262`, `:274` | 권한 변경/재입장/장기 offline에서 예전 cache 잔존 또는 private tombstone ID 노출 | epoch-bound cursor, ID 없는 cache reset, 기기별 원자 반영. F06/F12 |
| BR-14 / P2 | `architecture.md:87`, `aws-ec2/README.md:16`, `design-review.md:6` | 두 프로세스를 HA로 오인하거나 낡은 상태 문서를 배포 증거로 사용 | QA 단일 호스트/DB writer 한계 명시, live 미조회 구분, HA 별도 승인 |

위 `runtime/README.md`는 `infrastructure/runtime/README.md`, `aws-ec2/README.md`는
`infrastructure/environments/qa/aws-ec2/README.md`다. 기능 보안 시험은 아직 실행하지 않았다.

## 기술 선택의 판단 근거

- Socket.IO의 연결 내 순서 보장은 application DB commit 순서/누락 복구 보장이 아니다.
  여러 노드에는 연결 routing과 노드 간 전달이 각각 필요하다.
  [전달 보장](https://socket.io/docs/v4/delivery-guarantees/),
  [다중 노드](https://socket.io/docs/v4/using-multiple-nodes/).
- Redis Pub/Sub는 유실을 복구하지 않는다. DB catch-up을 유지하면 payload-free hint bus로는
  사용할 수 있다. Streams adapter는 일시 단절을 보완하지만 메시지 원본·인가·업무 큐를 대신하지 않는다.
  [Pub/Sub](https://redis.io/docs/latest/develop/pubsub/),
  [Streams adapter](https://socket.io/docs/v4/redis-streams-adapter/).
- 자동 Socket.IO recovery는 과거 packet/rooms/data를 복원한다. 초기에는 끄고 매번 현재 권한으로
  조회한다. middleware 재실행만으로 모든 과거 packet의 인가가 해결되는 것은 아니다.
  [복구 계약](https://socket.io/docs/v4/connection-state-recovery/).
- 권한 판정 시점과 이미 승인된 in-flight 응답을 구별해야 한다. 읽기는 짧고 새 snapshot,
  변경은 불변식별 lock으로 설계하며 network send 동안 DB lock을 유지하지 않는다.
  [MySQL snapshot](https://dev.mysql.com/doc/refman/8.0/en/innodb-consistent-read.html).
- queue claim용 SKIP LOCKED를 사용자 타임라인이나 인가 조회에 쓰면 안 된다.
  [MySQL locking reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html).
- 60초 R2 URL은 만료 전 재사용 가능한 bearer capability다. 즉시 회수/일회용으로 표현하지 않는다.
  [R2 공식 문서](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).
- Aurora storage 내구성과 DB compute HA는 다르다. single writer/no reader QA의 장애 복구를
  다중 AZ app/reader failover 구성과 동일하게 보장하지 않는다.
  [Aurora HA](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html).

## 범위와 후속 처리

통합 초안을 실시간·보안 에이전트가 재검토하여 다음 경계도 보강했다: 전체 manifest generation
완료 뒤 사라진 방 cache purge, 최신 N개 초기 snapshot과 과거 pagination 분리, cycle별 고정 H,
journal floor/GC 원자성, REPEATABLE READ snapshot, 삭제 전용 projection, stale R2 쓰기의 고아
재정리, receipt HMAC/삭제 표식 분리, 방장 공개 capability와 private 열람 grant 구분.

보안 스킬의 deny-by-default·DTO allowlist·세션/업로드 통제와 Cloudflare 스킬의 R2 조회 경계를
반영했다. reference의 예제/수치는 그대로 이식하지 않고 공식 문서와 제품 결정을 우선했다.
기존 인프라 문서는 별도 세션 작업과 충돌하지 않도록 live 상태를 추정해 수정하지 않았다.

이번 산출물은 설계 보강·구현 계획·장애 시험 명세다. P1 finding을 "해결 완료"로 닫으려면
각 구현과 실제 테스트 증거가 필요하다. public repo scanner/문서 검사/기존 CI 성공은
메시지 전달·부하·권한 보안 검증을 대체하지 않는다. 첫 작업은 P0/P1 scaffold와 2-node harness다.
