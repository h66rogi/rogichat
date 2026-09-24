# Durable web command outbox (source integration)

Current browser storage contract for durable message commands. The server wire
contract is defined by `docs/membership-scope-contract.md`,
`apps/api/src/modules/messages/dto/message.openapi.ts` and the message command
controller. The existing v1 browser database remains readable across this
multi-tab change.

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
   `suspend()` aborts only this tab's work on route exit or document freeze;
   call `revoke()` for confirmed account/session loss. `close()` ends this local
   connection. Hiding a tab does not interrupt an in-flight send or prevent
   another tab from sending. Pagehide/pageshow require fresh authorization.

`outbox/transport.ts` supplies optional `sendOutbox`, `reconcileOutbox`, and
`retryOutbox` adapters with `{verify,lookup,send}` callbacks. `verify` must check
current session, room/capability, controller generation and quote eligibility;
it is not a no-op in product integration. Only `retryOutbox` may turn an actual
lookup 404 into an explicit same-ID SEND. The adapter returns a server receipt;
the controller still owns fresh projection loading and composer rendering.

## Atomic storage, privacy, limits and lifecycle

A native IndexedDB version-1 database per environment contains one bounded state
record. IDB readwrite transactions serialize authority, command records and
receipts. Every authorized tab can append its own command. The server's
`clientMessageId` receipt makes a repeated same-command POST idempotent, while
a tab-local prepared-ID set keeps cold recovery receipt-first. The v1
owner/fence/lease fields remain inert so existing browser storage and pending
commands survive rollout. No operation waits for or renews a tab lease.
A monotonic authority epoch fences changed session/M/A authority and confirmed
revocation across all tabs; changed authority irreversibly scrubs old payloads,
including A→B→A. BroadcastChannel carries only a content-free change hint after
receipt settlement or authority change. Other tabs recheck current server/session
state and the shared store; correctness does not depend on that hint arriving.

Limits: 256 command records, 2 MiB encoded records, 15-minute payload eligibility,
24-hour receipt identity retention, maximum 10,000 complete-manifest rooms.
Expiry is enforced in every authorized operation; physical expired records are
removed on the next transaction, not by a service worker timer while the browser
is closed. Only settled receipts are evicted under count/byte pressure. Unknown commands
are never silently evicted to make room; if they fill storage, new input is
refused with CAPACITY. Exact expiry is never extended by retry.
No drafts, participant labels, quote excerpts, auth proof, upload objects, signed
URLs, File/Blob objects or transport error bodies are stored. TEXT is NFC with
4,000-codepoint/16,384-byte bounds; PHOTO has 1–4 unique UUIDv4 asset references,
VIDEO exactly one, STICKER a catalog sticker UUID. Extra runtime fields are
removed by allowlisted reconstruction and asset arrays are copied/frozen.

Versionchange closes/stops an old connection; blocked/newer databases produce
UPDATE_REQUIRED without database deletion. Failed/quota/aborted transactions
produce fixed storage errors, no SEND, and no accepted result. A missing state
record in a live connection is treated as incompatible/evicted, never recreated
by that connection. Storage eviction across a full restart can remove recovery
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
Browser tests use isolated synthetic accounts; deployment and real-account
verification are separate release gates.


## Shared controller mount

The production room passes the canonical environment to the durable owner. Full
live session and complete membership-manifest checks authorize the store before
recovery or writes. Authorized unresolved records appear as outgoing messages in
the timeline without restoring composer text. The room checks receipts on recovery
and on subsequent visible refreshes; a lookup never replays a send. The retry
action on that message performs receipt lookup and fresh authorization before
same-ID SEND. A slow receipt check does not block a separate new message. New writes persist
before POST, and confirmed receipts settle in IDB before the in-memory result and
fresh server projection read. Storage failures retain input. Transient authority
changes retry automatically while the visible chat remains mounted; users can
also retry immediately. Tabs can send while other tabs are open or sending.
Leaving the chat route suspends only that tab's work. Returning reauthorizes
from the current session and complete manifest before recovery or a new send.
A routine refresh with unchanged authority preserves an in-flight send or
receipt lookup; changed authority still fences it.
Logout/confirmed authentication loss synchronously fences
active stores, then completes the authority-fenced erasure before closing them.
The product browser suite covers cold restart, concurrent tabs and session
revocation on desktop and mobile Chromium.

### Recovery test checkpoint

The outbox test branch normally merged the first immutable controller mount
`92af9ac64ee99f1e92093fcc9a24c5e4f6cd40d7`, preserving the reviewed v2 and media
history. The final adapter additionally captures its original abort signal so a
same-instance authority A→B→A cycle cannot settle a late transport response.
Nine native IndexedDB/adapter cases passed in the existing Chromium browser with
one worker; no dependency install, Next build or product server was used for that
isolated native-storage run. The preceding exact `6cfd92c` leaf also passed the
135-test web unit suite and an independent eight-case native Chromium review.

`test/e2e/outbox-production.spec.ts` adds six actual production-route cases:
reload with receipt-first recovery and immutable explicit retry, receipt-only
recovery requiring a fresh projection, same-account new-session payload scrub,
BFCache foreground reauthorization/input preservation, concurrent tab sending,
and a real native prepare-write failure followed by storage reconnect and an
actual user retry. Fixtures and native storage fault injection are isolated to
tests. These product cases require the composed PR67 production artifact; authoring,
typechecking or passing the isolated store suite does not count as product-UI proof.

Logout/deletion integration must also call
`DurableOutbox.revokeSession(environment, accountPartition, sessionKey)` with the
captured trusted session digest, even when no chat controller is mounted. This
opens storage only to compare the erasure identity and perform epoch-fenced
scrubbing; it does not authorize reading or sending. A different account/session
is untouched, including a late old-session logout after successor login. A native
closed-owner regression and a seventh production-route test cover settings logout
after a full navigation away from chat. The shared lifecycle owner wires the
helper; the aggregate product test must pass before that fix is claimed complete.

A validated compact pending-deletion marker can instead use
`DurableOutbox.revokeSessionKey(environment, sessionKey)` for erase-only recovery.
The key must be the exact 64-character environment-domain-separated session digest;
malformed keys reject, mismatched stored sessions are untouched, and the captured
authority epoch still prevents late erasure of a successor. This helper never
unlocks records or creates authorization. Legacy markers lacking the digest must
remain blocked for explicit recovery rather than inferring a new session identity.
