# API

현재 소스는 Nest domain modules와 Prisma CRUD/transaction을 기반으로 인증·계정·방 권한,
채팅·REST sync·Socket.IO hint, worker, 사진·영상·스티커, 삭제·탈퇴, 알림·읽음,
신고·차단 및 Apple/네이티브 인증·push 경로를 통합한다. 구현과 격리 테스트 증거는
[통합 기록](../../docs/backend-integration-m10-m11.md)을 따른다.
실제 SOOP/Apple 로그인, R2·APNs·FCM 전달, 백업 복구와 QA 배포는 각각 별도 운영 증거가 필요하다.

후속 [제품·권한 설계](../../docs/backend-design.md), [독립 리뷰](../../docs/backend-review.md),
[다중 인스턴스 구현 계획](../../docs/backend-implementation-plan.md)을 따른다.
초기 실시간 권고는 본문 없는 Socket.IO hint + 현재 권한을 적용한 REST sync다.

실제 작업 순서는 [저비용 MVP 실행 계획](../../docs/backend-mvp-execution-plan.md)의 M01–M12와
[후속 리뷰](../../docs/backend-mvp-review.md)를 따른다. API 1 + worker 1, Redis 없이 시작하며
상시 다중 서버·1,000명 부하는 후속이다.

## 개발·검증

저장소 root에서 Node `.node-version`(24.21.0)과 pnpm `packageManager`(12.4.2)를 사용한다.
TypeScript 5.9.3은 현재 lint parser와 호환되는 버전으로 고정했다. Nest 12.0.3의 ESM layout을
사용하고 `tsc`가 decorator metadata를 출력한다. 테스트도 빌드된 JS를 실행한다.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:e2e
pnpm contracts:check
pnpm test:integration
```

마지막 명령은 PATH의 **MySQL 8.0 mysqld**로 새 임시 datadir/loopback port를 만든다.
기존 MySQL·QA·운영 DB를 사용하지 않는다. 임시 DB/user만 만들고 종료 시 자기 datadir까지 정리한다.
runtime fixture 계정에는 SELECT/INSERT/UPDATE/DELETE만 주어 DDL 거부도 시험한다.
root는 격리 fixture 관리와 migration 생성/적용에만 사용한다.
MySQL 없이 integration을 자동 skip하지 않으며 실패한다.

Docker가 있으면 아래 fixture를 대안으로 사용할 수 있다. 고정 digest의 MySQL 8.0.44이고,
저장은 tmpfs라 container 제거 시 **테스트 데이터만 소멸**한다. 다른 Compose project를 내리지 않는다.

```sh
export TEST_MYSQL_ROOT_PASSWORD="$(openssl rand -hex 24)"
docker compose -f tools/testing/compose.mysql.yaml up -d --wait
ROGICHAT_TEST_MYSQL=disposable TEST_MYSQL_PORT=13306 pnpm test:integration
docker compose -f tools/testing/compose.mysql.yaml down
```

`TEST_MYSQL_PORT` 경로도 loopback만 접속하며 명시적 `disposable` 선택이 없으면 거부한다.
실제 QA 주소/암호를 fixture 변수에 넣지 않는다. CI는 runner 전용 service container를 사용한다.

## 실행과 설정

```sh
pnpm build
# 실제 local DB 계정으로 apps/api/.env를 준비한 뒤 각각 별도 터미널에서 실행
pnpm --filter @rogichat/api dev:api
pnpm --filter @rogichat/api dev:worker
```

`dev:*`는 JS 변경 시 재시작만 한다. 소스 변경은 `pnpm build` 또는
`pnpm --filter @rogichat/api exec tsc -p tsconfig.build.json --watch`로 빌드한다.
이미 설정을 주입한 실행 환경은 `start:api`/`start:worker`를 쓴다. HTTP 포트는 API만 연다.

| 입력 | 계약 |
|---|---|
| `APP_ENV`, `NODE_ENV` | 필수. APP_ENV=local/test/qa/production; qa/production은 NODE_ENV=production 필수 |
| `HOST`, `PORT` | 기본 127.0.0.1:3000. container 내부 bind는 배포 때 명시. PORT 1–65535 |
| `DATABASE_URL` | local/test 전용 mysql URL. query/hash/빈 사용자·암호 거부 |
| `DATABASE_SECRET_FILE` | URL과 상호 배타적. qa/production 필수. JSON의 host/port/database/username/password만 허용 |
| `DB_TLS_MODE` | 기본 required. disabled는 local/test의 loopback DB만 허용 |
| `DB_CA_FILE` | qa/production 필수. 읽기 전용 CA bundle 경로, 인증서 체인+호스트명 검증 |
| `DB_POOL_SIZE` | 기본 API 5/worker 2, 최대 10. transaction admission은 pool size의 5배로 제한하며 초과/알려진 획득 실패는 503 |
| `AUTHORIZATION_EPOCH_FILE` | 선택적 보호 파일의 UUIDv4 authorization epoch. 미설정 시 기존 계약 유지; 설정 시 세션·scope·sync/차단복구 cursor를 별도 키로 묶고 provider sealing 기본 키는 유지 |

파일 credential 구조는 [운영 인계](../../docs/qa-operations-handoff.md)와 맞춘다. 앱은 secret을
직접 발급/회전하거나 AWS 관리자 자격증명을 받지 않는다. 파일 원자 교체 뒤 app recreate는 후속 배포 계약이다.
설정 값·URL·SQL·본문·headers·stack을 로그에 기록하지 않는다. 알려진 event/reason/status와
서버가 생성한 request UUID만 기록한다. 인증·인가 검사는 문서 제공 여부와 무관하게 유지한다.
복구 operator의 격리·증명·checkpoint 계약은 [restore gate](../../docs/backend-restore-gate.md)를 따른다.
epoch 파일을 추가하거나 변경하는 실제 운영 작업은 이 소스 통합에서 수행하지 않는다.

## Health·종료·스키마 경계

- `GET /live`: 200 `{"status":"ok"}`. DB 생존 여부와 무관한 프로세스 liveness.
- `GET /ready`: DB 연결+migration manifest 성공이면 200 `{"status":"ready"}`, 실패/종료 중이면
  503 `{"error":{"code":"UNAVAILABLE"}}`. DB명/버전/실패 원문은 반환하지 않는다.
- 적용한 migration 이름·SHA-256·완료 상태를 manifest와 비교한다. 빈 schema/미완료/알 수 없는
  active migration은 거부하며 명시적으로 rolled back 처리한 과거 시도만 제외한다. startup DDL은 없다.
- probe는 fresh query이며 동시 호출만 합친다. migration 조회에는 2초 transaction 예산을 적용한다.
- worker는 lease/fence를 적용해 job을 소비한다. 5초 probe와 함께 rate GC, publication/media 복구,
  purge 복구, 신고 보존 기한과 Apple revocation을 처리하며 활성 모듈의 설정·서비스 의존성을 따른다.
- SIGTERM/SIGINT 시 readiness 차단→HTTP/context 종료→DB pool 종료. 10초 초과/실패는 비정상 종료.
- `/v1/` CORS는 설정된 origin만 허용하며 보호된 웹 쓰기는 세션·CSRF도 검사한다.
  Apple callback의 제한된 예외는 별도 state/code/nonce 검증을 거친다.

[`health.json`](../../packages/contracts/health.json)은 최소 검증 fixture다. 생성 OpenAPI는 아래 경로에서 확인한다.

## 버전·운영 경계

[Nest 12 ESM/Node 계약](https://docs.nestjs.com/migration-guide),
[Node LTS](https://nodejs.org/en/about/previous-releases),
[Prisma 지원 버전](https://www.prisma.io/docs/orm/release-status)을 확인했다.
Prisma 7.10.0 CLI를 schema/migration에 사용하며 runtime CRUD는 Prisma Client와
단일 mysql2 pool의 driver adapter를 사용한다. lock 등 필요한 raw query 경계와 transaction
deadline은 [ORM 계약](../../docs/backend-orm-first.md)을 따른다.
패키지 exact version+lockfile, 최소 release age 24시간을 적용한다. 검토한 Prisma 7.10.0의
Node 검사와 schema-engine 설치 script만 허용하며 나머지 dependency install script는 차단한다.

Backend PR CI는 credential 없는 build/test와 image build·검사를 수행하며 registry 발행,
cloud 접속·실제 서비스 DB migration·Caddy 변경·배포는 하지 않는다.
실제 Aurora TLS positive 연결, 앱 image/UID/GID, migration 단일 실행과 public route는 후속 증거다.

## Swagger / OpenAPI

`APP_ENV=local` 또는 `qa`에서 `/docs`(조회 전용 UI), `/docs/openapi.json`을 제공한다.
`test`와 `production`에서는 UI·JSON·정적 자산을 등록하지 않는다.
QA: <https://api.qa.rogi.chat/docs>. 검색과 태그별 탐색을 지원하며 Try it out과 인증 저장은 꺼져 있다.
문서는 실제 활성화된 Nest 모듈의 REST 경로만 포함한다. 소켓 복구 계약은
[백엔드 설계](../../docs/backend-design.md)를 함께 참고한다.

웹은 쿠키 세션을 사용하며 보호된 쓰기에는 CSRF 토큰과 허용 Origin도 필요하다.
네이티브는 Bearer 토큰과 `X-Rogi-Client: ios|android`를 함께 사용하며 웹 인증과 혼용할 수 없다.
네이티브 SOOP transaction/launch/completion exchange 및 Apple native completion 경로를 제공한다.
실제 provider 설정과 기기에서의 로그인 증거는 격리 계약 테스트와 구분하며 refresh endpoint는 제공하지 않는다.
각 작업에 로그인 예외, 방 권한, 조회 범위와 오류를 표시한다. 문서 조회 권한은 API 실행 권한이 아니다.

```sh
pnpm --filter @rogichat/api contracts:check
pnpm --filter @rogichat/api openapi:export
```

Export는 외부 서비스나 환경 파일 없이 health/auth/full 세 구성의 JSON을
`apps/api/build/openapi/`에 생성한다. CI도 같은 파일을 artifact로 보관한다.
생성 파일은 Git에 넣지 않는다. REST 변경 시 기능별 `dto/*.openapi.ts`와 컨트롤러의
문서 메타데이터를 함께 수정한다. route inventory, OpenAPI 표준 검사, 요청 parser 비교,
실제 HTTP 응답 schema 검사 및 환경별 노출 테스트로 계약을 검증한다.
[설계·구현계획](../../docs/swagger-design.md)에 범위와 후속 조건을 기록했다.
