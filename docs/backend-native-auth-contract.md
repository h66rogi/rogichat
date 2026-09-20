# Native authentication implementation contract

2026-09-20. Backend-owned implementation target agreed with the native-app owner.
This document does not mean the endpoints below are deployed. The QA foundation
is running, but its current authentication transport is web-only and its broker
is not configured. Never turn these gaps into fake login or a successful demo.

## Delivery slices and current ownership

1. Native session transport: separate DB purpose/client binding, REST session and
   logout, shared command authorization, and native socket admission. In progress.
2. Native SOOP transaction, browser launch, callback handoff and completion exchange
   are implemented separately in slice 2; see [implementation evidence and safe
   errors](backend-native-soop.md). Broker activation/canonical-subject verification
   and deployment remain release gates. Not implemented by slice 1 alone.
3. Apple native verification and Android/web Apple authorization, provider-token
   revocation and account-change handling. Separate implementation and registration
   gates; an identity table is not evidence of Apple support.
4. Actual device tests, verified return-link association, logout/deletion races,
   provider identity checks and external failure cases before feature activation.

The backend owns credentials, identity verification and authoritative projections.
Native apps own secure credential/verifier storage and lifecycle cancellation.
Web/infrastructure own the HTTPS completion path and verified association files.
Swagger/OpenAPI work is owned by its separate conversation; this contract is an
input to that work, not a parallel Swagger implementation.

## Credential contract (slice 1)

- Native credentials are opaque CSPRNG 32-byte values, base64url without padding
  (43 characters). Store only a digest in the database. No native JWT or embedded
  claims, no app-bundled client secret, and no public mint/test-login endpoint.
- Fixed maximum lifetime is seven days from issuance, measured using the database
  clock. Activity does not extend it. Initially there is **no refresh endpoint**;
  expiry requires reauthentication. Any future rotation is a new reviewed contract.
- `auth_sessions.transport` is `WEB` or `NATIVE`; existing rows default to `WEB`.
  Native rows additionally bind `client_id` to `ios` or `android`. Audience remains
  the exact server environment. A web credential is never accepted as Bearer and
  a native credential is never accepted from a cookie.
  Issuance and reads accept only `(WEB,null)` or `(NATIVE,ios|android)`; malformed
  persisted combinations fail closed even though the additive schema permits them.
- Native REST uses `Authorization: Bearer <credential>` and
  `X-Rogi-Client: ios|android`. The client header is a binding, not device or app
  attestation. Reject duplicate/malformed headers, mixed cookie/Bearer credentials
  and native CSRF headers. Never infer native authentication from missing Origin.
- Web cookie attributes, exact Origin checks and CSRF proofs remain unchanged.
  Native commands authenticate their explicit Bearer; they do not spoof an Origin
  or collect system-browser cookies. Both transports authorize again in the same
  transaction that performs each protected command.
- Native `GET /v1/auth/session` returns an explicit own-account projection:
  account UUID, nickname and nullable avatar asset ID; current SOOP status,
  onboarding state, fixed expiry, opaque account generation and only implemented
  capabilities. No provider subject, database row spreading, token digest or CSRF
  token. The generation is an invalidation hint, never an authorization proof.
  Existing web session response is preserved in this slice.
- `POST /v1/auth/logout` with `{}` revokes this session in the same authorization
  transaction and returns 204. Native logout does not set/clear web cookies.
  Expired/revoked/suspended/deleting accounts fail authentication; a valid account
  missing SOOP linkage receives `403 SOOP_LINK_REQUIRED` on chat operations.
- Native realtime uses upgrade Authorization/client headers and handshake
  `{schemaVersion:1,transport:"native"}`. The web handshake retains its Origin,
  cookie and CSRF contract. No credential in a URL or application event. Admission
  is bounded and must validate the current session before accepting a connection;
  existing session-expiry/revocation checks continue after connection.

## Native SOOP transaction contract (slice 2)

All JSON objects reject unknown fields. Auth responses are `Cache-Control: no-store`.
The following routes are implemented by slice 2, not a claim of deployed APIs.

| Route | Request | Response |
|---|---|---|
| `POST /v1/auth/native/soop/transactions` | `clientId`, `intent`, `codeChallenge`, `codeChallengeMethod:"S256"`, `returnState`, login `termsVersion` | `transactionId`, `authorizeUrl`, `expiresIn:600` |
| `GET /v1/auth/native/soop/launch?request=…` | API-created one-time browser launch ticket | Bound browser cookie and 303 to the validated broker authorization URL |
| `GET /v1/auth/soop/callback` | Existing broker callback fields | Stored channel selects web completion or native HTTPS handoff |
| `POST /v1/auth/native/completions/exchange` | `clientId`, `transactionId`, `code`, `codeVerifier` | `tokenType:"Bearer"`, `accessToken`, `expiresAt`, `session` containing the authoritative native session projection |

The exchange response nests the exact `GET /v1/auth/session` native DTO under
`session`; it does not flatten those fields or add a provider/sign-in-method
inference. Its outer `expiresAt` must equal `session.expiresAt`.

Native start/exchange require a single `X-Rogi-Client` matching body `clientId`,
JSON content type, no browser Origin/CSRF and no web session cookie. Login omits
Authorization; link uses the same native Bearer at start and exchange. Reject
unknown body fields and duplicate credential/client headers.

`clientId` is `ios|android`. `intent` is `login|link`. Login requires current terms
version `2026-09-20`. S256 challenge and returnState are 43-character base64url
values; the app generates an independent verifier and independent returnState.
The verifier follows RFC 7636's 43–128 unreserved-character grammar. Neither the
verifier nor identity fields appear in the start response, callback URL or logs.

The app retains transaction ID/verifier/state and opens `authorizeUrl` only in a
system authorization browser. App PKCE is independent of the existing API-to-
broker PKCE; the broker verifier must not be handed to the app.

The browser launch sets a transaction-specific HttpOnly cookie, Secure in hosted
environments and SameSite=Lax for the SOOP GET callback. Preserve the existing
ten-pending-cookie bound and multi-tab isolation. Before claiming a callback or
calling the broker, validate its state, the corresponding browser proof, stored
channel/intent/environment and current bound session where applicable. Missing or
wrong browser proof must not consume the transaction or mutate identity. The
query cannot choose the channel, intent or app return location.

Launch lifetime is 60 seconds; completion lifetime is 120 seconds; the overall
transaction expires after 600 seconds. Each stage uses a different random value,
stored as a digest where possible, and is atomically single-use. The exchange
rechecks overall expiry, exact environment/client, S256 and current account state.
Transient provider failure must never silently produce an authenticated account.

For `link`, start requires the current native session and recent authentication
(15 minutes). Persist user/session/client/environment binding. The callback must
not assume the browser has the app's Bearer: inspect the bound session internally.
The final exchange requires that **same still-current native session** and app
verifier. Logout, account replacement, suspension or deletion invalidates the
pending link. Exchange resolves identity, updates linkage, consumes the code
and issues the replacement native session in one transaction. Revoke the old
session on successful replacement. Do not auto-merge identities or accounts.
Only an explicit login terms consent may update the recorded terms version. A
link transaction preserves existing consent; successful identity linking is not
agreement to new terms and must not bypass any outstanding terms requirement.
Slice 2 rejects stale/null consent at native link start, callback and exchange with
`403 TERMS_REQUIRED`, without updating consent or revoking the current session.
The app may offer an explicit login with current consent, but must not silently
convert link into login or merge accounts. This does not add an onboarding enum
value or implement a global future terms-policy migration gate.

Claim the provider transaction before external I/O; broker exchange happens
outside the DB transaction. Finalization repeats current authorization. Confirmed
DB rollback may be retried under existing classified policy, but an unknown COMMIT
acknowledgement must never blindly replay account creation or credential issuance.
If a completion response is lost, reauthenticate instead of persisting recoverable
plaintext session credentials or making a consumed code reusable.

Before sending an exchange and again before installing its response, the app must
match the pending transaction and local authentication generation. Cancellation,
logout, account replacement and a newer login advance that generation. A late
successful response must never overwrite the current secure-store credential;
discard it and best-effort revoke only the newly returned credential. This rule
applies to login as well as link and cannot be replaced by a callback-state check.

## App return links and browser boundary

Exact allowlist, selected by server environment rather than request input:

- QA: `https://qa.rogi.chat/mobile/auth/complete`
- Production: `https://rogi.chat/mobile/auth/complete`

There is no initial custom-scheme fallback. The app must verify the exact origin
and path, reject duplicate/unknown callback fields and match its pending state.
Only an opaque one-time `code` and the app's `state` may appear in a successful
handoff URL. Transaction ID is retained by the app from start. Credentials,
provider subjects, account IDs, profile fields and arbitrary return URLs are not
URL fields. A denied flow may return only a fixed allowlisted error and state.

The web fallback is a truthful return-to-app/error page, not an alternate exchange
client. It must not exchange a code, emit analytics containing the URL, load third-
party content, or treat a missing native app as successful login. Serve no-store
and no-referrer; redact/omit query strings in edge/application/error logging.
Verified AASA and Android assetlinks must use the real signed application identity.
Association files, native entitlements and real device routing are release gates.

## Apple contract boundary (slice 3)

iOS native Apple verification will use a server-owned transaction containing an
independent nonce, state, environment/client, app S256 challenge and optional
link-session binding. The app sets the returned nonce exactly; no undocumented
client/server hashing discrepancy is allowed. It submits identity token and
one-time authorization code with transaction/state/verifier to the backend.

The server validates signature using Apple's fixed JWKS endpoint, an explicit
algorithm allowlist, issuer, exact registered audience, expiry, issuance time,
subject and nonce. It exchanges the authorization code using server-only Apple
credentials and checks consistency before identity/account/session finalization.
No decode-only authentication, email/name-based auto-merge, arbitrary JWKS URL,
redirect-following token request or original-token fallback is permitted.

Provider refresh credentials, if issued, remain encrypted server-side and require
revocation/account-deletion handling; they are not native app credentials. Apple
notification authenticity, replay and identity/session invalidation require tests.
Android/web uses registered Services ID and a separately reviewed browser callback
contract; do not pretend the iOS native token endpoint implements that flow.
Missing registration/key/audience/verified linkage fails closed. Exact Apple
routes and form-post handling are finalized in slice 3 before consumers wire them.
Apple login followed by mandatory SOOP linking does not, by itself, establish
App Store policy compliance. Preserve the product requirement, but perform the
separate review gate in [mobile authentication](mobile-authentication.md) before
distribution. A SOOP-unlinked Apple account must still be able to manage its
connection, log out and request account deletion; those paths cannot require the
chat SOOP gate. No review-only bypass or misleading alternative-login claim.

## Verification and release gates

Tests use isolated synthetic identities only. Product builds/QA contain no fixture
accounts, synthetic rooms/messages, role selectors or fake success paths.

- Native/web cross-purpose, client and environment mismatch; malformed/duplicate
  or mixed credentials; unchanged web CSRF/CORS; shared REST command and socket ACL.
- Fixed expiry, logout/revoke, account suspension/deletion and SOOP linkage gates;
  no authorization reuse after a preliminary guard or generation comparison.
- Transaction/launch/completion replay; wrong verifier/state/client; expired and
  swapped flow; denied provider; link logout/account-change and concurrent identity
  conflict; cancelled login's late response; two tabs completing in reverse order;
  wrong browser proof and native/web callback swap; link preserving stale terms;
  lost-response behavior and safe rate-limited failure.
- Provider I/O outside transactions and no secret/identity leakage in DTO/logs.
- Actual broker canonical subject and real native device tests. Isolated HTTP
  mocks prove contract behavior only, never live provider registration or login.
- Every schema change is generated/verified in the owned local MySQL fixture,
  reviewed, committed and checked in CI. QA application requires the existing
  exact migration approval and separate deploy operation; never startup migration.

Sources: [RFC 8252 native browser/redirect practice](https://www.rfc-editor.org/rfc/rfc8252),
[RFC 7636 S256](https://www.rfc-editor.org/rfc/rfc7636), and
[Apple user verification](https://developer.apple.com/documentation/signinwithapple/verifying-a-user).
