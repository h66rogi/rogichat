# Web command and sync v2 source slice

Source work only, based on frozen QA `049a1971b3905159235a4be785cbfc6310cb9fd7`.
Accepted PR33 commits `330f101` and `f2de1b63d8a14e3071b0814ec2f9e79a8ccbc56c`
were merged without conflicts as `6480678`; reaction privacy and keyboard behavior
remain in the product. No backend, native, host, DNS, Caddy or deployment change
is included.

## Exact read-only source contracts

- C04/C06 checkout HEAD verified as `691aff80bbcc96903ffe11d76b2a7561859ddb02`.
  `docs/message-command-reconciliation.md` blob
  `453587d8d63187e7dc549ff3cee765003dbe2b65`;
  `docs/membership-scope-contract.md` blob
  `b58e6810cf5fdf65a962b1444cf1108adb3ae1ed`;
  `packages/contracts/sync-client.mjs` blob
  `a2f8f9a8482aa1b5adbf77dbe52a858975733dab`.
  The terminal tombstone correction `2d6cdb1945627f567143247a20df150379a26e3d`
  is included in this exact contract head.
- C05 checkout HEAD verified as `492f2f75f96acc88874d46646e44cbadefe532db`.
  `docs/message-projection-c05.md` blob
  `4e80718e88defe2af240e478921980ad2f082759`.
  The exact isolated fixture is copied into `apps/web/test/fixtures/` with blob
  `d3dde0fb1a25b20986b028f816704ef78ad823a5`; application code never imports it.
- Read the corresponding exact-head sync/message/profile OpenAPI source to
  validate nested DTOs and reset envelopes. No backend implementation was copied
  or merged. C05 and C06 must be combined by their backend integrator.

## Behavior

The in-memory command ledger stores immutable explicit SEND records, including
normalized payload, original membership scope, room, account partition, session
binding and local membership generation. New submissions mint new command IDs,
even for identical text; retries explicitly reference the original record. Editing
a draft creates a new intent. Unknown commands survive same-session cache/draft
resets and have a read-only recovery control. No persistence across reload is
claimed.

A GET receipt is read-only. Its deleted variant accepts only clientMessageId and
status, and terminal records discard payload/identity/version metadata. SEND's
existing deleted ACK still has its separately validated messageId wire field;
that field is not retained in the terminal command. Ambiguous 404 never establishes
noncommit. Only an explicit retry, with refreshed authorization, can replay the
same ID and immutable payload. Rejoin never rebinds the record; a local membership
generation also blocks an observed M→other M→M cycle. Read-only recovery remains
possible under fresh authorized membership without rebinding SEND.

Sync accepts schema 2 only, canonical 43-character tokens, lowercase UUIDv4,
uint64 decimal strings and canonical millisecond UTC timestamps. Complete
single-generation manifests carry M/A on room entries only. Nested DTOs and reset
envelopes reject unknown fields. Reset always creates a fresh cacheId and snapshot;
AbortSignal and local projection/cache generations fence old asynchronous results.
The separate websocket wake-up protocol remains schema 1, as specified by the
exact C06 realtime gateway; it contains no chat data.

Loaded messages sort by createdAt then lowercase UUID ASCII, independently of the
server's history/event cursor ordering. Equal-version authorized DTOs replace
fully, including counterpart and action hints. A tombstone removes the entire
live DTO and blocks every subsequent live version in that cache generation, while
ignored upserts still advance the event cursor. Immutable display keys are checked
even on rejected resurrection attempts.

Remote deletion clears all draft/quote views and action state, retaining terminal
tombstones. Before displaying retained messages again, the controller re-reads
whole DTOs in groups of at most four and rechecks authority; inaccessible rows
remain absent. This protects anonymous derived copies and quotes without guessing
source identities. Resume/access refresh uses a fresh authorized snapshot.
PRIVATE replies target counterpart, including outgoing messages; reply/delete
hints only control affordances and every mutation still goes to the server.
Anonymous publishers can use the server's delete hint without acquiring an author
identity. Reaction responses remain anonymous aggregates; authority changes fence
and invalidate cached/in-flight reaction state.

ApiClient retains HTTP status and fixed user messages. Only exact, status-bound
allowlisted server codes escape; arbitrary body text and expected-token hints do
not. No v1 fallback, feature flag, demo adapter or optimistic success is added.

## Coordinated cutover and paired rollback — blocking

Current production uses schema 1. This web source cannot be activated alone.
Backend C04+C05+C06, web, Android and iOS must pass a coordinated v2 compatibility
review and required CI before any QA/main promotion or activation. Existing v1
clients cannot SEND v2 commands. Stage matching immutable artifacts, fence old
sessions/caches at cutover, verify real authenticated routes/receipts/scope changes,
and keep the existing release set available. A rollback must restore the matching
backend and all consumer artifacts together and invalidate v2 caches/sessions;
rolling back only web or only backend is unsupported. No backend migration is
introduced by this web slice. Rollout/rollback execution belongs to the coordinator
and infrastructure/native owners, not this branch.

## Validation and side effects

Focused Node 24.21.0 unit/contract tests, TypeScript and ESLint are the local gates;
full production build, browser matrix and five required checks are hosted-CI gates.
Earlier implementation runs exposed a test variable shadowing the sync fixture,
canonical tie-order expectations, optional-property typings and lint-only test
annotations; these were corrected without relaxing the v2 decoder. No full local
build/browser matrix was run.

Shared symbols changed: Session.accountPartition, ChatComposerSubmission's
explicit retryCommandId, ChatState command recovery, RoomMembership M/A and the
strict ServerMessage projection. In-repository UI/callers and isolated browser
fixtures were updated together. Existing shell/composer/reaction structure is
retained; no new reference implementation was imported. The side-effect review is
bounded to this checkout and explicitly authorized exact read-only contract heads;
other worktrees are not modified or broadly scanned. Backend/native v1 consumers
remain a high-impact coordinated-cutover dependency, not a compatibility claim.

Durable IndexedDB/outbox, media/publication expansion, push/read state, account
lifecycle/moderation and real-account deployment verification remain out of scope.
A browser reload or confirmed session loss removes memory-only recovery. Component unmounts park scoped memory under the limits below.

Review checkpoint: 75 focused unit/contract tests passed on Node 24.21.0;
TypeScript and ESLint passed. Exact C05 fixture validation, nested negative DTO
cases, safe error-code filtering, read-only recovery and stale receipt ABA are
included. Checksum-pinned Gitleaks installation and the mandatory `check.py all`
passed; staged commit and pre-push hooks remain mandatory. Browser fixtures and
new outgoing-reply/identical-new-command cases are aligned to v2 but await hosted
execution. No browser/build or deployment success is claimed by these local checks.


## Independent review corrections

The independent Opus review of `62d7e47` identified the foreground composer-loss
P1 and the action-generation, receipt/tombstone and accessibility followups. The
correction separates component/cache lifetime from the parked command/composer
owner. Fresh snapshots still hide private UI during reauthorization; same
account/session/M/A/actor/role plus current projections restore the draft, quote
and retry identity. A quoted source outside the latest page is freshly read and
room authority checked before its excerpt can render. Identity is parked before
a SEND begins, so unmount during an uncertain in-flight request cannot remint it.
Each new controller claims an exclusive local lease; old completions/writers
cannot attach to a successor. Real pagehide/pageshow and focus browser tests are
included for the auth-gate unmount path, alongside session-loss scrubbing.

Parking is bounded to four rooms, 32 drafts and 2 MiB of draft data per room,
544 hint records, and 256 command records. New commands are refused if all 256
records remain unknown; old settled entries can be evicted and are never replayed
when absent. Parked private content expires after 15 minutes: drafts, participant
metadata, hints and replay payloads are scrubbed, retaining only minimal unknown
receipt identity. Logout/session loss clears all rooms; confirmed room loss uses
the same payload/participant scrub with receipt-only quarantine. Expiry warnings
are consumed by a fresh valid lifecycle. Capacity/lifetime and stale ownership
have focused regression coverage. This is not durable storage or crash recovery.

Generic sync tombstones no longer create a durable deleted command receipt.
Duplicate tombstones are idempotent; rejected lower-version deletions cannot
settle other commands in a mixed page. Only receipts for existing commands settle
the ledger, and a true deleted receipt remains irreversible. History and events
both invalidate reactions/actions on equal-version hint changes. Mismatch handling
uses the allowlisted MEMBERSHIP_SCOPE_MISMATCH code, distinct from generic
conflicts. The actual safe-exception filter and OpenAPI error schema both define
exactly `{error:{code}}`, with no requestId; strict rejection of extra fields is
intentional. Counterpart labels also resolve from authorized recipients, and
pending recovery controls have unique accessible names and groups.

Corrected local checkpoint: **85 unit/contract tests, TypeScript and ESLint passed**
on Node 24.21.0 before publication. The actual auth-gate pagehide/pageshow/focus
browser regressions are committed for hosted execution, not claimed as locally
run. Transient reauthorization failure keeps parked drafts locked until a fresh
successful authority check; confirmed loss scrubs them. No new dependency or
build cache was installed during correction.


### Second independent review corrections

The second immutable review of `5e9299d` reproduced routine manifest/profile
cache-generation resets dropping drafts, message-scoped 403/404 doing the same,
and parked quote freshness/evidence gaps. Generation resets now preserve scoped
composer memory while always replacing the cache and snapshot. Message reaction
and delete denials hide the timeline, preserve unrelated drafts, and await fresh
room authorization; confirmed room loss takes the full scrub/quarantine path.
Successful deletion still deliberately clears derived private drafts and quotes.

Every restored quote is checked against bounded prior createdAt/version evidence,
including quotes already in the latest page. Its excerpt and author label are
rebuilt from the current authorized DTO. Hints for parked quotes outside the
current timeline survive normal sync, up to the existing 32-quote/544-hint bound.
Focused regressions vary manifest/profile generations and reset envelopes, cover
both 403 and 404 for reactions and deletion, fresh snapshot/point-read quote bodies,
and off-snapshot createdAt mutation/version rollback. Browser regressions exercise
real socket wake generation changes plus auth-gate quote refresh.

Inferred followups remain bounded and are not claimed resolved: draft parking
serializes at most the accepted 2 MiB map on each edit (large rejected input can
cost more); performance optimization needs measurement and must preserve the exact
JSON byte bound. Capacity errors for more than four simultaneously active rooms
are unreachable in the current dedicated single-room composition and need a UI
error boundary before that composition expands. Scrubbed expired entries remain
in the four-slot registry until bounded eviction, intentionally preserving minimal
unknown-receipt recovery without retaining private payloads.

The targeted followup also freezes the prior quote-evidence map for the complete
reauthorization pass, so clearing one revoked quote cannot weaken validation of
later quoted IDs. Access-error recovery runs even while an aborted SEND awaits its
late completion; confirmed room loss scrubs before that completion arrives. Live
event/history projection changes regenerate quoted excerpts, preserve draft text
and explicit retry IDs, and advance the composer generation to reject stale UI
writers. Unit and browser regressions cover the held-SEND reaction denial and
live redaction paths as well as the multiple-quote evidence case.


### Current-QA integration (2026-09-20)

Normal merge parents are reviewed PR59 `db6c488c94b34dce3f1fb98bf1103c052fe7dce4`
and fetched QA `040652817ef357c4389da25e2bb0e001408dd810`. No reviewed commit
is rewritten. QA's accepted PR66 `83061701fa94f39fb4555e381218c3f8e8f0fc6b`
join-401 login gate and browser regression are preserved. The controller conflict
is resolved narrowly: terminal receipts schedule post-flight revalidation centrally,
covering direct schema-2 SEND, explicit retry lookup, and read-only reconciliation.
The existing sending fence releases before this fresh read; no local message is
invented, no command is replayed by reconciliation, and no schema-1 fallback exists.

Three schema-2 regressions hold an old sync, begin each command path, release the
old read, and require the committed server message to appear through exactly one
fresh read without a timer, socket hint, or manual refresh. Each fails when the
post-receipt revalidation is removed. Node 24.21.0: all 126 web unit tests, TypeScript
(no incremental cache), and ESLint passed. Browser and production/container checks
remain hosted-only; their authoritative result belongs to the exact pushed head.

Product diff versus reviewed PR59 retains strict schema-2 envelopes, opaque M/A,
account/session/room and lease fences, ABA protection, tombstones, private drafts,
quote scrubbing, and unknown-command quarantine. Wire parsing and command payload
construction are unchanged against frozen backend
`f9197a31d61b7c34256e92f0bcb73ee255275d40`: authorizationRevision includes
content_epoch server-side and remains opaque to this client; GET deleted receipts
omit messageId while legacy SEND deleted acknowledgements retain it.

PR59 remains draft for centrally paired backend/native activation. This integration
does not merge QA/main or deploy. QA has zero real users/rooms and real-account login
is unavailable, so it provides no runtime OAuth/chat success evidence. Existing QA
media/native changes arrive only through the normal QA parent; future media/push
composition remains separately owned.
