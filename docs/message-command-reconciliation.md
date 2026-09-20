# Own command reconciliation and account partition

This additive source contract is independent of deployment. It does not enable
persistent outbox replay by itself: participation scope and stale asynchronous
response fencing remain consumer integration gates.

## HTTP receipt lookup

`GET /v1/rooms/{roomId}/message-commands/{clientMessageId}` takes UUID path
parameters (lowercase UUIDv4, RFC variant `8`, `9`, `a` or `b`) and the existing session read credentials (web cookie or native
bearer plus `X-Rogi-Client`). It takes no sender, account partition, or payload.
Authentication, active room membership, sender-scoped receipt lookup, and live
message readability are checked on the same bounded read transaction snapshot.
It is a read, not a send or authorization to replay a send.

Success is exactly one of:

```json
{"clientMessageId":"UUID","status":"committed","messageId":"UUID","version":"1"}
```

```json
{"clientMessageId":"UUID","status":"deleted"}
```

`version` is the **current readable message version**, a decimal string, not the
original send version. Only a durable own deleted receipt produces `deleted`;
that response contains no message ID or body, and is terminal for the command.
An existing blocked/moderated message without a deleted receipt is `404`.
No other sender's receipt, command key, existence, digest or content is exposed.
Two senders using the same UUID resolve independently to their own receipts.

Errors use the existing `{ "error": { "code": "..." } }` envelope:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | INVALID_REQUEST | Invalid UUID or transport credentials |
| 401 | UNAUTHENTICATED | Missing/expired/revoked session or inactive account |
| 403 | SOOP_LINK_REQUIRED | Current account has no verified link |
| 403 | FORBIDDEN | Transport origin rejected by existing credential rules |
| 404 | NOT_FOUND | Absent own receipt, other sender, inaccessible message, inactive membership or room |

After leaving, lookup is `404`. Rejoin evaluates the new membership period's
history boundary and current ACL: `ALL_AVAILABLE` can allow an old shared
message, while a newer history boundary can exclude it. Revoked private grants
remain revoked; an unreadable live receipt remains `404`. An own deleted receipt is
terminal once the caller again has active membership; it reveals no old message
metadata. Closed rooms and revoked accounts cannot use lookup. Reads use the
existing snapshot semantics; a read already in flight can precede a concurrent
revocation/deletion. Clients must discard stale responses after account,
session, membership, or synchronization-generation changes, and never replace a
locally observed terminal deletion with a late committed response.

An ambiguous `404` is **never** evidence that a command did not commit, permission
to generate a replacement command ID, or send authorization. Retry, when allowed
by fresh client/server state, uses the same command ID and normalized payload on
the existing send endpoint. Existing same-payload idempotency, conflicting-payload
rejection, and terminal deletion behavior are unchanged.

## Session account partition

Both web and native `GET /v1/auth/session` responses add top-level
`accountPartition`, an opaque 43-character base64url string. Native login exchange
also receives it through the same native session projection. Its server derivation
uses the existing configured auth key and audience, with HMAC-SHA256 domain
`account-partition:v1:` over JSON `[audience, internalUserId]`.

The value is stable across same-account relogin, devices, web/native transports,
link changes and membership/revocation generation changes under the same key and
environment. Different accounts or environments get distinct namespaces. Key
rotation changes it: fail closed, invalidate/quarantine the old local partition,
and do not migrate or replay its pending records automatically.

It is a local persistence namespace, **not authorization**, a session token, a
membership-period fence, or permission to replay. No API accepts it as authority.
Native `accountGeneration` retains its separate revocation role. Existing native
`account.userId` remains solely for compatibility with current decoders; new
outbox code must use `accountPartition` and must not key storage by that legacy
internal UUID. Removing the legacy field requires a separate coordinated change.

OpenAPI registration is owned by the parent auth/API integrator. Security/race
review, consumer compatibility, hosted MySQL CI, QA PR gates, deployment and
participation-scope readiness are distinct gates; this contract claims none of
them implicitly.

## Combined OpenAPI integration

The backend integrator registers the lookup on the actual controller and keeps
its receipt separate from the send receipt: a deleted lookup never includes a
message ID. Web/native session schemas and the nested native issuance schema all
require the exact opaque account partition. Negative schema tests reject extra
deleted-message content/IDs, numeric versions and absent/malformed partitions.
Real receipt lookup responses across restart, both transports, permission loss
and deletion are checked against the generated document in disposable MySQL
HTTP tests. The web session fixture retains an exact key allowlist with the new
partition and validates the actual response; it does not relax unknown fields.
The rejoin fixture uses the current QA leave contract (204), without changing
runtime behavior to accommodate an obsolete expectation.
