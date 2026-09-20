# ORM-first data access correction

2026-09-20. ORM conversion implemented; coordinated regression/publication gates below remain authoritative.

## Decision

Ordinary reads, relations, inserts, updates, conditional updates and deletes use the
generated Prisma Client. Repositories receive the caller's transaction client; they
do not acquire another connection or return generated models as API DTOs. Explicit
`select` and existing viewer-specific projections remain mandatory.

The M02 choice of mysql2 for every runtime query was SQL-first. It did not establish
a Prisma limitation for ordinary CRUD. Locking requirements justify individual raw
queries, not replacing every SQL call with `$queryRawUnsafe` or keeping a parallel
mysql2 production pool.

Prisma CLI, Client and MariaDB adapter stay pinned to 7.10.0, with mariadb 3.4.5 as
the adapter dependency. Node 24.21.0 and pnpm 12.4.2 remain unchanged. The existing
1,440-minute release-age policy and explicitly reviewed build-script allowlist
remain enforced. Generated TypeScript is deterministic, ignored by Git and emitted
before compilation; no generated client files are committed.

## Transaction contract

One interactive Prisma transaction contains current command authorization and the
mutation. Read admission and mutation admission retain their existing separation;
rate charging commits independently before fresh command authorization. External
HTTP, storage and decoder work stays outside transactions.

Reads use a fresh writer REPEATABLE READ, database-enforced READ ONLY snapshot.
Writes retain explicit current locking reads and established lock ordering. The
driver adapter and generated client share one bounded process pool. UTC, session
lock timeout (2 seconds), acquire timeout (1.2 seconds), statement wall deadline
(3 seconds) and whole-transaction deadline (8 seconds; 2 seconds for readiness) are enforced at their
boundaries. The 3-second socket timeout bounds idle transport only. On MySQL 8,
MariaDB's resetAfterUse performs rollback rather than full session reset: each
checkout explicitly reapplies UTC, lock wait timeout and NEXT-transaction READ
ONLY/READ WRITE before the adapter's single normal BEGIN. Snapshot linearization
is the first consistent authorization read, not an implicit transaction restart.

Retries require a recognized MySQL deadlock or lock timeout AND evidence that the
whole transaction rolled back. An exception during COMMIT is an unknown result,
never an automatic replay. Closed or timed-out transaction handles cannot perform
late writes. Explicit projection converts native bigint/bytes only where existing
domain contracts require string counters or Buffer values.

## Retained raw exception inventory

The following are the allowed categories; the method inventory below exhausts runtime call sites:

| Exception | Why generated CRUD alone is insufficient |
|---|---|
| `FOR UPDATE` current authorization/resource locks | Prisma find operations do not express MySQL locking clauses; lock order is a product correctness boundary |
| `FOR UPDATE SKIP LOCKED` job candidate selection | Atomic concurrent queue claiming must skip rows already leased by another transaction |
| DB-clock lease expiry and final fence | Owner/token/generation and DB UTC expiry must be tested atomically with completion |
| Atomic rate-bucket admission | DB UTC admission requires locking; measured INSERT IGNORE shared-to-exclusive lock upgrades deadlocked under ten concurrent callers; the native duplicate-key no-op takes the exclusive lock directly |
| ACL-before-LIMIT history/event queries | Scope, source deletion and event visibility must be applied before pagination; no JavaScript filtering or N+1 replacement |
| Binary emoji aggregation | Existing Unicode collation cannot collapse distinct emoji; binary grouping/order is required |
| Transaction setup and migration readiness | READ ONLY snapshot syntax, session settings and Prisma's internal migration table have no ordinary model API |

Simple writes following a lock still use Prisma CRUD. A SQL expression or join is
not by itself an exception: relation filters, nested select, groupBy and conditional
updateMany must be considered first. Values in retained raw queries are bound;
identifiers and SQL fragments are fixed trusted code.

## Independent compatibility evidence

An independently installed temporary project (no workspace node_modules symlink)
used a fresh loopback MySQL 8.0.44 datadir, synthetic rows and a DML-only runtime
account. It did not load environment files or apply repository migrations.

Passed observations:

- Generated ESM TypeScript compiled under NodeNext with explicit `.js` imports.
- Typed create/read preserved unsigned bigint above JavaScript's safe integer range,
  millisecond UTC Date and binary bytes; Prisma returns Uint8Array, not Buffer.
- ORM and parameterized locking raw used the same interactive transaction;
  an independent connection's SKIP LOCKED observed the held row lock.
- A database-enforced read-only snapshot rejected ORM updates, stayed stable across
  independently committed updates, and the next transaction saw fresh state.
- Interactive timeout rolled back a prior update, rejected late continuation and
  rejected an escaped handle with P2028.
- Runtime DDL was denied. Session UTC must be reapplied after a pooled checkout.
- Actual lock timeout was P2039 with adapter MySQL code 1205, not a reliable generic
  P2028/P2034 classification. Retry classification must inspect driver cause plus
  confirmed rollback.

Discovered compatibility details:

- An early experiment restarted Prisma's empty transaction to install a snapshot.
  That approach was rejected: production uses NEXT-transaction READ ONLY before
  the adapter's normal BEGIN, with no implicit commit or transaction restart.
- Raw unsigned INT values are widened by the adapter to bigint; a fixed list of
  schema-bounded fields is normalized to Number. True BIGINT counters remain
  decimal strings in existing domain interfaces. Generated CRUD keeps native
  bigint, Date and Uint8Array until explicit DTO projection.
- Non-TLS local MySQL caching_sha2_password fixtures need explicit RSA public-key
  retrieval. This is restricted to validated local/test loopback configuration;
  hosted database access retains certificate-verified TLS.

References: [Prisma Client setup](https://docs.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction),
[Prisma generation](https://docs.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/generating-prisma-client),
and the installed 7.10.0 adapter source and type declarations. Live fixture results,
rather than a newer documentation version, govern the compatibility decision.

## Pinned transport teardown correction

The installed mariadb 3.4.5 `destroy()` attempted cancellation through a new KILL
connection, then queued QUIT if that connection failed. That did not establish
bounded local transport teardown and could exceed the configured pool limit.
`patches/mariadb@3.4.5.patch` replaces only this method with the driver's existing
fatal-error cleanup, which synchronously destroys the socket, disables commands,
and rejects queued work. The public API and ordinary connection/TLS/authentication
paths are unchanged; application code does not extract private sockets. The patch
is pinned by SHA256 in pnpm-lock.yaml, applied by frozen install and copied into
the Docker install stages. No install lifecycle scripts were added.

Tests verify the exact installed patch, synchronous close with an active receive
queue while any auxiliary connection would fail, queued rejection and idempotent
close. Actual MySQL tests verify timeout rollback and rejected cached/lazy handles.
TCP close guarantees local transport teardown, not immediate cancellation of
arbitrary server-side execution. A commit already submitted remains unknown and
must never be replayed. Driver upgrades must re-review or remove this patch.

## Method-level inventory

All paths below are relative to `apps/api/src`. For methods with read/write
branches, only the write branch retains raw locking; reads use generated selects.
Every listed locking query preserves its prior current-row check and lock order;
Prisma does not expose `FOR UPDATE` or `SKIP LOCKED`. Writes after those locks use
Prisma except the specifically identified arithmetic/lease/limiter statements.

| Repository | Raw methods | Individual requirement |
|---|---|---|
| `modules/auth/session.repository.ts` | `findCurrent` (write) | Lock session, current account and SOOP status together before mutation |
| `modules/auth/identity.repository.ts` | `findSubject`, `account`, `linked` | Lock unique subject/account/link before identity creation or link mutation |
| `modules/auth/login.repository.ts` | `pending`, `processing` | Lock unexpired single-use login state before claim/finalization |
| `modules/access/membership.repository.ts` | `findActive` (write) | Current room/member/active-period authorization locks |
| `modules/rooms/rooms.repository.ts` | `manager` (write), `eligibleOwner`, `activeOwner` | Capability, eligible owner and active owner-period locks |
| `modules/rooms/room-state.repository.ts` | `lockRoom`, `counter`, `member`, `leavingMember` | Room serialization, monotonic event counter, membership transition locks |
| `modules/messages/messages.repository.ts` | `load` (write), `grant` (write), `sharedStreams`, `target`, `pair`, `sendGrants`, `room`, `member`, `receipt` | Current content-owner/deletion/quote, grant, stream, member and idempotent receipt locks |
| same | `requireAsset` (two queries), `ownedMessage`, `deletionRequest`, `attachedAssets`, `nextDeletionOrder` | Attachment exclusivity and author-deletion graph/counter locks, including LEFT/CLOSED cases |
| `modules/messages/messages-query.repository.ts` | `page`, `affected` | Correlated ACL/source-deletion/quote visibility and event impact before LIMIT; batched attachment projection uses Prisma |
| `modules/reactions/reactions.repository.ts` | `counts` | Binary emoji grouping/order avoids collation merging different emoji |
| same | `lockRoom`, `prior` | Current room and single-reaction replacement locks |
| `modules/publications/publications.repository.ts` | `lockRoom`, `revision`, `existing`, `lockAccount`, `lockRoomForFinalize`, `lockPublication`, `sharedStreams` | Publication capability/source revision/receipt/finalization lock order, independent of private read grant |
| `modules/jobs/jobs.repository.ts` | `dedupe`, `claim` | Dedupe lock and priority-ordered bounded SKIP LOCKED lease candidates |
| same | `complete`, `renew`, `retry` | Owner/token/generation and DB UTC expiry checked in the same atomic update; retry schedule and attempt cap are DB expressions |
| `modules/media/media.repository.ts` | `owner` (write), `lockBudget`, `capability`, `lockDaily`, `lockReserved`, `lockUploading` | Current account/capability, shared budget, daily quota and expiring upload-token locks |
| `modules/media/room-media.repository.ts` | `current` (write), `owner`, `manager` | Current policy, owner-period and admin capability locks |
| `modules/media/media-worker.repository.ts` | `lockOwner`, `lockAsset`, `originals`, `attempts`, `uploading`, `recentAttempts`, `objects`, `currentObjects`, `currentState` | Immutable attempt, deletion/processing and current-owner locks |
| same | `fence` | Job owner/token/generation and unexpired DB UTC lease lock before domain finalization |
| same | `reserveRetry` | Conditional arithmetic `reserved_bytes + capBytes <= limit_bytes` with atomic increment; Prisma field references cannot express the addition in WHERE |
| same | `recoverable` | Bounded SKIP LOCKED cleanup candidates exclude live references/jobs and DB-UTC-hour dedupe before LIMIT |
| same | `epoch` | DB UTC hour formatted identically to SQL recovery-dedupe hash |
| same | `attachments`, `avatars`, `catalog`, `copies` | Current attachment/avatar/approved sticker/preparing-publication reference locks before deletion |
| `modules/users/users.repository.ts` | `lockOwner`, `lockProfile`, `attachableAvatar` | Current account/profile and eligible avatar locks |
| `modules/stickers/stickers.repository.ts` | `operator`, `asset`, `byAsset` (write), `catalog` (write), `lockAsset` | Approval capability, current asset-owner, catalog uniqueness and attachment locks |
| `modules/realtime/realtime.repository.ts` | `validSessions` with event/profile refs | Correlated event/profile ACL checks batch recipients before fan-out; ordinary session validity and resource existence use Prisma |
| `infrastructure/rate-limit/rate-limit.repository.ts` | `consumeRate` initial upsert and locking read | Exclusive duplicate-key admission avoids observed INSERT IGNORE upgrade deadlocks; reset/increment use Prisma |
| same | `collectExpiredRates` candidate read | Bounded expiry cleanup with SKIP LOCKED; deletion uses Prisma |
| `modules/sync/sync.repository.ts` | `clock` | Read DB UTC rather than application clock |
| `infrastructure/database/transactions.ts` | `now`, parameterized `rows`/`execute` wrappers | DB clock and binding for only the inventoried exceptions; no Unsafe API |
| `infrastructure/database/database.ts` | readiness migration manifest | Internal Prisma migration table has no generated model; exact finished names/checksums checked through bounded read transaction |
| `infrastructure/database/prisma-provider.ts` | session/NEXT-transaction setup | Driver lifecycle/session characteristics, not domain CRUD |

Login's unique-subject retry requires positive rollback evidence from Transactions,
not just a P2002 code. The final transaction retries at most once without another
broker exchange. Both failed-rollback and confirmed-rollback caller tests cover it.

## Cold readiness deadline

The first remote run exposed a cold-start bound violation: the official adapter
performs capability discovery with one acquire budget, catches its failure, then
attempts transaction checkout with another. Two 1.2-second windows plus engine
startup exceeded the existing 2.5-second readiness test (2.585 seconds observed).
Readiness now explicitly uses a 2-second absolute read-transaction deadline that
includes engine startup, capability discovery and checkout. Domain transactions
retain their 8-second budget. Cancellation closes any owned transport and blocks
late callbacks; the original timing assertion remains unchanged. Tests also prove
that closing a failed readiness pool releases its pending handshake sockets.

## Verification checkpoint

The final coordinated clean artifact build passed all **106 real MySQL integration
tests**, including HTTP/process/API crash recovery, worker leases, authorization,
privacy, idempotent deletion/publication, concurrency and seven Prisma runtime
cases. The runtime cases cover native value fidelity, single-connection session
reuse/read-only snapshots, cached/lazy continuation after cancellation, lost actual
COMMIT acknowledgement, statement deadline rollback, failed checkout discard, and
delayed BEGIN beyond maxWait with no late callback. Independent runtime review found
no remaining P1/P2 after the startup ownership correction.

An independent temporary graph passed frozen install with all lifecycle scripts
disabled and generated/build output from a clean source copy. A separate production
install loaded the generated Client, official adapter and PrismaDatabase while
confirming mysql2 and the Prisma CLI were absent. `python3 tools/security/check.py
all` and `git diff --check` passed. mysql2 remains a development/fixture and explicit
migration-image dependency, not the production API/worker data path.

## Remaining acceptance gates

The architecture worker records the coordinated unit/HTTP/process/contract/lint/
typecheck results; the coordinator must verify remote PR checks on the exact final
source snapshot and actual certificate-verified QA TLS when publishing. The coordinator owns the task branch, PR into QA,
remote CI and final publication boundary. No migration SQL or model changes, QA
schema application, infrastructure deployment or production promotion are part of
this correction worker's authority. Docker is not available on this workstation;
its actual image build remains a remote CI gate.

## Coordinated ownership map

The ORM correction owns `apps/api/package.json` Prisma/runtime dependency changes,
`pnpm-lock.yaml`, `pnpm-workspace.yaml` patch declaration, `patches/mariadb@3.4.5.patch`,
`apps/api/prisma.generate.config.ts`, `.gitignore` generated-client entry, the schema
**generator block only**, build/typecheck generation scripts, generated-code lint
ignore, and Docker `COPY patches` wiring. The two API-only Docker install-filter
lines are published by the separately coordinated web task. Schema models and all
11 migration directories/checksums remain the backend coordinator's work.

Runtime ownership is `infrastructure/database/{database,transactions,prisma-provider}.ts`
and `infrastructure/rate-limit/{rate-limit.repository,room-command-rate}.ts`.
Repository query bodies changed in access membership; auth session/identity/login;
rooms rooms/room-state; messages messages/messages-query; users users; reactions;
publications; jobs; media media/media-worker/room-media; stickers; sync; and realtime.
`messages/message.types.ts` removes legacy driver row inheritance. Narrow shared
service changes are the AuthFlow confirmed-rollback retry predicate and publication
receipt typing; Nest module wiring, cross-feature ports and structural moves belong
to the architecture worker. Root retains all functional M08–M12 semantics.

New ORM regression files are `test/unit/{prisma-provider,mariadb-abort-patch,auth-retry}.test.mjs`
and `test/integration/prisma-runtime.test.mjs`. Runtime unit transaction/database/session
tests were adapted to the Prisma boundary. Integration transaction/message/reaction
error assertions recognize Prisma's actual driver metadata; the media-worker race
barrier observes the new ORM owner-reference read while retaining the original
concurrency assertion. Other unit fixture adapters and moved imports are coordinated
with the Nest worker. This ownership list does not transfer unrelated source,
mobile, infrastructure or security edits to the ORM worker.
