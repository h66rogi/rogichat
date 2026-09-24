# Fixed-path web release

`web_release.py` is an operator-invoked Linux host helper for the real QA and
production web application. The default command performs preflight only; `--apply`
activates the reviewed release. It does not build, check out Git, pull images,
install registry credentials, call cloud APIs or SQL, modify the API configuration,
restart API/worker containers, create networks, or recreate Caddy.

## Initial edge commissioning prerequisite

A trusted operator must prepare the edge once, under the same
`/run/lock/rogichat-deploy.lock` used by backend and web release tools:

1. Create the environment's dedicated bridge network `rogichat-qa-web` or
   `rogichat-prod-web`. QA may also attach the separately managed
   `rogichat-qa-media-gateway` and `rogichat-qa-overlay` services; production
   permits only Caddy and the corresponding web container.
2. Create root-owned, non-group/world-writable directories
   `/opt/rogichat/web/{current,sites,receipts}`. Do not pre-create `web.caddy` or
   `current/compose.json` for an initial release. No parent may be a symlink.
3. Install the reviewed top-level `import /etc/caddy/sites/*.caddy` in the existing
   `/opt/rogichat/bootstrap/Caddyfile`. Preserve its API configuration.
4. Merge the reviewed `edge.qa.yaml` or `edge.prod.yaml` with the host's existing
   `/opt/rogichat/bootstrap/compose.yaml`. Review the complete rendered config
   before recreating **only Caddy**: same Compose project, original API/default
   network, image, host ports, data/config volumes and original Caddyfile mount.
   Add the dedicated web network and read-only directory bind
   `/opt/rogichat/web/sites:/etc/caddy/sites`. Never create a second Caddy project.
5. Verify the existing API route and API/worker health after commissioning.
   Configure DNS/TLS so the public web `/healthz` can be verified at activation.

The helper requires exactly one running Compose `caddy` service, exactly two
Caddy networks (existing API plus dedicated web), the exact read-only site and
main-config mounts, retained `/data` and `/config` mounts, and only the named
environment-specific peers on the web network. It snapshots Caddy identity,
image, mounts, HostConfig, network names and non-web peer identities, and rejects
changes during activation. Initial ports/volume identity preservation remains
the commissioning operator's responsibility: the helper
cannot reconstruct the pre-commissioning state.

## Trusted files and schemas

Install the reviewed helper and exported public artifacts through the existing
trusted operator channel. Files and every parent must be root-owned, non-writable
by group/others and free of symlinks; checked files cannot have multiple hard
links. Never expose this helper through an unauthenticated webhook or unrestricted
sudo wrapper. All requests have closed schemas, including rejection of duplicate
JSON keys. These files contain no credentials, but host identities and room IDs
belong in private host configuration, not public Git.

`/etc/rogichat/web-host.json`, root mode `0600`:

| Field | Contract |
| --- | --- |
| `environment` | `qa` or `production` |
| `machine_id_sha256` | SHA-256 of stripped bytes from `/etc/machine-id` |
| `default_room_id` | Empty string for honest unconfigured state, or canonical UUID |

`/etc/rogichat/web-release.json`, root mode `0600`:

| Field | Contract |
| --- | --- |
| `environment` | Exact host environment |
| `source_sha` | 40 lowercase hex characters; QA-tested image source |
| `image` | `ghcr.io/h66rogi/rogichat-web@sha256:` followed by 64 lowercase hex characters |
| `default_room_id` | Exact host configuration, empty string or canonical UUID |
| `artifacts` | Exact keys `compose`, `environment`, `edge`, `site`, each a SHA-256 hash |
| `caddy_sha256` | Hash of current main `/opt/rogichat/bootstrap/Caddyfile` |
| `bootstrap_sha256` | Hash of current `/opt/rogichat/bootstrap/compose.yaml` |
| `request_id` | Fresh canonical UUID; consumed on first activation attempt |
| `expires_at` | Integer Unix seconds, future and no more than one hour away |
| `verification_runs` | Exact keys `web.yml`, `backend.yml`, `mobile.yml`, `security.yml`, `infrastructure.yml`, `web-publish.yml`; positive integer run IDs |

Production additionally requires these three fields:

| Field | Contract |
| --- | --- |
| `promotion_sha` | Current `main` HEAD, with `source_sha` as ancestor or identical commit |
| `promotion_runs` | Successful main push run IDs for `web.yml`, `security.yml`, `infrastructure.yml` |
| `completed_qa_sha256` | Hash of operator-installed `/etc/rogichat/web-completed-qa.json` |

Every verification run must be completed/successful, belong to the exact public
repository and head repository, match its workflow path, SHA and `push` event,
and use `qa` for image verification or `main` for promotion verification. Public
GitHub API reads require no host token. A failed/rate-limited API read fails closed.
The publisher run gate complements the preloaded image's immutable RepoDigest,
OCI source/revision labels, linux/amd64 platform, UID/GID `10001:10001`, Node
entrypoint and standalone server command. Image preview/demo switches are rejected;
removal of preview routes/fixtures from image contents remains the reviewed
publisher/web tests' responsibility, not a conclusion from OCI labels alone.

Artifacts are fixed beneath
`/opt/rogichat/releases/<source_sha>/infrastructure/runtime/web` for QA, or
`/opt/rogichat/releases/<promotion_sha>/infrastructure/runtime/web` for production:

| Hash key | File |
| --- | --- |
| `compose` | `compose.yaml` |
| `environment` | `compose.qa.yaml` or `compose.prod.yaml` |
| `edge` | `edge.qa.yaml` or `edge.prod.yaml` |
| `site` | `Caddyfile.qa` or `Caddyfile.prod` |

The edge artifact is checked for provenance, not applied. The two web Compose
files are rendered using a clean environment and `/dev/null` env-file; only the
approved image and configured room ID are supplied. The result must contain only
the web service, exact environment/API origin and external network, non-root
read-only runtime, no capabilities, no host ports/mounts/secrets or command override.
No runtime network rewrite occurs.

## Activation and failure behavior

Run the installed reviewed helper as root, first without flags, then explicitly
with `--apply`. Both hold the shared nonblocking host lock. Preflight performs no
container activation (it may create the fixed empty lock file). The image must
already exist in the local daemon with the actual approved RepoDigest.

Activation verifies the previous managed web release is healthy, rechecks request,
host, artifact bytes, promotion and Caddy bindings, then marks the UUID attempted.
It installs only `/opt/rogichat/web/current/compose.json`, starts only `web` with
`--no-build --pull never --no-deps`, and waits up to 120 seconds for Docker health.
The live image ID/reference, UID, exact isolated network, absence of host ports,
runtime environment, paired API origin and configured room ID are checked.
Only then does it atomically install `/opt/rogichat/web/sites/web.caddy`, validate
and reload the existing Caddy process, and require public HTTPS `/healthz` status
200 without redirects using normal certificate verification. Caddy identity and
main configuration are checked again after verification.

A failed first activation removes only the web service/container and its managed
files, never the external network. A failed replacement restores the previous
rendered web config/image and site, waits for previous health and reloads Caddy.
It never restores or overwrites the main API Caddyfile or bootstrap Compose file.
If these changed concurrently, restored web files remain on disk but a Caddy
reload is refused pending operator review. Rollback failure is explicitly reported;
it does not become a successful deployment. The attempt UUID remains consumed,
including failure, and a fresh reviewed request is required for retry.

SIGINT/SIGTERM during activation enter the failure path. Abrupt host death/SIGKILL
cannot execute rollback: an `attempted` receipt without completion requires
operator inspection of web config/container/site and public health. This is a
single-container replace deployment, so transient web interruption is possible.
The helper does not claim zero downtime or perform a reboot/recovery drill.

## Completed QA evidence and production promotion

Successful activation replaces `/opt/rogichat/web/receipts/<request_id>` with JSON
containing exactly `environment`, `source_sha`, `image`, `status` (`completed`),
`request_id`, integer `completed_at`, `verification_runs`, and `default_room_id`.
The operator verifies the QA outcome, transfers its exact bytes to the production
host at `/etc/rogichat/web-completed-qa.json` mode `0600`, and pins its hash in the
production request. Production requires the same QA source SHA, image and
verification runs. It separately validates its own actual default room ID against
production host configuration; the QA and production room IDs may differ.

Production artifacts come from the reviewed current main promotion, with successful
main checks; the application image is the exact completed-QA image, not a rebuild.
The operator remains responsible for the review authorizing that promotion and
for verification of user journeys with real account state. `/healthz` is web
process readiness, not proof of authentication, API availability, room permissions
or chat behavior. No application state is synthesized or modified by this helper.

## Offline verification

```sh
python3 -m unittest discover -s tools/operations -p test_web_release.py -v
```

Tests isolate all daemon/network operations and cover hostile requests, preview
switches, room/environment/image/host mismatch, stale requests, main ancestry,
source/Caddy drift, first-deploy cleanup, replacement rollback and replay refusal.
Before commissioning, render the actual reviewed files with Linux Docker Compose
and run host preflight; offline unit tests do not substitute for that check.

## Explicit reviewed archive transport

If a Docker-loaded image lacks RepoDigests, registry mode fails closed. There is
no automatic fallback and no fabricated tag/digest. A request may explicitly add
`archive` with exactly these fields:

| Field | Contract |
| --- | --- |
| `export_sha` | 40 lowercase hex SHA running the reviewed export workflow |
| `export_run`, `export_attempt` | Positive run ID and attempt of `web-export.yml` |
| `artifact_id` | Positive GitHub Actions artifact ID |
| `artifact_sha256` | `sha256:` plus GitHub ZIP's 64 lowercase hex digest |
| `descriptor_sha256` | Hash of exact exported `descriptor.json` bytes |
| `config_id` | `sha256:` image config digest bound by raw registry manifest |
| `execution_identity` | Explicit `config` or `archive-manifest` |
| `execution_id` | Actual inspected Docker image ID matching declared identity |
| `validator_sha256` | Hash of reviewed sibling `backend_archive.py` |
| `web_validator_sha256` | Hash of reviewed `tools/web/archive.py` |

Select the final source SHA from the successful trusted web publication run and
its verified proof, then inspect `tools/web/archive.py` and
`tools/operations/backend_archive.py` at that exact source. Compute SHA-256 from
each file's exact bytes in that reviewed checkout and pin the results as
`web_validator_sha256` and `validator_sha256` in the operator-approved request;
do not reuse hashes from an earlier publisher or a moving branch. The web
validator must bind the archive digest and config to the exact-attempt publication
proof and reject proof replacement after the export attempt began. Install both
reviewed files in the same repository-relative layout as the helper. The web
wrapper loads an isolated instance of the backend core; no backend policy or file
is modified. The helper verifies both modules' hashes and protected ownership
before importing the wrapper.

The fixed transport is
`/opt/rogichat/releases/<source_sha>/web-export/export.zip`, including on production.
It is the exact `web-<source_sha>-<export_run>-<export_attempt>` artifact produced
by the trusted `web-export.yml` workflow dispatch on QA. The archive contains
exactly `descriptor.json`, `runtime.tar`, `runtime.manifest.json`, and
`publication-proof.zip`, preserving the publisher's original exact-attempt
`web-publication-proof-*` artifact ZIP bytes.

The existing web archive wrapper verifies ZIP hashes and bounded members, config
and layer hashes, raw original GHCR manifest, exact source verification runs,
export workflow/run/attempt/artifact provenance and export-source ancestry. It
extracts only the fixed member set into a private temporary directory below
`/var/tmp`, removed after validation; tar layer paths are never extracted.
Its disk-headroom guard requires archive expansion plus 1GiB of free space.
The operator-installed request additionally pins the descriptor's exact bytes.

The original registry manifest binds the original GHCR digest to the image config.
The loaded Docker image must match the approved config or verified Docker 29
archive-manifest descriptor and exact rootfs layers, plus the same web runtime
and OCI-label checks as registry mode. The helper does not load images; the trusted
operator loads the already-verified archive before invocation.

Archive mode supplies only the approved execution ID to Compose. The approved
original GHCR image and execution ID are retained in the inert
`x-rogichat-release` extension of the installed rendered config for rollback.
QA evidence continues to bind the original registry image digest, so production
cannot substitute a different image by changing archive transport. A transport
schema mismatch, missing manifest/descriptor, or unexpected Docker identity is a
rejection requiring review, never a reason to skip verification.

Archive transport requires exactly four members: `descriptor.json`, `runtime.tar`,
`runtime.manifest.json`, and `publication-proof.zip`. The final member preserves
original GitHub publication artifact ZIP bytes, bounded to 1 MiB and fetched only
by the trusted exporter with its existing credential. The host passes these
bytes through `publication_proof` to the reviewed validator and fetches public
metadata anonymously to bind the original ZIP digest, publication attempt,
source, image, config, five checks and pre-export cutoff. No host credential or
artifact ZIP download is needed; missing proof and old archives fail closed.
