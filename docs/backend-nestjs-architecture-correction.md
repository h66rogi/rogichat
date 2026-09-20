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
