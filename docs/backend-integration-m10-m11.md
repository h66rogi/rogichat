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

These input results do not substitute for final composed-tree validation.

## Composition decisions

Keep push and deletion options separate in API and worker Nest registration.
API command reconciliation and viewer-specific projections remain registered.
Worker deletion replay is independent of the job loop; publication, both push
handlers and optional media handlers remain installed. Test helpers perform
external ledger I/O outside their database transaction, including read-state
deletion races. Preserve all added OpenAPI and actual HTTP response contracts.

Both independently generated migrations are retained byte-for-byte, ordered
`20260920060633_m10_deletion_intents` then
`20260920061207_m11_notifications_read_state`. This candidate has **15** migrations;
the earlier reviewed native-login QA candidate has **13**, and the observed live
QA runtime has **12**. Approval for one is not approval for another. No SQL was
hand-edited, no shared database was changed, and no production promotion occurred.

The local resource gate defers new heavy suites. The final integration needs its
own hosted build, generated-client/schema, unit, HTTP/OpenAPI, real-MySQL and image
checks before acceptance. The existing source tests are retained and explicit
API/worker push-plus-deletion composition regressions were added.

## Still outstanding

ACCOUNT admission/identity guards, physical message/account purge, late-provider
write/orphan closure, backup expiry and isolated restore release are not completed
by MESSAGE blocking. Actual R2/VAPID secrets and least-privilege mounts must be
commissioned separately. Missing provider configuration remains unavailable.
No real login, push delivery, media lifecycle or M12 operational claim follows
from a successful source build. Schema-v2 membership scope (C06) remains a separate
coordinated web/native cutover, not silently included in this additive batch.
