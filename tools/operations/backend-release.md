# QA backend release helper

`backend_release.py`는 서버에 별도 검토·설치하는 root-owned 실행기다. 자동 CI deployer가 아니다.
명시적 승인 이전에는 `--apply`를 실행하지 않는다. public source push만으로 설치/실행하지 않는다.
현재 CLI는 API 1개·worker 1개를 함께 갱신하며 웹/관리 서버/production은 대상이 아니다.

## 설치 전 계약

- `/opt/rogichat/operations/backend_release.py`와 모든 부모는 root 소유, group/other 쓰기 금지.
- `/opt/rogichat/releases/<full image source SHA>/` 아래 승인한 다섯 파일을 원래 상대 경로로 둔다.
  `infrastructure/runtime/{compose.app.yaml,rogichat-app@.service,Caddyfile.app,Caddyfile.bootstrap}`와
  `tools/operations/migrate_entry.mjs`다. 운영자가 파일을 직접 검토하고 각 SHA-256을 승인한다.
  image SHA와 별도 helper revision을 사용하면 두 revision과 파일 hash의 관계도 private 기록에 남긴다.
- 두 GHCR image는 명시적 immutable digest로 미리 pull한다. helper는 pull credential을 취급하지 않는다.
- `/etc/rogichat/backend-release.json`은 root:root `0600`, 아래 폐쇄 schema를 사용한다.
  SSH 사용자에게 이 파일 쓰기 권한이나 임의 Python/Docker sudo를 주지 않는다.
- 기존 Caddy 프로젝트·read-only config mount·data/config volumes·network가 일치해야 한다.
  승인 후에도 Caddyfile hash가 바뀌었으면 다른 배포와 경합한 것이므로 거부한다.
- API에는 host port·host networking·추가 network를 허용하지 않는다. edge network의 상시 peer는
  Caddy와 `rogichat-qa-api`만 허용하여 hosted API의 정확한 `trust proxy = 1` 전제를 검사한다.
  일회성 migrator는 종료·제거한 뒤 최종 network membership을 재검사한다.
- M03 이후 Compose는 API-only `/etc/rogichat/auth.json` bind가 필수다. 별도 승인된 최초
  생성은 운영자가 미리 수행한다. helper는 auth owner/GID/mode/link/크기와 승인된 runtime image의
  실제 `readAuthConfig`를 자동 검증한다. network-none/read-only/128MiB 일회성 container에 auth만
  RO mount하고 env에는 경로만 전달한다. 실패 시 배포를 거부하며 secret 생성/수정은 하지 않는다.
  [인증 파일 운영 계약](../../docs/runbooks/qa-backend-deployment.md#m03m04-api-인증-파일-단일-qa-호스트-한정)을 따른다.
  M02는 인증 mount가 없는 승인된 이전 artifact를 사용하며 두 revision을 섞지 않는다.

요청 필드(실제 호스트 hash와 실행 식별자는 private 운영 기록에만 저장):

| 필드 | 값 |
|---|---|
| `environment` | `qa` |
| `source_sha` | 이미지의 40자리 commit SHA |
| `runtime_image`, `migration_image` | 정해진 GHCR repository의 `@sha256:` digest |
| `edge_network` | 실제 Caddy network, `rogichat-qa_` prefix |
| `database_host_sha256` | 승인된 QA writer hostname UTF-8 SHA-256 |
| `artifacts` | `compose`, `unit`, `caddy`, `bootstrap`, `migration_entry` 각각 파일 SHA-256 |
| `migrations` | 승인한 `{name, checksum}` 목록, 이름 오름차순 |
| `verification_runs` | `backend.yml`, `security.yml`, `infrastructure.yml`, `backend-publish.yml` 각각 성공 run ID |
| `previous_caddy_sha256` | 배포 직전 기존 Caddyfile SHA-256 |
| `request_id` | 새로운 UUID, 실패/재시도도 재사용 금지 |
| `expires_at` | UTC epoch 초, 설치 시점부터 최대 1시간 |

기본 실행은 request/file/CI/image label/digest/host 계약 검사만 한다. API 호출도 public GitHub
read-only이며 rate limit 또는 조회 실패 시 거부한다. 검사 이후 운영자 승인으로 `--apply`를 사용한다.
M03 auth preflight는 위 제한된 일회성 container를 실행·제거하지만 앱/DB/호스트 설정을 바꾸지 않는다.
`--apply`에서는 host lock 획득 뒤 migration 이전에 인증 파일 검증을 다시 수행한다.
실행 직전 migrator JSON을 신뢰된 별도 credential reader에서 SSH stdin으로 공급한다.
JSON/DSN을 shell argument, env, history, 로그에 넣지 않는다. 앱 instance role 권한은 늘리지 않는다.

## 실행과 실패

1. `/run/lock/rogichat-deploy.lock`의 nonblocking exclusive flock을 잡고 승인 만료/기존 config를 재검사.
2. root 전용 `backup-<request UUID>`에 이전 설정을 보존하고 요청을 소비. 이 경로가 있으면 재사용 거부.
3. 기존 Caddy 인증서/volume/container는 유지하고 bootstrap 503으로 admission 차단. 기존 API/worker 중단.
4. migrator JSON을 `/run` tmpfs의 `0440 root:GID10001` 임시 파일로 전달. migration container만 mount.
5. wrapper가 정확한 QA host hash/database/role, TLS+hostname, runtime DML-only/migrator 제한 grants,
   적용 migration의 성공한 prefix를 확인. 실패·rolled-back·unknown·checksum drift는 모두 차단.
6. container 내부 child env로만 DSN을 만든 뒤 `prisma migrate deploy --config prisma.config.ts` 실행.
   출력은 비노출, 5분 상한. Docker inspect/로그에 credential이 없으며 main helper는 6분 상한으로 대기.
7. manifest 전체와 runtime grants 재검증 후 secret 삭제. 검토한 Compose/unit을 설치하여 두 unit 시작.
8. 두 container digest+health, Caddy reload, public `/live`, `/ready`, `/_infra/health` 200 검증.

실패/interrupt 시 bootstrap 503으로 유지하고 API/worker를 중단한다. 임시 migration container와
secret을 정리하며 자동 DB down migration이나 M01 재시작은 하지 않는다. 호환되는 M02 이후 image로
복귀하려면 현재 schema와 일치하는 새 승인 요청을 만든다. 기존 config 백업은 자동 삭제하지 않는다.
Caddy rollback 오류가 나도 두 앱 중단을 각각 시도한다. host/Docker/systemd 장애로 복구 명령까지
실패한 경우 503·앱 중단을 보장했다고 보고하지 않고 실제 경로/프로세스를 직접 확인한다.
전원 장애/SIGKILL은 finally를 보장하지 않으므로 `/run` 잔여 파일·migration container·schema 상태와
공개 경로를 먼저 읽기 전용 검사하고 새 승인으로 복구한다. systemd boot ordering은 별도 reboot 시험 대상이다.

`migrate_entry.mjs`의 URL은 Prisma v7 문서의 `sslcert`와 `sslaccept=strict`를 사용한다.
실제 Prisma-engine TLS 연결 확인은 QA 실행 증거로 남긴다. mysql2 사전 TLS 성공만으로 대체하지 않는다.
[Prisma v7 MySQL connector](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/mysql).

검증(합성 입력, 클라우드/DB 접근 없음):

```sh
python3 -m unittest discover -s tools/operations -p 'test_backend_release.py'
node --test tools/operations/test_migrate_entry.mjs
```
