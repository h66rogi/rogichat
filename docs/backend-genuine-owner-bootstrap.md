# Genuine initial owner provisioning

This is an **operator-only initial provisioning command**, shipped in the normal
immutable API runtime image. It is not loaded by API or worker composition, has no
HTTP route, and is never called by login, migration, deployment or startup. It does
not create users, SOOP links, identities, sessions, profiles or messages. Normal
web permissions and login behavior are unchanged.

At dispatch, QA had zero users, verified SOOP links, creators, administrators and
rooms. No provisioning has been executed against QA. Genuine login remains a
prerequisite; this command cannot solve unavailable login by inventing an account.
INFRA owns merge, image deployment, host custody and execution. Production remains
a separate reviewed main promotion.

## Input and custody contract

Compiled command: `/app/apps/api/dist/modules/owner-bootstrap/owner-bootstrap.command.js`.
Run with **no arguments**. Standard input must be a private regular JSON file
(mode 0600/0400, owned by root or the executing UID), at most 8192 bytes. Pipes,
TTY input, environment payloads and argv payloads are rejected. No provider
subject, account ID or request document is emitted in output or error messages.
The operator must obtain the exact authenticated owner UUID and case-sensitive
SOOP subject through a trusted private authentication/DB verification process,
after that person really logs in; never infer them from a nickname or email.
Do not paste that evidence into a public issue, PR, command history or logs.

The request has **exactly** these fields (no implicit defaults):

| Field | Required value |
| --- | --- |
| `version` | Number `1` |
| `scope` | `INITIAL_OWNER` |
| `environment` | `qa` or `production`, equal to runtime configuration |
| `requestId` | Fresh canonical lowercase UUID v4; retain unchanged for retry |
| `ownerUserId` | Explicit genuinely authenticated existing user UUID v4 |
| `expectedProvider` | `soop` |
| `expectedSubject` | Exact provider subject string, 1–191 UTF-8 bytes |
| `roomId` | Explicit stable new UUID v4, distinct from user/request |
| `name` | Exact NFC, trimmed name, 1–80 Unicode characters, no controls |
| `mode` | `FAN` |
| `historyPolicy` | Deliberately selected `SINCE_JOIN` or `ALL_AVAILABLE` |
| `grantCreator` | Boolean; true grants creator, false requires it already enabled |
| `grantManageRooms` | Boolean; true grants only manage_rooms; false does not grant it |

No complete real request or secret fixture belongs in this public repository.
A request is deliberately not a shell command or an environment variable. Prepare
it using a root-controlled private editor/file delivery path. Keep the exact bytes
in protected operator custody until outcome is confirmed; parsing canonicalizes
field order only. Name normalization changes are rejected rather than silently
rewritten. Capability flags never grant manage_users or manage_stickers, and do
not revoke unrelated preexisting permissions.

## INFRA helper interface

Reviewed source helper: `tools/operations/owner_bootstrap.sh`. INFRA may install
that exact version as `/usr/local/sbin/rogichat-owner-bootstrap` root-owned 0755
with **no unrestricted sudo access** for application identities. Its invocation
requires root, zero arguments, and these operational metadata environment values:

- `BOOTSTRAP_IMAGE`: the already-present reviewed API runtime `image@sha256:digest`.
- `BOOTSTRAP_NETWORK`: explicitly selected existing private Docker network; host
  and none are rejected. No host service name is hardcoded in this public source.
- `BOOTSTRAP_ENVIRONMENT`: `qa` or `production`.

Host custody directory is `/run/rogichat-owner-bootstrap`, root-owned mode 0700.
It contains exactly the required inputs below, each root-owned regular mode 0600:

- `request.json`: the approved exact request above.
- `database.json`: existing runtime secret format (host, port, username, password,
  database); use the intended environment's DB and verified TLS endpoint.
- `auth.json`: existing authentication secret format, including the same stable
  `identityGuardKey` used by genuine login and deletion admission.
- `ca.pem`: the trusted database CA chain.

The helper validates custody before Docker execution, mounts this directory
read-only, disables container logging, uses the chosen immutable image with
`--pull=never`, a read-only root filesystem, dropped capabilities, no privilege
gain, no published ports and a 256 MiB memory limit. Container UID 0 reads the
root-owned 0600 mounted inputs; it has no Docker socket or host namespace.
The Node command still validates request/config privacy and uses the existing
configuration/TLS/readiness checks and Prisma pool (size one). INFRA must secure
all ancestor directories and prohibit concurrent file replacement while running.
The helper does not copy secrets, fetch images, create a network, deploy anything,
change a host service, or invoke itself automatically.

Use the helper only once login evidence and the deliberate request are available.
Its stdout is `{ "status": "applied" | "already_applied", "roomId": "…" }`.
Exit 0 means the command observed a committed result and shutdown completed.
Any nonzero result, interrupted process, lost connection or lost stdout means
**failed or unknown**, never success. Restore the same runtime/config and rerun
**the exact original request**, including request ID and target room UUID. Do not
choose a new request/room ID, manually insert missing pieces, delete receipts, or
retry with changed grants. A successful exact rerun verifies live state and returns
the same room; a changed or damaged result rejects and needs investigation.
Keep custody until outcome is resolved, then INFRA removes the ephemeral inputs
according to its secret handling policy. This batch neither creates nor removes
any such host files.

## Atomicity, receipts and lock review

No schema change is necessary. Existing primary keys, unique SOOP subject/user
bindings, room membership and period constraints are reused. One write transaction:

1. Claims the reserved global initial-owner audit singleton using Prisma
   createMany/skipDuplicates. Different owner/room requests serialize here.
2. Calls the existing identity guard service using the configured guard key.
3. Locks exact provider binding, user, creator, admin and target room with bound
   `FOR UPDATE NOWAIT`. The dedicated service owns its transaction; no older RR
   snapshot can be supplied by a caller. Its first consistent Prisma read happens
   only after these locks, while identity guard reads are current locking reads.
4. Requires ACTIVE account, VERIFIED exact subject binding, and no account
   deletion obligation or ACCOUNT intent. A mismatched key, blocked subject,
   missing account or unavailable schema fails closed.
5. For initial application, refuses existing target rooms and any other rooms,
   enabled creators or room managers. It never adopts, renames or chooses between
   existing rooms. A creator must exist or be explicitly requested.
6. Grants only requested capabilities, then reuses `RoomStateService.createOwnedRoom`
   for actual room, initial policy, counter, shared stream, STREAMER membership,
   active period, membership generation increment and owner assignment.
7. Writes request and keyed specification audit receipts in the same transaction.

Three audit rows cover the singleton action, explicit request identity, and opaque
specification identity. The specification ID is a domain-separated HMAC of all
canonical request fields using identityGuardKey, encoded as a UUID (122 retained
bits). No names, subjects, secret values or free-form request content enter audit
columns. This is an internal exact-request integrity receipt, not a public token.
The singleton and request/spec primary keys make same/different request races
rollback-safe. Key rotation requires operational review: a different guard key
must not silently claim a prior provisioning result.

Exact replay checks receipt actor/room/action, specification, live room/name/mode,
policy/version, join policy, owner/role/status, active period, counter/shared stream
and requested grants. It performs no duplicate grant, audit, join or generation
increment. Later valid product activity may add rooms/messages/members; it does not
invalidate the original receipt. Changed bootstrap-defining state (e.g. owner
transfer, changed policy/name or disabled creator) fails without repair/overwrite.

The global audit receipt is bootstrap-only. The shared deletion/login ordering is
guard -> identity -> account. All shared target row acquisition in this command
uses NOWAIT, so a session/room command holding an inverse-order target cannot
close a wait cycle through bootstrap. Contention fails atomically and the operator
reruns unchanged after it clears. Ordinary CRUD uses generated Prisma operations;
raw SQL in the new repository is limited to these explicit current-row locks.
No hidden pool, external I/O inside the write transaction, or unclassified replay
is introduced. Existing Transactions retries only confirmed rollback lock failures;
ambiguous COMMIT errors escape to the fixed nonzero CLI outcome.

Trusted operators and migrations must not concurrently mutate provisioning or
capability records outside these domain paths. The initial-global empty-state
checks are not an authorization mechanism for arbitrary DB writers.

## Verification and release boundary

`test/unit/owner-bootstrap.test.mjs` covers strict request scope, all-field receipt
binding, protected input, missing/ineligible/conflicting state, exact replay,
transaction failure and redacted CLI errors. `test/integration/owner-bootstrap.test.mjs`
creates fresh disposable schemas from committed migrations and covers empty DB,
complete real domain graph, requested-only grants, both history policies, exact
rerun/lost-response recovery, changed requests/state, two competing owners, same
request race, existing multiple rooms, deletion fences and inverse-order locks.
These fixtures run only under the disposable test harness and never enter the
runtime bundle. Hosted CI owns full build, lint, typecheck, existing regression
suite and MySQL execution; no dependency installation/full build/MySQL was run
locally for this batch.

After INFRA merges and publishes, verify the running image digest and normal public
health/auth routes. Only after genuine login and successful operator provisioning
should the actual user route demonstrate that owner and FAN room. A green build,
a pushed branch or this helper's presence is not evidence of deployment or of a
usable QA login. Record actual execution facts privately without identity data in
public reports.
