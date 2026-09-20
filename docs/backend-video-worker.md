# M09 bounded video asset worker integration

This change integrates VIDEO asset processing with the existing isolated Unix
video decoder. It is a draft QA review increment, not M09 completion or a
production deployment. VIDEO/STICKER publication remains rejected.

## Dependencies and ownership

The task branch normally merges the preserved PHOTO publication commit
`f3bace3fb4a73941ce7fa33a9573a1c5ece076a2` (PR #25) and video IPC commit
`bd00a7ff061ff12707e54636d253fdd67eb09d66` (PR #24). Their source branches and
implementations remain unchanged and require separate coordinator review.
Integration edits are limited to the media worker service/repository, isolated
tests, and this document. No schema, migration, dependency, Docker, infrastructure,
controller, Swagger, authorization-service or response-contract changes occur.

## Durable storage and authorization

- A preparation transaction locks the owner/asset, checks current room membership,
  and creates both immutable `video` and `poster` ALLOCATED objects with one attempt
  ID before any GET, decode or PUT. The source remains the STORED input object.
- Initial admission already reserves input bytes plus 52 MiB. Every subsequent
  attempt reserves another full 52 MiB before allocating either object. Current
  locking reads detect previous image/video/poster attempts even under an older
  repeatable-read snapshot. Quota denial or stale preparation fences roll back
  allocation and reservation together.
- `VideoDecoder.decodeVideo` is the only VIDEO transformation path. The existing
  Nest provider is `UnixImageDecoder`, which implements both image and video ports;
  production storage remains `R2MediaStore`. There is no worker FFmpeg process,
  synthetic adapter, or original-file fallback.
- Decoder IPC validates the exact canonical manifest, lengths, binary EOF and
  output caps while spooling. Before PUT, the worker checks the returned video and
  poster manifest again, requires SHA-256 strings and integer duration, and uses
  the canonical MP4/WebP content types. Video and poster PUTs are sequential and
  use the allocated immutable keys.
- Only after both successful PUTs does one transaction recheck the current owner,
  verified source link, active room/membership and nondeleted PROCESSING asset,
  write both READY objects, set the asset READY and complete the fenced job.
  Expiry/reclaim rolls back all those DB changes. `duration_ms` is written through
  ordinary Prisma `updateMany`; creates explicitly select only their generated ID.
- An uncertain PUT, including video success followed by poster failure, leaves
  both attempts discoverable and fully reserved. Neither best-effort deletion nor
  quota refund runs in the error path. Normal fenced cleanup handles all attempts.
- Source streams are destroyed in `finally`. Both output spools are disposed with
  `Promise.allSettled`, including when one disposal itself fails. Decoder failures
  before returning outputs retain the IPC adapter's existing cleanup ownership.

## Deadline, lease and deletion bounds

`WorkerLoop` does not automatically renew handler leases. The media worker now
renews its exact purpose/state/generation/owner/token/unexpired lease before work
and every 30 seconds in separate job-only transactions. Each renewal grants at
most 300 seconds, uses the database clock and cannot revive an expired lease.
Renewals do not overlap; any denial or unknown renewal result aborts external I/O
and returns lease loss. Pending renewal is drained and its timer canceled on exit.
Final READY and quota refund still require the authoritative completion fence.

The worker's 450-second external-I/O deadline covers GET, the existing 270-second
video transport deadline and both PUTs. Healthy renewal does not move it. It is
inside the unchanged ten-minute recent-attempt cleanup guard; young or uploading
objects defer cleanup for twenty minutes without releasing quota. R2 operations
receive that same abort signal and retain their own bounded request timeouts.
The PHOTO dependency's DELETING early return remains before room authorization,
so cleanup does not introduce a room lock after owner/asset acquisition. Domain
lock order and response contracts were not expanded by this change.

## SQL exception inventory

New `renew` uses bound values and fixed SQL because DB-clock expiry checking and
`TIMESTAMPADD` must happen atomically in the same UPDATE. Its transaction acquires
only the job row. The existing `attempts` locking read now includes video/poster;
this remains a current-read exception required after an earlier owner-reference
snapshot. Existing quota arithmetic/current-row locks retain their prior
exceptions. Allocations, duration/metadata writes, READY state and deletions use
Prisma CRUD; no additional database client or pool is introduced.

## Validation and remaining gates

Local validation uses Node 24.21.0 and a fresh loopback MySQL 8.0.44 datadir owned
and deleted by the disposable harness. Synthetic objects and media are confined
to tests. The local pnpm launcher lacks a shebang, so the harness uses a temporary
external shell wrapper around its installed `bin/pnpm.mjs`; repository tooling,
lockfiles and policies are unchanged.

Validation result: build, typecheck and lint pass; 233 unit tests, 157 disposable
MySQL tests, 27 HTTP/process/contract tests and six native decoder tests pass
(423 tests, no skips). Public repository security scans and installed commit/push
hooks are required before publication.

Coverage includes durable dual allocation before PUT, concurrent preparation
under old snapshots, exact READY/duration persistence, uncertain video/poster
PUTs, 52 MiB retries, quota denial, expired/reclaimed finalization and cleanup,
owner/link/member/room/asset revocation during PUT, young deletion deferral, and
real DB renewal during a 31-second decode wait. Bounded timer unit cases exercise
renewal beyond 300 seconds, the fixed 450-second deadline, unknown renewal,
heartbeat loss between/during PUTs, renewal racing finalization, source closure
and both-file disposal failures. Real MySQL also serializes a waiting renewal
behind completion and rejects renewal of an expired lease. Poster failure before
storage is distinct from an unknown successful PUT, and cleanup covers absent keys.
Existing image and independent PHOTO-publication regression suites run unchanged
apart from extending the shared worker fixture for VIDEO. Native decoder tests
also run actual FFmpeg/ffprobe, a per-job child and Unix IPC on synthetic media.

Cross-consumer review found worker-private changes only. Existing message
projections already enumerate `image`, `video`, and `poster`; the duration column
is persisted without extending public DTOs. The existing Unix provider satisfies
the expanded internal decoder type. No mobile/web response contract changed.

Still pending: actual R2 immutable PUT/read/delete and unknown-ack verification,
Linux container/network/credential isolation proof, deployed immutable artifact
and authenticated user-route verification, mobile/browser playback compatibility,
load/scratch/concurrency and failure-recovery soak tests. This worker did not
access cloud services, production/QA databases or the deployment host. Coordinator
review, dependency integration and deployment remain separate gates.
