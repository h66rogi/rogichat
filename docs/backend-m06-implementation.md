# M06 authoritative REST sync and lossy local hints

The API remains one Node process with one local Socket.IO adapter. No Redis, extra host or
multi-node realtime guarantee is introduced. DB-backed consistency and polling recovery are
independent of hint delivery. Journal compaction is disabled.

## REST contract

All sync routes require current session, account, verified identity and a fresh writer snapshot.
Query fields are `deviceId`, `cacheId` (client UUIDs), optional opaque `cursor`, and `limit` (1–100,
default 50). Unknown fields are rejected. A cache belongs to one account/device/generation.

| Route | Result |
|---|---|
| `GET /v1/sync` | Current memberships, opaque stable generation, continuation and complete flag |
| `GET /v1/rooms/:roomId/snapshot` | Latest visible messages and same-snapshot event cursor; optional separate history cursor |
| `GET /v1/rooms/:roomId/events` | Current-state upserts/tombstones, next cursor, visible-result hasMore, reset flag |
| `GET /v1/rooms/:roomId/history` | Older current visible messages; never advances the event cursor |
| `GET /v1/rooms/:roomId/profile-sync` | Viewer-specific full replacement profiles with stable generation/complete flag |

Snapshot and upper bound H share a transaction. Each continuation opens a new authorized snapshot
but keeps its cycle's H. SQL applies room, stream grant and history boundaries **before** LIMIT;
hidden message counts, global order gaps, H and provider/global user IDs are not returned.
When no additional visible event exists, the encrypted checkpoint advances to H. Later sends
are handled by the next cycle. A delta projects the current resource, not historical text, so
its resource version can be newer than its event's scan boundary.

Cursors are fixed-length AES-256-GCM tokens with independent environment-derived keys, random IV,
bounded expiry and strict schema. They bind user, session, device/cache UUIDs, room, participation
period, query purpose and current ACL fingerprint. Only DB UTC controls issuance/expiry.
ACL includes member epoch/role, room policy, account membership generation and sorted current
grant fields plus effective time-bound status. A policy reset never rewrites the participation
period's snapshotted history boundary. Invalid/expired/cross-scope cursors produce an empty,
ID-free reset; authorization failures still deny the endpoint.

Deletion events use the original audience/history eligibility and emit minimal tombstones, not
the deleted body. A source event affecting a currently visible quote/publication produces an
ID-free cache reset so derived stale content cannot survive. An unrelated private source never
causes another fan's reset. Account-deletion integration and physical purge remain M10 work.

Membership and profile manifests replace cache sets only after a complete stable generation.
Profile generation hashes only this viewer's visible fields: a hidden birthday edit does not
change another fan's generation. Birthday withdrawal removes the field on full replacement.
The current low-cost implementation reads bounded generation sets, at most 10,000 memberships,
grants or visible actor profiles; above that guard it fails closed instead of allocating without
bound. This is an implementation safety ceiling, not a tested capacity promise. Generation/index
optimization for large deployments must preserve these same semantics.

## Realtime transport

`/v1/realtime` is websocket-only. Handshake requires the exact Origin, existing HttpOnly session
cookie and `auth:{schemaVersion:1,csrfToken}`. Upgrade authorization is separate from Express CORS.
There are no client-selected room/principal channels and no socket message commands.

The only application payload is `sync.required:{schemaVersion:1}`. No body, room, user, timestamp,
sequence, birthday or media URL is present. The API claims only REALTIME_HINT jobs, batches up to
20 references, checks current session/room/period/grant/history in recipient chunks, and emits at
most one volatile wake-up per socket per batch. A non-writable transport is closed, not buffered.
Worker output reaches sockets through committed events/jobs, never a process-local EventEmitter.

Profile changes have a separate body-free `profile_changes` reference; a null-room hint refers
only to that table. Nickname/public projection and streamer-only birthday projection changes
are distinct flags. The recipient query verifies both participants are currently active and
applies the same fan/streamer profile scope as REST. Hidden birthday-only edits enqueue no hint.

Automatic connection-state recovery is disabled. Dispatch is nonoverlapping, connection/account
counts and admission are bounded, and lease ownership guards completion. Closing the transport
on shutdown lets clients reconnect; server-forced authentication disconnect requires fresh auth
and explicit reconnect. These choices follow the official
[server options](https://socket.io/docs/v4/server-options/),
[volatile event semantics](https://socket.io/docs/v4/emitting-events/) and
[client disconnect behavior](https://socket.io/docs/v4/client-socket-instance/).

## Client fixture and operational gates

`packages/contracts/sync-client.mjs` is an executable reference contract, not a shipped UI/storage
adapter. Production IndexedDB/SQLite adapters must commit event effects and cursor atomically,
serialize cycles, reject stale requested-cursor responses, compare resource versions, preserve
tombstones against late history, and switch cache generation on reset/account change. Snapshot
replaces rather than merges the old generation. Partial manifests cannot evict unseen entries.

Foreground sync remains every 15 seconds with jitter even while connected; socket failure uses
3–5 second polling. Foreground/reconnect/ACK/hints trigger coalesced sync. Missing hints never
mean missing committed messages. Unauthorized access clears account caches and stops processing;
room revocation/404 removes that room cache. Real native/web persistence, background behavior and
device reconnection remain client integration gates; fixtures are not real-device proof.

Multi-API fixtures can validate DB ordering and polling only. Enabling more than one serving API
still requires a reviewed shared-bus deployment and capacity evidence. Real login and deletion/
restore release gates remain closed until their own evidence is available.

Local verification: 61 unit, 40 real-MySQL integration, 14 HTTP/process and 2 contract tests pass.
The review found a public-copy quote projection mismatch; root-owner deletion checks and two-hop
source invalidation were added, with a passing regression. Fixture-only audience-length and 204
parsing failures were corrected before the final successful run. These tests include real socket
connections, but do not claim a real-device reconnect or production capacity result.
The manifest fixture also fences every response by cache generation: clearing on account change
requires a new generation, and a late old-account birthday/profile page is rejected.
