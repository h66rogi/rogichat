# M10 MESSAGE deletion admission and independent replay

Status: implementation and disposable MySQL verification; not deployed. This slice
accepts MESSAGE deletion only. It does **not** implement account purge, physical
purge completion, backup expiry, restore release or a 24-hour/30-day guarantee.

## Admission and immutable intent

The existing owner-only delete route authenticates the current browser/native
session, locks its canonical owned message (also after leave/room closure), and
captures DB UTC in one transaction. It then closes that transaction before any
R2 I/O. `DeletionLedger.ensureIntent` conditionally creates the immutable record
and reads it back before any content blocking or successful HTTP ACK. Missing
configuration or failed ledger durability returns a truthful 503; there is no
DB-only fallback. Authenticated unauthorized targets remain denied. An accepted
external intent is irrevocable: session/membership revocation during I/O cannot
cancel its application.

The v1 record has only environment, request UUID, authorized actor UUID, target
UUID, MESSAGE/ACCOUNT scope, room UUID and original UTC. Parsing rejects unknown
fields, duplicate keys, noncanonical dates/bytes, invalid UTF-8 and records over
1 KiB. Private keys are `<environment>/<request UUID>/intent.json`. Conditional
`If-None-Match: *` creation plus exact bounded read-back handles a lost PUT ACK;
a missing, inaccessible, malformed or mismatched record cannot establish receipt.
No content, profile, provider ID, signed URL or private media object key is stored.

New MESSAGE IDs use standard UUIDv5 with the fixed v1 namespace
`c905df9b-942b-53e8-a726-59c955726fcc` and UTF-8 JSON serialization of
`[environment, actorUserId, "MESSAGE", roomId, messageId]`. This is an identifier,
never authorization. Two devices converge to one first durable timestamp.
Existing `deletion_requests` retain their legacy UUIDv4 and original DB timestamp;
backfilling their external receipt cannot restart the deadline. PURGE job resource
references and the deletion response alone accept UUIDv4/v5; other ID policies are
unchanged.

## Trusted apply and opaque checkpoints

Admission and replay share `DeletionApplyService`. A new transaction serializes
its immutable receipt checkpoint, acquires message/room/attachment domain locks,
blocks the source, anonymous copies, command receipts and attached media, then
creates idempotent jobs. It does not repeat mutable session/membership admission.
Unknown COMMIT outcomes are surfaced without retrying the command callback. A
later independent ledger pass may safely reconcile the same immutable obligation.
HTTP success remains only `{requestId, status: "blocked"}`, never "purged".

The sole additive Prisma table is `deletion_intents`: opaque UUID actor/target/room
scalars, environment/scope, request UTC, canonical SHA-256 and nullable blocked UTC.
It has no FK, synthetic parent or completion state. Missing restored actors, rooms
or messages keep an opaque obligation with null blocked UTC; the replay cannot
infer physical deletion from absence. Every pass rechecks the domain even when a
checkpoint already reports blocking. `deletion_requests` and its UUID tombstone
graph are preserved; M11 tables and auth-session constraints are untouched.

Ordinary checkpoint operations use Prisma. The bound `SELECT request_id ... FOR
UPDATE` is a narrow current-row locking exception after duplicate-safe insertion,
preventing simultaneous checkpoint creation/application races. Existing bound
message/room locks remain the deletion domain fence. Storage I/O never holds a DB
transaction, and domain updates precede job locks. Prisma generated migration
`20260920060633_m10_deletion_intents` was generated/applied by `migrate dev` only on
the harness-owned disposable loopback MySQL; no existing SQL was edited.

## Independent bounded replay

The worker starts a separate Nest lifecycle reconciler when a real ledger is
configured. It does not depend on DB jobs or client retries: an external PUT
followed by DB failure is discovered from private R2 inventory. Each tick lists
at most 50 objects (port maximum 100), validates environment/key/size/continuation,
reads strict canonical bodies by key, and uses the same apply port. It advances
only after the whole page applies; after the final page it starts again at the
prefix. An insertion behind the cursor is found by the next full pass, without a
time watermark. Multiple workers remain idempotent through database locking.

Ticks run serially with a 30-second admission/I/O budget and a five-second pause.
An already started DB apply may finish within its existing eight-second transaction
budget; a receipt arriving after the replay deadline cannot start apply. Shutdown
aborts external I/O and awaits the current tick. Per-operation ledger I/O has a
ten-second abort budget, shorter adapter network deadlines, no SDK retries or
region redirects, and bounded streamed bodies. Malformed data, unsupported ACCOUNT
intents or inventory failures stop that page with the fixed diagnostic
`deletion_replay_unavailable`; no record contents or SDK errors are logged. ACCOUNT
application is an explicit remaining integration gate, not silently marked done.

## Real configuration and activation gates

API and worker `readRuntimeSettings` load `DELETION_LEDGER_SECRET_FILE` when present.
The JSON file has exactly `accountId`, `bucket`, `accessKeyId`, `secretAccessKey`,
and `environment`; the environment must match QA/production. It is limited to
4096 bytes and must be a regular, single-link file owned by the process user or
root with no group/other permissions. The loader opens with `O_NOFOLLOW`, compares
file identity, bounds reads and emits only a fixed configuration error. No inline
credential fallback exists. Missing configuration keeps other features bootable
and deletion admission unavailable.

The actual `MEDIA_SECRET_FILE` binding is required for local separation checks:
account must match, and ledger bucket, access-key ID and secret must each differ
from media. This is not proof of provider permission isolation. Runtime composition
constructs the real R2 adapter; synthetic stores exist only in isolated tests.

Still required before activation or any operational completion claim:

- Provision/review the independent private ledger bucket and credential, with no
  public endpoint/CORS. Verify actual account/environment, credential scope,
  encryption and enforced retention/independent operational copy. Different key
  material does not prove IAM separation. Pending obligations must not expire.
- Install reviewed secret mounts/configuration and confirm real R2 conditional
  writes, read-back, list pagination, cancellation and permission behavior. No
  cloud resources, credentials, QA databases or host configuration changed here.
- Account admission/guards, physical rows/objects purge, late-write fences,
  verified object absence, backup inventory/expiry, external alerts and the
  operational isolated-restore replay/release gate remain separate work.
- Root integrates current QA/native OpenAPI and M11/C04 changes, runs required
  checks and reviews deployment as a distinct change. This branch is draft only.

## Verification and compatibility

Disposable MySQL coverage includes two-device first-time convergence, legacy UUID
and time mapping, failed/unconfigured ledger without DB blocking, lost PUT ACK,
durable PUT plus real rollback recovered by the independently booted reconciler,
revoked authorization during I/O, missing restored parents, stale checkpoint
rechecking, actual lost COMMIT ACK without callback replay, bounded full-pass cursor
insertion, owner deletion after leave/closed room, source/copy/attachment blocking
and no private/public DTO leakage. Unit coverage includes standard UUIDv5 vectors,
strict R2 inventory/read-by-key, malformed records, abort/deadline handling, and
secret-file validation. These are local transport/failure tests, not R2 cloud proof.

Consumer inspection found the web client treats request IDs as opaque strings and
accepts only `blocked`; it correctly rejects any invented purge response. Existing
HTTP response validation remains enabled with the narrow v4/v5 deletion contract.
Unconfigured environments intentionally lose deletion availability (503), rather
than misleading users with legacy DB-only success. Other message operations retain
their existing authorization, response and persistence paths.

Official references: [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/),
[conditional requests](https://developers.cloudflare.com/r2/api/s3/extensions/),
[bucket-scoped credentials](https://developers.cloudflare.com/r2/api/tokens/), and
[bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/).
