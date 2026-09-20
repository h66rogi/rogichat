# M10 ACCOUNT admission and identity guard

This slice implements durable account deletion admission and replay on the frozen
M10 MESSAGE baseline `31d3e797bd590c5e34c275c4a037dfbe3b3a619c`.
It does **not** implement physical ACCOUNT/MESSAGE purge, backup retirement,
restore release, provider configuration, deployment, or a completed M10 claim.

## Admission and receipt

`DELETE /v1/me/account` accepts an empty object. Web requests require the exact
Origin, session cookie and CSRF proof; native requests require the bound Bearer
and client ID. A current locking session/account read and a session created within
the last 15 minutes authorize only the authenticated self. A caller cannot supply
a user, request UUID, timestamp or guard. Missing ledger or dedicated guard key
returns 503 without successful admission.

The authorization transaction captures the linked SOOP identity UUID, a versioned
purpose-separated subject HMAC and DB UTC. External create-only/read-back ledger
I/O follows outside any DB transaction. ACCOUNT schema v2 adds only the opaque
identity UUID, HMAC version, key fingerprint and subject digest; raw provider
subjects, profile fields, tokens, bodies and URLs are excluded. MESSAGE schema v1
and legacy ACCOUNT v1 remain canonical and readable under the existing 1 KiB cap.

A separate short transaction installs guard evidence, sets the account DELETING,
increments its generation once, and retains an independent account purge obligation.
It never scans the user's rooms or all sessions. The public response is exactly
`{requestId, status: "blocked"}` after this commit; it is not a purge completion.
All later ordinary auth and command paths reject the account through their current
status checks. The service never sets LIVE_PURGED, BACKUPS_EXPIRED or a completion
clock and does not install a PURGE handler that could claim success.

A versioned UUIDv5 namespace deterministically identifies environment/account
admission. A known legacy checkpoint UUID and original request time take precedence.
The external immutable receipt wins on retries; dates and subject evidence are
never overwritten. An expired/revoked/deleting session cannot fetch a receipt as a
way to regain authentication. Response loss may therefore leave the caller with
401 on retry while independent replay finishes the already authorized command.

The identity UUID is re-read under lock during apply. A changed identity set cannot
earn an ACK under old evidence: the account is denied, guard coverage remains
false, the obligation stays outstanding and the API returns 503. Legacy v1 or a
missing account similarly cannot prove coverage. While any coverage obligation is
unresolved, an indexed current-read barrier refuses new identity creation/linking;
it does not fabricate a parent account or infer purge from absence. Existing
identity login still needs its own ACTIVE account and a checkable key policy.
Resolving incomplete immutable evidence needs a separately reviewed repair; this
slice has no automatic override or success claim.

## Locking, callback and key lifecycle

Current shared key-policy lock -> subject guard row -> provider identity -> account
is the identity resolution order. Receipt application first locks its immutable
checkpoint, then key policy/subject guard and current identity/account, followed by
the per-account obligation. Account preflight only reads key policy and evidence
while holding the existing current session/account locks; it does not install a
guard. Raw SQL is limited to current locking projections; ordinary persistence is
Prisma. Existing confirmed-rollback retry policy handles lock conflicts and never
replays an unknown COMMIT result.

Web callback finalization checks the guard before its bound session check. Native
callback checks it before storing verified identity payload, and native exchange
checks it again before resolution/issuance. Unbound transactions are included.
The guard projection comes from the locking read itself, so an older repeatable-read
snapshot cannot hide a concurrently committed deletion. Linked callbacks still
revalidate their original user/session/generation and terms.

`identityGuardKey` is an optional, distinct 32-byte hex key in the existing file-only
auth secret JSON. It must differ from the session/auth key. No default/random key
is generated and deletion admission requires it. The first durable guard pins its
version/fingerprint in DB. Missing or mismatched keys fail closed once policy exists;
ordinary auth-key rotation does not change the dedicated guard key. The worker can
rebuild guards from opaque ledger evidence without receiving either raw subjects
or the auth secret. API DTOs do not expose key fingerprints or subject digests.

Key loss or guard-key rotation is an operational barrier, not permission to clear
tables or recreate accounts. Preserve the original dedicated key in the approved
private secret path; a future rotation requires explicit prior-key verification and
replay coverage before activation. Do not delete fingerprints, invent a new key,
or reopen restored service to bypass a mismatch. Restore stays isolated until the
complete ledger and denies have been rebuilt and independently verified.

The new secret shape is not backward compatible with pre-guard binaries: their
strict parser permits only `key` and `broker`, so `identityGuardKey` causes startup
and release preflight failure independently of the schema-version gate. Before
installing the key or enabling admission, approve a same-schema, guard-aware
recovery artifact and configuration strategy. Never strip or rotate the key to
force an old image to start: after durable deletion receipts exist, a pre-guard
binary cannot safely resume identity resolution or ledger replay. Preserve the
original key, pinned policy and deletion evidence during rollback and restore.

Both web and native overall auth transaction lifetime is ten minutes. The original
request fixes `auth_not_before = requested_at + 10 minutes`; retries never restart
it. The guard does not expire at that timestamp. No cleanup operation exists here:
future cleanup requires actual live purge evidence **and** elapsed maximum auth
lifetime, with explicit fresh registration allocating a new UUID and no historical
authority. No account recreation is implemented in this admission slice.

## Bounded replay and composition

The independent ledger reconciler visits ACCOUNT and MESSAGE records without a
pre-existing DB job or original session. A bounded pending page and completed-key
index survive tick deadlines in memory, so a slow page does not starve later
keys. The index advances only after apply and any auth scrub succeed; failures
retry the same key. Restart deliberately replays the prefix. Each completed scan restarts from the
prefix, so no wall-clock watermark skips old intents. Account auth cleanup occurs
in a separate transaction with at most 100 bound login rows and 100 session rows
per visit. It clears pending/processing verifier, launch and identity payloads and
completion bindings, and revokes sessions without deleting them. No account or
guard lock is taken during this cleanup, avoiding callback/login-row lock inversion.
Unbound callback payloads are not attributed by guessing a user; their guard checks
deny use and their existing transaction deadlines remain in force.

M11 subscription/session foreign keys remain intact because admission does not
delete sessions or subscriptions. Membership/read-state/push purge continuation
contracts and C06 read/command fences remain owned by their domains. Root integration
must compose this schema and auth graph with those branches and run the combined
matrix; this branch alone does not prove their final composed behavior. Sole-owner
room topology and actual physical data cleanup remain explicit follow-up work.
The existing room/member admission code does not consult the owner account status,
so other members may still send after that owner enters DELETING. This requires a
separate current owner-status command fence before launch; it is not fixed by this
account-only slice and must not be hidden as completed owner-room handling.

## Validation

Prisma generated and applied `20260920074544_account_deletion_admission` through
`migrate dev` on a fresh loopback MySQL 8.0.44 database, replaying the complete
baseline history. The generated SQL creates only three account/guard tables and
bounded lookup indexes; no existing rows are removed. SHA-256:
`1e3d298e965c15500e83d96f4ebae5e2ce3336c154ce67d369a207058bff85fb`.
A second disposable run replayed that migration and reported schema in sync.
No hand-authored SQL migration, reset, diff, shared DB or hosted DB operation was used.

Focused tests cover current proof and recent-auth failure, external failure/lost
ACK, crash before checkpoint followed by independent replay, original deadlines,
identity-set change during external I/O, missing/rotated guard keys, absent identity,
legacy receipts, bounded cleanup, and old RR snapshots. Web/native unbound and linked
callback tests exercise the same identity guard port used in production. HTTP and
OpenAPI tests require exact receipt/denial shapes and reject caller target fields.
Local build, lint, 27 focused unit checks, 53 initial MySQL checks, the expanded
11-test account matrix, and 19 contract/auth-module checks passed. The replay
continuation correction and strict injected constructors additionally passed 43
focused architecture/ledger/auth-module/contract checks. Hosted CI
evidence is recorded in the PR; full physical purge,
provider storage behavior, real QA login and deployment remain unexecuted here.
