# Bounded deletion runtime

The configured worker now installs a real `PURGE` handler. It schedules the existing
physical MESSAGE text/sticker row purge and ACCOUNT private-field cleanup ports.
This is M10 subset progress, **not** full ACCOUNT, media, backup, restore-safety,
`LIVE_PURGED`, or end-to-end deletion completion. Missing deletion configuration
installs neither this module nor a handler; there is no synthetic ledger fallback.

## Authority and transaction boundary

Each claim reads the canonical immutable external receipt before opening a domain
transaction. MESSAGE compares its checkpoint hash and exact request with that
receipt, in addition to canonical intent hashing, room, author, deletion-root,
request and checkpoint validation. ACCOUNT re-reads the immutable receipt and
requires the exact admitted checkpoint, blocked account, guard coverage and
original obligation in its transaction. No queue row or caller-supplied user ID
alone grants destructive authority.

ACCOUNT private-field mutations and continuation now share one transaction.
Both ports acquire their existing domain locks before the queue lock; the final
queue update requires purpose, room, resource, owner, token, generation, running
state and a lease expiry later than DB time sampled **after** the queue lock wait.
A rejected fence rolls back the entire bounded page. External ledger I/O never
holds a domain transaction. Only confirmed rollback permits retry of a classified
transaction error; unknown COMMIT does not re-execute a domain page. A committed
page already released its running lease into durable pending continuation, so
WorkerLoop cannot retry that old lease after a lost acknowledgement.

## Continuation, recovery and fairness

One canonical `sha256(purge:requestId)` job is retained per intent. Existing
MESSAGE admission jobs use this same identity. Successful pages requeue that
same row with five seconds of delay; deferred/evidence-unavailable and drained
subsets remain pending for a five-minute recheck. WorkerLoop separately counts
`progress`, `deferred` and `subset_drained`; none increments `completed`.
The latest fixed reason is stored as `PURGE_PROGRESS`, `PURGE_DEFERRED`,
`PURGE_EVIDENCE_UNAVAILABLE` or `PURGE_SUBSET_DRAINED`. A drained subset is
periodically rechecked for restored/reintroduced rows without asserting all
external obligations have been discharged.

Only exact canonical purge jobs with a matching current intent/scope/room get
the bounded-progress exception to generic maxAttempts exhaustion. Their attempt
counter saturates at its existing maximum without lowering any previously higher
count. Success does not reset it. Ordinary jobs retain ordinary exhaustion rules.
Transient failed owned jobs are reconsidered after at least five minutes beyond
the recorded availability time; recovery retains attempts and last error, bumps
generation, and applies a further delay. It never steals an active lease, revives
a foreign terminal job, clears failure history on recovery or creates a new row
for every retry. Explicit permanent/invalid-resource failures remain failed and
the independent deletion intent remains an unresolved obligation requiring repair.

`deletion_purge_discovery` stores a source+environment-bound request UUID cursor
and next scan time. A transaction locks that source row, discovers at most twenty
intents via Prisma and advances its cursor, delaying five seconds between pages
and sixty seconds after the end of a pass. Each discovered item is reconciled in
its own intent → room → job transaction. A crash after the page checkpoint but
before enqueue is repaired during the next full pass; one poison item cannot
prevent cursor advancement or starve later intents. Missing rooms and malformed
scope bindings stay unresolved and emit only a fixed recovery-unavailable signal.
Multiple workers share the durable cursor and use the existing SKIP LOCKED queue.
Recovery does not hold a queue lock while acquiring a later domain lock.

All requested-at fields and the first-request deadline remain unchanged. Discovery
and retry clocks are operational pacing, never a new deletion deadline or expiry
of an identity guard. Neither five-minute rechecks nor recovery backoff prove the
one-hour target or twenty-four-hour obligation has been met.

## Remaining concrete M10 gates

- MESSAGE media and attachment/publication object provenance remain unsupported;
  those rows and external references must survive until every owned write attempt
  and object version can be reconciled. Curated service sticker assets remain.
- ACCOUNT-owned messages and derived copies cannot be routed through a fabricated
  MESSAGE request: that port requires independently admitted exact author/root
  authority. A separate ACCOUNT content port must enumerate own roots/copies with
  durable provenance and account fencing before this runtime may remove them.
- Avatar assets and profile FKs remain while media transfer is unresolved. Shared
  assets, archived/derived copies, broker/provider records and backups need their
  own verified deletion contracts and evidence before any completion claim.
- Identity/provider anchors, subject guards and user/member UUID anchors remain.
  In particular identity cleanup must respect the original `auth_not_before`,
  pending login transactions and every downstream content/media obligation;
  removing these anchors now would discard resurrection protection/provenance.
- Replay binding scrubbing remains a separate fenced flow. Its observation is
  not proof of private outbox payload erasure, external deletion or backup expiry.

No host/cloud SQL, QA merge, deployment or full deletion status is authorized by
this source change. The running immutable release, health and actual user route
remain separate deployment gates owned by the coordinator.

## Verification

The hosted MySQL suite exercises actual selected account/message progression,
TEXT and STICKER rows, two workers, restart, missed enqueue recovery, exhausted
retry history/cooldown, strict fencing including expiry during a real job lock
wait, unknown COMMIT acknowledgement, observer preservation, unsupported media
and missing external evidence. Composition tests cover deletion enabled/disabled
with media enabled/disabled and retain publication and both PUSH routes.

Migration `20260920095340_m10_purge_runtime_discovery` was generated unedited by
pinned installed Prisma 7.10.0 on a genuinely isolated MySQL 8.0.44 database.
All eighteen prior migration hashes remained unchanged. A second fresh database
replayed all nineteen migrations and reported schema in sync without drift or
another migration. SHA-256 of the new SQL is
`4d8b2c9be35b665942e1f4dccc396b0ec3ac8e45574ab03b88adb88aa7bbb978`.
The owned server stopped and temporary data/project were removed before releasing
the shared resource slot. Runtime tests and builds are delegated to hosted CI.
