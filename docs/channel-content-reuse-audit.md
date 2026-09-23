# 후로기 채널 콘텐츠 이식 기록

## 기준 소스와 범위

- `meloming-front` `f8907f37e73d0b760eac3c5af2beb48714331c83`
- `meloming-back` `a91393b2362ca8462328c6553f7fbe4b6703c6e1`
- 멜로밍 저장소는 읽기 전용으로 참조했다. 콘텐츠 레코드, 개인정보, 환경 파일은 복사하지 않았다.
- 로기챗은 멜로밍의 `Channel` 정수 키를 기존 `rooms.id` UUID와 기본 방 바인딩으로 치환한다. 기존 인증, CSRF, 소유자 권한, 오류 처리도 로기챗 경계에서 적용한다.

| 기능 | 직접 가져온 부분 | 로기챗 연결과 차이 |
| --- | --- | --- |
| 일정 | `src/schedule/schedule.service.ts`의 기간 겹침·KST 월 범위, `src/schedule/recurring/recurring-schedule.service.ts`의 요일별 최대 4주 생성·일괄 저장, 프론트의 일정 타입·상태·데스크톱/모바일 카드·주간 이동 유틸 | `apps/api/src/modules/channel-content/`의 HTTP/인증/트랜잭션 어댑터, `apps/web/src/features/channel/schedule/`의 채널 단일 주간 뷰와 편집 폼. 정기 생성은 멜로밍 cron 대신 API 프로세스의 시간별 멱등 갱신을 사용한다. |
| 옷장 | 백엔드 `src/channel/channel-wardrobe.service.ts`, 상수·DTO 모양·HTML 정화·임베드 도메인; 프론트 `src/domains/channel/components/channel-wardrobe-content.tsx`, 상세 화면, 비율·설명·정화 유틸, 타입 | 로기챗 세션/API 어댑터와 소유자 관리 폼. 멜로밍 관리 화면의 분류·항목 CRUD, 공개 상태, 비율·태그를 제공한다. 이미지 등록은 URL 입력으로 연결한다. 멜로밍 전용 파일 업로드 서비스는 로기챗 미디어 계약과 별도라 연결하지 않았다. |
| 노래책 | 멜로밍 `Category`, `Artist`, `Song`, `SongCategory`, `UserSongLike` 모델 필드와 검색 정규화/LIKE 이스케이프, 프론트 노래 타입·URL 필터 훅·별점 표시 컴포넌트 | 로기챗 단일 채널 목록/상세/검색/즐겨찾기/소유자 편집 화면과 API. 멜로밍의 라이브 신청·가격 설정·글로벌 악보·음원 요청·랭킹·후원 연동은 별도 도메인에 의존하므로 이 세 페이지의 기본 모델에 포함하지 않았다. |

## 스키마와 운영 차이

- `apps/api/prisma/schema.prisma`에 멜로밍 채널 콘텐츠 테이블 9개를 추가했다. 로기챗의 마이그레이션 계약은 `AUTO_INCREMENT`를 금지하므로 Meloming의 숫자 DTO는 유지하고 `channel_content_counters` 한 행의 원자적 증가로 ID를 할당한다. 기존 테이블의 필드 변경은 없다.
- 계정 탈퇴 페이지에 새 즐겨찾기, 작성 일정, 소유 채널 콘텐츠 삭제 단계를 추가했다.
- QA 배포는 백엔드 이미지와 새 마이그레이션을 함께 적용하는 수동 전달 절차가 필요하다. 현재 자동 배포 정책은 이전 스키마에 고정되어 있다.
- 사용자의 선택에 따라 멜로밍의 기존 일정·옷장·노래 데이터는 이전하지 않는다. 로기챗 페이지는 실제 데이터가 생길 때까지 빈 상태를 표시한다.
