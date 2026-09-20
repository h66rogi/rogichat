# Real account access and temporary room delegation

This is a production implementation, not a demo mode. The same HTTP/Nest/Prisma
graph serves QA and production. No product fixture, seeded login, default
password, impersonated platform identity or fabricated room owner is installed.

## Identity and chat entitlement

- Existing UUIDs and canonical SOOP subjects never change.
- An ACTIVE account can chat through verified SOOP, a currently verified Apple
  identity with the exact Apple issuer, or an unexpired reviewer entitlement.
- `soopLinkStatus` remains truthful. `REQUIRED` can coexist with `READY` and
  `capabilities.chat: true`. Clients must not derive chat from SOOP status.
- Real room creation/owner bootstrap still requires the existing verified SOOP
  creator boundary. Reviewer/temporary access never acquires permanent ownership.
- Apple cryptographic verification, identity scope, deletion guards, provider
  revocation and retained upstream obligations remain in the existing lifecycle.
  Missing Apple provider configuration still rejects new Apple authorization.
  Implementing independent chat does **not** prove live Sign in with Apple is
  configured; dedicated provider credentials and actual login verification remain
  deployment evidence, not assumptions from a mobile signing key.
- Natural reviewer expiry removes chat on fresh REST/socket/worker/media checks;
  a still-valid account session may remain usable for self profile/deletion.

## Consumer contract

| Method and path | Contract |
| --- | --- |
| GET `/v1/me/capabilities` | `chat`, `admin.{enabled,manageTestAccess,manageReviewers}`, `password.enabled` |
| GET `/v1/rooms/:roomId/capabilities` | Current effective role and action booleans, optional `temporaryStreamer.{grantId,expiresAt}`; requires active membership |
| POST `/v1/admin/rooms/:roomId/test-grants` | `{requestId,durationSeconds,reason}`; self only, 201 receipt |
| GET same path | Own history, `?after=UUID`, at most 50 rows and `next` |
| POST same path + `/:grantId/revoke` | `{reason}`, idempotent 204 |
| POST `/v1/auth/password/login` | `{clientId,loginId,password,termsVersion}` |
| POST `/v1/auth/password/change` | `{clientId,currentPassword,newPassword}` |

Password login/change return the existing WEB session body + HttpOnly session
cookie, or the existing native `{tokenType,accessToken,expiresAt,session}` body.
No client persists passwords. Native credentials use the existing protected
session store, not a second auth store. `termsVersion` is `2026-09-20`.

WEB requires JSON and exact allowed Origin. A valid prior cookie requires current
CSRF proof. Only a confirmed unauthenticated expired/revoked HttpOnly cookie is
ignored for fresh login; a DB failure is not a stale-cookie bypass. If login
installs a cookie but confirmation fails, clients first read the session instead
of blindly posting another login. Native admission requires matching
`X-Rogi-Client`, forbids browser session cookies, Origin and CSRF, and reuses the
existing opaque Bearer transport.

Login IDs are private ASCII identifiers, 3–64 characters, case insensitive.
Passwords are at least 12 Unicode code points and at most 256 UTF-8 bytes;
controls and malformed UTF-8 are rejected. Passwords are not trimmed, normalized
or silently truncated. Hashes use asynchronous scrypt (`N=32768,r=8,p=3`), random
salt, constant-work dummy verification for absent/malformed stored credentials,
and timing-safe comparison. At most two hash jobs run per process; excess work
fails with 503 instead of growing an unbounded queue. Hashing holds no DB locks.
DB-backed account-HMAC limits (10 attempts/900 seconds) and the existing IP
admission budget apply across API replicas. Password replacement rechecks the
credential revision under the account lock, revokes every old session and push
binding, advances account generation and issues a fresh same-account session.

## Temporary delegation semantics

An operator must already hold the dedicated `manage_test_access` capability and
be an active FAN in the selected FAN room. A request grants only that same member,
for 60–3600 seconds, tied to its current membership period. There is no target
user/actor, permanent role, arbitrary expiry or owner field in the request.

- Physical `room_members.role` remains FAN and `rooms.owner_member_id` is untouched.
- HTTP capability, membership sync, actor profiles, private recipient discovery
  and message action hints project the current effective STREAMER role.
- Read/publish/reply authority is checked fresh inside the protected operation's
  transaction. History floors, blocks, source deletion, current accounts, media
  policy and immutable receipt checks are not bypassed.
- The delegate can receive genuine private fan inboxes, send shared messages,
  answer the actual fan and use scoped moderation. It cannot ban the real owner
  or itself. Existing unrelated administrative capabilities are not granted.
- A new delegate/fan pair does not create durable read/send authority for the
  delegate. Its live room grant supplies those powers. The actual recipient
  retains their received reply after the delegation expires.
- Quoted replies from an owner's inbox may cross to the delegate/author pair
  **only** when the live delegate answers that original fan and both currently
  can read the source. Sending the quote to another fan is rejected. GET and
  paginated projections additionally require the exact reply pair and the
  current viewer's source ACL; deletion or revoked source access hides the quote.
- Issuance/revocation is audited without raw reason text. Same request UUID and
  same payload returns the original receipt, including after expiry/revocation;
  changed payload conflicts and never renews authority. Active overlaps conflict.
- Leave/ban revokes delegation. Rejoining has a new period and never revives the
  old receipt. Explicit revoke is idempotent; history is own-only.
- Membership scope remains period-bound. Authorization revision includes live
  delegation state, including expiry, for both private access and room-visible
  actor projections. Cached role/profile state is invalidated even without an
  expiry worker. This does not promise recall of already delivered plaintext.

## Private operator bootstrap

Compiled entrypoint: `dist/modules/admin/admin-bootstrap.command.js`.
It is a separate one-shot Nest graph, never an HTTP route or startup fixture.
It uses the existing `DATABASE_SECRET_FILE`, strict TLS/`DB_CA_FILE` and
`AUTH_SECRET_FILE`; set `APP_ENV` to the actual `qa` or `production`,
`NODE_ENV=production`, and a single DB connection for the operation. No new
permanent API/worker secret mount or runtime flag is needed.

Request JSON must be supplied on stdin as a protected **regular file descriptor**
with mode 0600, one link, current UID/root ownership and 2–4096 bytes. Do not place
it in argv, environment variables, shell history, terminal output, a pipe, public
CI artifacts or this public repository. Container execution must mount/open the
protected file internally; `docker exec -i` forwarding a pipe is not this contract.

Every request has exactly these base fields:

| Field | Meaning |
| --- | --- |
| `version` | `1` |
| `environment` | `qa` or `production`, exact runtime match |
| `requestId` | New canonical UUID, reused unchanged for uncertain-result reconciliation |
| `operatorUserId` | Existing real user UUID in this environment |
| `expectedSubject` | Independently confirmed exact canonical SOOP subject |
| `scope` | One of the cases below |

Scopes and additional fields:

1. `ADMIN_TEST_ACCESS`: no additional fields. Exact verified subject + UUID +
   ACTIVE account is required; only `manage_test_access` is enabled.
2. `REVIEWER_ACCOUNT`: add `targetUserId`, `loginId`, `password`, `nickname`,
   `expiresAt` (UTC ISO with milliseconds). Requires the operator capability;
   expiry must be 30 minutes–90 days ahead. Creates a new real credential/account
   UUID only. Existing UUID or login ID conflicts; no takeover or automatic merge.
   Terms are accepted through the later real password login, not by bootstrap.
3. `REVIEWER_REVOKE`: add only `targetUserId`, different from the operator.
   Disables the password, clears reviewer expiry, revokes sessions/push bindings
   and advances generation. It does not delete chat or falsify provider status.

Generate request files and reviewer credentials separately per environment.
Resolve the existing operator UUID independently in each DB. Never copy QA rows,
identities, private keys or operational evidence into production or public Git.
Keep necessary reviewer credentials in protected delivery custody for the actual
reviewer; do not publish them in a README or login screen.

The receipt is keyed/HMAC-bound to the complete parsed request. Exact rerun after
lost COMMIT acknowledgement is safe; changed request bytes/meaning conflict.
Replay cannot re-enable a previously revoked reviewer. Fixed success output is
`admin_bootstrap_applied`; failure is `admin_bootstrap_failed_or_outcome_unknown`.
Reconcile the exact request after an ambiguous result, never invent a new UUID
and report success from missing output. No password, subject or profile is logged.
`manageReviewers` is false in the public capabilities until real public reviewer
management endpoints exist; this private command is not exposed as UI capability.

## Migration and deployment boundary

The isolated MySQL harness generated migration 26:
`20260920185425_admin_reviewer_access`, SHA-256
`d000e455dbd31efddbe4db2c20d3efe8b93a587f3205639dbba6be0169e65df2`.

It adds nullable reviewer expiry, a false-default admin flag, password accounts,
period-bound delegation rows and body-free access audit. Existing users, messages,
UUIDs, owner pointers and all previous migration files are unchanged. Fresh
migration replay includes the genuine default-room initializer from migration25.
It creates no reviewer or administrator automatically.

This is a **separate 25→26 release**, not part of the urgent profile/default-room
24→25 operation. Do not widen that operation's allowlist or append this migration
to a frozen deployment. The deployment owner must prepare an exact source/image
digest, schema manifest and separate approved migration operation, then run the
protected DML bootstrap once. Verify actual API/worker revision, schema, public
health and real consumer flows before claiming availability. Old schema25 API
readiness rejects a schema26 ledger: rollback requires a reviewed compatible
application release, not destructive down-migration or an unchecked old image.

## Review and verification

Isolated tests cover strict DTO/OpenAPI fields, bounded password work, protected
file admission, WEB/native sessions, stale HttpOnly cookies, credential rotation,
reviewer revocation/expiry, cross-room/period/owner denial, quoted private replies,
role/profile cache withdrawal and independent verified Apple authorization.
Existing message, multi-pool race, media, source deletion, restore, account cleanup,
sync and owner-bootstrap suites remain required. Synthetic identities occur only
inside these disposable tests and are not runtime seed data.

Cross-consumer review must verify WEB/native interpretation of independent chat
entitlement and effective role, cancellation/ambiguous auth recovery, and protected
token replacement. Private operations review owns exact environment/manifest,
stdin custody and rollout; broker profile deployment retains its separate gate.
