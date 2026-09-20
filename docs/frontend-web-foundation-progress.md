# 프론트엔드 웹 FW00/FW01 진행 기록

2026-09-20. [웹 구현 계획](frontend-web-implementation-plan.md)의 FW00(화면·이식 범위)과
FW01(scaffold·공개 홈·route·공통 UI·SW 기반)을 구현한 기록이다. 실제 로그인·SOOP 연결·입장·전송·
저장·푸시·배포는 완료되지 않았으며, 이 문서는 그것을 완료로 표시하지 않는다.

구현 모델: Claude Code Fable 5.1(`claude-fable-5-1`). 채팅·설정 presentation은 같은 worktree의
별도 Fable 5.1 UI 작업자가 담당했고, scaffold·route·shell·홈·미리보기 하니스·CI·문서는 이 기록의 작성자가 담당했다.

## 만든 것

| 영역 | 내용 |
|---|---|
| 워크스페이스 | `apps/web`을 pnpm workspace에 추가. root `package.json`에 `web:*` 스크립트 추가(기존 API 스크립트 의미 유지). `allowBuilds`·`engineStrict` 변경 없음 |
| 버전 | Next 16.3.5, React 19.3.0, TypeScript 5.9.3(API와 동일), Tailwind 4.3.3, `radix-ui` 1.6.7, lucide-react 1.47.0, ESLint 10.11.0 + `@next/eslint-plugin-next` 16.3.5 + `eslint-plugin-react-hooks` 7.1.1, Playwright 1.63.0, `@axe-core/playwright` 4.13.0. 모두 2026-09-20 npm metadata에서 확인한 stable이며 `minimumReleaseAge` 24시간을 충족 |
| 디자인 토큰 | `apps/web/src/app/globals.css`에 DESIGN.md 색·radius·높이 토큰과 shadcn alias. 시스템 폰트 스택만 사용. focus ring 전역 |
| 공통 UI | `src/shared/ui/{button,card,badge,textarea,input,label,separator,sheet,avatar}.tsx` (공식 shadcn 템플릿 기반, 48px 버튼·56px 입력·44px 터치) |
| 채널 | `src/features/channel/model`(descriptor, 메뉴/경로 생성기 `channelHref`), `shell`(단일 트리 ChannelShell, 모바일 상단바+Sheet, 프로필 카드, 메뉴), `home`(공개 홈) |
| route | `/`(후로기 홈, redirect 없음), `/chat`·`/settings`(브라우저 gate, FW01은 `unavailable`), `/rules`, `/login`(허용 방식 없음 → 비활성), `/auth/login`(303 → `/login?reason=<enum>`, raw query 미복사), `/auth/complete`(placeholder), 404 |
| session gate | `src/core/session/session-gate.ts` 상태 모델·adapter 경계, `src/features/auth/session-gate-panel.tsx`. 로그인/입장 성공을 연출하는 상태 없음 |
| SW/manifest | `public/sw.js` 비활성 기반(fetch/push 핸들러 없음, 등록 호출 없음), `/manifest.webmanifest`, SVG 아이콘. `/sw.js`는 JS MIME + `no-cache, must-revalidate` |
| QA 미리보기 | `*.preview.tsx`가 `ROGICHAT_WEB_ENV=qa` 빌드에서만 route로 등록. `.next`/`.next-qa` dist 분리. `/preview`, `/preview/chat/{fan,streamer}`(`?room=other`), `/preview/settings`. fixture 팬 2·스트리머 2·방 2, avatar null, 상시 배너 |
| 격리 검사 | `tools/web/check-preview-isolation.mjs --shape both`: route manifest, server/static/standalone 내 marker·`.preview.tsx` 부재/존재, standalone에 cache·preview 소스 없음, 실제 HTTP(`/preview*` 404/200, `/sw.js` 헤더, `/auth/login` 303, QA `X-Robots-Tag`) |
| 브라우저 시험 | `apps/web/test/e2e/*.spec.ts`(desktop Chrome + Pixel 7): route·gate·404, 단일 mount, 메뉴·aria-current, 가로 overflow 없음, drawer 키보드, axe wcag2a/aa serious·critical 0, 미리보기 수신 대상, IME 조합 중 Enter 미전송, pending→unknown(저장 완료 없음), 방 scope 초안 격리, 설정 전 항목 비활성 |
| 배포 준비 | `apps/web/Dockerfile`(standalone, `--filter '@rogichat/web...'`, preview 소스 build context 제거). `.github/workflows/web.yml`(lint·typecheck·두 shape 빌드·격리 검사·Playwright, 항상 보고되는 `Web required checks`) |
| 문서 | [재사용 ledger](frontend-web-reuse-ledger.md), `apps/web/README.md` 갱신, 계획 문서의 Socket.IO 사실 정정 |

## 리뷰에서 정정한 사실

- 커밋된 `apps/api/src/realtime.ts`의 Socket.IO 서버는 path `/v1/realtime`, transport `websocket` 전용, 기본 namespace다.
  계획 문서의 "`/socket.io` transport, `/v1/realtime` namespace" 문장을 정정했다. FW01은 소켓을 연결하지 않는다.
- 리뷰어 지적 반영: brand 틴트 위 글자는 `text-action-hover`(약 5.4:1), QA 빌드 `robots noindex` + `X-Robots-Tag`,
  홈의 내부용 placeholder 문단과 "준비 중" 메뉴 행 제거, inline style → Tailwind arbitrary value, 격리 검사 경로 통일.
- 리뷰어가 측정한 API 이미지의 workspace graph 전체 설치 문제(웹 importer 추가 후 `--prod` 설치가 전체 lockfile을
  materialize)는 백엔드 코디네이터가 이 작업에 이관해 `apps/api/Dockerfile`의 두 `pnpm install` 줄에
  `--filter @rogichat/api...`를 추가하는 변경으로 이 PR에 포함했다. 웹 Dockerfile도 같은 `--filter` 패턴을 쓴다.
  API/웹 컨테이너 이미지의 실제 빌드·실행은 이 작업에서 수행하지 않았다.

## 검증 결과

작성 시점의 로컬 결과이며 CI 결과는 PR에서 확인한다.

| 검사 | 결과 |
|---|---|
| `pnpm install --frozen-lockfile` (Node 24.21.0, pnpm 12.4.2) | 통과 |
| `pnpm web:typecheck`, `pnpm web:lint --max-warnings 0` | 통과 |
| `pnpm web:build`(production), `pnpm web:build:qa` | 통과. production route 목록에 `/preview*` 없음 |
| `node tools/web/check-preview-isolation.mjs --shape both` | production OK, qa OK |
| `pnpm web:test:unit` (chat drafts/formatters, node:test) | 10/10 통과 |
| Playwright(desktop Chrome + Pixel 7, `pnpm web:test`) | 62 통과, 실패 0, 건너뜀 2. 건너뜀 2건은 `test.skip(isMobile)`/`test.skip(!isMobile)`로 표시한 폭 전용 케이스("데스크톱 aside/상단바 표시"는 mobile 프로젝트에서, "모바일 드로어 키보드"는 desktop 프로젝트에서 해당 없음)이며 각 케이스는 해당 폭 프로젝트에서 실행·통과했다. 미검증 항목이 아니다 |
| 실제 렌더 확인 | QA standalone(127.0.0.1)에서 데스크톱/모바일 홈, 드로어, 채팅 gate, 미리보기 화면 스크린샷 확인 |

## 남은 gate (FW03 이후)

- 서버 계약 W01–W08(공개 descriptor endpoint, bootstrap/session, recipient 인가, projection, 정렬, strict DTO, 미디어/푸시/lifecycle, callback).
  Nest 구조 보정과 Prisma Client 정정이 진행 중이라 신규 endpoint/DTO를 만들지 않았다.
- 실제 SOOP 로그인·callback·복귀, IndexedDB/outbox, 소켓(`/v1/realtime`, websocket), 미디어, Web Push 구독/binding.
- 실기기(iOS Safari/Android Chrome)·스크린리더·한국어 IME 실제 입력 검증. Playwright의 IME 시험은 합성 이벤트다.
- iOS 설치 아이콘(PNG apple-touch-icon)은 아직 구현·검증하지 않았다. 현재 아이콘은 SVG만 있으며 iOS 설치 구조는 미검증이다.
- 서비스 약관·개인정보처리방침 확정본 링크, 신고/문의 담당 경로, 후로기 공식 소개/링크/사진.
- QA 호스트 배포(web GHCR digest, Caddy web hostname, deployer). 이 작업은 호스트 배포를 수행하지 않았고 배포 완료로 표시하지 않는다.
