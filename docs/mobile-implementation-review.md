# 모바일 세부 구현 계획 — 독립 리뷰 기록

이 문서는 최초 리뷰와 후속 재사용 통합 리뷰를 함께 보관한다. **최신 판정은 아래
“공통 기반 재사용 통합 리뷰”**이며 최초 리뷰의 착수 범위를 대체한다.

## 최초 세부 계획 리뷰

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


## 공통 기반 재사용 통합 리뷰

2026-09-20. 사용자 요청: 멜로밍의 공통 앱 구현을 최대한 재사용하되 채팅 UX는 제외하고,
여러 관점에서 기존 계획과의 충돌을 검토한 뒤 단일 계획에 통합한다.
초기 조사 → 통합 초안 → 독립 재검토 → 보정본 확인 순서로 진행했다.

기준: 모바일 `9a028b9`, 참조 Android `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`,
iOS `18a33bbf96fe52b28d0de361916e20549bdcce6b`. 원본과 동시 작업 중인 서버 코드는 수정하지 않았다.

| Reviewer | 독립 검토 관점 | 방법 |
|---|---|---|
| `android_reuse_review` | 실제 컴포넌트/탐색 추출, Compose·의존성·OS 권한·접근성·상태 복원 | 원본 파일/호출 경로/테스트와 통합 계획 대조 |
| `ios_reuse_review` | 활성 MyPage 경로, Swift6 actor/Observation, router/delegate/Keychain·lifecycle | 원본 심볼·결합·현 QA reducer와 계획 대조 |
| `reuse_contract_review` | 제품/인증/인가·개인정보·push 경쟁·공개 repo 출처·단계/QA·다문서 정합성 | 기존 인증/DB/sync/배포 설계 및 새 단계 비교 |

### 지적과 통합 결과

| 우선순위 | 지적 | 반영 |
|---|---|---|
| P1 | 공통 재사용 요청과 채팅 상세화 우선순위가 충돌 | 계획 §2.1·§8 MB02a→b→c, foundation/progress/reference-audit 정합화. 멜로밍 채팅 UI/UX/구현 이식 제외 |
| P1 | QA의 rooms→settings 탐색 제약은 SOOP 미연결 계정 관리 정책과 충돌 | §2.2 상태별 허용 route 표, LinkRequired 설정/로그아웃/탈퇴 접근, 단일 방 자동 진입 후 설정·목록 복귀 보장 |
| P1 | 원본 direct route/refresh/전역 cache 의미가 새 계약과 충돌 | §2.1–2.3·MB02d: SessionGate/coordinator 분리, C01–08 유지, 원본 refresh·URL token·cookie WebView·민감 logging 제외 |
| P1 | 기존 loading(previous:)가 다른 계정/미인가 private 화면을 노출할 수 있음 | 같은 인가 scope에만 이전 값 유지, account/environment 변경 시 stack·pending·cache fencing |
| P2 | 알림을 전부 MB07에 두거나 OS 허용을 구독 성공으로 표시 | MB02c OS/화면/parser와 MB07 runtime binding 분리, permission/preference/binding 세 축, C09 후속 계약 추가 |
| P2 | 실제 iOS 설정 진입과 Keychain/browser 근거가 부정확 | MyPageSection/MyActionRow 활성 경로, KeychainAccess wrapper, 실제 SafariView/RouterSafariURL로 audit 보정. InAppWebView 제외 |
| P2 | Android 원본에 없는 복귀 재조회·이미지 error/cancel·retry를 재사용처럼 기술 | audit에서 원본 추출과 로기챗 신규 보강 분리, ApiClient의 client 조립과 새 timeout 정책 구분 |
| P2 | 최신 pending intent 도중 이전 비동기 인가가 끝나는 경쟁 | §2.3 revision/nonce+session generation 재확인, 동일 revision만 navigate/clear. A 재인가 중 B tap fixture |
| P2 | C09 완료에 실기기 전달 필요, SDK 구현은 C09 완료 후라는 순환 gate | C09 계약 합의/서버 준비→MB07 provider 구현→전달 시험으로 C09/MB07 완료 구분 |
| P2 | 실기기 미확인이 다음 shell 구현까지 차단할 수 있음 | §8 개발 진행 조건과 최종 완료 gate 분리. 코드/상태/격리 통과 후 조립 계속, 기기 확인은 ledger에 미완료로 기록 |
| P2 | 추상적인 참고만으로 코드 재사용을 주장할 위험 | source SHA/path/symbol→대상 파일, 수정/그대로/신규, 권리/의존/검증 ledger. 실제 추출 전 후보로 표시 |
| P2 | QA Release preview, Firebase 배포/runtime, 오래된 시작 화면 기록이 상충 | §4 QA 오프라인 adapter 예외 통합, foundation SDK 문구·test-distribution 현재 소스/업로드 상태 구분 |

### 최종 확인

- Android reviewer: 원본/신규 보강 구분과 개발 진행 gate의 P2 해소. 최종 확인 중 원본에도
  명시적 timeout이 없다는 조사 정정을 반영했다. 출처 문구 수정 외 잔여 채택 blocker 없음.
- iOS reviewer: Keychain/browser 근거와 C09 순환 의존 P2 모두 해소, 잔여 P1/P2 없음.
- Contract reviewer: baseline P1 및 후속 P2 모두 해소, 계약·권한·운영·문서 정합성 리뷰 통과.

**통합 계획 채택 가능. 다음 착수는 MB02a 공통 구현 추출이다.** API 계약과 병행 가능한
MB02b/c를 이어가고, 막힌 단위만 ledger에 남긴다. 최초 리뷰 말미의 “MB00/MB01만 착수”는
현 사용자 지시와 이 보정본으로 대체한다. 실제 추출·기능 구현은 이번 문서 작업에 포함하지 않았다.

계획 리뷰는 실제 구현·OS 접근성·API/push·기기 시험의 성공을 대체하지 않는다. 원본 앱의 production 검증 수준도 이번 조사로
추정하지 않는다. API C01–08 및 C09, 실기기, 출처가 불명확한 단위 등의 gate는 유지한다.
