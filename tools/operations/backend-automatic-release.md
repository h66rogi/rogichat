# QA schema-unchanged backend activation

This is a **separately reviewed, uncommissioned** host interface. No policy,
receiver, credential, cloud resource or running host is installed by this PR.
`backend_release.py`, `backend_archive.py`, manual export and manual migration
remain unchanged. Production is unsupported by this tool, including `--apply`;
existing production verification remains separate.

## Trust and installation boundary

A trusted administrator installs these files under `/opt/rogichat/automatic`,
root-owned and not writable by the receiver, candidate or application:

- `backend_automatic_release.py` (this reviewed version, invoked using
  `/usr/bin/python3 -I /opt/rogichat/automatic/backend_automatic_release.py`).
- Exact reviewed copies of `backend_release.py` and `backend_archive.py`. Their
  bytes are pinned in policy and compiled from checked bytes, ignoring pycache.
- `backend_schema_readonly.mjs`, separately reviewed and SHA256-pinned in policy.

All ancestors must be root-owned without group/other write permission and no
symlinks. Policy, request and current-state records are root-owned regular files
with mode `0600`, one hard link, and protected ancestors. The fixed shared lock
`/run/lock/rogichat-deploy.lock` must already exist as root-owned `0600`, one hard
link; root-owned sticky `/run/lock` is supported. Manual and automatic host
operations must all hold this same lock. No self-update or candidate-supplied
verifier is accepted. Root updates/installations must serialize on that lock too.

The independently reviewed baseline **runtime image** is already loaded locally
under its exact `sha256:` execution identity, with its source SHA recorded in
policy. It supplies the existing patched MariaDB driver from
`/app/apps/api/package.json`; it must contain no migration CLI. The probe does not
import application code and never runs the candidate migration image. The fixed
probe is mounted read-only, with the existing DML-only runtime JSON and CA.
There is no new DB user, credential profile, migrator secret, registry login,
cloud credential or secret input on stdin.

The private receiver/poller belongs to the infrastructure coordinator. It stages
trusted QA source templates and `export.zip` in `/opt/rogichat/releases/<source_sha>`
using a privileged, independently reviewed installation boundary. Neither GitHub
webhook data nor a candidate may write policy, helper code or current state.

## Policy version 1

The fixed file is `/etc/rogichat/backend-automatic-policy.json`. All fields below
are required, and unknown fields fail. Operational values must be commissioned
privately; this repository deliberately contains no ready-to-activate policy.

| Field | Required value |
| --- | --- |
| `version`, `environment` | Integer `1`, string `qa` |
| `release_helper_sha256`, `archive_helper_sha256` | SHA256 of installed reviewed helper bytes |
| `probe_sha256` | SHA256 of installed readonly probe bytes |
| `probe_image`, `probe_source_sha` | Exact installed baseline runtime execution identity and full source SHA |
| `schema_sha256` | SHA256 of the canonical physical schema representation below |
| `migrations` | Nonempty sorted exact list of `{name, checksum}`; checksum is migration SQL SHA256 |
| `database_host_sha256`, `ca_sha256` | Approved existing QA host hash and CA file hash |
| `edge_network` | Exact existing QA edge network, restricted to `rogichat-qa_...` |
| `templates` | Exact hash map with `compose`, `unit`, `caddy`, `bootstrap` keys |

Templates are the existing `infrastructure/runtime/compose.app.yaml`,
`rogichat-app@.service`, `Caddyfile.app`, and `Caddyfile.bootstrap`. Both current
and candidate templates must match this policy. A changed schema, runtime
composition, Caddy file or edge peer requires separate review and policy
commissioning, never implicit acceptance from a candidate request. In particular,
future reviewed web edge imports/network changes must be preserved in the
reviewed template/helper version; unknown current edge changes fail closed.

## Request and initial current state

The root-installed `/etc/rogichat/backend-automatic-request.json` contains exactly:

- `environment`: `qa`; `source_sha`: current full QA head; `request_id`: canonical
  UUID; `expires_at`: integer Unix seconds, future and no more than one hour away.
- `policy_sha256`: hash of UTF-8 Python `json.dumps(policy, sort_keys=True,
  separators=(',', ':'))`; no trailing newline. Policy fields are ASCII. Migration
  dictionary key order has no semantic effect.
- `previous_state_sha256`: hash of the **raw file bytes** of the current state.
- `verification_runs`: exact positive integer run IDs for `backend.yml`,
  `security.yml`, `infrastructure.yml`, and `backend-publish.yml`. These must be
  successful same-repository QA push runs at the exact candidate source SHA.
- `archive`: exactly `export_sha`, `export_run`, `export_attempt`, `artifact_id`,
  `artifact_sha256`, `runtime_config_id`, `execution_identity`,
  `runtime_execution_id`. IDs/attempt are positive integers; source is a full SHA;
  digest/config/execution IDs are `sha256:` plus 64 lowercase hex characters.
  `execution_identity` is `config` or `archive-manifest`, never inferred/fallback.
  Config mode requires execution ID equal to config ID; archive-manifest mode
  requires the verified archive descriptor digest and Docker descriptor identity.

Existing manual `backend-export.yml` provenance is supported. The pinned archive
verifier verifies the whole ZIP, raw registry manifests, config, rootfs, producer
run/attempt, exact artifact digest/ID and QA ancestry. It parses migration archive
bytes solely to validate this existing export format. **Only `runtime.tar` is
loaded**, after verification and durable request consumption. No registry pull,
migration image load/run, Prisma migration command or migrator secret is used.
Automatic-export event support requires separately reviewing and pinning the
future archive verifier; this PR does not loosen existing producer checks.

Initial `/var/lib/rogichat/backend-automatic/current.json` must be commissioned
from the running, reviewed compatible release. It contains exactly `source_sha`,
`runtime_image` (typed immutable execution ID), `schema_sha256`, `migrations`, and
`files` (raw SHA256 map of `compose`, `images`, `unit`, `caddy`). These correspond to
`/opt/rogichat/app/compose.app.yaml`, `/etc/rogichat/app-images.env`,
`/etc/systemd/system/rogichat-app@.service`, and
`/opt/rogichat/bootstrap/Caddyfile`. Both API and worker must currently be healthy
and running this exact identity; the previous image must remain locally present.
No bootstrap deployment or recovery from unknown state is authorized here.

## Read-only schema contract

The pinned probe uses only SELECT, SHOW, `START TRANSACTION WITH CONSISTENT
SNAPSHOT, READ ONLY`, and `ROLLBACK`. The existing runtime account must be
`rogichat_app` in `rogichatqa`, TLS must be established with the pinned CA and
certificate verification, and SHOW GRANTS must contain exactly database-scoped
SELECT/INSERT/UPDATE/DELETE (plus optional USAGE). DDL, roles, global privileges,
grant options or unexpected grants reject the release. No credential values or
child diagnostics are logged.

The ledger read includes **all** rows without filtering rolled-back migrations.
Missing table, absent/extra/duplicate rows, unfinished/failed rows, rollback rows,
name or checksum mismatch all reject. Names and checksum fields are compared
semantically, not by dictionary serialization order.

The physical fingerprint is SHA256 of `canonical(schema)` exported by the probe.
Object keys are sorted; array order is the explicit query ordering. The versioned
query set covers tables (name/type/engine/collation), columns (ordered type,
null/default/charset/collation/extra/generated expression), indexes (ordered
columns/expression, uniqueness/prefix/type/visibility), foreign keys (ordered
mapping and update/delete rules), and CHECK constraints. Volatile cardinality,
row counts and next auto-increment counters are excluded. Actual first schema
capture and independently verified hash approval are **root commissioning gates**;
the deployment tool never learns or updates a baseline from a candidate or DB.
The fingerprint covers this query set, not stored program bodies or application
data; source review and restrictive runtime grants remain necessary. Schema DDL
outside the common-lock operational boundary must remain prohibited.

## Execution and failures

Default invocation verifies trusted source, policy, current state, archive and DB
schema. It launches/removes only the trusted baseline read-only probe container;
it does not load a candidate or change application/configuration/state. Candidate
readiness is deliberately not claimed by verification alone.

`--apply` is a later root-owned host action. Under the common nonblocking lock:

1. Revalidate policy/request, expiry, exact current QA head and all exact checks;
   verify current host state and pinned templates; run the trusted readonly probe.
2. Verify archive completely. Create `request-<uuid>` in the private state
   directory, save consumed request and previous state/configuration, and fsync
   both directories. An interrupted/failed consumed request cannot be replayed.
3. Load and inspect only the verified runtime image; run the existing isolated
   auth preflight. Recheck source and current state before draining.
4. Install the pinned bootstrap Caddy configuration, stop API/worker, repeat the
   readonly schema/grant probe, then activate pinned runtime configuration.
5. Require exact API/worker image identities and healthy candidate `/ready` and
   worker schema health. Repeat the independent schema probe, latest QA/check/
   expiry gate and edge boundary verification before restoring API routing.
6. Verify public `/live`, `/ready`, and `/_infra/health` return 200 without a
   redirect, then persist the new current state and completion marker.

Before drain, failure preserves the old running release. After drain, any failure
(including candidate READY schema mismatch) invokes the existing fail-closed
bootstrap routing and stops API/worker. Previous reviewed image and configuration
are retained; **no automatic rollback or down migration** is attempted. Recovery
is a separate reviewed operation with fresh current-state commissioning/request.
An uncatchable host crash needs operational recovery; a consumed request stays
consumed. Image load/probe cleanup failures never become successful activation.

## Validation and remaining commissioning gates

Run `python3 -m unittest discover -s tools/operations -p 'test_backend_*.py'`.
The existing backend CI glob runs the new Python safety tests, which also invoke
`node --test tools/operations/test_backend_schema_readonly.mjs`. Tests use isolated
fixtures/mocks; no production or QA service is contacted. Existing public scanner
and hooks must pass before publication.

Before any real activation, root must separately review this draft, merge through
required current-QA checks, install exact verifier/helper/probe versions, validate
the baseline runtime driver/TLS and read-only query behavior on the host, capture
and approve the ledger and physical fingerprint, pin existing template/edge
state, commission current.json and private receiver staging/authorization, and
exercise failure/replay/locking/recovery with operational evidence. Archive event
compatibility with an automatic exporter is an additional reviewed gate. No
receiver/policy activation, cloud/DB write or host deployment is part of this PR.
