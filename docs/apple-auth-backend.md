# Apple identity and required SOOP link backend

The Apple Nest feature provides native iOS proof completion and a Services ID
browser path for Android/web. It uses Apple's real authorization-code exchange,
RS256 JWKS signature verification and an ES256 client secret signed from mounted
configuration. There is no runtime fixture, token mint shortcut, email matching,
relay matching, identity transfer or restricted-account merge.

The public wire contract is [apple-auth-client-contract.md](apple-auth-client-contract.md).
Existing SOOP direct login resolves the same account UUID after explicit linking.
Restricted accounts retain account/session/logout/deletion access; every existing
chat entry uses the current verified SOOP gate with `403 SOOP_LINK_REQUIRED`.
Apple code/JWKS/signature tests use generated ephemeral keys only in `test`.

## Provider configuration and external evidence

`APPLE_AUTH_SECRET_FILE` is optional. With it absent, existing SOOP starts and
Apple routes return `503 AUTH_UNAVAILABLE`. With it present, malformed secrets
fail startup. The mounted JSON contains exactly `teamId`, `keyId`, `privateKey`
(the real P-256 Apple server signing key) and `clients`. `clients` contains exactly
`ios`, `android`, `web`, each with `audience` and `scope`; Android and web use the
same registered Services ID. `scope` is the explicit lowercase primary App ID
grouping identifier. Shared scope is valid only after verifying the grouping in
the developer portal, never from matching email or assuming subjects are global.

Use distinct real QA/production audiences in their respective runtime files.
The API fixes the callback to its own environment's `/v1/auth/apple/callback`.
Apple's issuer, authorize, token, JWKS and revoke origins are hard-coded; callers
cannot redirect requests or choose a token endpoint. Requests have 8-second
deadlines and 64 KiB response limits, reject redirects and never log credentials.
JWKS cache lasts 60 seconds; unknown keys fail closed until refresh.

Mount both `AUTH_SECRET_FILE` (including its stable 32-byte `identityGuardKey`)
and `APPLE_AUTH_SECRET_FILE` into API and worker when enabling Apple. Never commit
the JSON, `.p8`, provisioning, refresh token or client secret. Apple App ID
capability, Services ID grouping, registered return URLs, server notification URL,
native entitlement/signing and live provider account evidence remain external
release requirements. This work does not claim that registration or a real QA
Apple login has occurred, and does not deploy or modify the separate SOOP broker.

Sources verified for the implementation:
[Apple user verification](https://developer.apple.com/documentation/signinwithapple/verifying-a-user),
[token exchange](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens),
[account notifications](https://developer.apple.com/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts),
[token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens).

## Transactions and provider obligations

The session principal remains the Rogichat user UUID. Identity uniqueness is
provider + exact issuer bytes + explicitly configured scope + subject bytes.
Every link binds original user/session/generation and recent authentication;
callback and completion recheck that binding. Each provider authorization code
and app completion is one-time. App completion additionally requires the original
S256 verifier. Native iOS uses the exact server nonce in the Apple request and
submits both authorization code and signed identity token; both tokens must agree.

An Apple credential obligation is recorded before making the external token
exchange. A successfully received refresh token is AES-256-GCM sealed with
environment/obligation UUID/purpose as authenticated data before account admission.
Failed or abandoned admission schedules revocation; successful admission activates
the credential under the verified identity. Worker revocation uses a persisted
lease and bounded exponential retries, clearing token bytes only after Apple's
acknowledgment. A crash/lost response where the provider might have issued a token
but no token can be recovered remains an explicit exchange obligation; it cannot
be claimed as completed revocation or account purge. It needs provider/account
reconciliation evidence. No distributed transaction with Apple is pretended.

Signed notifications validate signature, issuer, registered audience, issue time,
event time and durable notification replay digest. A subject event fence also
covers notifications arriving before a first account is created. Revocation
invalidates Apple identity and sessions and advances generation, but preserves a
SOOP identity and account. Email forwarding events do not assign identities.

## Deletion and restore fencing

Canonical ACCOUNT ledger v3 records at most eight sorted unique provider guards.
V1/V2 bytes, hashes, original request times and exact existing SOOP v2 HMAC input
are unchanged. Apple gets its own HMAC domain over provider/issuer/scope/subject.
Admission captures immutable guards; apply/restore verifies complete current
identity coverage. Missing coverage remains an unresolved obligation. The bounded
ledger payload cap is 4096 bytes for multi-identity receipts.

The exported `AppleLifecycleService.purgeAccount(tx, receipt, limit)` port requires
the original receipt hash, blocked account and original `auth_not_before`. It
scrubs all-status login payloads, schedules provider revocation and refuses to
report a drained auth subset while provider obligations remain. Identity guard
records and user/identity UUID anchors remain; M10 separately owns content/media
closure. Raw SQL is limited to current-row locks/fences; ordinary persistence
uses generated Prisma operations on the caller's transaction.

## Schema evidence

Migration 21 is `20260920105633_apple_identity_lifecycle`, generated and applied
with Prisma 7.10.0 on a new local MySQL 8.0.44 datadir using Node 24.21.0.
Its unedited SQL SHA-256 is
`de0799c31a68a38512194da77ecd2aaa94b43940e595a6f78e888540321e3ba8`.
The existing identity unique index is replaced by the scoped identity index;
existing rows receive empty scope and retain their previous uniqueness.
No manual SQL migration, reset, create-only generation, diff or live SQL is used.
A separate fresh datadir replayed all 21 migrations and reported schema in sync;
its teardown was confirmed at `2026-09-20T10:58:17.223Z`. The generation fixture
was also removed. Full batch validation is separate from this schema evidence.


## Validation progress

The small single-process TypeScript emit passes. The complete unit/contract run
passed 396 test entries; the two unavailable contract files then passed all 14
checks after reusing installed exact-version Ajv dependencies. The focused
Apple cryptographic, credential-sealing, DTO and v1/v2/v3 ledger suite passes all
27 checks. OpenAPI exports for health/auth/full compose without database or
provider I/O. Genuine MySQL generation and fresh replay evidence are above.
Full source/test ESLint also passes. Hosted integration and required PR checks remain the publishing gate;
real Apple developer registration and live QA device evidence are not claimed.
