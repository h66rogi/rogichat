# MESSAGE deletion and push integration checkpoint

This source integration is not a QA release or a completed M10 purge.

## Reviewed inputs

- Existing additive integration `b3dc1bf`: own-command reconciliation, account
  partition, current message counterpart/actions, notification/read-state baseline,
  storage absence checks and publication owner concurrency regressions.
- Push enrollment/configuration `69bfa9a` (PR 46): exact-head hosted 306 unit,
  18 e2e, 16 contract and 228 disposable-MySQL tests passed, including image safety.
- MESSAGE admission/replay `31d3e79` (PR 42): exact-head hosted 251 unit,
  18 e2e, 11 contract and 184 disposable-MySQL tests passed, including image safety.
- ACCOUNT admission/identity guards `b251b9a` (PR 53): exact-head Backend CI
  `35498584176` passed tests, disposable MySQL and image safety. The replay keeps
  completed-key progress across tick deadlines, and all production services use
  injected dependencies rather than manually constructed fallback repositories.
- Departed-owner send fence `cd7af58` (PR 54): Backend CI `35498447425` passed
  324 unit, 18 e2e, 18 contract and 255 MySQL tests, including 11 owner races and
  receipt/read/deletion regressions. Existing receipts remain reconcilable;
  new sends require the current room owner and membership to remain eligible.
- Media late-write containment `43606ce` (PR 55): Backend CI `35499582753`
  passed tests, disposable MySQL and image safety. Cleanup retains keys, states,
  quota and durable continuation when provider-write termination is unproven;
  legacy DELETED rows are not sufficient proof. This is the bounded safety slice
  described in [its closure review](backend-media-late-write-closure.md), not
  complete external-storage purge.

These input results do not substitute for final composed-tree validation.

## Composition decisions

Keep push and deletion options separate in API and worker Nest registration.
API command reconciliation and viewer-specific projections remain registered.
ACCOUNT and MESSAGE admission receive the same configured external ledger without
replacing notification/read-state registration. The replay worker imports the
identity-guard port without requiring raw provider subjects or auth secrets.
Worker deletion replay is independent of the job loop; publication, both push
handlers and optional media handlers remain installed. Test helpers perform
external ledger I/O outside their database transaction, including read-state
deletion races. Preserve all added OpenAPI and actual HTTP response contracts.

Both independently generated migrations are retained byte-for-byte, ordered
`20260920060633_m10_deletion_intents` then
`20260920061207_m11_notifications_read_state`, followed by the original generated
`20260920074544_account_deletion_admission` (SHA-256
`1e3d298e965c15500e83d96f4ebae5e2ce3336c154ce67d369a207058bff85fb`).
This candidate has **16** migrations;
the earlier reviewed native-login QA candidate has **13**, and the observed live
QA runtime has **12**. Approval for one is not approval for another. No SQL was
hand-edited, no shared database was changed, and no production promotion occurred.

The earlier MESSAGE/push integration `46bca35` passed all required hosted gates,
including Backend CI `35498258627`. ACCOUNT/owner composition `388c9d0` then
passed Backend CI `35499262730`; its docs-only follow-up `d9614ed` passed all
required gates, including Backend CI `35499608318`. These results do not cover
the subsequent media composition, which needs its own hosted build,
generated-client/schema, unit, HTTP/OpenAPI, real-MySQL and image checks.
The local resource gate defers new heavy suites. Existing tests and explicit
API/worker push-plus-deletion composition regressions are retained. The media
merge changes no HTTP contract, configuration key or migration; consumer and
private-operations source scans found no dependency on its internal helper or
object-state representation.

Ordinary app-only QA source merges were cleared after web delivery commissioning.
This candidate still changes the root dependency lockfile and API image build,
so its QA merge remains subject to a coordinated reviewed delivery-policy refresh.
That source/trust gate is separate from concrete QA schema-change approval and
does not authorize any host write or migration.

## Still outstanding

Physical message/account purge, late-provider
write/orphan closure, backup expiry and isolated restore release are not completed
by MESSAGE blocking. Actual R2/VAPID secrets and least-privilege mounts must be
commissioned separately. Missing provider configuration remains unavailable.
No real login, push delivery, media lifecycle or M12 operational claim follows
from a successful source build. Schema-v2 membership scope (C06) remains a separate
coordinated web/native cutover, not silently included in this additive batch.
ACCOUNT admission additionally needs a dedicated file-only identity guard key;
missing configuration returns unavailable rather than acknowledging deletion.
No key has been generated or installed by this source integration.
