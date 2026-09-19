# API

M01 구현: Nest API/독립 worker, 검증된 설정, 안전한 로그, health와 종료 처리,
격리 MySQL fixture, 단위/HTTP/프로세스/DB 시험, credential 없는 hosted CI.
M02는 Prisma schema/migration과 mysql2 transaction/repository, membership/history/counter/rate
primitive를 추가한다. [M02 구현 기록](../../docs/backend-m02-implementation.md)을 따른다.
인증·채팅·Socket.IO·R2 및 실제 QA 앱 배포 완료는 이 문서의 DB 구현과 구분한다.

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
| `DB_POOL_SIZE` | 기본 API 5/worker 2, 최대 10. acquisition 대기열 없음 |

파일 credential 구조는 [운영 인계](../../docs/qa-operations-handoff.md)와 맞춘다. 앱은 secret을
직접 발급/회전하거나 AWS 관리자 자격증명을 받지 않는다. 파일 원자 교체 뒤 app recreate는 후속 배포 계약이다.
설정 값·URL·SQL·본문·headers·stack을 로그에 기록하지 않는다. 알려진 event/reason/status와
서버가 생성한 request UUID만 기록한다. 익명 health 이외의 API, auth bypass, Swagger UI는 없다.

## Health·종료·스키마 경계

- `GET /live`: 200 `{"status":"ok"}`. DB 생존 여부와 무관한 프로세스 liveness.
- `GET /ready`: DB 연결+migration manifest 성공이면 200 `{"status":"ready"}`, 실패/종료 중이면
  503 `{"error":{"code":"UNAVAILABLE"}}`. DB명/버전/실패 원문은 반환하지 않는다.
- 적용한 migration 이름·SHA-256·완료 상태를 manifest와 비교한다. 빈 schema/미완료/알 수 없는
  active migration은 거부하며 명시적으로 rolled back 처리한 과거 시도만 제외한다. startup DDL은 없다.
- probe는 fresh query이며 동시 호출만 합친다. 연결 1초/획득 1.2초/query 1초 제한, 실패 연결 정리.
- worker는 5초 간격으로 겹치지 않게 probe하고 상태 변경만 기록한다. **job 소비는 아직 하지 않는다.**
- SIGTERM/SIGINT 시 readiness 차단→HTTP/context 종료→DB pool 종료. 10초 초과/실패는 비정상 종료.
- CORS는 아직 비활성, proxy header는 신뢰하지 않음. 인증 단계에서 검증된 origin/proxy 계약을 추가한다.

[`health.json`](../../packages/contracts/health.json)은 최소 검증 fixture다. 생성 OpenAPI와
제품 DTO 계약은 해당 API 구현 단계에서 추가하며 이미 제공된 것으로 표시하지 않는다.

## 버전·운영 경계

[Nest 12 ESM/Node 계약](https://docs.nestjs.com/migration-guide),
[Node LTS](https://nodejs.org/en/about/previous-releases),
[Prisma 지원 버전](https://www.prisma.io/docs/orm/release-status)을 확인했다.
Prisma stable 7.10.0 CLI를 schema/migration에 사용하며 runtime query는 단일 mysql2 pool을 쓴다.
패키지 exact version+lockfile, 최소 release age 24시간을 적용한다. 검토한 Prisma 7.10.0의
Node 검사와 schema-engine 설치 script만 허용하며 나머지 dependency install script는 차단한다.

Backend CI는 build/test만 하며 image 발행·cloud 접속·DB migration·Caddy 변경·배포는 하지 않는다.
실제 Aurora TLS positive 연결, 앱 image/UID/GID, migration 단일 실행과 public route는 후속 증거다.
