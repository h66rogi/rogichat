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
- 두 GHCR image는 명시적 immutable digest로 미리 pull한다. registry 접근이 없는 호스트는 아래의
  별도 archive transport를 사용한다. helper는 어느 모드에서도 registry credential을 취급하지 않는다.
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
python3 -m unittest discover -s tools/operations -p 'test_backend_archive.py'
node --test tools/operations/test_migrate_entry.mjs
```

## 명시적 archive transport (registry mode의 fallback이 아님)

GHCR 권한 확대·브라우저 credential 추출·가짜 RepoDigest 태깅을 하지 않는다. 검토한
`backend-export.yml`을 `qa`에서 직접 dispatch하여 **이미 발행된** 두 image의 full source SHA와
registry manifest digest를 입력한다. 빌드/DB 접근/배포는 하지 않는다. public PR은 실행할 수 없다.
export job의 자체 GITHUB_TOKEN은 contents/actions/packages **read**만 가지며 임시 Docker config는
pull 직후 logout/삭제한다. Docker save와 upload에는 registry token을 전달하지 않는다.

Producer는 source의 backend/security/infrastructure/publisher 네 push CI 성공, source→export SHA
조상 관계, 원본 registry manifest bytes의 SHA-256, config ID와 Docker save의 모든 rootfs diff ID,
amd64/Linux/nonroot/entrypoint/source label 및 image env의 credential 키 부재를 검사한다.
Dockerfile은 public source/base image만 복사하며 운영 secret은 빌드 입력으로 제공하지 않는다.
이는 임의 이미지에 대한 범용 secret 탐지 보증이 아니며 source security CI/검토를 대체하지 않는다.

artifact는 descriptor 1개 + raw manifest 2개 + Docker tar 2개, 1일 보존이며 source/run/attempt별 이름이다.
관리 환경에서 기존 `gh` 인증으로 다음을 실행한다(출력 폴더는 public Git 밖의 새 임시 경로).

```sh
python3 tools/operations/backend_archive.py download \
  --export-sha <approved-40-character-workflow-sha> --run-id <id> --attempt <attempt> \
  --artifact-id <id> --output <new-external-temporary-directory>
```

ZIP 자체 SHA-256을 GitHub artifact API의 `digest`와 **일치하지 않으면 실패**시킨다. 단순
`download-artifact` 경고를 성공으로 취급하지 않는다. 원본 repository/workflow/event/ref/head SHA,
정확한 run attempt/success, artifact ID/name/expiry, source 네 CI와 crypto chain을 다시 검사한다.
ZIP은 고정된 5개 일반 파일만 허용하고 duplicate/path traversal/link/암호화/크기 초과를 거부한다.
Docker tar는 경로를 추출하지 않고 config 및 layer 내용을 stream hashing한다.

운영자가 descriptor의 기존 registry digest와 config ID를 별도 승인하고, 검증한 두 tar만 신뢰 SSH로
`docker load`한다. 서버 credential 저장은 없다. helper 옆에 검토한 `backend_archive.py`를 root-owned로
설치하고, source release 디렉터리에 원본 `export.zip`을 root-owned로 둔다. 승인 JSON에는 기존
필드를 그대로 유지하고 선택적 `archive` 객체만 추가한다:

- `export_sha`, `export_run`, `export_attempt`, `artifact_id`, `artifact_sha256`
- `runtime_config_id`, `migration_config_id` (각각 `sha256:<64 hex>`)
- `execution_identity`: `config` 또는 `archive-manifest` (자동 감지/fallback 없음)
- `runtime_execution_id`, `migration_execution_id`: 선택한 타입의 검증된 immutable ID
- `validator_sha256` (서버에 설치한 검토된 `backend_archive.py` SHA-256)

`archive-approval.json`은 export/config 값 7개를 제안할 뿐 배포 권한이 아니다. 운영자가 execution 타입/ID, validator hash와
다른 요청 필드를 대조해 root-owned 승인 요청에 반영한다. helper는 원본 ZIP/API 증거/registry
manifest/config/rootfs를 다시 검증하고 로드된 이미지의 실제 ID/labels/RootFS를 검사한다.
검증에는 `/var/tmp`의 제한된 임시 disk scratch가 필요하며 여유 공간 1GiB를 추가 확보한다.
classic graph driver는 `config` 타입, containerd image store는 `archive-manifest` 타입을 명시한다.
후자는 tar의 OCI layout/index를 검사하고 index의 단일 manifest를 raw blob SHA-256/size로 검증한다.
그 manifest의 config digest/size와 모든 layer descriptor digest/size/media type이 이미 검증한
config·layer 파일과 일치해야 한다. `docker inspect`의 실제 `Id`와 `Descriptor`도 정확히 그 manifest와
일치해야 한다. 임의 관측 ID, 가짜 tag, 서로 다른 타입의 자동 fallback은 허용하지 않는다.
원래 GHCR manifest digest, config digest, archive manifest digest를 모두 감사 기록에 유지한다.
서로 다른 세 digest를 같다고 보고하지 않는다. registry mode는 기존
RepoDigests 검증을 그대로 유지하며 실패 시 자동으로 archive mode로 전환하지 않는다.

Docker 29 신규 설치는 containerd image store가 기본이다. QA Docker 29.1.3에서 `docker load`한
OCI archive의 `image inspect.Id`/`Descriptor.digest`가 archive manifest digest이고 source CI의 classic
store ID(config digest)와 다른 것을 확인했다. 이 차이를 위의 명시적 typed identity로 처리하며,
Docker 저장소 설정 변경/daemon restart/이미지 재태깅을 하지 않는다.
[Docker containerd image store](https://docs.docker.com/engine/storage/containerd/),
[OCI image manifest](https://github.com/opencontainers/image-spec/blob/main/manifest.md).

GitHub API 장애/아티팩트 만료/digest 불일치는 배포 차단 조건이다. 만료 뒤에는 같은 source/digest의
새 trusted export와 새 운영 승인이 필요하다. 실제 배포와 DB migration은 기존 `--apply`
승인/실패 시 503 계약 그대로다.
