# 로기챗 Web

후로기 전용 웹. `/`은 공개 홈, `/chat`은 서버가 인가한 채팅방, `/settings`는 현재 계정의 설정이다.
QA와 운영 모두 같은 production 앱을 실행한다. 미리보기 경로·합성 계정·가짜 채팅·성공 응답은 배포하지 않는다.

- [현재 구현·검증·제한](../../docs/frontend-web-production-report.md)
- [구현 계획](../../docs/frontend-web-implementation-plan.md)
- [디자인](DESIGN.md) 및 [기존 재사용 ledger](../../docs/frontend-web-reuse-ledger.md)

## 실행 구성

Node 24.21.0, pnpm 12.4.2, Next App Router의 standalone 출력 하나를 사용한다.
런타임에서 다음 환경 변수를 명시한다. request Host 헤더나 build-time 공개 변수로 API origin을 추정하지 않는다.

| 변수 | QA | 운영 |
|---|---|---|
| `NODE_ENV` | `production` | `production` |
| `ROGICHAT_WEB_ENV` | `qa` | `production` |
| `ROGICHAT_API_ORIGIN` | `https://api.qa.rogi.chat` | `https://api.rogi.chat` |
| `ROGICHAT_DEFAULT_ROOM_ID` | 선택적 서버 기본 방 UUID (없으면 API의 명시적 isDefault 사용) | 선택적 서버 기본 방 UUID (없으면 API의 명시적 isDefault 사용) |

기본 방 ID가 없거나 빈 문자열이면 미개설로 표시한다. 다른 값은 UUID 검증을 통과해야 한다.
실제 방 ID는 비공개 배포 구성에만 보관한다. 공개 표시 설정은 인가 증거가 아니며 매번 API가 접근을 판정한다.
`GET /healthz`는 runtime 구성을 검증하고 민감한 정보 없이 `{"status":"ok"}`를 반환한다.

```sh
pnpm install --frozen-lockfile
pnpm --filter @rogichat/web typecheck
pnpm --filter @rogichat/web lint
pnpm --filter @rogichat/web test:unit
pnpm --filter @rogichat/web build
pnpm --filter @rogichat/web test
```

브라우저 시험은 production standalone 서버에서 실행한다. 합성 응답은 `test/e2e`의 Playwright
interception에만 존재하며 앱 소스·라우트·컨테이너 입력으로 가져오지 않는다.

## 데이터와 개인정보 경계

브라우저는 API origin으로 `credentials: include` 요청을 직접 보낸다. API의 host-only HttpOnly
쿠키를 Next로 옮기거나 도메인을 넓히지 않는다. `/v1` 프록시가 없다. 읽기는 CSRF 없이 현재 세션을
확인하고, 변경은 서버가 발급한 CSRF 헤더와 실제 JSON 계약을 사용한다. 원본 오류 본문은 표시·로그하지 않는다.

세션·프로필·채팅 조회 데이터는 메모리에만 둔다. 숨김·pagehide·bfcache 복귀·다른 탭의 세션 변경 시
private 화면을 제거하고 새 세션을 확인한다. 로그아웃 요청 전에는 불투명한 one-way session digest와
시도 ID만 pending marker로 저장하며, 결과가 불명확하면 새로고침해도 잠금 상태를 유지한다.
다른 세션은 기존 로그아웃 재시도로 해제하지 않으며, 늦은 응답은 최신 pending marker를 지우지 않는다.

프로필 PATCH·명시적 방 입장/퇴장·로그아웃은 서버 결과를 사용한다. 데이터가 없으면 빈 상태를,
네트워크 오류는 재시도를 표시한다. SOOP provider가 미구성되면 503을 실제 로그인 실패로 안내한다.
`/auth/login`은 정해진 실패 이유만 전달하고 `/auth/complete`는 실제 세션을 확인한다.
Socket.IO는 기본 namespace, Engine.IO path `/v1/realtime`, `websocket` 전용이다.

## 남은 제품 범위

미디어 업로드, 웹 푸시 구독, 계정 탈퇴, 신고/차단은 이 앱에서 아직 제공하지 않는다.
관련 설정은 불가 이유를 표시하며 연결되지 않은 동작을 성공으로 보여주지 않는다.
현재 채팅은 서버에 저장된 데이터 재조회가 기준이며 브라우저 종료를 넘는 영속 outbox는 후속 작업이다.
전체 제품 출시 판단에는 실제 provider·계정·기기 검증과 남은 공통 출시 조건이 필요하다.
