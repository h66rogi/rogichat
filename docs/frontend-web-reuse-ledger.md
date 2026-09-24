# 프론트엔드 웹 재사용 ledger

2026-09-20 FW00/FW01. 원본 저장소는 읽기 전용이며 `git show <sha>:<path>`로만 읽었다.
Git 이력·환경 파일·자산·분석 SDK·broker URL·비공개 식별자·기존 제품 표기는 가져오지 않았다.

## 출처와 권리

| 항목 | 내용 |
|---|---|
| 원본 | `meloming-front` (dylabs 내부 저장소) |
| 채널 틀 기준 | `f8907f37e73d0b760eac3c5af2beb48714331c83` (HEAD, "docs: allow installed local development tools") |
| talk 기준 | `8db1289e6ce5b2b37028ddbb73863363870de6b5` (HEAD에서 삭제된 talk가 남아 있는 커밋) |
| 원본 라이선스 | 저장소에 LICENSE 파일이 없고 `package.json`에 `license` 필드도 없다. 공개 라이선스가 부여된 코드가 아니다 |
| 재사용 근거 | 사용자가 [웹 구현 계획](frontend-web-implementation-plan.md) §3과 이번 FW00/FW01 작업 지시에서 멜로밍 채널 틀·채팅 UI의 선별 이식과 공개 rogichat 구현을 명시적으로 요청했다. 별도의 법인 명의 재라이선스 승인서나 권리자 확인 절차는 이 작업에서 수행하지 않았으며 그런 문서가 있다고 기록하지 않는다 |
| 이식분의 취급 | 각 파일 상단 주석에 원본 SHA·경로·가져온 것·바꾼 것을 남긴다. 이식된 부분은 이 저장소의 [PolyForm Noncommercial 1.0.0](../LICENSE) 아래 배포되는 rogichat 코드의 일부다 |

제3자 코드: `src/shared/ui/*`와 `src/shared/lib/cn.ts`는 공식 shadcn/ui new-york 템플릿(MIT)을 손으로 옮기고
DESIGN 토큰에 맞게 수정한 것이다(멜로밍의 사본을 복사하지 않음). 원저작권·MIT 고지 전문과 출처·조회 증거는
[apps/web/THIRD_PARTY_NOTICES.md](../apps/web/THIRD_PARTY_NOTICES.md)에 있으며, 해당 부분은 원 라이선스를 그대로 따른다.
의존성 `radix-ui`(MIT), `lucide-react`(ISC), `class-variance-authority`(Apache-2.0), `clsx`·`tailwind-merge`(MIT)는
npm으로 설치되며 각자의 라이선스를 따른다.

## 파일별 기록 — 채널 틀 (`f8907f37`)

| 원본 경로 | 대상 | 가져온 것 | 바꾼 것 / 제외한 것 |
|---|---|---|---|
| `src/features/home-new/layout/ChannelShell.tsx` | `apps/web/src/features/channel/shell/channel-shell.tsx` | 얇은 상단바, 카드형 본문(18rem 사이드바 + main + footer), 모바일 64px 상단바 + 오프캔버스 구조 | desktopUI/mobileUI 이중 트리 제거 → 단일 트리(children 1회 mount). SidebarProvider 쿠키·단축키, GlobalThinHeader, HeaderProfileMenu, top-notice 변수, 로고 제외 |
| `src/features/home-new/layout/ChannelMobileTopBar.tsx` | `.../shell/channel-mobile-top-bar.tsx` | 메뉴 트리거 + 아바타 + 채널명 홈 링크 배치 | react-query·채널 fetch 제거, descriptor prop 주입, 채팅 화면 축약 헤더 추가, Sheet drawer |
| `src/domains/channel/components/channel/channel-menu-sidebar.tsx` | `.../shell/channel-menu.tsx` | `TAB_ICONS` 패턴, `ChannelSidebarMenuLink`(pill, 아이콘+라벨, `aria-current`), 셋리스트의 `ListMusic` 아이콘 | DnD 편집기, feature settings mutation, verified/availability 필터, toast 제외. 공개 셋리스트가 아직 없을 때도 빈 상태 페이지를 볼 수 있도록 메뉴 노출 |
| `src/domains/channel/types/channel-tab.ts` | `.../model/channel-features.ts` | `TabConfig`/`TAB_CONFIG` 형태, `getPathFromTab`/`getTabFromPath` 개념 → `channelHref`/`featureFromPath`, 원본의 독립 `setlist` 탭과 경로 | 사이트 루트 경로, prefix 한 곳. 기본 순서 정규화 로직 제외 |
| `src/domains/channel/components/channel-layout.tsx` | 홈 구성 순서 참고 | 헤더 → 본문 순서, 섹션 단위 구성 | customCss 주입, 인증 모달, 사이드 배너, ContentWidthProvider, legacy 분기 제외. 코드 복사 없음 |
| `src/domains/channel/components/channel/user-header.tsx` (sidebar variant) | `.../shell/channel-profile-card.tsx` | 중앙 원형 아바타 + 이름 + 행동 행 배치 | 공유 시트, 즐겨찾기·수치, 뱃지, 관리 링크, 업로드 제외. 확인된 공식 링크만 표시 |
| `src/domains/channel/components/channel/user-avatar.tsx` | `.../shell/channel-avatar.tsx` | Avatar + 이니셜 fallback | 클릭 이스터에그·hover 확대 제외 |
| `src/domains/channel/components/section/home.tsx` | `.../home/channel-home.tsx` | 12-col 그리드(8/4), 바로가기 카드(원형 아이콘 + 제목 + 설명 + 액션 칩) | 노래/가격/방명록/일정/기념일 query 전부 제외. descriptor 콘텐츠만 표시, 수치 없음 |

가져오지 않은 것: `src/shared/components/ui/*`(멜로밍의 shadcn 사본), `src/app/globals.css`(CDN 폰트,
oklch neutral 토큰), api/hooks/stores/socket, analytics(`captureIntentEvent`), ChannelTalk SDK.

## 파일별 기록 — talk (`8db1289e`)

채팅·설정 presentation은 같은 worktree에서 별도 UI 작업자가 담당했다. 그 작업자가 보고한 출처: `src/domains/talk/components/room/{TalkMessageList,TalkMessageInput,TalkMessageBubble,TalkStreamerView}.tsx`
→ `apps/web/src/features/chat/{ChatTimeline,ChatComposer,ChatMessageItem,ChatRoomView}.tsx`.
가져온 것: 날짜 구분선, 이전 메시지 로드, textarea 자동 높이·IME 조합 중 Enter 무시·Shift+Enter, 답장 미리보기, 버블 배치, 삭제 tombstone.
바꾼 것: 문자열 ID·ISO 시각, SHARED/PRIVATE 범위 라벨, 익명 공개본 항목(작성자·원본 연결 없음),
수신 대상 표시·인가 목록 기반 대상 선택, `conversationScopeKey`별 초안 격리, 읽음/typing/반응/이모티콘/DM 생성/analytics 제외,
과거 열람 중 강제 바닥 스크롤 제거. `src/domains/talk/types/talk.ts`는 복사하지 않고 presentation 타입을 새로 작성했다.
`src/features/settings/**`는 원본 없이 새로 작성했다.

## Airbnb 스타일 자료

[shadcn.io Airbnb 디자인 자료](https://www.shadcn.io/design/airbnb)의 원칙을 [DESIGN.md](../apps/web/DESIGN.md)가
로기챗 토큰으로 재정리했고, 웹은 그 토큰만 `src/app/globals.css`에 옮겼다. 원문·로고·Cereal 폰트·사진은 사용하지 않았다.
공식 [ui.shadcn.com](https://ui.shadcn.com)은 별개 출처이며 primitive 템플릿의 근거다.
