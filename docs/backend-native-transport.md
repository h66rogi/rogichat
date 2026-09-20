# Native credential transport: implemented foundation

2026-09-20. This is the transport implementation contract, not proof of a deployed
native login. SOOP completion and Apple verification remain separate work in
[the native authentication plan](backend-native-auth-contract.md). There is no
public token mint, test-login, refresh or native OAuth endpoint in this slice.

## Credential and lifecycle

Native credentials are opaque 32-byte random values encoded as 43 base64url
characters. The database stores only their SHA-256 digest. They expire exactly
seven days after issuance according to the database clock; use does not extend
expiry. Initially expiry requires real provider reauthentication, not refresh.
The app stores its credential in OS-protected storage and removes it on logout,
account replacement or authoritative 401. Do not retry 403 SOOP_LINK_REQUIRED as
an expired-token condition.

Every authorized transaction checks exact environment audience, transport and
client binding, expiration, revocation and current account status. Only these
stored combinations are accepted:

- `WEB` with `client_id = null`;
- `NATIVE` with `client_id = ios` or `android`, matching the requesting client.

The client ID is a binding, **not app/device attestation**. An iOS credential is
not accepted with Android's client value. Native credentials cannot be used as
web cookies, and web credentials cannot be used as native Bearer credentials.
Command authentication remains inside the transaction performing the mutation;
neither a guard nor accountGeneration is an authorization proof.

`SessionService.issueNative(tx,userId,clientId)` is internal only. A future verified
login flow must resolve/check the account and issue the session on the same
transaction. Its return is `{token, expiresAt}`; it must never be exposed through
an unauthenticated mint endpoint or a fixture account path.

## REST headers

```http
Authorization: Bearer <43-character credential>
X-Rogi-Client: ios
```

`X-Rogi-Client` is exactly `ios` or `android`. The scheme is exactly `Bearer`, with
one ASCII space. Unknown clients, absent pairs, array/comma/multiple values and
duplicate raw authentication headers are rejected. A native request cannot include
`X-CSRF-Token` or either web session cookie (`rogi_session`, `__Host-rogi_session`),
even if the cookie is empty. No token is accepted from query parameters.

Native HTTP clients send their real headers, not an invented web Origin. Existing
HTTP CORS continues to reject a supplied foreign Origin. Browser cookie requests
retain their exact Origin, CSRF and cookie contract; adding native authentication
does not relax that path or permit a missing-Origin cookie command.

All existing REST routes using the shared authentication context accept the bound
native credentials with the same domain authorization. Native message/reaction
commands do not synthesize a CSRF proof. Unsupported native login routes remain
unsupported rather than falling back to a cookie flow.

## Native session projection

`GET /v1/auth/session` returns this exact native shape:

```json
{
  "authenticated": true,
  "account": {
    "userId": "<own account UUID>",
    "nickname": "<own nickname>",
    "avatarAssetId": null
  },
  "soopLinkStatus": "VERIFIED",
  "onboardingState": "READY",
  "expiresAt": "<UTC ISO-8601 timestamp>",
  "accountGeneration": "<43-character opaque HMAC>",
  "capabilities": { "chat": true }
}
```

For a currently unverified/missing SOOP link, values are `REQUIRED`,
`SOOP_LINK_REQUIRED`, and `chat:false`. Account management remains separately
authorized; this DTO does not advertise unimplemented actions. `chat:true` means
the SOOP gate passes, not membership in every room or blanket message access.

`avatarAssetId` is nullable or the current own READY, nondeleted, roomless AVATAR
asset UUID. No storage key, signed URL, provider identity, email, birthday, raw
generation counter, session ID, token digest or CSRF proof appears here. The query
uses explicit selected fields. A missing profile on an otherwise ACTIVE account
is `503 AUTH_UNAVAILABLE`, not a fabricated successful account projection.

accountGeneration is an environment/domain-separated HMAC of own account UUID,
membership generation and current SOOP-verification state. It is stable across
sessions of the same account and authorization state. It is an invalidation hint,
not a profile revision or substitute for per-room sync/cursor authorization.

Existing **web** session response is unchanged:
`{authenticated:true,soopLinkStatus:"VERIFIED"|"REQUIRED",csrfToken}`.

## Logout and failures

`POST /v1/auth/logout` accepts exactly `{}`. For native authentication it revokes
only this native session and returns `204`, without setting or clearing a web
cookie. Other sessions are unaffected. Web logout still requires its Origin and
CSRF proof and clears its cookie. All auth responses remain `Cache-Control:
no-store`; credentials must not enter application/client analytics or logs.

- `400 INVALID_REQUEST`: malformed/mixed credential transport or invalid body.
- `401 UNAUTHENTICATED`: absent, wrong-purpose/client/environment, expired or
  revoked credential; inactive account.
- `403 FORBIDDEN`: existing web Origin/CSRF rejection or ordinary domain policy.
- `403 SOOP_LINK_REQUIRED`: valid account without the currently required SOOP gate.

No raw rejection detail is exposed from realtime handshake failures.

## Native realtime

Socket.IO uses `/v1/realtime`, websocket transport only, with the same Authorization
and X-Rogi-Client **upgrade headers**. Its handshake auth object is exactly:

```json
{ "schemaVersion": 1, "transport": "native" }
```

No credential goes in a URL, handshake object or application event. The gateway
allows only Engine.IO's protocol query keys (`EIO`, `transport`, `t`, `sid`, `b64`).
An absent Origin is eligible only with syntactically valid native headers, then
the connection still requires current database purpose/client/audience/session/
account/SOOP validation. Header syntax or a claimed client ID never authorizes it.
A supplied foreign Origin remains rejected. The web handshake remains exact web
Origin + cookie + `{schemaVersion:1,csrfToken}`.

Native Authorization is removed from the server-owned request headers/rawHeaders
after extraction. Only user/session IDs are retained in connection application
state. Existing per-account/global admission bounds, fresh checks before hints,
periodic session-expiry/revocation checks and body-free hints remain unchanged.
Idle invalid sessions disconnect on the existing bounded periodic sweep, not an
instant revocation broadcast. REST rejects revoked sessions immediately at its
next authorization transaction. Foreground/reconnect/periodic REST sync remains
authoritative; connection-state recovery is disabled.

## Verification boundary

Local validation on 2026-09-20 passed build, type checking, lint, 219 combined
unit/HTTP/contract tests and 121 disposable real-MySQL integration tests. The
transport migration was generated and applied only in that isolated local MySQL;
these counts precede integration with the newer reusable-sticker QA change.
Neither the native transport migration nor these routes have been deployed to QA
at this checkpoint.

Unit tests cover strict raw/header parsing and unchanged web behavior. Disposable
MySQL/HTTP/socket tests exercise cross-purpose/client/environment rejection,
malformed stored combinations, fixed expiry, restricted SOOP state, safe account
projection, missing-profile failure, native message/reaction/delete commands,
native owner publication and denial after authority loss, isolated logout and
current socket authorization. Independent review found the remaining web-only
CSRF check in publication requests; it was replaced with the shared transport
proof and covered by an actual HTTP/worker regression. Fixture issuance occurs only
inside tests, never through a product endpoint. These tests do not establish real
SOOP/Apple registration, callback association or device-login success.
