# M11 persisted own state and wake-only notification contract

This contract extends the native-session foundation (`de02c6a`). It defines the
shared implementation boundary, not evidence of deployment or real-device delivery.
The integration worker owns module wiring, hosted verification and publication.
Global birthday policy and streamer birthday visibility are unchanged.

## Persistence and deletion inventory

All IDs below are UUID `CHAR(36)`; counters are unsigned BIGINT and times are
UTC `DATETIME(3)`. All new foreign keys use RESTRICT for deletion and update.
No cascade may silently bypass the account deletion ledger/fence.

| Table | Persisted columns and keys | References and deletion selector |
| --- | --- | --- |
| `own_read_states` | PK `(member_id,stream_id)`; `room_id`, `period_id`, `last_read_order`, `updated_at` | `(room_id,member_id,period_id)` → membership period; `(room_id,stream_id)` → stream. Select through `period.member.user_id`; delete before periods/streams. No message FK or content copy. |
| `notification_preferences` | PK `user_id`; `push_enabled=false`, `generation=1`, `updated_at` | `user_id` → users; delete by user. Missing row means opted out. |
| `push_subscriptions` | PK `id`; `user_id`, `session_id`, `audience`, `endpoint`, unique `endpoint_digest BINARY(32)`, `p256dh`, `auth_secret`, `generation=1`, `account_generation`, nullable `revoked_at`, `created_at`, `updated_at` | `user_id` → users; `(session_id,user_id)` → auth_sessions. Delete by user only after dependent delivery/job cleanup and before auth_sessions. |
| `push_deliveries` | PK `id`; `subscription_id`, `room_id`, `message_id`, `subscription_generation`, `account_generation`, `preference_generation`, `created_at`; unique `(subscription_id,message_id,subscription_generation,preference_generation)` | subscription → push_subscriptions; `(room_id,message_id)` → messages. Delete for recipient account OR messages affected by content-owner/root deletion, before either referenced parent. |
| Existing `jobs` | `purpose=PUSH`: non-null `room_id` uses `resource_id=push_deliveries.id`; null `room_id` uses `resource_id=messages.id` for fan-out; lease generation is independent of subscription generation | No polymorphic resource FK. Delete all matching PUSH jobs, including FAILED/COMPLETED/RUNNING, before delivery rows; also null-room message fan-out jobs even if no delivery exists. Never put endpoint, keys or message payload in job columns. |

The only change to an existing model's physical schema is the additive unique
index `auth_sessions(id,user_id)`, enforcing subscription session ownership.
Migration `20260920061207_m11_notifications_read_state` is generated locally from
the before/after Prisma schemas. It creates four tables, their indexes/FKs, and
that session index; no existing migration SQL is edited.

Cross-feature ports belong to exported services, never private repositories:

- `ReadStateCoreService.purgeAccount(tx, userId, limit)` removes bounded own-state
  rows. Resolve ownership through period/member in the caller's transaction.
- `NotificationsCoreService.purgeAccount(tx, userId, limit)` performs bounded,
  restartable job → delivery → subscription → preference cleanup. Return progress
  suitable for the caller's repeated bounded deletion passes; do not claim done
  while delivery rows referencing the account's content remain.
- `NotificationsCoreService.revokeSession(tx, sessionId)` invalidates bindings
  atomically with session revocation. Current session validation remains mandatory
  even if this eager cleanup has not yet executed.
- `PushEnqueueService.enqueue(tx, {messageId, subscriptionId})` in
  `PushEnqueueModule` records a recipient intent and PUSH job on the existing
  transaction; integrator-owned fan-out must be bounded. No external sender I/O
  belongs in this transaction.
- `NotificationsCoreService.authorizeSubscription(tx, id)` returns internal
  credentials only after current locked account/session/preference/subscription
  checks: `id,userId,sessionId,audience,endpoint,p256dh,auth,generation,
  accountGeneration,preferenceGeneration` (generations are bigint internally).
- `PushDeliveryService.consume(lease)` owns fenced completion and returns
  `completed` or `lease_lost`; the worker must not complete it twice.

M10 must also enumerate delivery IDs attached to messages whose
`content_owner_user_id` is the deleted account, including publications rooted in
that content, before purging those messages. Delete null-room PUSH fan-out jobs
whose resource IDs are those same affected message IDs, including when fan-out
has not created any delivery yet. Subscription-owner cleanup alone is
insufficient. Message-only deletion needs the same dependent job/delivery cleanup.
For a bounded batch, select IDs, delete jobs for exactly those IDs, then delete
those deliveries on the same handle. Never physically remove a subscription
with remaining deliveries. Fence account status/generation first so no new
intents race these passes. Restore/replay must reapply this inventory before
serving traffic. Endpoints and Web Push secrets are personal credential data,
including in backups; never log/export them as operational progress evidence.

## HTTP DTOs and errors

These routes are own-state surfaces, without a target user selector. Use the
existing web cookie+origin+CSRF or native Bearer credential handling as applicable.
All mutations reauthenticate and authorize on the transaction that writes state.
The shared parser and DTO exports live in
`apps/api/src/modules/notifications/notification-contract.ts`.

| Route | Request | Response |
| --- | --- | --- |
| `GET /v1/me/notification-preferences` | none | 200 `{pushEnabled:boolean,generation:string}`; missing row projects false with initial generation `"1"` |
| `PUT /v1/me/notification-preferences` | `{pushEnabled:boolean,expectedGeneration:string}` | 200, same DTO; stale generation is 409, increment when setting changes |
| `POST /v1/me/push-subscriptions` | `{endpoint,keys:{p256dh,auth},generation?}` | 201 `{id,generation}` only |
| `DELETE /v1/me/push-subscriptions/:id` | `{generation:string}` | 204, empty body; no credential data |
| `GET /v1/rooms/:roomId/read-state` | none | 200 `{readContext,items:[{messageId:string|null}]}` |
| `PUT /v1/rooms/:roomId/read-state` | `{messageId:string,readContext:string}` | 200 `{messageId:string|null}` |

Generation values are canonical positive decimal uint64 strings, never JS
numbers; account generation stays internal. DTOs exclude session/user/member IDs,
stream/period keys, numeric read order, endpoint/key echoes and another fan's state.
Unknown request fields are rejected. The subscription parser validates an HTTPS
URL and unpadded canonical base64url P-256 public key (65 bytes, uncompressed) and
auth secret (16 bytes). Cryptographic point validity and destination authorization
remain sender/registration policy responsibilities; URL parsing alone is not SSRF
protection. Native FCM/APNs registration never accepts these Web Push fields;
the separate [native contract](backend-native-push.md) defines its provider
adapter and proof. Without native provider configuration it is unavailable.

| Condition | Public error |
| --- | --- |
| Wrong shape, invalid UUID/generation/key/URL syntax | 400 `INVALID_REQUEST` |
| Missing, expired, revoked or inactive-account session | 401 `UNAUTHENTICATED` |
| Missing or malformed web CSRF proof | 400 `INVALID_REQUEST` |
| Missing/wrong Origin, or syntactically valid but incorrect CSRF proof | 403 `FORBIDDEN` |
| Required platform link absent | existing 403 `SOOP_LINK_REQUIRED` |
| Unknown or unauthorized room/message/subscription | 404 `NOT_FOUND` (same projection) |
| Stale preference/subscription generation or membership read context | 409 `CONFLICT` |
| Provider/configuration not available | 503 availability error; never synthetic success |

Transport validation precedes session lookup: malformed or mixed native/web headers
return 400, and web command Origin validation can return 403 before a missing
session is reported as 401. The error table is not an ordering guarantee.

Preference PUT requires the latest GET generation. Do not replay a stale desired
value after 409; read current state and ask for a new user choice. An unchanged
value with matching generation does not increment the generation. Native clients
may read preferences and disable push. Native enable requires verified SOOP and
the configured client-specific provider. Managing Web Push subscriptions from a
native session remains 503 `AUTH_UNAVAILABLE`; use the separate native routes.

Registration locks the owning account/session and endpoint binding, then stores
its current account generation and audience. A same-owner update requires the
current subscription generation and increments it; new endpoints omit generation.
A generation-free retry of a lost initial response returns the existing ID and
generation without mutation only for an active, exact same-session, same-account
binding with identical endpoint/keys and current account generation. Otherwise
it conflicts. A repeated DELETE with the original generation returns 204 only
for the same-session revoked tombstone exactly one generation ahead; an active
replacement remains protected. A 204 response has no JSON body.
A same-account session rebind requires the current generation and invalidates prior
intents. A cross-account endpoint collision returns 404, including a revoked binding;
it never transfers endpoint ownership. On account switch, the client must unsubscribe
from the browser push service and obtain a fresh subscription endpoint before
registering under the new account. If the provider returns the same endpoint,
registration remains unavailable until a fresh endpoint is obtained. Never copy
another account's preferences/read state. Only current binding ownership may
unregister, and deletion uses generation CAS. Provider 404/410 cleanup also matches
the exact ID+generation so a late response cannot revoke a replacement binding.

## Own display progress

Use `AccessService` and current message readability, including stream grants,
history floor, source deletion/moderation and owner state, on the same transaction.
The client sends an actually displayed permitted message UUID; never accept a
client-supplied room order or a sync cursor. Resolve its stream and created order
server-side. GET issues an opaque authenticated `readContext` bound to current
account/room/membership period; PUT must return it and reject an obsolete context
with 409 `CONFLICT` before writing. This fences delayed old-period commands even
when ALL_AVAILABLE history still permits their message. The token must not reveal
raw period/order keys. The token is a canonical 43-character base64url HMAC-SHA256
over the current audience, session, user, room and active period, under a separate
cryptographic purpose from sync; verification uses constant-time comparison.
Advance monotonically only in the active membership period, reset
when the period changes, and never advance a different restricted stream.

GET is a recent bounded snapshot: select at most 100 rows ordered deterministically
by latest update, then filter unavailable states; there is no unbounded fan-out or
public internal-key pagination. Return readContext even when items is empty. A
client may submit any newly displayed authorized message even if its state was
absent from this snapshot.

GET must reauthorize each row against active membership/stream visibility, resolve
the stored order to a currently readable message UUID, and omit unavailable rows
(or return null for a single PUT projection). It must not expose a tombstoned,
revoked or hidden message merely because it was once readable. There is no other
user's read receipt, read-count UI, cursor adoption across devices, or implied
server proof that the client displayed a message.

## PUSH intent, generation and send fence

The only client payload is `WAKE_ONLY_PUSH`:

```json
{"type":"sync_required","version":1}
```

No title/body from a message, fan identity, room/member/message UUID, Signed URL,
endpoint or sync cursor is included. The service worker coalesces duplicate wakes
and performs authenticated sync after resume/open; it clears old account caches
on logout/switch and discards responses from an obsolete local account binding.
A worker ACK means intent processing, never proven browser/device delivery.

A null-room PUSH job is a body-free message fan-out intent, created once on
MESSAGE_CREATED in the message transaction (not on edit/delete). The integrator
pages at most 50 subscriptions without prior message delivery, skips sender, and
requires both preference/subscription updated_at not later than message creation.
Every page is lease-fenced with durable job dedupe. A non-null-room PUSH job points
to one push_deliveries row; consumers distinguish these two reference types before
resolving resource_id.

A delivery intent snapshots subscription, account and preference generations. Registration
rotation/rebinding, revocation, preference changes and account deletion must make
older snapshots unusable. Increment rather than reset generations on reused rows;
never reset a job/intent to replay old content after opt-in or account reactivation.
Existing `users.membership_generation` is the account snapshot, distinct from
`jobs.generation` (lease fencing). Leave/kick/grant expiry is checked against live
access, not inferred solely from that account counter.

Before each provider attempt, under existing transaction deadlines and lock order,
validate ACTIVE account, unchanged generations, unrevoked/unexpired bound session
with matching provider/client/transport and audience, enabled preference, unrevoked subscription, current
room/membership/grants/history and readable live message/source. Suppress obsolete
intents without payload reconstruction. Enqueue and final job completion use the
existing `JobsCoreService` transaction ports; external network I/O stays outside
DB transactions. The unavoidable gap after the final check may deliver only a
body-free wake; a client must still reauthenticate and reauthorize to read content.
Do not promise cancellation of provider requests already in flight.

Web Push sending requires explicit provider allowlisting, rejection of private,
loopback/link-local/metadata destinations, DNS-rebinding-safe connection targeting,
no redirects, strict time/size limits and separate QA/prod VAPID configuration.
404/410 permanently invalidates only the attempted generation; retry only classified
transient failures with bounded job attempts. Missing resources after purge are
terminal no-ops, never repaired by reconstructing deleted payloads.

## Verification boundary

Prisma validation passed locally. The additive migration was regenerated and
applied by Prisma 7.10 `migrate dev` against a newly initialized disposable local
MySQL 8.0.44 datadir, using `test/run-mysql.mjs --migration-only`. The earlier
unpublished schema-diff candidate was preserved outside the repository and is not
the published migration. No historical SQL was edited and the fixture harness
removed its database, account and datadir afterwards.

- Migration: `20260920061207_m11_notifications_read_state`
- Migration SHA-256: `759241f53ea3c007439d7498142b0ec285ced3e83642c26d7d9c2cd39fd6d372`

Focused compile/unit evidence and hosted results are tracked in
`backend-m11-progress.md`. Source presence and migration validation alone do not
prove hosted persistence/race results, consumer implementation, provider delivery,
or live foreground/background return-to-sync.
