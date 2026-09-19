# M05 durable messages and fenced jobs

2026-09-20. This stage implements text commands and queue primitives. Real-user release remains
closed until the identity, media, deletion/restore and M12 operational gates pass.

## Commands and privacy

`POST /v1/rooms/:roomId/messages` accepts a client-generated UUID, an explicit `SHARED` or
`PRIVATE` intent, optional quote UUID and `{type:"TEXT",text}`. PRIVATE requires a room actor
recipient; SHARED forbids that field. Text is NFC, nonblank, at most 4,000 code points and
16 KiB UTF-8. Unknown fields, NUL and unsupported content kinds are rejected. No arbitrary
user ID, stream ID, author, audience list or external media URL is accepted.

FAN shared sends require the room streamer. Private sends require a currently active, verified
recipient and a permitted fan/streamer pair. GROUP uses the same model and allows ordinary
shared/private sends. Existing revoked or expired pair grants are never silently repaired.
Invalid private targets never fall back to the shared stream. Quotes may reference shared
messages or the exact private stream, never another private audience.

The command transaction records message, monotonic room order, versioned HMAC receipt,
body-free event and REALTIME_HINT job together. ACK follows commit and contains only the client
key, message ID, status and version. An uncertain outcome must be retried with the same key.
Same-key concurrent requests resolve to one message; changed normalized payload returns 409.
Retries recheck current authorization and do not store/replay an old response projection.

The HTTP limiter commits separately so failed commands cannot refund it. A fixed account bucket
bounds requests across rooms, and per-room buckets are created only for an existing membership.
Unknown room UUIDs cannot create unbounded buckets. Burst and other command policies follow in M07.

`GET /v1/rooms/:roomId/messages/:messageId` projects from a fresh authorized writer snapshot.
Room actors are exposed instead of user/provider identities. Publication-shaped rows have an
anonymous author and no source/quote identity. Missing, revoked and cross-room resources return
404 without revealing private content. Deleted quote content is omitted, not cached as a copy.

`POST /v1/rooms/:roomId/messages/:messageId/delete` takes `{}` and checks original authorship,
not current room membership/history. Leaving or closing the room does not remove author deletion
rights. It immediately clears text, marks receipts deleted, creates a deletion intent/event/job,
and denies linked publications through their root predicate. Retry of a deleted command returns
a minimal deleted ACK, never recreates content. M10 must complete external-ledger and physical
purge guarantees; this DB-only intent is not yet a disaster-recovery deletion guarantee.

All command routes require current session, exact Origin and CSRF. Sending/reading also requires
the verified SOOP link. No mock authentication is enabled in a hosted runtime.

## Queue boundary

API consumers claim only REALTIME_HINT. Workers claim PURGE, MEDIA, PUBLICATION, PUSH and
LEDGER_EXPORT, prioritizing purge. Claims use short MySQL transactions with SKIP LOCKED;
external work never runs under a queue lock. DB UTC controls deadlines. Limits, lease durations,
attempts and exponential jittered retry are bounded; errors are allowlisted codes, not payloads.

Every claim increments an unsigned bigint generation and assigns owner/token UUIDs. Complete,
renew and retry compare purpose, generation, owner, token, RUNNING state and unexpired lease.
Expired workers cannot finalize reclaimed work. Domain handlers acquire domain locks first and
perform conditional job completion in the same transaction; a failed fence rolls back domain
changes. `runClaimedJob` is only for lossy transport effects, not media/publication finalization.

Dedupe keys never revive a completed/failed job. No job contains message bodies, provider
identities, credentials or signed URLs. M06/M07 add the actual dispatcher/worker execution loops.

## Verification and boundaries

The disposable MySQL harness applies all unmodified Prisma-generated migrations and exercises
real row locks, scoped foreign keys, atomic rollback, send/join ordering, concurrent receipts,
private grants, audience-safe quotes, ownership deletion, queue races and stale fences.
Unit tests cover strict command input and job policy/error contracts. The actual-process fault
test holds a committed ACK at an egress proxy, kills the API with SIGKILL, then retries in a new
process: one message, receipt, event and job remain. This proves client ACK loss plus process death,
not a hook precisely between the server's COMMIT and socket write. Local verification passed
47 unit, 29 MySQL integration, 14 HTTP/process and 2 contract tests, plus lint. Remote CI and
actual QA rollout are separate evidence and are not implied by those local results.

No journal compaction or automatic chat expiry is enabled. Retention remains until deletion.
No multi-node realtime, real SOOP login, attachment delivery, complete purge or capacity claim is
made by this milestone. Those remain explicit later gates in the execution plan.
