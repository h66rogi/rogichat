# Runtime contract

QA 앱 호스트는 reverse proxy, web, api를 Docker Compose로 운영하는 설계다.
DB는 MySQL 계열로 변경했으며 private Aurora MySQL로 분리하는 전환 방향이 승인됐다.
메시지 이식이 Redis에 의존하면 cache를 추가한다. 현재는 Caddy만 띄우는 bootstrap
Compose를 준비했고 web/api용 운영 Compose는 앱 scaffold 이후 추가한다.

- image는 검증된 GHCR digest, build는 CI에서 수행.
- DB/cache는 내부 네트워크만 사용, host port 미공개.
- secret은 image/Compose 본문 대신 권한 제한 파일로 전달.
- 관리 접근은 Tailscale 위 OpenSSH. SSH 개인키는 GitHub 밖, 공개키는 private ops GitOps로 관리.
- QA web/API host를 분리하고 API callback TLS·host-only cookie·CORS를 검증.
- web/api만 개별 교체, 공통 host lock으로 manifest 갱신 직렬화.
- volume 보존, migration 별도 단일 작업, 이전 digest rollback 가능.
- 외부 DB backup과 restore drill, disk/log 제한, 실제 HTTP/socket 검증 필수.

`bootstrap.sh.tftpl`은 OS 패키지·Docker·Tailscale daemon·방화벽·SSH hardening과 Caddy를
설치한다. Tailscale 가입 자격증명은 주입하지 않는다. EC2는 `start_caddy=false`로 파일만 준비하고
승인된 DNS 전환 후 Caddy를 시작한다. Lightsail은 외부 `/bin/sh` 실행과 관계없이
명시적으로 Bash를 호출해야 하며, 최초 실패 로그로 이 조건을 확인했다. `compose.bootstrap.yaml`의 Caddy
2.11.4 이미지는 upstream manifest digest로 고정했고 `/data`, `/config`는 영속 volume이다.
`Caddyfile.bootstrap`은 `/_infra/health`에 200, 앱 경로에 503을 반환하도록 설계했다.
`/_infra/ssh-host-key`는 복사한 서버 Ed25519 호스트 공개키 한 파일만 제공한다. 최초
SSH 신뢰 설정 시 정확한 API hostname의 정상 공개 CA TLS 검증과 DNS/IP 일치를 확인하고,
redirect를 따라가지 않는다. 운영자 키·개인키는 노출하지 않으며 기존 pinned key를
자동 교체하지 않는다. 서버 호스트 키 회전 시 snapshot 갱신과 별도 검증이 필요하다.
이 응답을 Nest readiness나 앱 배포 성공으로 해석하지 않는다. DNS가 실제 static IP를
가리킨 후 외부 SAN/chain/HTTP redirect를 검증해야 HTTPS 배포 완료다.

Cloudflare DNS token은 Caddy에 필요하지 않다. HTTP-01/TLS-ALPN-01을 사용하고 80/443을
열어 둔다. 웹 hostname은 앱 배포 시 별도 origin 우회 차단과 함께 추가한다.
[host 접근 설계](../../docs/host-access.md)의 bootstrap·가입·재부팅·인증서 검증을 따른다.

## Web Push custody activation

Before applying a release whose Compose includes `PUSH_VAPID_SECRET_FILE`, the
trusted operator must provision the existing, distinct QA and production VAPID
files at `/etc/rogichat/push-vapid.json` and
`/etc/rogichat/prod/push-vapid.json`. Each must be a regular, non-symlink file
with one link, owner UID 10001, mode 0400, and root-owned directory parents
without group/other write permission. No key material or private bindings belong
in this public repository; release helpers neither generate nor provision keys.

Only API and worker receive the read-only bind at `/run/secrets/push-vapid.json`
and its environment variable. Shared runtime/migration anchors and DB-only
probes never receive VAPID. Preflight uses the pinned runtime image as UID 10001,
read-only and without networking, to execute compiled `readPushConfig` for the
exact QA/production environment and key pair; it suppresses key output, bounds
execution and removes its exact container. Runtime health gates also verify the
API/worker environment and read-only bind. Older reviewed Compose files without
the variable retain their previous behavior. Native FCM/APNs custody is separate
and its absence does not prevent Web Push activation. Deployment still requires
operator-side provisioning, running image verification and real route checks.

## Explicit optional runtime features

The QA and production release requests may include `features`, a sorted unique
list from `apple_auth`, `deletion`, `media`, `native_push`. Omission preserves the
base runtime. Files on disk never enable a feature automatically. A selected
feature must have real provisioned custody; absence rejects that release rather
than inventing config or silently enabling only part of it. `deletion` requires
`media`. No native push provider is required for Web Push.

For each selected name, `artifacts.feature_NAME` pins the corresponding
`compose.NAME.yaml` alongside that environment's base Compose. Only these
approved overlays are rendered into the installed `compose.app.yaml` (JSON,
which Compose accepts as YAML). The existing systemd template then runs the
selected services, including the isolated `decoder` instance only for media.
No new imported host helper is required. The automatic QA helper retains its
existing base-template policy and does not accept these optional feature requests.

| Feature | API and worker file/env | Additional boundary |
| --- | --- | --- |
| `native_push` | `push-native.json`, `PUSH_NATIVE_SECRET_FILE` | Existing parser requires at least one real APNs/FCM provider and its encryption key; no VAPID or native key changes are inferred. |
| `media` | `media.json`, `MEDIA_SECRET_FILE`, `MEDIA_ENABLED=true` | Separate private 256 MiB `/run/media-scratch` tmpfs for each role; only worker gets `MEDIA_DECODER_SOCKET=/run/decoder/image.sock`. |
| `deletion` | `deletion-ledger.json`, `DELETION_LEDGER_SECRET_FILE` | Exact runtime parser verifies a separate ledger bucket/credential pair against media; API auth must contain a distinct `identityGuardKey`. Actual retention and credential scope remain operator admission requirements. |
| `apple_auth` | `apple-auth.json`, `APPLE_AUTH_SECRET_FILE` | Worker additionally receives the existing auth file at `AUTH_SECRET_FILE`; compiled auth parser requires `identityGuardKey`. Other releases never give API auth to worker. |

Each feature file's host prefix is `/etc/rogichat` in QA or `/etc/rogichat/prod`
in production; the mount prefix is `/run/secrets`. All feature files use UID
10001, mode 0400, single-link regular files and trusted root-owned parents.
Auth retains its existing root:10001 mode 0440 contract, base key and broker.
Feature preflight runs only the selected parsers in the immutable runtime image,
nonroot/read-only/network-none, with a timeout and exact-container cleanup.
Neither decoder nor migrator receives provider, auth or VAPID secrets; decoder
also never receives DB credentials.

Media adds `decoder_image` pinned to
`ghcr.io/h66rogi/rogichat-media-decoder@sha256:...`. Archive requests also require
`decoder_config_id` and `decoder_execution_id` under `archive`, using the same
explicit execution-identity mode as runtime/migration. Media admits only archive
v2 with exactly three image roles; non-media admits legacy v1 and rejects decoder
fields. Production QA evidence must repeat the exact `features` and
`decoder_image` fields when present. Production remains schema verify-only.

The decoder has network none, UID 10001, a read-only root filesystem, all
capabilities dropped, no-new-privileges, 1 CPU, 512 MiB memory, 128 PIDs, private
128 MiB `/tmp` tmpfs, and 20-second shutdown. Its only shared path is
`/run/decoder`: a project-scoped `decoder-socket` local tmpfs volume (1 MiB,
UID/GID 10001, mode 0700, noexec/nosuid/nodev), writable only in decoder and
mounted read-only in worker. There is no shared media scratch directory. Release
health verifies the volume's exact driver/options and role mounts/environment.
Socket-stat health is noninterfering liveness only; actual image/video roundtrip
commissioning in the decoder image gate must pass before artifact admission.

Removing media stops and disables the old decoder systemd instance, verifies
container ownership/stopped state, and removes that exact container without
removing volumes. Recreating API/worker from the newly selected template removes
unselected provider mounts. Failed activation keeps the Caddy fence and stops
application roles; it never automatically restarts an incompatible old release.
