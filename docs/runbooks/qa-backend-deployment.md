# QA 백엔드 최초 배포와 후속 갱신

이 문서는 실행 절차다. 파일이 존재하거나 image publication CI가 성공해도 QA 앱 배포 완료가 아니다.
범위는 기존 승인된 QA 앱 호스트·전용 Aurora DB의 API 1개와 worker 1개다. production,
새 클라우드 자원, 인증 broker의 다른 소비자, SSH/DB 관리자 권한 확대는 포함하지 않는다.
[운영 인계](../qa-operations-handoff.md), [접근 규칙](../host-access.md),
[MVP 계획](../backend-mvp-execution-plan.md)을 함께 따른다.

GHCR private pull 권한이 없는 QA 호스트는 [검증된 archive transport](../../tools/operations/backend-release.md#명시적-archive-transport-registry-mode의-fallback이-아님)를
명시적으로 승인해 사용할 수 있다. trusted QA export workflow의 ZIP digest·registry manifest·config ID·
rootfs 검증을 통과한 image만 전달하며, registry 권한 확대나 가짜 RepoDigest 태깅은 허용하지 않는다.
이 경로도 실제 `--apply` 전 운영 승인이 필요하고 CI 성공만으로 자동 배포되지 않는다.

## 승인·소유권

- 사용자 예외 승인: 로기챗 전용 격리 local fixture에서 `prisma migrate dev`로 생성·검증한
  migration을 로기챗 QA의 별도 단일 `prisma migrate deploy` job으로 적용할 수 있다.
  reset, migration SQL 수동 수정, production 적용은 승인 범위가 아니다.
- runtime/worker startup은 migration을 실행하지 않는다. API 계정은 계속 DDL 불가다.
- 이 저장소의 image publisher는 cloud/SSH/QA DB credential이 없다. public PR은 기존
  verification workflow만 사용한다. private ops push도 자동 배포 승인으로 간주하지 않는다.
- 서버 helper·Compose·systemd unit은 운영자가 검토한 source SHA로 root 소유 설치한다.
  public 소스가 제공한 임의 shell을 credentialed root 작업으로 자동 실행하지 않는다.
- 아래 작업은 승인된 관리 세션/서버 소유 실행기에서 수행한다. 아직 없는 deployer를 있다고
  가정하지 않으며, helper 검토·설치와 최초 실행 증거를 별도로 기록한다.

## 1. 출처와 이미지 확인

`Backend image publication`은 **이 저장소의 qa push만** 처리한다. 정확히 같은 SHA의
Backend foundation·Security·Infrastructure validation 성공을 read-only job에서 기다린 뒤
linux/amd64 image를 만든다. 빌드와 image smoke에는 registry credential을 전달하지 않는다.
그 다음 publish 단계에서만 해당 job의 GITHUB_TOKEN으로 GHCR에 push한다.
QA host에 CI runner를 설치하거나 Actions에 cloud/SSH secret을 전달하지 않는다.

| image | 내용/실행 |
|---|---|
| `ghcr.io/h66rogi/rogichat-api` | production dependencies·compiled dist만. `dist/main.js` 또는 `dist/worker.js` |
| `ghcr.io/h66rogi/rogichat-api-migration` | 별도 Prisma CLI/engine·검증된 migration. 기본 시작은 Node 버전 표시뿐 |

운영 기록에 source SHA, 성공한 검증·publication run, 각 `repository@sha256:...`를 연결한다.
tag를 deployment 입력으로 쓰지 않는다. 자동 배포 서명/provenance 검증기가 이미 설치됐다고
주장하지 않는다. 운영자는 trusted QA 출처·OCI revision label·digest를 대조해 릴리스를 승인한다.
image가 private이면 관리 경로에서 별도 read-only pull credential을 준비한다. 빌드용 write token을
호스트에 옮기지 않으며 image 공개 여부를 임의 변경하지 않는다.

Node 24.21.0 공식 bookworm/build와 bookworm-slim/runtime manifest digest를 Dockerfile에 고정했다.
기본 build target은 `runtime`; migration tooling은 runtime image에 복사하지 않는다.
Prisma engine은 migration target build 때 설치하고 network-disabled image smoke로 존재를 검사한다.

Nest/Prisma 구조 전환 릴리스는 image만 교체하지 않는다. worker Compose healthcheck,
서버에 설치한 `backend_release.py`의 인증 사전 검사, `migrate_entry.mjs`의 manifest import를
같은 검토된 릴리스에 맞춘다. 현재 경로는 각각 `dist/infrastructure/database/database.js`,
`dist/infrastructure/config/auth-config.js`, `dist/infrastructure/database/schema-manifest.js`다.
옛 flat `dist` 파일을 호환용으로 남겨 성공시키지 않으며, clean build의 runtime-import 계약
시험을 통과한 뒤 서버 helper도 검토·설치한다. MariaDB timeout 보완 패치는 frozen lockfile과
함께 image install 단계에 포함되어야 한다. 상세 조건은 [ORM 결정](../backend-orm-first.md)을 따른다.

## 2. 배포 전 호스트 확인

1. private ops의 승인된 QA 대상과 pinned host key를 사용한다. 검증되지 않은 host key를 자동
   수락하거나 StrictHostKeyChecking을 끄지 않는다. pin 파일이 없으면 SSM 등 승인된 복구 경로로
   host key를 확인해 Git 밖 관리 파일을 준비한다. private 값·키·원문 로그를 public Git에 넣지 않는다.
2. 실제 Caddy container/image, 현재 Compose 경로·프로젝트·Docker network를 확인한다.
   bootstrap 소스의 기본 위치는 `/opt/rogichat/bootstrap`이다. 경로·network를 추측해 다른
   stack을 교체하지 않는다. Caddy `/data`와 `/config` volume·인증서·host-key mount를 보존한다.
3. runtime secret unit이 정상이고 `/run/rogichat/secrets/database.json`이 root:GID 10001,
   0440인지 확인한다. 값 출력 없이 파일 존재·권한과 CA bundle을 검증한다.
4. 예정 release의 schema compatibility와 현재 migration 상태를 확인한다. target QA DB 확인은
   실제 연결 문맥에서 수행하며 URL/암호를 출력하지 않는다. 합성 CI DB와 QA를 혼동하지 않는다.
5. 현재 image/config를 rollback 대상으로 기록한다. 첫 배포에는 이전 앱 image가 없으므로
   실패 시 bootstrap 503 경로로 되돌리고 부분 성공을 배포 완료로 표시하지 않는다.

## 3. 서버 소유 runtime 파일

운영자는 검토된 [compose.app.yaml](../../infrastructure/runtime/compose.app.yaml)을
`/opt/rogichat/app/compose.app.yaml`에 설치한다. root 소유 `/etc/rogichat/app-images.env`에는
아래 **비밀이 아닌** 세 값만 둔다. 실제 값은 외부 private 운영 명세에서 선택한다.

- `ROGICHAT_API_IMAGE`: 승인된 API repository와 64자리 sha256 digest.
- `ROGICHAT_WORKER_IMAGE`: 승인된 worker용 runtime digest. API와 N/N−1 호환 범위를 확인.
- `ROGICHAT_EDGE_NETWORK`: 현재 Caddy가 실제 사용하는 Docker network 이름.

서버 helper는 환경을 QA로 고정하고 서비스 이름 api/worker, 허용 registry/repository,
`@sha256:[a-f0-9]{64}`, source SHA와 검증 증거, 정해진 파일 경로를 검사해야 한다.
Compose 변수 치환 자체는 digest 검증을 대신하지 않는다. 파일 검증/원자 갱신/서비스 교체는
**공통 host 배포 lock** 아래 직렬화한다. API와 worker를 포함해 웹 배포와도 같은 lock을 사용한다.
image pull은 unit 시작 전에 수행하고 unit은 `--pull never --no-build`로 시작한다.

API는 GID 10001로 runtime JSON과 CA를 read-only mount하며 container 내부 `0.0.0.0:3000`에
bind한다. host port는 publish하지 않는다. worker는 HTTP port가 없으며 별도 jobs network를 쓴다.
두 service는 non-root/read-only rootfs, cap drop, no-new-privileges, 메모리/PID/CPU/log 한도를 가진다.
초기 한도는 M02–M04용 시작점이며 영상/업로드 scratch 기능 도입 전 다시 검증한다.

[rogichat-app@.service](../../infrastructure/runtime/rogichat-app@.service)의 `api`, `worker`
두 인스턴스만 설치한다. secret unit의 `Requires=`·`After=` 이후 systemd가 foreground Compose를
관리한다. Docker restart policy는 `no`다. `unless-stopped`로 바꾸면 reboot 때 secret보다
container가 먼저 재시작할 수 있으므로 systemd 순서를 우회하지 않는다.
두 instance를 임의 role로 늘리거나 Compose scale/PM2 cluster/blue-green 동시 serving을 하지 않는다.

runtime JSON의 원자적 교체만으로 기존 file bind mount가 갱신됐다고 간주하지 않는다.
credential 갱신은 별도 승인 절차의 file 준비·container recreate·TLS 확인으로 처리한다.

### M03/M04 API 인증 파일: 단일 QA 호스트 한정

M02 최초 배포는 승인한 M02 artifact revision을 그대로 사용한다. 현재 Compose의 인증 mount는
M03 이후용이며, 아래 파일이 준비되기 전에 M02 배포에 섞지 않는다. 파일이 없으면 Compose가
디렉터리를 만들지 않고 시작을 거부한다. 이 문서를 추가한 것은 서버 파일 생성 승인이 아니다.

- 기존 암호화된 QA EC2 root volume의 `/etc/rogichat/auth.json`을 사용한다. root:GID 10001,
  `0440`, regular file이며 symlink/hardlink·group/other write를 금지한다. 부모 디렉터리도 root
  소유·group/other 쓰기 불가여야 한다. 파일은 Git·image·Actions·로그·Terraform state에 넣지 않는다.
- 최초 승인된 설치에서만 시스템 CSPRNG의 32바이트를 lowercase 64자리 hex로 만든다. JSON의
  초기 필드는 `key` 하나뿐이다. 생성은 no-follow/no-overwrite로 수행하고 안전한 권한 아래
  fsync까지 끝낸다. 이미 존재하면 새 키 생성·교체·덮어쓰기를 하지 않고 값 비노출 검증만 한다.
  기존 값/권한이 잘못돼도 자동 재생성하지 않고 별도 복구 판단을 한다.
- 승인한 image의 `readAuthConfig`와 동일하게 8,192바이트 이하 JSON object, 허용 필드
  `key`/선택 `broker`, key의 `[a-f0-9]{64}` 형식을 확인한다. 현재 함수는 owner/mode/link를
  검사하지 않으므로 배포 helper가 OS 권한/부모 경로/단일 hardlink/크기를 먼저 자동 검사한다.
  이어서 승인된 runtime image의 `readAuthConfig({environment:'qa'})`를 network-none,
  non-root/read-only/cap-drop ALL/128MiB 일회성 container에서 실행한다. auth 파일만 RO mount하며
  환경에는 파일 경로만 전달한다. parser 실패 시 migration·설정 교체 전에 배포를 거부하고
  container를 정리한다. key-only도 정상 입력이며 이 검증은 외부 broker 접속을 하지 않는다.
- API에만 `/run/secrets/auth.json:ro` mount하고 `AUTH_SECRET_FILE`에는 이 경로만 둔다.
  worker·migration job·Caddy에는 이 파일이나 key/broker 값을 전달하지 않는다. 기존 DB secret은
  계속 Secrets Manager → `/run` tmpfs → DB JSON mount로 유지하며 필드·권한을 변경하지 않는다.
- `broker`가 없으면 실제 로그인은 503으로 닫힌다. key-only로 API 기동/익명 401/권한 방어를
  검증할 수 있지만 로그인 연동 완료라고 보고하지 않는다. broker URL/등록정보/secret은 승인된
  관리 영역에서만 다루고 public 문서·source에는 실제 주소를 기재하지 않는다.
- 추후 broker를 추가할 때도 기존 key는 보존한다. 별도 승인 아래 private 설정 변경·파일
  재검증·API recreate를 수행한다. 원자 교체만으로 기존 bind mount가 갱신되지 않는다.

이 방식은 새 IAM 권한·Secrets Manager 자원 없이 단일 QA instance 수명 동안 키를 유지하는
범위다. 현재 root EBS는 암호화되지만 instance 종료 시 삭제되므로 호스트 손실/재생성을 견디는
secret 복구 체계가 완성된 것은 아니다. 키를 잃으면 진행 중 OAuth PKCE 복호화·기존 세션의
CSRF 재발급·IP rate-limit 식별의 연속성이 깨질 수 있다. 자동 key 재생성을 복구로 간주하지 않는다.
실사용 확대·호스트 교체·API replica 추가 전에 동일 key의 별도 복구 보관과 공유 secret store,
접근권한·복구 시험을 승인/구현해야 한다. DB runtime secret에 auth 값을 끼워 넣으면 폐쇄 JSON
계약이 깨지고 worker까지 auth secret을 읽게 되므로 기존 DB secret을 재사용하지 않는다.

## 4. migration 단일 job

1. 동일 릴리스의 검증된 migration image digest와 local fixture 생성·테스트 결과를 확인한다.
2. host lock 아래 단일 migration job만 실행한다. 앱 프로세스·public runner에는 migrator
   credential을 주지 않는다. 앱 EC2 role의 secret 읽기 권한을 늘리지 않는다.
3. 승인된 운영자/관리 경로가 migrator secret을 읽고 권한 제한 tmpfs 파일로 일시 전달한다.
   job wrapper가 이 파일을 읽어 **자기 process/child 환경 안에서만** DATABASE_URL을 만든다.
   DSN/암호를 Docker CLI 인자, `docker -e DATABASE_URL=...`, image, Compose, artifact, 로그에 넣지 않는다.
   비밀을 container 설정 환경에 넣으면 docker inspect에 남으므로 파일 mount 후 내부 조합한다.
4. 해당 Prisma 버전의 MySQL TLS/CA·hostname 검증 설정을 실제 QA에서 검증한다. runtime
   Prisma Client/driver adapter의 TLS 성공이 Prisma CLI의 TLS 설정 검증을 대신하지 않는다.
   검증 해제 옵션은 금지한다.
5. wrapper는 CLI의 `migrate deploy`로 고정하며 임의 인자를 받지 않는다. QA DB allowlist·한 번
   실행·실행시간 상한·실패 시 후속 rollout 중단·비밀 오류 redaction을 검증한다.
6. 적용 결과를 migration 이름/checksum/성공 상태로 확인하고 임시 secret과 job container를 정리한다.
   실제 적용 성공 전 API readiness gate를 우회하지 않는다. 실패한 migration의 해결을 위해
   reset, 수동 SQL 수정, 무검토 `migrate resolve` 또는 자동 down migration을 실행하지 않는다.

위 wrapper/credential 전달과 서버 helper는 실제 실행 전에 검토·설치해야 하는 운영 구성이다.
Migration image가 있다는 이유만으로 이 경로가 구축됐다고 보고하지 않는다.

## 5. API/worker 시작과 Caddy 연결

1. additive migration 성공 후 기존 API admission 차단/drain과 종료를 거쳐 새 digest로 시작한다.
   API와 worker는 각 unit으로 관리하며 Caddy 전체 stack을 `down`하지 않는다.
2. 내부 network에서 `/live` 200, `/ready` 200과 실제 schema/TLS 연결을 확인한다. worker의
   프로세스·정상 readiness 전이·재시작 횟수를 확인한다. worker healthcheck는 별도 read-only DB
   probe이므로 작업 진행/처리 성공 증거는 아니다. probe의 추가 단기 DB connection도 예산에 포함한다.
3. [Caddyfile.app](../../infrastructure/runtime/Caddyfile.app)을 기존 bootstrap Caddy의 동일 경로에
   검토·반영한다. `caddy adapt --validate` 뒤 reload하고 기존 volume과 infrastructure endpoint를 유지한다.
   root-owned bind file을 교체한 경우 container가 새 inode/content를 실제로 보는지 확인한다.
4. 외부 `https://api.qa.rogi.chat/live`, `/ready`, `/_infra/health`의 TLS/HTTP를 확인한다.
   M03/M04는 실제 로그인·세션·권한 matrix와 필요한 프로필/방 API를 추가 smoke한다.
   worker 실행이나 `/ready` 200을 로그인·채팅 완성으로 보고하지 않는다.
5. 실패 시 이전 **호환** digest/config로 복귀한다. schema는 자동 downgrade하지 않는다.
   첫 배포 실패는 보존한 bootstrap Caddy 경로로 복귀하고 503을 명시한다.
   M01의 빈 schema 전용 readiness는 M02 migration 이후 호환 rollback 대상이 아니다.
   bootstrap 503 또는 같은 schema manifest와 호환되는 M02 이후 digest를 사용한다.

프로파일·OAuth query·Cookie·Authorization·Signed URL을 Caddy access log나 오류 원문에
기록하지 않는다. API DNS-only 경로에서 Caddy는 `X-Forwarded-For`를 `{remote_host}`로
정확히 덮어쓰고 CF-Connecting-IP/Forwarded를 제거한다. hosted API는 정확히 한 프록시
hop(`trust proxy = 1`)만 신뢰한다. 이 전제는 API host port 미공개·edge network 단일 연결·
그 network의 상시 peer가 Caddy와 API 두 개뿐인 조건에서만 유효하다. 배포 helper가 기존/신규
container 설정과 network membership을 검사한다. 호스트 root/Docker 권한은 신뢰 경계다.
다른 웹/프록시 container를 같은 network에 붙이거나 LB/Cloudflare proxy를 앞에 추가하려면
헤더·trust policy를 먼저 재설계한다. 다른 경로 길이를 무조건 한 hop으로 간주하지 않는다.
Caddy upstream은 generic Compose alias `api` 대신 전역고유 container name `rogichat-qa-api`다.
위조 X-Forwarded-For/CF-Connecting-IP/Forwarded를 보낸 요청이 같은 실제 client IP로
처리되는지 인증 rate-limit 테스트로 검증하며 IP echo API나 원문 IP 로그는 만들지 않는다.
이 template 자체가 인증/CSRF/rate-limit을 구현하는 것은 아니다.

## 완료 기록

- source SHA와 remote verification/publication run·immutable image digest.
- 별도 migration job 성공과 migration 이름/checksum, runtime DDL 불가 유지.
- 실제 API/worker image, 시작/종료·재시작·메모리, secret mount 권한, TLS/schema readiness.
- public route·제품 smoke·bootstrap/이전 digest rollback 시험.
- 승인된 reboot 시험에서 tmpfs secret 공급 → API/worker 재시작 순서.
- 미실행 항목·외부 broker/Apple 등록 등 잔여 의존성을 명시. 운영 로그/식별자는 private ops에만 보관.

참고: [Docker multi-stage](https://docs.docker.com/build/building/multi-stage/),
[Compose services](https://docs.docker.com/reference/compose-file/services/),
[GitHub 최소 token 권한](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).
