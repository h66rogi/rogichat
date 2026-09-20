# M08/M09 implementation checkpoint

2026-09-20. Work in progress; neither milestone is accepted for release yet.

## Current implementation

- Media reservation, quarantine upload, immutable attempts, image decoding and
  READY finalization are separate phases. Object-store I/O never holds a database
  transaction. Authorization and lease fencing are repeated at finalization.
- Room policy supports independent photo/video/sticker switches and bounded
  photo/video sizes. Active members read it; the active owner STREAMER or a
  `manage_rooms` operator changes it. Actual changes advance policy version and
  append a fixed-action audit event. Existing committed message retries do not
  become new sends when policy changes.
- Profile avatar attachment requires an owned, global, READY avatar. An already
  assigned avatar survives intent expiry. Replacement/removal queues old-asset
  cleanup atomically; recovery excludes current avatar references.
- Global sticker catalog separates DRAFT, ACTIVE, RETIRED and terminal REVOKED.
  Only `manage_stickers` operators register/approve/revoke. Approved service
  assets can outlive the registering account. Ordinary media retains content-owner
  deletion guards. Catalog references use `message_stickers`, not room-scoped
  photo attachments.
- All API DTOs are explicit projections. Storage keys, account IDs, provider
  subjects, signer configuration and decoder paths are not response fields.

HTTP wiring added in this checkpoint:

| Route | Authorization |
|---|---|
| `GET /v1/rooms/:roomId/media-policy` | Current session, SOOP link and active room membership |
| `PATCH /v1/rooms/:roomId/media-policy` | Current command credentials/CSRF and owner or `manage_rooms` |
| `GET /v1/rooms/:roomId/stickers?after=...` | Current active member and room sticker policy |
| `POST /v1/admin/stickers` | Current command credentials/CSRF and `manage_stickers` |
| `PATCH /v1/admin/stickers/:stickerId` | Same operator capability; explicit state transitions |

Sticker routes are included only with the media feature graph. Catalog command
admission uses a separately committed per-account bucket (20/minute), followed by
fresh transaction authorization. Denied commands cannot refund that budget.
Signed media access has its own per-account 120/minute bucket and 60-second URL.

## ORM and module correction

The correction is implemented in parallel, not an alternative runtime. Ordinary
data access uses the generated Prisma Client on the caller's transaction;
individual locking/clock/ACL pagination exceptions remain bound raw queries.
See [ORM-first policy](backend-orm-first.md) and
[Nest architecture correction](backend-nestjs-architecture-correction.md).
The ongoing implementation rules also live in `apps/api/AGENTS.md` so subsequent
backend work uses the same ORM, module and transaction boundaries.
New media-management HTTP fixtures use generated nested creates and explicit
`select`, rather than adding raw fixture CRUD.

## Native video decoder slice

`src/isolated/media-decoder/video-*.ts` is not imported by API or worker code.
It admits bounded MP4/MOV metadata and performs full re-encoding to one H.264,
yuv420p, 30fps MP4 rendition with optional stereo 48kHz AAC and a WebP poster.
The generated rendition is probed and fully decoded again before success.
Original title/location metadata and data tracks are not copied.

Limits: 50 MiB input/output, 60 seconds, 1920x1080 or portrait equivalent,
one video stream, at most one audio stream, square pixels, bounded frame rate,
quarter-turn rotation, 32 KiB probe output, 2 MiB poster. Unsupported or ambiguous
inputs fail closed; there is no original-file fallback. Probe metadata alone is
never READY evidence.

Processes use fixed arguments without a shell, a minimal environment, ignored
stdin, bounded output and hard per-process deadlines. The complete operation has
a 210-second deadline. Failures delete only the operation's freshly created output
directory; existing paths are never overwritten. Abort is checked again after
poster postprocessing. Success transfers cleanup responsibility to the caller.

References: [FFprobe output](https://ffmpeg.org/ffprobe.html),
[FFmpeg mapping, metadata and error options](https://ffmpeg.org/ffmpeg.html),
[protocol allowlist](https://ffmpeg.org/ffmpeg-protocols.html),
[MOV external-reference options](https://ffmpeg.org/ffmpeg-formats.html#mov_002fmp4_002f3gp).

## Evidence and remaining gates

- Before the ORM/module correction, the prior media snapshot passed 83 real
  disposable-MySQL integration cases. This is not proof for the new snapshot.
- Video probe/process tests cover malformed metadata, bounds, canonical codec,
  clean environment, stdout/stderr overflow, timeout, abort and missing binaries.
- The explicit native suite passed five tests locally with Node 24.21.0 and
  FFmpeg 8.0.1: real H.264/AAC/poster, 90/180/270-degree asymmetric pixel orientation
  in both rendition and poster, abort during final postprocessing, over-duration
  and truncated inputs, path preservation, input symlinks and concurrency denial.
  Run after build with `node --test test/decoder/video.test.mjs` from `apps/api`.
  FFmpeg/FFprobe with libx264/libwebp/AAC are required; missing tools do not skip.
- The combined Prisma/Nest snapshot passed 106 disposable-MySQL integration
  tests, including the three media-management HTTP cases, transaction deadline
  and lost-COMMIT-acknowledgement regressions. Its clean-build unit suite passed
  188 tests, HTTP/process 14 and contract checks 4. Remote image/CI and QA gates
  remain separate from these local results.
- The worker healthcheck, deployment auth preflight and migration gate now import
  the relocated compiled modules. Nineteen pure deployment validation tests and
  two runtime-import contract tests passed locally. These tests do not execute a
  host deployment, read production secrets or apply migrations.

Still required for M08/M09 completion:

1. Actual sticker send/read/sync/URL integration, durable catalog-revocation
   invalidation, avatar actor-context URL authorization, publication media copy
   preparation/finalization and failed-copy cleanup.
2. Video IPC/worker integration, all-variant READY atomicity, deletion races and
   recovery after process death. The current image-only decoder server must not
   be advertised as video-ready.
3. Linux decoder image, network-none/credential-free mounts, CPU/memory limits,
   hard tmpfs quota, startup orphan recovery, and whole-process-group termination.
   Killing only the per-job Node process can leave an FFmpeg descendant alive.
   Polling output size is defense in depth, not a replacement for a disk quota.
4. Native 60-second boundary, late-frame corruption, output-limit cleanup and
   supported-browser/native codec fixtures; media load must preserve text ACK/sync.
5. Actual QA R2 access, cross-room denial, expiry/Range reauthorization, scanner,
   task-branch PR checks, running release and public-route verification.

No QA schema application, host rollout or real R2 verification is claimed by this
checkpoint. Media remains behind its existing runtime enablement gate.
