# Web

후로기 전용 웹. `/`이 후로기 채널 홈이며 채팅은 `/chat`에서 제공한다.
현재는 FW01 기반 단계다: 공개 홈·이용 안내·gate 화면·QA 미리보기 틀이 있고,
실제 로그인·SOOP 연결·입장·전송·저장·푸시는 연결되지 않았다.

- [프론트엔드 웹 구현 계획](../../docs/frontend-web-implementation-plan.md): 화면, 멜로밍 선별 이식, 서버 계약, 단계별 완료 조건
- [DESIGN.md](DESIGN.md): Airbnb 스타일을 적용한 로기챗 웹 디자인 기준
- [다층 독립 리뷰 기록](../../docs/frontend-web-implementation-review.md): 지적·반영·재검토 결과와 남은 구현 gate
- [FW00/FW01 진행 기록](../../docs/frontend-web-foundation-progress.md)과 [재사용 ledger](../../docs/frontend-web-reuse-ledger.md)

## 구성

Next.js 16 App Router, React 19, TypeScript 5.9, Tailwind CSS 4, shadcn/ui 형태의 primitive(통합 `radix-ui`).
Node 24.21과 pnpm 12.4.2를 root lockfile로 고정한다. 한국어는 시스템 폰트 스택만 사용한다.

```text
src/app/            # route, layout, metadata, manifest, not-found
  (channel)/        # /, /chat, /rules, /settings — ChannelShell 하나가 감싼다
  (auth)/           # /login, /auth/login(호환 redirect), /auth/complete(placeholder)
src/features/channel/  # 채널 descriptor, 메뉴/경로 모델, shell, 홈
src/features/auth/     # session gate 상태 표시, 안전한 로그인 reason
src/features/chat/     # 채팅 presentation (UI 작업자 소유)
src/features/settings/ # 설정 presentation (UI 작업자 소유)
src/core/session/      # gate 상태 모델과 adapter 경계 (FW01은 unavailable)
src/shared/ui/         # Button, Card, Badge, Textarea, Input, Label, Separator, Sheet, Avatar
src/preview/           # QA 전용 합성 fixture와 미리보기 틀
public/                # sw.js(비활성 기반), manifest 아이콘(SVG)
```

## 명령

```sh
pnpm install --frozen-lockfile
pnpm web:lint && pnpm web:typecheck
pnpm web:build          # production shape: .next, /preview 없음
pnpm web:build:qa       # QA shape: .next-qa, /preview 포함
node tools/web/check-preview-isolation.mjs --shape both
pnpm --filter @rogichat/web exec playwright install chromium
pnpm web:test           # QA standalone을 127.0.0.1:3101에 띄우고 브라우저 smoke
pnpm --filter @rogichat/web dev   # 로컬 개발 3001, QA shape
```

## QA 미리보기 격리

`/preview`, `/preview/chat/{fan,streamer}`, `/preview/settings`는 `*.preview.tsx` 파일이며
`ROGICHAT_WEB_ENV=qa` 빌드에서만 `pageExtensions`에 등록된다. 기본/production 빌드에는 route가 없고
fixture 모듈이 번들에 들어가지 않는다. 두 shape는 dist 디렉터리가 다르며(`.next`, `.next-qa`)
`tools/web/check-preview-isolation.mjs`가 route manifest, server/static/standalone 내 fixture marker,
실제 HTTP 404/200, `/sw.js` MIME·캐시 헤더, `/auth/login` redirect를 검사한다.
Dockerfile은 production shape만 빌드하고 preview 소스를 build context에서 제거한다.

## 인증·실시간 경계

QA 웹은 `qa.rogi.chat`, API는 `api.qa.rogi.chat/v1`이다. API host-only HttpOnly cookie를 사용하므로
Next 서버는 인증된 SSR을 가정하지 않으며 private 화면은 브라우저에서 gate를 통과한 뒤 렌더한다.
Socket.IO 서버는 API host의 path `/v1/realtime`, `websocket` transport 전용, 기본 namespace다
(커밋된 `apps/api/src/realtime.ts` 기준). FW01은 소켓·세션·저장소를 연결하지 않는다.
사용자에게 보이는 이름은 로기챗이다.
