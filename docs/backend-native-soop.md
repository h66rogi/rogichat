# Native SOOP authentication slice 2

Implementation evidence, 2026-09-20. These source routes are **not a deployment
or device-login claim**. Broker activation and verification of its actual SOOP
canonical subject remain blocked. The implementation uses only the existing
server-side `Broker`/`HttpBroker` contract and rejects missing registration or
an unsupported environment. There is no runtime fixture identity, fallback issuer,
Apple endpoint or app client secret.

## HTTP contract for mobile consumers

The routes and payloads in [the native contract](backend-native-auth-contract.md)
are implemented by `native-auth.controller.ts` and the existing
`auth.controller.ts` callback. POST start/exchange require JSON and exactly one
`X-Rogi-Client: ios|android` matching body `clientId`. Login omits Authorization;
link supplies the original native Bearer at start and exchange. Reject Origin,
CSRF headers, web session cookies, malformed/duplicate headers and unknown JSON
fields. Link must omit `termsVersion`; login may send the legacy optional field,
which has no effect on authentication. Response bodies contain no provider identity or broker URL.

Start returns exactly `transactionId`, API `authorizeUrl` and `expiresIn:600`.
Launch accepts only the one-time `request` query and sets its own transaction cookie
before the broker redirect. Callback accepts only broker state/code or the existing
allowlisted provider error, then selects the stored channel; queries cannot select
channel, client, intent or return location. Native callback never mints a web cookie.
All responses use no-store/no-referrer through the existing application boundary;
application request logs contain fixed route labels, never query strings.

Exchange returns exactly `{tokenType:"Bearer",accessToken,expiresAt,session}`.
`session` is produced by the same function as native GET session, and both expiry
fields match. The opaque credential is 32 random bytes, digest-only at rest, with
fixed seven-day expiry. The existing `READY|SOOP_LINK_REQUIRED` onboarding values
and account-generation derivation remain unchanged.

Native errors are fixed codes, never provider messages:

| Code | HTTP | App action |
|---|---|---|
| `INVALID_REQUEST` | 400 | Correct payload/header grammar; do not infer success. |
| `FORBIDDEN` | 403 | Native POST cannot use browser Origin/CSRF transport. |
| `UNAUTHENTICATED` | 401 | Link start needs a current native credential. |
| `RECENT_AUTH_REQUIRED` | 403 | Reauthenticate; original session is older than 15 minutes. |
| `TERMS_REQUIRED` | 403 | Legacy reserved error; current login and linking do not require consent. |
| `LINK_SESSION_CHANGED` | 401 | Cancel pending link; original session/account/generation is no longer current. |
| `SOOP_LINK_CONFLICT` | 409 | Keep the current account; do not merge or overwrite another identity. |
| `NATIVE_CALLBACK_FAILED` | 400 | Failed, expired or consumed stage, invalid proof, or unverifiable provider result; reauthenticate. |
| `AUTH_UNAVAILABLE` | 503 | Broker/environment unavailable; no synthetic success or fallback. |
| `RATE_LIMITED` | 429 | Back off and start a fresh flow when allowed. |

After a valid browser callback has been claimed, its HTTPS error handoff contains
only `error` and retained app `state`. Its allowlist is `NATIVE_CALLBACK_FAILED`,
`RECENT_AUTH_REQUIRED`, `TERMS_REQUIRED`, `LINK_SESSION_CHANGED`,
`SOOP_LINK_CONFLICT`, `AUTH_UNAVAILABLE`; arbitrary broker messages are discarded.
Pre-claim admission failures return safe HTTP JSON and do not consume the stage.
Successful handoff contains only opaque completion `code` and app `state`.
Only `https://qa.rogi.chat/mobile/auth/complete` or
`https://rogi.chat/mobile/auth/complete` can be selected, by server environment.

## Persistence and authorization

Additive migration `20260920044559_native_soop_transactions` extends
`login_transactions`; existing rows default to WEB. Its generated SQL was created
and applied by `test/run-mysql.mjs --migration-name=native_soop_transactions
--migration-only` using `prisma migrate dev --name` in a disposable loopback MySQL
8.0 instance. No remote DB, reset, manual SQL or migration metadata repair was used.
Readiness manifest SHA-256 is
`2745e58fc8f95fe15792d4b8b6e74b3c9eb937316331f79240e7c99e924edd21`.

Overall lifetime is 600 seconds; launch is 60 seconds; completion is 120 seconds.
Each stage has independent random proof. App S256 is separate from broker S256.
Broker verifier, launch payload and temporary verified identity are AES-GCM
encrypted with transaction/environment/purpose AAD and cleared as consumed.
Browser, launch and completion proofs are digests. Return state is retained for
the required handoff. No plaintext session credential is persisted.

The private native repository uses Prisma CRUD. Its only raw SQL exceptions are
fixed, bound current-row locks by transaction ID/state digest/launch digest.
The stage projection comes directly from that locking read, so it does not
establish a repeatable-read snapshot before a concurrent first-login account is
registered; the later own-account DTO can see the newly committed canonical
account. A deterministic two-request regression forces this ordering.
`SessionRepository.boundNative` uses a fixed, bound joined session/account lock
for fresh session, account status, DB-clock recent-auth and generation
checks. These checks and protected mutations share the caller transaction.
Neither repository opens a hidden transaction or independent database pool.

Broker request/exchange I/O is outside database transactions. Callback validates
browser/state/channel/environment/session before claiming and before broker I/O,
then revalidates on completion storage. Link exchange requires the same still-live
Bearer/session/client/account/generation, and repeats recent-auth checks.

Identity resolution, native issuance, original link-session
revocation and code consumption commit atomically. Unique-identity races retry only
after confirmed rollback. Unknown COMMIT acknowledgement never replays issuance.
A lost exchange response requires reauthentication; it cannot recover plaintext
credentials or reuse the completion code.

## Verification and remaining release gates

`test/integration/native-soop.test.mjs` exercises real loopback MySQL and HTTP:
strict DTO/header/body parsing; stage replay/concurrency/expiry; S256/client/env
mismatch; browser/state swaps and reversed tabs; stored web/native dispatch;
recent-auth, logout, generation/account replacement and deletion; link
conflicts; nested DTO parity; actual lost COMMIT acknowledgement; safe errors and
callback query redaction. Existing web and native transport suites remain required.
Synthetic broker identities exist only in these isolated tests.

Mobile must match local pending transaction/state and authentication generation
before sending exchange and before installing its response. Cancellation/logout/
newer login must reject late results and best-effort revoke only the returned new
credential. Backend tests do not prove that device secure-store lifecycle behavior.
Consumer impact review found the exact onboarding enum enforced by Android
`NativeDtos.kt` and iOS `NativeSessionDTO.swift`; this slice adds no enum values.

Still blocked: actual broker canonical-subject evidence/activation, independently
reviewed QA migration and rollout, signed app association files, real system-browser
return routing and actual device tests. The coordinator owns QA/production hosts,
migrations and merge queue. This slice neither changes those systems nor claims
that native authentication is deployed.
