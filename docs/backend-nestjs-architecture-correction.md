# NestJS architecture correction — required before more feature delivery

## Finding and scope

The execution plan already required feature modules and domain/repository/DTO boundaries.
The implementation instead grew one RuntimeModule, flat source files, manually assembled
dependencies and controllers that own transactions. This is an implementation deviation, not
an approved simplification for the low-cost MVP. Passing behavioral tests does not satisfy
the architecture requirement. New M08 feature work and host deployment are held while this
deviation is corrected. Existing changes and generated migrations must be preserved.

This correction does not replace or reduce M01–M12. It is a prerequisite within that goal.
There is no permission here to change API contracts, authentication trust, database isolation,
retention, infrastructure cost, production branches or deployment authorization.

## Target ownership

The service remains a modular monolith, with one API and one worker deployment. Modules do not
imply more processes, servers, databases or paid infrastructure.

| Location | Responsibility |
|---|---|
| `src/main.ts`, `src/worker.ts` | Short bootstrap only; no business dependency assembly |
| `src/app.module.ts`, `src/worker.module.ts` | Explicit application module composition |
| `src/infrastructure/config` | Validated configuration providers; secrets never in DTOs |
| `src/infrastructure/database` | Connection provider, UnitOfWork, transaction handle and lifecycle |
| `src/infrastructure/observability` | Safe logging and lifecycle/health integration |
| `src/common/http` | Transport-only filters, guards, decorators, strict validation pipes |
| `src/modules/auth` | Login, sessions, SOOP broker adapter and authentication service |
| `src/modules/users` | Self profile, birthday consent and viewer-specific profile projection |
| `src/modules/rooms` | Rooms, memberships, history snapshots and room policy |
| `src/modules/access` | Pure access policies and authoritative permission queries |
| `src/modules/messages` | Message commands/queries, receipts, attachments and canonical projection |
| `src/modules/reactions`, `src/modules/publications` | Their commands, state machines and repositories |
| `src/modules/sync` | Cursor/pagination orchestration; consume canonical projections |
| `src/modules/realtime` | Connection admission and lossy hints; no message command authority |
| `src/modules/media` | Intent/quota/access orchestration, storage port and R2 adapter |
| `src/modules/jobs` | Claim/lease/fence/retry primitives and registered worker handlers |
| `src/modules/audit`, `src/modules/notifications` | Narrow audit/push contracts |
| isolated decoder entrypoint | Separate credential-free process/container; not an API/worker service |

Each feature owns its `*.module.ts`, `*.controller.ts` when applicable, `*.service.ts`,
`*.repository.ts`, `dto/`, and only the policies/projectors/adapters it actually needs.
Do not generate empty layers or make every helper injectable. Pure deterministic policies remain
plain functions. Stateful services/adapters have explicit Nest providers and constructor injection.
Feature modules export narrow services/ports, not their repository internals or runtime containers.
Avoid a global catch-all module, service locators, `ModuleRef.get()` as dependency escape hatch,
and `forwardRef()` to paper over cycles. Infrastructure providers may be shared deliberately;
domain dependencies remain visible in imports/exports.

## Behavioral boundaries that must survive

1. Controllers adapt HTTP only: validate DTOs, extract credentials/context and call an application
   service. They do not query MySQL, open transactions, build services or decide domain policy.
2. Authentication guards are early admission, not the final authorization guarantee. Application
   services recheck session/account/SOOP and resource permissions in the SAME transaction as the
   protected operation. Preserve the routes that intentionally do not require a current SOOP link,
   including self-profile, logout and author's deletion rights.
3. Application services own UnitOfWork boundaries. Repositories receive an explicit transaction
   handle and cannot secretly start another transaction. Preserve writer snapshots, locking reads,
   lock order, bounded deadlock retries and unknown-commit handling.
4. Rate charging remains a separate committed transaction before the command transaction. The
   command transaction repeats authentication and current room/resource authorization.
5. No generic transaction interceptor: broker calls, streamed upload, R2 I/O and decoding must
   not run inside an eight-second database transaction. Worker finalization and lease completion
   remain atomic; external effects remain outside the transaction.
6. Canonical message/profile projections serve direct GET and sync. Query repositories can batch
   data differently, but cannot maintain incompatible DTO or privacy logic. No ORM/driver row is
   returned directly. DTO validation and response projection are separate responsibilities.
7. R2 signing requires fresh authorization; keys and storage configuration never become ordinary
   message fields. The isolated decoder cannot acquire API/DB/R2 credentials through module imports,
   environment inheritance or mounts.
8. Nest owns production provider instances and shutdown hooks. API, worker and decoder still have
   distinct entrypoints and resources. Test overrides must exercise the production module graph;
   do not retain a second monolithic test-only application indefinitely.

## Migration sequence and gates

R1. Freeze the current behavioral baseline and inventory imports, API contracts and unfinished M08
changes. Establish the infrastructure and authentication provider contracts. Add module-graph tests.

R2. Convert one complete vertical slice (messages) to feature Module/Controller/Service/Repository/
DTO/projector. Keep authorization, receipt/rate and transaction semantics intact. Migrate the test
imports and remove the replaced flat implementation, rather than permanently wrapping it.

R3. Convert users/rooms, reactions/publications, sync/realtime and media/jobs. Split the combined
community controller. Consolidate projections and remove cross-feature private-file imports.

R4. Move API/worker startup and cleanup into configured providers/lifecycle hooks. Remove temporary
composition adapters and obsolete root files. Generate and verify the planned REST contract without
publishing a debug endpoint. Add automated dependency-boundary checks and fresh-app DI tests.

R5. Run unit, real MySQL, HTTP, worker-kill/replay, authorization, media and migration regressions;
review the module graph separately from behavioral/security tests. Scan the public repository,
commit/push reviewed corrections to qa, inspect CI, then resume the remaining feature plan and
previously authorized QA delivery. Actual external login/R2/device/restore gates remain independent.

Completion requires the production entrypoints to use the intended module graph, no retained
parallel legacy implementation, passing full regression evidence and independent structural review.
Folder moves, injectable wrappers around unchanged monoliths, green old tests or this document
alone do not prove that the correction has been completed.

## R1 checkpoint — 2026-09-20

The API now composes explicit AuthModule and HealthModule alongside a temporary adapter for
the remaining controllers. AuthController uses AuthService, with session logout persistence and
independently committed rate charging behind a private repository. DatabaseModule rejects split
database/transaction overrides and tests shared provider identity and shutdown ownership.
Pure message/profile projection contracts are available for the subsequent vertical slices.

The exact staged source snapshot passed 89 unit, 14 HTTP/process and 2 contract tests (105 total).
The development tree with preserved, unfinished M08 changes also passed 62 disposable-MySQL
integration tests after the auth controller transition. These are different validation scopes;
neither result means M08 or the architecture correction is finished. Independent review checked
the DB module boundaries and projection allowlists. Cross-repository searches found no references
to the changed internal types or sampled session endpoint in the local sibling source repositories.

Remaining gates include all R2–R5 work, legacy Sessions/AuthFlow SQL extraction, removal of
AuthRuntime from other domains, production provider lifecycle ownership, canonical query wiring,
and full structural review. The API/worker still receive externally constructed dependencies.
Feature development and QA host deployment remain held; this checkpoint is not release acceptance.

## R2 checkpoint — 2026-09-20

MessagesModule now owns the actual message HTTP routes. MessagesService owns admission and
transaction boundaries; MessagesCoreService owns receipt/audience/deletion orchestration; the
private MessagesRepository owns SQL using the caller's transaction. The worker-facing CoreModule
is a separate entrypoint with no HTTP controllers, auth configuration or UnitOfWork provider.
AccessModule owns current membership facts instead of making Messages depend on Users/Profile.
SessionService and SessionRepository now split session policy from SQL; shared primitives avoid
a dependency cycle with the legacy Sessions adapter.

The published checkpoint preserves the M07 TEXT input contract and seven-migration schema.
Unfinished M08 media input, avatar joins, attachment deletion wiring and generated schema changes
are preserved in the development tree, not activated by this structural checkpoint. Message/media
repository methods prepared for M08 are not a claim that uploads or media delivery are available.
No migration was added or applied to QA for this checkpoint.

The exact staged backend source was extracted without a Git worktree, installed from the frozen
lockfile and tested against a fresh disposable MySQL database. Results: 103 unit + 56 MySQL +
14 HTTP/process + 2 contract tests = 175 passing tests; build, ESLint and public-repository scan pass.
The full development tree separately passed 137 unit and 62 MySQL tests, preserving M08 WIP.
Independent review found no P1/P2 regression in receipt ordering, same-TX authorization, deletion
rights, lock ordering or route ownership. Structural tests verify module exports, repository
encapsulation, SQL-free controllers/services and independent rate commit followed by reauthorization.

R2 is not the end of the migration: `messages.ts`, `access-compat.ts` and `Sessions` still provide
explicit legacy composition adapters for R3 consumers and R4 bootstrap. They contain no second
message/session implementation, but must be removed with the remaining consumer conversions.
Shared counter/job repository functions, other feature modules, canonical Sync query boundaries,
AuthFlow/identity repositories, DI-owned startup/shutdown and the full R5 gate remain required.

## R3–R5 structural correction — local verification 2026-09-20

The API composition now imports separate Users, Rooms, Messages, Reactions, Publications,
Sync, Realtime and optional Media modules. Controllers only adapt transport and validation;
application services own authenticated UnitOfWork boundaries. Transaction-scoped core services
coordinate policy and repositories without opening implicit transactions. OAuth login and identity
SQL, membership transitions/counters, profiles, reactions, publications, sync state, hint audience
queries, jobs and media persistence now have named private repositories.

`main.ts` and `worker.ts` are two-line bootstrap entrypoints. `AppModule.production` and
`WorkerModule.production` configure the same domain providers exercised by test composition.
Database and R2 providers close through Nest shutdown hooks; realtime starts/stops through Nest
bootstrap/destroy hooks; worker polling, readiness probes and pending work belong to a lifecycle
provider. The existing safe signal/fault handler calls Nest application close and retains its bounded
shutdown deadline. A killed long media operation still relies on lease/fence/replay recovery; this
change does not claim graceful completion of a four-minute transform within the ten-second deadline.

The root `Sessions` fallback, `AuthRuntime`, combined community/interaction/sync controllers,
`messages.ts`, `access-compat.ts` and all other root compatibility adapters have been removed.
Tests that need transaction-scoped operations obtain the actual core services from a Nest module
graph in `test/support/domain-fixture.mjs`; there is no second production implementation.
The remaining root source files are intentional composition or executable boundaries:

| File | Reason to remain at source root |
|---|---|
| `main.ts`, `worker.ts` | Stable process entrypoints, bootstrap invocation only |
| `media-decoder-main.ts` | Stable executable boundary for the isolated decoder process |
| `app.module.ts`, `worker.module.ts` | Explicit top-level API and worker module composition |
| `application.ts` | Shared HTTP application setup and test provider overrides, no domain policy |

The worker graph imports transaction-scoped publication/message/job providers and an optional
MediaWorkerModule, not HTTP controllers or authentication configuration. RoomMediaCoreModule
is a separate policy boundary: messages and stickers may consume current room media policy without
creating a MediaCoreModule → MessagesCoreModule → MediaCoreModule cycle. JobsCoreModule exports
only enqueue/finalization operations on the caller's transaction, while consumer-specific JobsModule
owns claim/retry transactions and the API-versus-worker purpose allowlist.

Message snapshot/history/event queries now belong to MessagesQueryRepository behind a finite
window API in MessagesQueryService. SQL ACL conditions remain before LIMIT, and attachments are
batched only for authorized page IDs. Sync consumes the canonical message projection; profile sync
consumes a UsersCoreService query/projection port rather than maintaining profile SQL in Sync.
Profile cursor generation hashes the authorized DTO array. Pre-transition profile cursors may
therefore safely require a reset; endpoint shapes, visible fields and birthday consent are unchanged.
No guard result substitutes for fresh same-transaction authorization, rate failures do not refund
committed charges, and external broker/storage/decoder I/O stays outside database transactions.

Decoder implementation files live under `isolated/media-decoder`; bounded protocol, spool and media
validation primitives live under `common/media`. The API/worker import only the decoder IPC client,
never the decoder implementation. The decoder's child process still receives its explicit scrubbed
environment and no database, API or R2 provider dependencies.

Architecture regression tests enforce the root allowlist, acyclic runtime imports, isolated-decoder
boundaries, private repositories, standalone core-module DI and strict room/profile DTOs. They also
reject Unsafe Prisma SQL members and runtime mysql2 imports/reexports/loads while allowing type-only
imports. Fourteen application-service tests verify the exact transaction handle and fresh session/SOOP
admission for profile, room and sync operations. The canonical message query tests cover anonymous
identity/quote stripping, lookahead exclusion and body-free tombstones. The page envelope exposes
only canonical DTOs, decimal position/version strings, deletion state and a lookahead boolean.

Realtime attaches its transport in `onApplicationBootstrap`, after Nest creates the HTTP server.
The real Nest socket-connect/shutdown test protects this ordering. An independent structural review
and follow-up review found no new P1/P2 in the module graph, query/profile ports or realtime lifecycle.
The separate ORM worker owns the database runtime/repositories and the physical-connection abort
correction identified by its own review. Its final runtime re-review also reported no P1/P2,
and the shared disposable-MySQL suite passed after those corrections.

The operational owner updated all three consumers of removed compiled paths: the worker healthcheck
in `infrastructure/runtime/compose.app.yaml`, the authentication preflight in
`tools/operations/backend_release.py`, and the manifest loader in `tools/operations/migrate_entry.mjs`.
Contract tests actually import the current exports. The expanded repository scan includes hidden
workflows and documentation and found no remaining executable flat-path references; the only old
string is a negative regression assertion. A read-only sibling-repository scan found no external
API-internal-path consumers.

The previous ignored build output was moved to a named local scratch directory. The clean artifact
tree contains exactly the six intended root JavaScript entrypoints and no deleted adapters. Current
shared-snapshot evidence, including preserved coordinator feature work and the ORM conversion:

| Gate | Current result |
|---|---|
| Clean build and typecheck | PASS |
| Unit, including architecture/privacy/UoW boundaries | 188 PASS |
| HTTP/process, including outage, kill and shutdown | 14 PASS |
| API/schema/runtime-consumer contracts | 4 PASS |
| Explicit native decoder regression | 5 PASS |
| Disposable MySQL, including transaction/replay/privacy | 106 PASS |
| ESLint | PASS |
| Public-repository scanner | Worktree checkpoint PASS; exact staged hook gate required for publication |

These local suites total 317 passing tests. Publication additionally requires the exact staged
security scan and the task PR checks against current QA; the PR carries those publication results.

A handshake deadline assertion initially missed its unchanged threshold under simultaneous native
video/typecheck load; the full unit suite passed after those CPU-heavy checks exited. No test timeout
or production deadline was relaxed. The native decoder test is an explicit local dependency gate;
these results do not establish production R2/decoder operation.

The user assigned the separate ORM-first conversion during this correction. Its worker owns database
runtime and repository data access; the structure worker owns architecture tests/documentation, while
the coordinator resumed M08+ services/tests after the path handoff. Publishing follows the repository's
updated task-branch/checked-PR rule, without direct QA push or a shared-checkout branch switch. The
security-policy/index mismatch was reconciled by its owner without bypassing scanners or hooks.
This section does not assert feature acceptance, QA deployment, external R2/login evidence or
completion of the M01–M12 goal.
