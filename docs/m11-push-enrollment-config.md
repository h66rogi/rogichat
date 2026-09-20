# M11 push enrollment configuration

`GET /v1/me/push-capabilities` uses the existing browser session cookie or native
Bearer plus `X-Rogi-Client` proof. It authenticates session and active account,
requires verified SOOP and terms version `2026-09-20`, and projects the response
inside the same read-only transaction. Missing/stale terms or SOOP return 403;
invalid/revoked/expired sessions return 401. Mixed or malformed proof returns 400.
Every response has `Cache-Control: no-store`.

The exact success union is `{available:false}` or
`{available:true,applicationServerKey:<canonical public VAPID key>}`. Only WEB
with configured VAPID returns true. Native and unconfigured WEB return false.
No subject, private key, provider endpoint, subscription, or account identifier
is exposed. This is enrollment capability, not enqueue/delivery/receipt success.
Existing subscription CAS, ownership, account-switch and delivery fences remain.

## Startup secret file

QA and production accept only `PUSH_VAPID_SECRET_FILE`, an absolute path to a
privately provisioned regular file. An omitted path means unconfigured (`vapid:
null`); an empty path, unreadable/missing configured file or invalid configuration
fails startup with `invalid_push_vapid`, without logging file content or path.
Same-environment legacy `PUSH_QA_VAPID_*` / `PUSH_PRODUCTION_VAPID_*` inline settings
are rejected, including partial/empty settings. Unprefixed inline VAPID settings
are also rejected. Unrelated environment-prefixed settings cannot configure the
current environment. Local/test retain their explicit `PUSH_LOCAL_VAPID_*` and
`PUSH_TEST_VAPID_*` convenience; mixing those with a file is rejected.

File JSON must contain exactly four string fields: `environment`, `subject`,
`publicKey`, `privateKey`. Environment must exactly equal `APP_ENV` (`local`,
`test`, `qa`, or `production`). Use a mailto or HTTPS subject and a matching P-256
pair: public key is canonical unpadded base64url of the 65-byte uncompressed curve
point; private key is canonical unpadded base64url of the 32-byte scalar. No
credential examples or generated key values are committed.

The loader accepts 1–4096 bytes, strict UTF-8 without BOM, a flat JSON object,
plain unescaped field names and no unknown or duplicate fields. Values may use
valid JSON escapes. The descriptor is opened read-only with NOFOLLOW/NONBLOCK,
then checked as a single-link regular file owned by root or the process effective
UID. Mode must be exactly 0400 or 0600 (including no special bits). Path symlinks
are rejected, including symlinked parent paths; supply the canonical mount path.
The read is bounded to 4097 bytes and descriptor metadata is checked again for
concurrent changes. Parent directories and secret provisioning remain trusted
operator boundaries. For a hosted process running as UID 10001, provision the
file as owner 10001 with mode 0400 or 0600; root:10001 mode 0440 is rejected
and a root-owned 0400 file cannot be read by that non-root process. Mount a regular secret file; symlink-based secret mounts
are intentionally unsupported. Never bake it into an image, commit it, or put
private material in environment variables or public CI.

Load configuration at startup; replacing the file requires a controlled restart.
On public-key rotation, consumers must unsubscribe the old browser subscription
and create a new subscription with the new `applicationServerKey`, then enroll
using the existing CAS contract. Do not reuse an endpoint across accounts or
weaken generation/ownership checks. Parent owns hosted provisioning, QA merge,
rollout and consumer coordination; this change performs no deployment.

## Verification

Unit tests generate synthetic P-256 pairs at runtime and cover file permissions,
links, environment binding, malformed/duplicate/escaped/unknown fields, bounded
UTF-8/JSON parsing and key canonicality. Controller-derived and standalone M11
schemas share the capability schema, with contract tests proving equality and
rejecting excess fields. Disposable MySQL HTTP tests exercise configured and
unconfigured WEB, native, mixed proof, stale/missing terms, SOOP revocation,
account suspension and session revocation through the real Nest composition.

The initial full suite exposed the pre-existing readiness test's fixed 20 ms
server-close wait (one failure in both parallel and serial runs). A bounded
synthetic handshake diagnostic measured one close-event delay of 1001.757 ms
and other samples already closed by return. With coordinator approval, that
single test now uses the adjacent test's existing 1500 ms bounded wait, retains
its 2500 ms readiness and 5000 ms test limits, and asserts no reopened sockets
after checking the closed database. No runtime timeout or database code changed.
