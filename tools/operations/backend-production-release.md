# Production backend promotion

This is a reviewed host-side promotion, not a GitHub deployment workflow. The
public repository holds code only. No production resources, DNS, SQL, secrets or
running services are changed by publishing this implementation. Merge the task PR
to `qa` only after its required checks, then separately review promotion to `main`.
The image is the **exact QA-verified immutable image**, never a production rebuild.

## Operator prerequisites

Use pinned OpenSSH over Tailscale and the private operations inventory to identify
the production instance. Do not run this helper on the management or QA host.
The production account/schema provisioning, DNS cutover, Caddy start and web
composition are separate coordinator-owned changes. A missing schema is a hard
block: this helper has **no migration execution mode**, never reads the migration
secret, never starts Prisma migrate, and never accepts migrator stdin.

The independently approved schema procedure must provision `rogichatprod` with
exactly the promoted image's full migration manifest. `rogichat_app` must have
SELECT/INSERT/UPDATE/DELETE on that database only, no DDL, global permissions or
GRANT OPTION. Only the runtime account is fetched from the fixed Secrets Manager
name `rogichat/prod/database/runtime` in the fixed region. The host IAM policy
already restricts that resource; do not broaden it for deployment.

Install Python 3 with boto3, Docker/Compose v2, systemd, findmnt and trusted CA
certificates through the approved host preparation process. All installed files
and parent directories must be root-owned, without group/other writes or symlinks.
Helpers stay in `/opt/rogichat/operations`; no host checkout or registry credential
is needed. The instance `/run` must be tmpfs.

1. Stage the reviewed main commit's complete `ARTIFACTS` paths beneath
   `/opt/rogichat/releases/<promotion_sha>/`. Runtime artifacts and installed helper
   versions must agree byte-for-byte. The application image label remains the
   original QA `source_sha`, even when the main merge has a different commit SHA.
2. Install `backend_production_release.py`, `fetch_production_runtime_secret.py`,
   and the unchanged `backend_release.py` / `backend_archive.py` in
   `/opt/rogichat/operations/`. These shared helpers provide file/process, CI,
   digest/image/archive verification only; production never invokes QA activation
   or modifies QA guards/globals. Their hashes are part of the reviewed request.
3. Prepare root-owned mode `0600` `/etc/rogichat/prod/host.json` with exactly
   `environment: "production"`, `machine_id_sha256`, `database_host_sha256`.
   The machine hash is SHA-256 of `/etc/machine-id` with surrounding whitespace
   stripped. The DB hash is SHA-256 of the exact approved production writer DNS
   hostname. Derive both from the private, verified inventory/host, never from QA.
   This is a small host binding document, not a copy of private inventory fields.
4. Install the reviewed `rogichat-prod-runtime-secrets.service` into
   `/etc/systemd/system/`, run daemon-reload, then enable/start it. It fetches only
   the production runtime credential, validates the exact writer hash, production
   hostname pattern/database/account, and atomically delivers
   `/run/rogichat-prod/secrets/database.json` as `root:10001` mode `0440`.
   The parent runtime/secrets directories are `root:10001` mode `0750`.
5. Install the production-specific API auth JSON at
   `/etc/rogichat/prod/auth.json`, `root:10001`, mode `0440`, single regular file;
   install the trusted RDS CA bundle at `/etc/rogichat/prod/rds-global-bundle.pem`.
   Use a distinct production session key and registered production broker client
   for `https://rogi.chat` / `https://api.rogi.chat/v1/auth/soop/callback`.
   Broker URLs and credentials must remain private. The exact runtime image must
   parse this auth file and have a configured broker before activation is allowed.
   Auth is mounted only into the API and a network-disabled auth validation probe.
6. Pull approved repository digests separately, or use the existing
   `backend_archive.py download` contract and load its verified tar files. For the
   archive path, retain the original ZIP at
   `/opt/rogichat/releases/<source_sha>/export.zip`. Retain **the same** reviewed
   archive descriptor, registry digests, config IDs and execution IDs as QA.
   The production preflight rechecks GitHub provenance, manifest/rootfs bytes,
   loaded IDs, source labels and amd64 architecture. No rebuild or tag resolution.
7. Confirm a single production bootstrap Caddy container, persistent certificate
   volumes, read-only bind of `/opt/rogichat/bootstrap/Caddyfile`, and the existing
   `rogichat-prod_default` network. Only Caddy and `rogichat-prod-api` may join that
   API network. Caddy may separately join the web network. Both production Caddy
   templates own only `api.rogi.chat` and import `/etc/caddy/sites/*.caddy`; the
   coordinator supplies the root-owned read-only site mount/edge overlay for the
   apex web route. These backend templates do not claim or duplicate `rogi.chat`.
   Missing optional site files are allowed for backend validation, but a complete
   product release still requires the coordinator's real web release and checks.

Boot ordering is `network-online` → production runtime secret delivery → API and
worker units. Compose restart is disabled; systemd owns restart and binds both
app units to the production secret service. Secret rotation must explicitly stop
and recreate both containers after successful delivery; an atomic secret file
replacement alone leaves old bind mounts on their old inode. No unit or QA
secret file is touched by this production helper.

## Reviewed request and QA evidence

Install `/etc/rogichat/prod/qa-verification.json` as root mode `0600`. This is a
trusted operator attestation, **not** arbitrary CI or PR input: derive it from the
QA host's consumed release request and successful completion marker after checking
QA API/worker image identities, health and public routes. Copy through the pinned
management channel. It has exactly these fields:

| Field | Contract |
| --- | --- |
| `environment` | `qa` |
| `source_sha` | Full QA image source SHA |
| `runtime_image`, `migration_image` | Exact verified GHCR repository@sha256 references |
| `verification_runs` | Successful QA push run IDs for backend.yml, security.yml, infrastructure.yml, backend-publish.yml |
| `request_id` | Completed QA request UUID |
| `completed` | Boolean true, only after the QA running release was verified |
| `archive` | Required only for archive delivery; exact original QA archive approval object |

Install `/etc/rogichat/prod/backend-release.json` as root mode `0600`. No fields
besides the following (and optional archive) are accepted:

| Field | Contract |
| --- | --- |
| `environment` | Literal `production` (neither `prod` nor `qa`) |
| `migration_policy` | Literal `verify-only`; all execution policies rejected |
| `source_sha` | The same full source SHA as QA evidence and image revision labels |
| `promotion_sha` | Full reviewed main head SHA; GitHub must confirm QA source is its ancestor |
| `runtime_image` | `ghcr.io/h66rogi/rogichat-api@sha256:<64 hex>` |
| `migration_image` | `ghcr.io/h66rogi/rogichat-api-migration@sha256:<64 hex>`; read-only schema probe only |
| `verification_runs` | Exactly the same four QA push run IDs as QA evidence; verified against GitHub |
| `edge_network` | Literal `rogichat-prod_default` |
| `host_binding_sha256` | SHA-256 of exact private host.json bytes |
| `qa_evidence_sha256` | SHA-256 of exact trusted QA evidence bytes |
| `database_host_sha256` | Must equal host binding and production runtime credential host |
| `previous_caddy_sha256` | Exact current mounted Caddyfile hash, rechecked before mutation |
| `artifacts` | Exact keys from `ARTIFACTS` in backend_production_release.py, values SHA-256 of staged files |
| `request_id` | Fresh canonical UUID; a consumed request cannot be reused |
| `expires_at` | Integer Unix seconds, future and at most one hour from validation |
| `archive` | Optional, must exactly match QA evidence including execution identity; see below |

Archive keys remain the existing QA contract: `export_sha`, `export_run`,
`export_attempt`, `artifact_id`, `artifact_sha256`, `runtime_config_id`,
`migration_config_id`, `validator_sha256`, `execution_identity`,
`runtime_execution_id`, `migration_execution_id`. Config identity must equal its
config ID; archive-manifest identity must match the validated saved manifest and
Docker descriptor. The validator hash must also equal `artifacts.archive_helper`.

Review the complete request, staging hashes, QA attestation and main promotion
before placing them at these fixed host paths. There is no arbitrary request-path
argument, shell command, environment override or unattended PR-to-host path.

## Exact execution commands

On the correctly bound production host, default preflight:

```sh
sudo /usr/bin/python3 /opt/rogichat/operations/backend_production_release.py
```

Preflight verifies root-owned inputs, host/environment/database binding, tmpfs
secret delivery, reviewed main ancestry, successful exact-source QA checks, the
same QA image(s), runtime Compose/Caddy validation, API auth parsing, live RDS
certificate/hostname verification, DML-only account grants and the exact completed
migration manifest. Database probes issue SELECT/SHOW only, with logs disabled and
no auth mount. It also verifies the public HTTPS infrastructure endpoint with
normal certificate validation. Short-lived containers, a lock and a temporary
nonsecret Compose binding file are used and cleaned; no app/config/schema is
changed. Without accounts/schema/DNS/Caddy readiness, preflight must fail.

After separately reviewing the concrete request and activation impact:

```sh
sudo /usr/bin/python3 /opt/rogichat/operations/backend_production_release.py --apply
```

The activation takes the same exclusive `/run/lock/rogichat-deploy.lock` as the
web releaser and reruns preflight; API and web Caddy mutations cannot overlap. It durably
consumes the UUID, backs up previous runtime files, drains only API traffic to the
reviewed bootstrap response, stops owned production units, recreates only stopped
owned API/worker containers using `--no-build --pull never`, enables their units,
and verifies running image identity, production environment, network/secret
isolation and both health checks before exposing API traffic. No SQL is executed.
A verified public `/live`, `/ready`, `/_infra/health` is required after exposure.
The imported web site is preserved during the API drain.

Failure attempts to restore the bootstrap edge and stops **both** production app
units even when one stop fails. There is no automatic image rollback or down
migration; inspect private host state, stop failures and schema compatibility,
then review a fresh request. The consumed marker prevents accidental retry.

## Success evidence and remaining checks

The only success record is root mode `0600`:
`/opt/rogichat/prod/releases/receipt-<request_id>/completed.json`.
It contains `environment`, `source_sha`, `promotion_sha`, `runtime_image`,
`migration_image`, `request_id`, `completed: true`, `request_sha256`,
`runtime_execution_id`, integer `verified_at` and `migration_executed: false`.
`consumed.json` alone is not success. The coordinator must independently inspect
running images/health, public routes and actual web/auth user flow before reporting
an integrated production release. Worker health proves DB/schema readiness, not
job progress or backlog drainage.

The implementation task does not supply actual digests/run IDs, host/machine/DB
hashes, QA completion evidence, production account/schema grants, auth credentials,
CA, main promotion approval, DNS cutover or live activation approval. Keep all
private request/evidence/credential values out of public Git and CI.

Validation uses the existing backend helper discovery command (no new workflow):

```sh
python3 -m unittest discover -s tools/operations -p 'test_backend_*.py'
node --test tools/operations/test_production_readiness.mjs
python3 tools/security/check.py all
```

Tests include actual Docker Compose/Caddy validation, cross-environment negative
cases, wrong host/digest/source/evidence rejection, archive identity checks,
read-only schema/grants tests and consumed-request/failure cleanup. Local macOS
validation may use a checksum-verified standalone Compose at `.tools/compose`;
GitHub's existing backend job supplies Docker Compose and a pinned Caddy image.
