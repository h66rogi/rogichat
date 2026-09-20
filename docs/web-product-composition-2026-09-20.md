# Web product composition

This work is reviewed through PR67 targeting QA. It does not merge QA, promote
production, commission a room, or change backend/infra configuration. The original
PR59 task branch is preserved. The coordinator owns paired rollout and acceptance.

## Composed source

- Login/join recovery and post-ACK fresh reads: `8306170`, reviewed and merged separately.
- Strict schema-2 session, room, projection and commands: `cd34c5c`.
- Avatar/PHOTO and scoped resource ownership: `fa3ddfe`.
- Catalog STICKER and shared resource reservations: `694a7f6`.
- Native durable outbox and erasure APIs: `7a28d4a` (includes original-signal adapter fences).
- Full VIDEO range/codec/expiry resource: `446e34c`, mounted in `788a2a3`.
- Deletion, publication, reporting and blocking: `9e6d723`, mounted with cleanup in `b4bf6d9`.
- Own-block current nullable label contract: backend `e3f813c`; strict parser and left-room recovery UI.
- Push enrollment, per-page wake binding and stale-cleanup rejection: `724a2dc`.

The controller sends only after durable preparation. Cold recovery performs receipt
GETs, never SEND. Explicit retry preserves the ID and wire payload, verifies current
session and complete manifest, and does not restore old drafts. Missing, expired or
revoked payloads become receipt-only records. Server receipts trigger a fresh read,
not an invented message. Busy/quota/incompatible storage retains input and exposes
an explicit reconnect action.

Deletion uses its own durable marker ahead of private gates. A domain-separated
session digest is saved before required erasure preparation; failed preparation
prevents DELETE. Recovery erases only the marker's original observed session under
an authority-epoch fence. It does not request fresh authentication after a confirmed
blocked receipt. Logout similarly records digest-only cleanup metadata before
mutation, including navigation away from chat. Mismatched successor sessions are
never erased by delayed cleanup.

Every privacy action uses a real server DTO and current session/room/M/A/message
revision context. Anonymous publication has no original identity linkage. Block
changes force manifest/snapshot reconciliation, preserving uncertain command IDs;
there is no local-only block or fabricated publication success.

Settings mounts real push capability/preferences and explicit enrollment/release.
Opening the page never asks permission or installs a worker. Existing-worker wake
hints carry digest-only account/session/generation bindings; they trigger fresh
authenticated controller reads and never become rendered content. Delayed cleanup
cannot unbind a successor lifecycle.

## Resource and transport boundaries

PHOTO/STICKER reference images and VIDEO previews/playback share a 64 MiB tracked
application byte budget with in-flight uploads. Retained images shrink to verified
Blob size and offscreen references release leases. This is not a process-RSS bound.
VIDEO supports canonical server video/poster pairs, strong ETag and exact ranged
responses, native codec checks, explicit loading and 60-second authorization renewal.
Paused, ended, hidden and offscreen video does not automatically redownload.

`ROGICHAT_MEDIA_STORAGE_ORIGINS` is an explicit JSON array of exact HTTPS origins;
empty configuration is unavailable, not a wildcard or fake adapter. Actual storage
CORS must expose `Content-Range`, `Content-Length` and strong `ETag` for video.
Fixtures and generated ffmpeg codec bytes belong only to isolated tests. The hosted
browser job installs ffmpeg; product containers receive no fixture or codec tool.

## Verification and runtime boundary

The assembled pre-push source passes 337 focused unit tests and TypeScript. Dedicated
production-route browser cases cover media, cold outbox recovery and privacy;
aggregate production build/browser/container/security results are still pending.
Leaf-only native IndexedDB and codec tests are bounded evidence, not product rollout.

The actual QA login button was observed reaching the SOOP credential screen after
infrastructure activation. No credentials were entered. A successful callback,
actual authenticated room and actual user SEND have not been observed. Latest
coordinator receipt identifies QA API/worker `397d2f0` schema13 and web `129f378`;
the paired schema23 backend cutover remains separately owned. Default room,
media signer origins, storage CORS, push configuration and real-account validation
must match the running immutable deployment before release completion is claimed.


The first assembled hosted run (`35508380629`, source `ac2c646`) passed production
build/container checks and 199 browser cases, with 17 failures requiring correction.
Focused production-artifact reproduction confirmed premature busy-button/textarea
assertions, native headless notification permission policy, and real unload leaving
its bounded 30-second lease. Cold recovery retains IDs while BUSY and authorizes
only after lease expiry; isolated tests advance the browser clock to the stored
lease deadline, never rewrite ownership. The UI now identifies prior-page recovery
and shows awaited reconnect progress. A held receipt regression fails on the older
artifact because Send remained enabled: dispatch now stays disabled during recovery
while the textarea remains editable. Final current-head hosted validation is pending.


Correction verification: 28 focused desktop/mobile production-route cases pass
with one browser worker (21.6 seconds), including the old failing cases, dispatch
readiness, unlinked deletion and current/null block labels. The held-receipt test
first failed against the old artifact and passes with the dispatch-only gate.
The isolated native-controller cold restart also passes with real IndexedDB.
Retained-dependency production builds used a 3 GiB heap cap: initial 23.88 seconds,
1.25 GB peak footprint, no swaps; necessary incremental source-fix build 0.40 GB
peak. No dependencies were installed and no concurrent build ran. These tests use
isolated HTTP fixtures and establish client behavior, not real-account acceptance.
