# Backend source integration checkpoint

This source integration is not a QA release or proof of physical deletion.

## Whole-batch follow-up (2026-09-20)

Accepted schema-23 checkpoint `7d1bd35df63d7f3aa707934a4473608e7dd6b59d`
passed every required PR52 check against current QA. Backend
[run 35510008789](https://github.com/h66rogi/rogichat/actions/runs/35510008789)
passed 443 unit, 18 end-to-end, 21 contract and 402 actual MySQL/process tests,
including the new populated WEB upgrade, native NOWAIT and pool recovery cases.
API/decoder image safety, public security, web, infrastructure, mobile-required
and the existing isolated quality gate also passed. Two obsolete auth error-code
expectations and one raw scalar type expectation were corrected precisely;
no runtime assertion was relaxed to accept arbitrary failures.

That checkpoint includes moderation discovery
`0d75c977244b43c2882b6f0fcbce8bc50664e25f`: `GET /v1/blocked-rooms` recovers
only rooms with the caller's durable blocks, uses session-bound encrypted
pagination, and returns currently permitted nullable labels.

Approved WEB `a92ebfc85398d368032195b901f42211b2983f62` was normally merged at
`609c08f3cef1755c48d244a5a9095293fed92318` without conflicts. Its web source and
workflow remain byte-identical to that reviewed leaf. Local typechecking and
security passed. The WEB owner accepted this exact aggregate, including dependency
closure and compatible moderation/push contracts: web tree
`62ca9f3b8b1dbbb6b0d9b357ec7569b95fdc4b52`, workflow blob
`5a83b574ac2f77ea7907522f7fb4ab098eca7ff6`. WEB hosted checks passed; the combined
quality job hit the setup migration's 60-second harness deadline before TAP.
Later source changes still require final CI and confirmation that the approved
web tree and dependency closure are unaffected.

Restore preparation `bd624d573dc53d2db49dd0f18d62f8d01c626a57` normally merges
generated migration 24, protected authorization epoch configuration and operator
restore gates, including accepted media reconciliation
`ba06a93d97deda4d4e4bdb676d836ba7c9a7d2bc`. Integration binds blocked-room cursors
to the authorization key while retaining stable report/rate and provider-sealing
keys. Compilation and 17 focused moderation/epoch tests passed. Final restore
source `7b559b645ef2b71fc5492d79895142745d0d6ead` adds checkpoint binding to both
the logical database and currently verified MySQL server UUID, preserving nonce
history and migration bytes. Approved MOBILE source and final hosted acceptance
are still pending; real joined restore execution remains a separate operator gate.

| Evidence boundary | Immutable source / result |
|---|---|
| Accepted backend, migrations 1–23 | `7d1bd35df63d7f3aa707934a4473608e7dd6b59d`; backend run above, all required PR checks passed |
| Approved WEB leaf | `a92ebfc85398d368032195b901f42211b2983f62`; [hosted browser run](https://github.com/h66rogi/rogichat/actions/runs/35510393707), 235 first-pass + 1 retry-pass, 2 opposite-device skips |
| Combined WEB/backend checkpoint | `609c08f3cef1755c48d244a5a9095293fed92318`; [WEB](https://github.com/h66rogi/rogichat/actions/runs/35510801843) passed, [backend](https://github.com/h66rogi/rogichat/actions/runs/35510801787) passed; [quality](https://github.com/h66rogi/rogichat/actions/runs/35510801733) stopped at the setup deadline |
| Restore/schema-24 source | `7b559b645ef2b71fc5492d79895142745d0d6ead`; includes physical/logical target binding and accepted media source, final aggregate hosted acceptance pending |
| Soak and supplementary scale | No accepted 30-minute result recorded here; no 1,000-client capacity claim |
| External providers, restored service, QA routes | Not established by these credential-free tests; infrastructure/provider execution remains separate |

The follow-up preserves accepted `4216aaaa53cc657a2d15e11cd12e53ce159e3b3b`
and normally merges these complete source histories:

- M10 account content/media `a25fb66f3e7345b136bdd810481d2f8f863be053`,
  including late-write reopening, cleanup fencing and durable cursor regressions;
  Apple also carries final sticker-proof correction
  `ae65a689b206dc57e1f2bcd898ef5bb5487e2413` without rewriting that commit.
- Moderation `d0461ccd778966dff6bbfd165e29fb8492650a7e`, including bounded
  report retention, reversible actor blocks and privacy-scoped recovery names.
- Native push `7774ce0634e686a0a66338e4a2619d1ab712eaaa`, including explicit
  enrollment, encrypted provider tokens, provider-aware enqueue/delivery and
  generated migration 23.
- Apple lifecycle `357f1fb80b9cdf5586a0ca6627466f74e974fe4f`, including
  SOOP-gated onboarding, bounded revocation and restored-credential quarantine.
- Current QA `c5c75d433e1da9a46d8a2fa4b66c405ab6e4a0c5`, including reviewed
  public-history scanner improvements.

Migrations 20–24 are retained without rewriting their bytes. Shared Nest module,
account-cleanup and worker conflicts preserve both moderation retention and Apple
lifecycle services. The merged cleanup tests retain both continuation contracts:
pending moderation cannot falsely complete, and provider waits cannot starve
independent content/media cleanup. Restore operations remain operator-only and
are not invoked by application startup or a public provisioning endpoint.

Integration-owned changes add [bounded overload admission](backend-overload-admission.md),
temporary socket transport retry, narrow native NOWAIT contention handling, and
real-MySQL regressions for acquisition exhaustion, lock contention and populated
WEB subscription preservation across migration 23. Existing tests are retained;
crossed native rebinding now rejects arbitrary errors as a passing outcome.
The disposable harness grants only Prisma migration replay/shadow validation a
bounded 180-second setup budget; other setup commands retain 60 seconds. It now
distinguishes sanitized timeout and nonzero-exit reasons. This changes no workload
assertion, migration SQL, production timeout or fresh-database guard.

Small local checks cover compilation, the focused runtime regressions, architecture,
syntax/lint and security. Full tests and disposable-MySQL upgrade checks belong
to exact-head credential-free hosted CI; prior or leaf passes are not combined
acceptance. The supplementary 1,000-client diagnostic has not passed on this
runtime. Local hints remain the reviewed single-API behavior, and HTTP 503 alone
does not establish successful recovery or capacity.

QA/main merge, live host/database/provider configuration, immutable-image
activation and user-route verification remain with the infrastructure executor.
No synthetic account or conversation is added to serving runtime.

### First QA schema-13 to schema-24 rollout

There is no previously healthy schema-24-compatible fallback for this first
rollout. After DDL, a failed candidate must leave the edge at 503 and API/worker
stopped while preserving the database and archives. The executor must use a
reviewed schema-24 forward repair or a separately controlled fresh physical
restore with ledger, media and authorization-epoch gates. A schema-13 image or
archive is a pre-DDL recovery option only: do not downgrade migrations, reset,
rebootstrap or restart the old image against schema 24.

After the first healthy schema-24 release receipt, retain that immutable digest
for a future schema-compatible fallback. This boundary authorizes no automatic
restore or recovery-time promise; real Aurora/R2 restore evidence remains pending,
and infrastructure owns the rollout and host implementation.

## Prior accepted source baseline (2026-09-20)

The sections below record earlier integration stages. Their statements about
18 migrations, an unregistered PURGE handler and a deferred C06 source cutover
are historical, superseded by accepted integration
`f3668aba120b4732e13ee024d13cebb3eb937bf3`. That baseline includes reconciled QA
`129f378`, the full C04–C06 contracts, native/web product composition and the
[bounded PURGE runtime](backend-purge-runtime.md), with **19 migrations**.
It still does not establish complete physical account/media purge or restore
release safety. No schema-20-or-later runtime is included in this checkpoint.

The [genuine-owner bootstrap](backend-genuine-owner-bootstrap.md) adds an
operator-only command and shared owned-room domain composition, normally merged
from reviewed PR68 commit `9f0bcd38a59bdc1d0a49a47a72210eeaf317acb0`.
Its exact-head hosted checks passed, including actual durable-COMMIT/driver-ACK
loss and exact-request replay. It changes no schema, HTTP authorization gate or
public login flow; genuine authentication and separate operator execution remain
necessary. The integration preserves the baseline's membership and deletion
contracts, worker composition, migrations and native/web source.

The [M12 isolated quality suite](backend-m12-quality-evidence.md) is normally
merged from PR69 commit `11cb2fa9485aa259c28e8dd204395bf295bd94f7`, whose required
checks and [33-test quality run](https://github.com/h66rogi/rogichat/actions/runs/35506640207)
passed. Its additions are test scaffolding, a credential-free hosted workflow
and measured evidence; none enter serving runtime. The drill exercises 1,000
sockets, API death/recovery, exact command replay and logical restore/session
invalidation. It does not establish cross-node hint delivery, production restore
release, per-client foreground latency or the entire M12 gate. Historical scalar
measurements in its runbook remain attributed to their original tested merge SHA.

Both inputs merged without conflict. Local bootstrap helper tests (three cases),
shell/JavaScript syntax and M12 scalar/target-refusal checks cover this small
integration step. Final combined hosted checks must pass on PR52; leaf results
alone do not validate the composed tree. No dependency installation, local full
mobile/container build or local database drill is part of this checkpoint.

QA/main merge, immutable-image activation, provisioning and actual user-route
verification remain with the designated infrastructure executor. Source evidence
does not claim those operations happened.

## Reviewed inputs

- Existing additive integration `b3dc1bf`: own-command reconciliation, account
  partition, current message counterpart/actions, notification/read-state baseline,
  storage absence checks and publication owner concurrency regressions.
- Push enrollment/configuration `69bfa9a` (PR 46): exact-head hosted 306 unit,
  18 e2e, 16 contract and 228 disposable-MySQL tests passed, including image safety.
- MESSAGE admission/replay `31d3e79` (PR 42): exact-head hosted 251 unit,
  18 e2e, 11 contract and 184 disposable-MySQL tests passed, including image safety.
- ACCOUNT admission/identity guards `b251b9a` (PR 53): exact-head Backend CI
  `35498584176` passed tests, disposable MySQL and image safety. The replay keeps
  completed-key progress across tick deadlines, and all production services use
  injected dependencies rather than manually constructed fallback repositories.
- Departed-owner send fence `cd7af58` (PR 54): Backend CI `35498447425` passed
  324 unit, 18 e2e, 18 contract and 255 MySQL tests, including 11 owner races and
  receipt/read/deletion regressions. Existing receipts remain reconcilable;
  new sends require the current room owner and membership to remain eligible.
- Media late-write containment `43606ce` (PR 55): Backend CI `35499582753`
  passed tests, disposable MySQL and image safety. Cleanup retains keys, states,
  quota and durable continuation when provider-write termination is unproven;
  legacy DELETED rows are not sufficient proof. This is the bounded safety slice
  described in [its closure review](backend-media-late-write-closure.md), not
  complete external-storage purge.
- Bounded account cleanup `16a0f70` (PR 57): Backend CI `35499919734` passed
  329 unit, 18 e2e, 18 contract and 273 disposable-MySQL tests, plus image safety.
  Its isolated internal module drains private profile/capability fields,
  read-state, own membership/reactions/grants/periods, push references and sessions.
  It remains unregistered in API/worker runtime; identity, avatar/media, outbox,
  and global purge obligations remain outstanding. The composed candidate adds
  per-room content-epoch invalidation for actual membership/reaction/grant/period
  cleanup mutations; this does not make admission an immediate all-room purge.
- Internal MESSAGE row purge `ac65632` (PR 60): bounded transaction/lease-fenced
  text/sticker row cleanup, detached dedupe receipts, exact atomic purge evidence,
  and room content epochs. It is not installed as a runtime job handler; media
  targets defer with provenance intact. Final Backend CI `35501023931` passed
  all 282 MySQL cases, including all 15 new purge cases, and both image checks;
  the old missing-root replay assertion was corrected without manufacturing
  synthetic requests or purge proof. Actual process-death tests are a separate task.
- Process-death regressions `f2abcea` (PR 61): actual child SIGKILL before the final
  transaction commits and after a successful commit loses its caller result.
  Both cases passed the first hosted run; the follow-up isolates an exact-owned
  synthetic publication job which had interfered with the shared test queue.
  This does not simulate network loss of the database COMMIT acknowledgement.
- Durable fair replay `ec53244` (PR 63): source-bound page/continuation journal,
  immutable invalid evidence, persisted NEW/RETRY scheduling, lease/fresh-time
  fences and bounded ACCOUNT scrub continuation. Independent review found and
  the author fixed a restored-account SCRUB liveness gap: precondition loss now
  commits a return to APPLY, and a separately claimed transaction re-establishes
  the account deny using the existing lock order. Exact final hosted validation
  and this composed tree's validation remain required.

These input results do not substitute for final composed-tree validation.

## Composition decisions

Keep push and deletion options separate in API and worker Nest registration.
API command reconciliation and viewer-specific projections remain registered.
ACCOUNT and MESSAGE admission receive the same configured external ledger without
replacing notification/read-state registration. The replay worker imports the
identity-guard port without requiring raw provider subjects or auth secrets.
Worker deletion replay is independent of the job loop; publication, both push
handlers and optional media handlers remain installed. Test helpers perform
external ledger I/O outside their database transaction, including read-state
deletion races. Preserve all added OpenAPI and actual HTTP response contracts.

Both independently generated migrations are retained byte-for-byte, ordered
`20260920060633_m10_deletion_intents` then
`20260920061207_m11_notifications_read_state`, followed by the original generated
`20260920074544_account_deletion_admission` (SHA-256
`1e3d298e965c15500e83d96f4ebae5e2ce3336c154ce67d369a207058bff85fb`).
The generated `20260920084358_m10_message_row_purge` follows (SHA-256
`9f55555af7708656e7a4db09b1196b819b58e859d3aad95c23c96c2d52a2dc7a`).
Its predecessor files are unchanged. Generated migration
`20260920090224_m10_durable_deletion_replay` then adds the two private replay
journal tables (SHA-256
`341773fcf5ab14ead777b85c68c8e8c04bf4eb4f9334019c3ce7053782c59e6f`).
All 18 were replayed in a second fresh isolated local database without drift;
the prior 17 SQL files were unchanged. This candidate has **18** migrations;
the earlier reviewed native-login QA candidate has **13**, and the observed live
QA runtime has **12**. Approval for one is not approval for another. No SQL was
hand-edited, no shared database was changed, and no production promotion occurred.

The earlier MESSAGE/push integration `46bca35` passed all required hosted gates,
including Backend CI `35498258627`. ACCOUNT/owner composition `388c9d0` then
passed Backend CI `35499262730`; its docs-only follow-up `d9614ed` passed all
required gates, including Backend CI `35499608318`. Media/account cleanup composition
`6d01b9e` passed all required gates, including Backend CI `35500464784`. Those
results do not cover the subsequent row-purge/cache composition, which needs its own hosted build,
generated-client/schema, unit, HTTP/OpenAPI, real-MySQL and image checks.
The local resource gate defers new heavy suites. Existing tests and explicit
API/worker push-plus-deletion composition regressions are retained. The media
merge changes no HTTP contract, configuration key or migration; consumer and
private-operations source scans found no dependency on its internal helper or
object-state representation.
The account-cleanup merge adds only its isolated module, tests and documentation;
it does not install a scheduler, change a controller, or claim a drained subset
means completed account deletion.

Ordinary app-only QA source merges were cleared after web delivery commissioning.
This candidate still changes the root dependency lockfile and API image build,
so its QA merge remains subject to a coordinated reviewed delivery-policy refresh.
That source/trust gate is separate from concrete QA schema-change approval and
does not authorize any host write or migration.

## Still outstanding

Physical message/account purge, late-provider
write/orphan closure, backup expiry and isolated restore release are not completed
by MESSAGE blocking. Actual R2/VAPID secrets and least-privilege mounts must be
commissioned separately. Missing provider configuration remains unavailable.
No real login, push delivery, media lifecycle or M12 operational claim follows
from a successful source build. Schema-v2 membership scope (C06) remains a separate
coordinated web/native cutover, not silently included in this additive batch.
ACCOUNT admission additionally needs a dedicated file-only identity guard key;
missing configuration returns unavailable rather than acknowledging deletion.
No key has been generated or installed by this source integration.

The original replay review found that persistent invalid/unavailable ledger
records and apply/scrub failures could pin a page and starve later intents. The
candidate now persists discovery and failed-item evidence separately from fair
execution: validated bounded page registration and cursor advancement are atomic,
and previously registered work has a separate execution budget even when discovery
fails. Invalid envelopes still stop discovery safely; they do not disappear into
an unbounded memory retry queue or become executable after metadata overwrite.
The replacement `inventoryPassEnded` result means inventory exhaustion only,
never complete resolution. No restore-release authority follows from it. Complete
physical purge, external orphan closure and restore release remain separate gates.
