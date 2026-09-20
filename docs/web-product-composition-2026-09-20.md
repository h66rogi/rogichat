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
- Deletion, publication, reporting and blocking: `9e6d723`.

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

The assembled pre-push source passes 210 focused unit tests and TypeScript. Dedicated
production-route browser cases cover media, cold outbox recovery and privacy;
aggregate production build/browser/container/security results are still pending.
Leaf-only native IndexedDB and codec tests are bounded evidence, not product rollout.

The actual QA login button was observed reaching the SOOP credential screen after
infrastructure activation. No credentials were entered. A successful callback,
actual authenticated room and actual user SEND have not been observed. Latest
coordinator receipt identifies QA API/worker `397d2f0` schema13 and web `129f378`;
the full feature backend schema17/22 cutover remains separately owned. Default room,
media signer origins, storage CORS, push configuration and real-account validation
must match the running immutable deployment before release completion is claimed.
