# 프론트엔드 웹 계획 — 다층 독립 리뷰 기록

2026-09-20. 대상: [웹 구현 계획](frontend-web-implementation-plan.md)과
[DESIGN.md](../apps/web/DESIGN.md). 사용자 요청에 따라 Sub Agent 3개가 독립적으로 검토하고,
주 작성자가 근거를 대조해 문서를 수정했다. **계획 리뷰이며 실제 웹 구현·기기 시험의 통과 기록이 아니다.**

## 방법과 기준

1. 1차: reviewer별로 같은 `c110863` 기준 문서와 커밋된 서버 계약을 읽고, 실패 시나리오·
   우선순위·최소 수정·검증 조건을 제시했다. 미커밋 M08과 동시 작업은 확정 계약에서 제외했다.
2. 통합: 제품 요구 → 현행 API → 브라우저 상태/개인정보 → 구현 순서/검증의 연결을 주 작성자가
   대조했다. 중복을 합쳐 P1 9건·P2 7건, 총 16건의 계획 공백으로 정리했다. P0 지적은 없었다.
3. 2차: 같은 reviewer가 수정본에서 원래 지적의 해소 여부와 수정으로 생긴 충돌을 재검토했다.

| Reviewer | 독립 관점 | 주요 대조 근거 |
|---|---|---|
| `web_product_review` | 제품·IA·역할별 UX·재사용·MVP 실행 순서 | backend-design/M04/M05/M08–M12, 모바일 계획, 멜로밍 talk 참조 |
| `web_architecture_review` | 웹 계층·실제 인증 계약·동기화·저장/전송 큐·서버 선행 조건 | 커밋된 AuthController/MessagesCoreService, M03–M07, contracts, Nest 구조 보정, 모바일 리뷰 |
| `web_privacy_a11y_review` | 브라우저 수명·계정 경계·푸시·접근성·배포 호환성 | 웹 푸시 요구, MDN 브라우저 계약, W3C 상태 메시지 기준 |

후로기 전용 `/`, 멜로밍 틀의 실제 선별 이식, Airbnb 스타일, vvave 활용 방향은 유지했다.
이 리뷰에서 새 채널 탐색·운영 콘솔·일반 그룹 UI를 추가하지 않았다. 참조 저장소와 다른 세션의
서버/모바일 작업은 수정하지 않았다. 외부 서비스 내부 API를 새로 확인했다고 주장하지 않는다.

## 발견 사항과 반영

아래 상태는 **계획 보정**이다. 구현 시 마지막 열의 증거가 있어야 실제 gate가 닫힌다.

| ID | 우선순위·지적 | 반영 위치·결정 | 구현 시 확인할 증거 |
|---|---|---|---|
| WR01 | P1 / `/login` 계획과 실제 실패 `/auth/login`, 성공 `/` 불일치 | §2/5 W08, FW03. 실패 호환 route, 제안된 고정 완료 route·시도 binding·탭별 복귀. 미구현 returnTo 가정 제거 | provider 취소, 두 탭, link session rotation, 외부/만료 경로, 구형 서버 rollback |
| WR02 | P1 / 빈 대화의 팬 수신자 계약 누락, PRIVATE가 텍스트 왕복 다음 단계 | W02, §6 역할별 composer, FW04/05, DESIGN. 서버 인가 recipient와 최소 PRIVATE를 FW04에 포함 | 메시지 0개에서 팬 PRIVATE, 스트리머 SHARED/PRIVATE 왕복; 대상 변경 시 송신 중지 |
| WR03 | P1 / 개별 403/404를 방/계정 철회와 구별할 실행 정책 부족 | §6 오류 표. 같은 session generation에서 방 재인가, 대상 문제면 초안 보존·철회면 정리 | 인용 삭제/상대 퇴장/본인 퇴장, 재인가 장애·도중 계정 전환 |
| WR04 | P1 / complete manifest 교체와 열린 방 작업 정리의 연결 누락 | §6 manifest 처리. removed/changed scope·capability 대조, room generation 선행 무효화 | 중간 페이지 삭제 없음, 같은 roomId 재입장 후 늦은 ACK/history/media 거부 |
| WR05 | P2 / account/timeline/profile reset과 outbox 범위 불명확 | §6 reset 표. cacheId 분리·명령 주차·재인가·인가 상실 시 payload 폐기 | profile-only reset의 메시지 cursor 보존, 두 timeline cursor 교체, 옛 응답 폐기 |
| WR06 | P2 / snapshot 밖·삭제된 불명 전송을 projection만으로 복구 불가 | §6 replay/receipt 원자 반영, outcomeUnknown, 오류별 제한 재시도 | ACK 유실→다른 기기 삭제→재시작→같은 명령→deleted receipt, 중복/본문 부활 없음 |
| WR07 | P1 / 신규 서버 작업의 구조 보정 선행 gate 약화 | §5/FW02. R5 검증·독립 리뷰·commit·CI 뒤 신규 Auth/DTO/projector 기능 착수 | 계약/fixture 초안 완료와 서버 구현 착수 가능 상태를 따로 기록 |
| WR08 | P1 / 영상 요구가 M08 완료에만 묶임 | W07, §7/FW06. 사진/스티커 M08, 영상 M09 명시 | codec·처리 실패·60초 초과 seek·위치 복원·삭제 후 URL 재발급 거부 |
| WR09 | P2 / 퇴장/재입장 UX 없이 lifecycle 시험만 요구 | §2 경로/FW03/DESIGN. 명시적 입장, 방 퇴장·계정 탈퇴 구별, owner 제한 | 알림/뒤로 가기/URL로 자동 재입장 없음, 명시 재입장은 새 scope |
| WR10 | P2 / 입력 경계 토큰이 자체 대비 기준에 미달 | DESIGN 초기 토큰·접근성. 장식선과 control-border/focus-ring 분리 | 실제 surface·기본/오류/focus 조합의 식별·대비 |
| WR11 | P2 / 웹 신고/차단 출시 범위가 모바일 공통 gate와 단절 | W07, §7/FW07/08. 최소 웹 진입·처리 경로·차단 의미를 공동 계약으로 확정 | 실제 처리 경로, 숨김/알림 끄기/접근 제한 구별; 콘솔 신설은 별도 범위 |
| WR12 | P1 / cold start 외 bfcache/동결 복귀에서 이전 계정 DOM 잔존 | §6/FW04 시험. 숨김/복귀 lifecycle gate와 현재 계정·참여 scope 재확인 | 다른 탭 계정 전환 후 뒤로 가기·동결 복귀, 재인가 실패 시 본문/송신 잠금 |
| WR13 | P1 / 오프라인 로그아웃 후 살아 있는 HttpOnly 세션 자동 복원 | §5/FW03. durable logoutPending 잠금, 서버 폐기 완료 구분, session binding 대조 | 요청 미도달/응답 유실→새로고침/다른 탭→온라인 복귀, 새 세션 잘못 revoke하지 않음 |
| WR14 | P1 / 구독 해제만으로 지연·이미 표시된 알림 차단 불가 | W07/§7/FW07. 불투명 계정 binding generation, SW 대조·기존 알림 정리 | 표시 알림+지연 push+SW 재시작+계정 전환. OS 노출 소급 회수는 보장하지 않음 |
| WR15 | P2 / 구버전 탭·새 DB schema·rollback 공존 정책 누락 | §6/FW04/08. versionchange/blocked, writer 종료, 호환 범위·업데이트 UI | 구버전 탭을 연 채 schema 변경/rollback, 불명 큐 무조건 초기화 금지 |
| WR16 | P2 / 실시간 스크린리더 상태 알림 계약 누락 | DESIGN 접근성·§8 UI 시험. 신규/실패/대상 상태 알림과 history/reset 재낭독 방지 | 실제 지원 조합에서 입력 중 수신·전송 실패·개인답장·history/reset 시험 |

WR10의 단색 대비를 계산해 확인했다: white 대비 `#dddddd` 1.36:1, `#ebebeb` 1.19:1,
`#858585` 3.69:1, `#222222` 15.91:1, `#e00b41` 4.89:1, `#ff385c` 3.52:1.
이는 색상 기준 검증이며 실제 UI·focus·접근성 시험의 대체 증거가 아니다.

주 작성자는 관련 보정으로 모르는 sync schema의 cursor 전진 금지와 민감 진단 로그/실제 계정
trace의 공개 CI 반입 금지를 추가했다. 모바일 리뷰에서 이미 정한 복구 원칙을 웹에 맞춰 구체화했다.

## 재검토 판정

| Reviewer | 2차 판정 |
|---|---|
| 제품/UX | 원 6건 모두 해소. W08도 후로기 홈 유지와 충돌 없음. 계획 채택 가능 |
| 아키텍처/계약 | 원 7건 모두 해소. 추가 blocker 없음. 기존 SOOP transaction 결과 reference 재사용·원래 세션의 CSRF로만 logout 재시도 문구 권고 |
| 브라우저/개인정보/접근성 | 원 5건 모두 해소. 로그·실계정 trace 경계도 적절. 추가 blocker 없음 |

reviewer 원 지적은 중복이 있어 합계 18건을 통합 표의 16건으로 정리했다. 아키텍처 reviewer의
마지막 문구 권고도 §5에 반영했다. **계획 리뷰 통과**로 판정하며 API·IndexedDB·브라우저·
실기기 시험을 실제로 통과했다는 의미를 부여하지 않는다.

## 남는 구현 gate

W01–W08의 서버 계약, Nest 구조 보정 완료, 실제 인증 제공자·R2·미디어·삭제/푸시 연결,
IndexedDB/multitab/lifecycle·접근성 실기기 시험은 후속 구현에서 증거를 확보한다.
계획 리뷰의 통과가 기능 구현·출시 gate를 대체하지 않는다. 다음 착수 범위는 FW00 화면/이식 범위
구체화와 구조 보정에 의존하지 않는 계약 ADR·합성 fixture 준비다.

브라우저 근거: [pageshow](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event),
[알림 조회](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/getNotifications),
[알림 닫기](https://developer.mozilla.org/en-US/docs/Web/API/Notification/close),
[IndexedDB versionchange](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/versionchange_event),
[IndexedDB blocked](https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/blocked_event),
[W3C 상태 메시지](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
