# Durable web command outbox (source integration)

This branch is stacked directly on PR59 `cd34c5c2733df61fa0e9a72a704f6ad6b79be547`.
It does not change PR59, QA, main, deployment, runtime schema, or reference trees.
Backend wire contract read: frozen `f9197a31d61b7c34256e92f0bcb73ee255275d40`,
`docs/membership-scope-contract.md` and `apps/api/src/modules/messages/dto/message.openapi.ts`.
Media wire union was confirmed with the separately owned controller implementation.

## Controller contract

`features/chat/outbox/indexeddb.ts` exports `DurableOutbox` and
`outboxSessionKey(environment, currentSessionBinding)`. The latter hashes in memory
with domain/environment separation; CSRF/cookies/tokens never enter the database.
The environment must be the canonical QA/production configuration, not a URL.

1. Open once per controller owner. Start locked. Capture the controller generation
   before every await and reject stale results afterward.
2. Obtain a genuine verified session and **complete single-generation membership
   manifest**, then current room/profile/recipient permissions. Call
   `authorize({accountPartition, sessionKey, rooms})`, where every room contains
   `roomId`, `membershipScope`, `authorizationRevision`. Persisted authority is
   only a fence comparison and never permission evidence.
3. `recover(roomId)` returns bounded command records after authorization. Payload
   is present only for the original session and original M/A. Import those into
   the memory ledger with their frozen ID/payload; do not restore composer text
   silently. Records without payload offer only read-only receipt recovery.
4. New explicit submission: normalize and allocate the ID once, then await
   `prepare(roomId,payload)` before any SEND. Preserve input on storage failure.
   Await `beforeSend(id)` immediately before the request; it atomically marks the
   command attempted. Pass `outbox.signal` alongside the controller abort signal.
5. Cold recovery uses only `beforeLookup(id)` + same-command GET. A 404 leaves the
   command unknown. An explicit retry can call `lookupNotFound(id)` after a real
   GET404 and fresh current authorization, then `beforeSend(id,true)`. Returned
   payload is the original wire intent; do not remint/rebind/edit it.
6. After every network await recheck controller scope/generation/session and
   `assertCurrent()`. Await `settle(receipt)` before accepting the ACK in memory.
   Terminal deletion erases content and cannot become committed again. Preserve
   the existing **post-ACK fresh read** for SEND/retry/reconcile; this store does
   not synthesize a message projection or imply recipient read status.
7. `quarantine(ids?)` scrubs payload for revoked quotes/capabilities. Current
   complete-manifest authorization scrubs old account/session/M/A records.
   `suspend()` immediately aborts/locks on reset/background; call `revoke()` for
   confirmed account/session loss. `close()` ends the owner. Native pagehide,
   pageshow, document freeze and hidden visibility also suspend automatically.
   Foreground remains locked until genuine reauthorization.

`outbox/transport.ts` supplies optional `sendOutbox`, `reconcileOutbox`, and
`retryOutbox` adapters with `{verify,lookup,send}` callbacks. `verify` must check
current session, room/capability, controller generation and quote eligibility;
it is not a no-op in product integration. Only `retryOutbox` may turn an actual
lookup 404 into an explicit same-ID SEND. The adapter returns a server receipt;
the controller still owns fresh projection loading and composer rendering.

## Atomic storage, privacy, limits and lifecycle

A native IndexedDB version-1 database per environment contains one bounded state
record. IDB readwrite serialization covers authority, command outcomes, receipt
mapping and lease updates together. There is no second optimistic message cache.
Ownership uses a random tab ID, monotonically increasing integer fence and
30-second lease. Every operation validates the lease/authority inside its
transaction; background/close releases opportunistically and failures fall back
to lease expiry. BroadcastChannel is unnecessary for correctness. Fresh changed
session/M/A authority fences an older tab and irreversibly scrubs old payloads;
A→B→A cannot restore them. A stale revoke cannot scrub a successor fence.

Limits: 256 command records, 2 MiB encoded records, 15-minute payload eligibility,
24-hour receipt identity retention, maximum 10,000 complete-manifest rooms.
Expiry is enforced in every authorized operation; physical expired records are
removed on the next transaction, not by a service worker timer while the browser
is closed. Unknown commands are never silently evicted to make room; full storage
refuses new input with CAPACITY. Exact expiry is never extended by retry.
No drafts, participant labels, quote excerpts, auth proof, upload objects, signed
URLs, File/Blob objects or transport error bodies are stored. TEXT is NFC with
4,000-codepoint/16,384-byte bounds; PHOTO has 1–4 unique UUIDv4 asset references,
VIDEO exactly one, STICKER a catalog sticker UUID. Extra runtime fields are
removed by allowlisted reconstruction and asset arrays are copied/frozen.

Versionchange closes/stops the old writer; blocked/newer databases produce
UPDATE_REQUIRED without database deletion. Failed/quota/aborted transactions
produce fixed storage errors, no SEND, and no accepted result. A missing state
record in a live connection is treated as incompatible/evicted, never recreated
by that writer. Storage eviction across a full restart can remove recovery
identities; no code recreates or automatically replays an absent command.

The JS contract requires DB schema 1 and backend sync schema 2. Service workers
must not send outbox commands. A rollback to a client lacking this schema must
leave unknown IDB content intact and gate incompatible use; backend/web/native
activation and rollback remain centrally paired source integration work.

## Validation boundary

Pure model tests run in the existing Node unit suite. Native IDB and adapter
integration cases live in `test/e2e/outbox-storage.spec.ts`, using browser-native
IndexedDB and isolated intercepted ES modules, never fake IDB or product-only
routes/globals. They cover restart locks, GET404 vs explicit retry, immutable
identity, cross-tab ownership, session ABA, stale ACK, pagehide, versionchange,
and an injected native transaction quota failure. Production UI mounting and
cold-restart/unknown-send browser verification are owned jointly with the
controller integrator and remain required before product completion is claimed.
No current QA real-account or deployment success is claimed.
