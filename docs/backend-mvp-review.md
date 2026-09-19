# 저비용 MVP 실행 계획 독립 리뷰

2026-09-20. 사용자 승인 정책과 1명 수준 초기 운영을 기준으로 서브 에이전트 3개가
실행 계획 초안을 읽기 전용으로 검토했다. 주 에이전트가 아래 보강을 반영했다.
이전 [분산 설계 리뷰](backend-review.md)는 기록으로 유지하며 현재 구현 순서는
[M01–M12 실행 계획](backend-mvp-execution-plan.md)이 우선한다.

## 검토 범위와 결론

- 실시간·분산: 단일 API의 hint 전달, outbox 소유권, 단계 의존성, 확장 시 바꿀 경계.
- 보안·개인정보: 전역 생일, 탈퇴/공개본, 외부 삭제 원장, 미디어 비용·삭제 경쟁.
- 구현·운영: 저비용 시작값, 복구/백업 약속의 실현 경로, 실패 감지와 출시 증거.

초기 API 1 + worker 1 + 기존 writer DB + private R2, Redis 없는 구성을 유지한다.
현재 앱 코드는 없으므로 발견 사항은 **계획상 위험**이다. 문서 반영은 구현·부하·보안 시험 통과가 아니다.
P1은 실제 데이터 투입 전 닫아야 할 권한·삭제·복구 경계, P2는 구현 순서·비용·운영 위험이다.

## 발견 사항과 반영

| ID | 우선순위 / 관점 | 위험 | 문서에 반영한 계약 / 구현 시 증거 |
|---|---|---|---|
| MR-01 | P1 / 실시간 | worker 수신자 확장과 API 전용 hint consumer가 충돌 | MVP API가 chunk별 현재 인가·확장·local publish. worker 완료는 event+outbox. 프로세스 간 fixture |
| MR-02 | P2 / 실시간·운영 | M06 claim이 M07 lease 구현보다 먼저 등장 | 공통 claim/lease/fence를 M05로 이동, M06 kill/reclaim/stale complete 시험 |
| MR-03 | P2 / 실시간 | 입장 history 경계가 아직 없는 counter에 의존 | counter M02, M04 입장 사용, M05 send/join 경쟁 시험 |
| MR-04 | P2 / 실시간 | 다중 API 때 SQL limiter 교체를 불필요하게 강제 | shared hint bus만 필수, 검증된 SQL limiter 유지 가능. DB UTC·lock 순서·활성 bucket GC 금지 |
| MR-05 | P1 / 보안 | DB 차단 후 외부 기록 전 장애로 삭제 접수 손실 | 인가된 외부 write-ahead intent→DB 차단→ACK. 동일 request/최초 UTC, 각 경계 crash/restore 시험 |
| MR-06 | P1 / 보안 | 공개본 작성자와 원본 팬이 달라 탈퇴 차단 누락 | source content owner/deletion root를 read/sync/quote/URL/finalize 전체에 적용. 독립 상대 답장 보존 |
| MR-07 | P1 / 보안 | 생일 OFF 뒤 기존 profile merge 캐시 잔존 | streamer별 revision/refresh, 주기 재검증, 전체 replacement. 다중 방·오프라인·연속 toggle 시험 |
| MR-08 | P1 / 보안 | DELETE 이후 늦은 COPY/PUT가 파일 재생성 | I/O 전 attempt 등록·최대 작업 수명·abort/kill·orphan 재확인. 종료/객체 부재 전 LIVE_PURGED 금지 |
| MR-09 | P2 / 보안·비용 | presigned PUT 재사용/oversize가 비용 quota 우회 | backend actual-byte cap + 제한된 scratch spool→known-length PUT. 거짓 길이/초과/abort/disk 고갈 시험 |
| MR-10 | P2 / 보안 | identity purge 뒤 늦은 OAuth callback이 계정 재생성 | auth/link 폐기·기간 제한 subject guard, 명시 신규 가입만 새 UUID. 기존 grant/owner 자동 복원 금지 |
| MR-11 | P1 / 운영 | 미디어 백업 없이 서비스 전체 RPO/RTO 약속 | 24시간 목표는 DB 복구만. R2 객체 자체 손실/오삭제 복원 미보장, 미존재 asset READY 금지 |
| MR-12 | P1 / 운영 | 신규 자원 금지와 실제 Aurora restore가 충돌 | 상시 증설 없음. 일시 drill cluster 생성·비용·정리 별도 승인 의존, 로컬 시험으로 대체 금지 |
| MR-13 | P1 / 운영 | manual/final snapshot에 보존 태그만 붙이고 잔존 | 외부 운영 automation의 매일 inventory/정리/read-back. 앱에 cloud-admin 권한 없음 |
| MR-14 | P2 / 운영 | 호스트 장애 시 purge와 경보가 함께 정지 | 외부 heartbeat/backlog·12시간 escalation·대체 실행 runbook. 장애 중 deadline 유지 |
| MR-15 | P2 / 운영 | 두 번째 API만으로 1,000명 시험 비용 강제 | cross-node correctness+예정 peak gate와 1,000명 지원 capacity gate 분리 |
| MR-16 | P1 / 보안 재검토 | 외부 intent 뒤 DB job 생성 전 crash는 DB claim만으로 복구 불가 | 같은 worker의 외부 ledger 독립 탐색/reconciliation, 누락 DB request/job 멱등 생성. API 재요청 없는 복구 시험 |
| MR-17 | P1 / 보안 재검토 | restore로 강퇴/grant 철회/owner 이전이 되돌아갈 수 있음 | 최신 상태를 입증 못한 복원 positive 권한 전부 비활성, 명시 재승인 전 fail-closed. 옛 owner 재로그인/공개 거부 시험 |

MR-09는 네트워크 직결 streaming과 bounded spool 대안을 비교해, 작은 최대 파일 크기의 MVP에서
길이를 확정한 PUT을 쓰는 **bounded disk spool**로 결정했다. 전체 RAM buffering은 금지하고
임시 디스크 예약/정리와 EC2→R2 전송 비용을 측정한다. Signed GET 60초 정책은 바꾸지 않는다.

보안·R2 가이드는 최소 DTO, 현재 권한 재검증, URL bearer 한계, 비신뢰 미디어 격리와
실제 삭제 확인에 반영했다. Aurora snapshot의 자동 만료/복구 자원은
[공식 백업 계약](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Backups.html),
R2 삭제 지연은 [공식 lifecycle 계약](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)을 대조했다.

## 완료 구분

수정 후 3개 agent가 재검토했다. 실시간·운영 관점은 새 P1 없음으로 회신했고,
보안 관점의 추가 2건(MR-16/17)을 주 에이전트가 반영했다. M04 계약/M06 transport 연결,
M06 합성 worker/M07 실제 worker 시험도 구분했다. 최종 2건은 코드 시험이 아닌 문서 보강 상태다.

이번 산출물은 정책·작업 순서·검증 기준과 독립 리뷰다. M01–M12는 전부 미착수이며,
실제 로그인/R2/삭제·복구/소규모 부하/운영 비용 증거는 구현 단계의 gate다.
다른 세션의 인프라 변경이나 배포를 이 리뷰의 실행 성과로 포함하지 않는다.
