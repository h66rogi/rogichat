# M02 DB foundation

2026-09-20. Local implementation and MySQL tests; QA application deployment is separately tracked.

## Storage and transaction decisions

- Prisma CLI 7.10.0 owns schema and generated migrations. Runtime uses the existing mysql2 driver
  behind `Transaction` so locking reads and read-only consistent snapshots share one physical handle.
  No second ORM pool, startup DDL or automatic schema push. This is the M02 ORM/SQL spike decision.
- Public resource/user IDs are application-generated UUIDv4 in `CHAR(36)`, validated as lowercase.
  This avoids binary conversion mistakes in compound foreign keys at MVP scale. Internal order and
  revision counters are unsigned bigint and the driver always returns them as strings.
- Prisma-generated `utf8mb4_unicode_ci` is retained unchanged for display text and canonical lowercase
  UUIDs. Provider subjects/issuers and token digests use binary columns, preserving exact identity.
  `DATETIME(3)` is UTC: every transaction sets `time_zone=+00:00` and uses DB UTC clock for expiry.
- A room/member pair is unique. Active membership is the member's single period pointer with a
  `(room_id,member_id,period_id)` foreign key. Historical rows cannot attach a period from another
  member/room. Readers follow the active pointer and require an unended period.
- Room owner, stream grant/member and stream grant/stream references are room-scoped in MySQL.
  Provisioning repositories are internal primitives, not permission-bypassing HTTP handlers.
- Room lock precedes its counter and membership mutations. Join records policy/version/start order;
  an existing active join is idempotent and rejoin creates a new period. Owner leave requires transfer.
- Transactions are bounded, read snapshots use fresh writer REPEATABLE READ/READ ONLY, mutation
  reads use explicit locking. Only deadlock/lock timeout retries (maximum three attempts with jitter).
  Unknown COMMIT result is never transparently retried. Callbacks must not perform external effects.
- Rate bucket increment/expiry is atomic and uses DB UTC. Callers commit rate charging separately
  from a command that may fail; otherwise its rollback would refund failed authentication attempts.
  Cleanup is bounded and leaves a safety margin behind expired buckets.

## Migration boundary

User explicitly approved an exception on 2026-09-20 for **Rogichat QA only**:
generate/apply with `prisma migrate dev` in a fresh harness-owned loopback MySQL, then apply the
unmodified reviewed artifact in a separate QA `prisma migrate deploy` job. No reset, hand-edited SQL,
production application or QA shadow-database permission is authorized by this exception.

Runtime remains SELECT/INSERT/UPDATE/DELETE only. The migrator is separate. Readiness checks exact
active migration names/checksums and successful completion. Explicitly rolled-back attempts are
ignored; unresolved failures, unknown active migrations and absent schema fail closed.

Tests cover migration from M01's empty schema, runtime DDL denial, mismatched/rolled-back history,
two concurrent joins, cross-room FKs, commit ordering/rollback, fresh versus retained snapshots,
handle lifetime, concurrent rate limits and a real two-connection MySQL deadlock/retry.
`contracts:check` compares every generated migration with the runtime checksum manifest.

## M01 review follow-up

Independent review reproduced repeated-fault stderr disclosure, failure during normal drain returning
exit 0, and an unbounded leftover handle after cleanup. Persistent redacted fault handlers, latched
failure status and an unreferenced final deadline address these. Seven subprocess regression cases
exercise exception/rejection, synchronous cleanup failure and the real ten-second deadline.

## Explicit later gates

M03 owns real session/identity/broker authentication. M04 owns authenticated room/profile APIs and
the authorization matrix. These database primitives do not by themselves enable chat, establish a
streamer/admin, verify provider subjects, or complete the deletion/restore launch gates in M10–M12.
