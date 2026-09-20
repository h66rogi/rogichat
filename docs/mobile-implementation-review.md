# 모바일 세부 구현 계획 — 독립 리뷰 기록

2026-09-20. 대상: [세부 구현 계획](mobile-implementation-plan.md)과
[모바일 기반](mobile-foundation.md)의 연결·reset 정책.
사용자 요청에 따라 두 Sub Agent가 읽기 전용으로 현재 코드와 계획을 비교했다.
주 작성자가 수정했고 각 reviewer가 수정본을 재검토했다.

## 리뷰 범위

| Reviewer | 범위 | 근거 |
|---|---|---|
| `mobile_plan_contract_review` | 인증/인가, 실제 API 공백, 백엔드 작업 의존성, 구현 순서 | M03–M07 문서, auth/messages/sync/realtime 코드, 계약 참조 |
| `mobile_plan_native_review` | 네이티브 저장/전송 큐, lifecycle, generation, UX, 시험 누락 | 앱 scaffold, foundation/authentication, M06, sync/interaction 참조 |

조사 기준은 계획에 기록한 `6123ae2`와 당시 작업트리다. M08 미커밋 코드와 백엔드 구조
보정 초안을 확정·배포 완료로 취급하지 않았다. 참조 저장소와 다른 세션 파일은 수정하지 않았다.

## 주요 지적과 반영

| 중요도 | 지적 | 반영 위치·결과 |
|---|---|---|
| P1 | 팬의 첫 전송에 필요한 PRIVATE 입력·수신자 식별이 후속 단계로 밀려 있음 | §8 MB04에 최소 PRIVATE composer와 서버 제공 스트리머 대상 식별 포함. MB05는 제스처·확장 UX |
| P1 | 구조 보정의 경계 합의만으로 신규 서버 기능이 먼저 시작될 위험 | §8에 검증·리뷰·commit 완료 후 native Auth/DTO 서버 PR 착수 명시. ADR/합성 fixture는 병행 |
| P1 | 개별 403/404로 방 철회와 수신자/인용 오류를 구분할 수 없음 | §6 동일 session generation에서 재인가. 방 유효 시 초안 보존, 철회 확인 시 정리, 재인가 장애 시 hide/stop |
| P1 | complete manifest에서 사라진 방·재입장 scope를 정리하지 않으면 늦은 작업이 남음 | §7 room generation 선행 무효화, 화면/송신 정지, DB·파생 cache 정리; late ACK/history/media 차단 |
| P2 | reset의 cache/큐 범위가 불명확하고 foundation과 불일치 | §6 account/timeline/profile cacheId와 reset matrix. pending command는 별도 주차·재인가, 접근 철회 시 폐기. foundation도 정합화 |
| P2 | sync key projection만으로 snapshot 밖/삭제된 명령의 결과를 찾을 수 없음 | §6 동일 ID/payload replay, deleted receipt 종료·본문 제거, 결과 확인 불가를 미전송으로 단정하지 않음 |
| P2 | logout 정리를 MB07로 미루면 MB03 계정 교체 시험 불가능 | MB03에 최소 logout/취소/credential/cache 정리, MB07은 탈퇴·알림 lifecycle 완성 |
| P2 | 동시 시각·오래된 upsert의 표시 정렬 검증 부족 | C06에 같은 createdAt가 history 페이지 경계를 가로지르는 경우와 미로딩 과거 메시지 upsert fixture 추가 |

공통 오류/manifest/reset/receipt 지적에 대응하는 실제 SQLite·UI 회귀 시나리오는 §9에 추가했다.
코드에 존재하지 않는 native refresh, Apple 인증, 생성 DTO, C04/C05 추가 projection을
이미 구현됐다고 표시하지 않는다.

## 재검토 판정

- Contract reviewer: 기존 P1 2건/P2 3건 해소, 계획 채택을 막는 추가 blocker 없음.
- Native reviewer: 기존 P1 2건/P2 2건 해소, 구현 계획 리뷰 통과.
- 중복 지적은 위 표에서 합쳤다. 전체 항목 수가 reviewer별 건수 합과 같지는 않다.

**계획 검토 통과**이며 실제 앱 구현·보안·성능·기기 시험 통과가 아니다.
C01–C08 계약/ADR, 특히 D03 표시 정렬, 백엔드 구조 보정, 실제 provider 연동,
Room/GRDB transaction 시험과 양 OS 실기기 왕복은 후속 구현의 명시적인 gate로 남는다.
현 단계의 적절한 착수 범위는 MB00 기준/모듈 경계와 MB01 계약 ADR·fixture 초안이다.
