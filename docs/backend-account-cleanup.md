# M10 bounded account remainder slice

The later [ACCOUNT content/media runtime](backend-account-content-media.md) composes
this subset into automatic PURGE continuation and supersedes the retained-content,
avatar and profile-change limitations below. Identity/provider/backup closure stays
independent; the historical standalone design is retained for context.

The original schema-free internal slice was based on integration `388c9d0`. It adds
`AccountCleanupModule` and its exported `AccountCleanupService.step(requestId)`.
It is deliberately not registered in API/worker composition, exposed through
HTTP, or installed as a job handler. The parent purge coordinator must integrate
it with content/media cleanup before scheduling it. The composed candidate now
requires migration 17's room content epoch for cache invalidation.

## Authority and bounded continuation

Every step reads the immutable ACCOUNT receipt from the configured external
ledger before starting a database transaction. Ledger unavailability prevents
cleanup. In that transaction, current locking reads verify the exact admitted
checkpoint including digest/original timestamp, current DELETING/DELETED account,
and matching BLOCKED/PURGING obligation with guard coverage. Missing account,
legacy/incomplete coverage, changed evidence, ACTIVE status and a purported
completed obligation are rejected. The service neither creates nor updates any
admission, guard, obligation, deadline or completion field.

Lock order is checkpoint shared lock, account exclusive lock, obligation shared
lock, then the selected room/domain and job rows. The checkpoint-first exception
matches admission replay. Raw SQL is limited to those current locking projections
and a selected room primary-key lock; ordinary persistence is generated Prisma.
Repositories receive the caller transaction and never open one. Existing bounded
transaction deadlines and confirmed-rollback retry rules apply.

Each call commits one mutating phase. Collections repeatedly process the first
remaining page, at most 100 rows, without OFFSET or collecting every room. The
small profile/capability phase touches at most three rows. Deletions, scrubbed
fields and inactive membership state are the durable continuation; a process
restart simply repeats all phase predicates. A fully drained retained member is
excluded by relation-existence predicates so it cannot starve later rooms.

Order:

1. Remove creator/admin capabilities. Remove profile if it has no avatar link;
   otherwise scrub nickname/birthday/visibility, retaining the avatar reference.
   The empty stored nickname is not a placeholder profile or successful API DTO.
2. Drain `ReadStateCoreService.purgeAccount` using its `{deleted, hasMore}` contract.
   A page that deletes rows yields even if `hasMore` is false.
3. Select one remaining membership and lock its room. Mark it LEFT, clear the
   active-period pointer and increment its ACL epoch once. Subsequent pages remove
   its own reactions (including on other authors' messages), grants and periods.
   Read-state FKs are drained before periods. Participation ends at the persisted
   inactive membership transition; period history is then erased in pages.
4. Drain `NotificationsCoreService.purgeAccount` using `{deleted, done}` without
   treating zero deletions as completion. It owns PUSH jobs, delivery intents,
   subscriptions and preferences. Only after `done` may session rows be deleted,
   also in pages of at most 100, preserving the subscription/session Restrict FK.

`{phase: "subset-drained", changed: 0, hasMore: false}` means only that these
predicates found no remaining work. It is not live purge, account deletion
completion, backup expiry, or restore release. Re-run performs a fresh rescan.
No service writes LIVE_PURGED or advances an obligation beyond BLOCKED/PURGING.

## Preserved evidence and independent content

Retain users, room-member UUID anchors, room owner pointers, rooms, others'
independent messages/replies/quotes, receipt/sticker/audit references and approved
service stickers. Never transfer ownership or grant a new privilege. The existing
current owner/account and recipient fences deny new sends after deletion.

Keep platform SOOP and other identity rows and all guard tables unchanged.
Admission replay recomputes coverage from the original identity UUID; removing it
without a separately modeled live-purge proof would turn replay into an unresolved
obligation. This slice does not authorize identity deletion or guard expiry.

Keep avatar links, media assets/objects/usage and provenance until a separate
durable cleanup transfer proves detachment safe. No broad registrar/owner asset
deletion is allowed, including approved stickers. Bound login-secret cleanup
remains admission replay's separate bounded responsibility. Profile-change outbox
rows and their scoped jobs remain a separate remainder; no room-wide job sweep
is used here. These are explicit outstanding obligations even when this subset
is drained.

## Privacy and client invalidation dependency

Existing HTTP self-profile authorization rejects the deleted account. Actor
profile and avatar authorization require ACTIVE account/member state, so retained
media references and scrubbed profile fields are not successful response data.
Fresh reaction counts already exclude DELETING users. Fresh counterpart and
reply hints require ACTIVE user/member/open period, and new private sends perform
current recipient checks rather than trusting those hints.

Each actual membership/reaction/grant/period cleanup page increments the selected
room's `content_epoch` under its existing room lock, in the same transaction as
the mutation. Rollback preserves both data and epoch; a drained retry does not
advance it. Migration 17 binds that epoch into event/history/profile cursor scopes,
so another participant's next request with an older cursor requires a reset.
No new response shape, public counter or fabricated event is introduced. ACCOUNT
admission and profile/read-state cleanup do not synchronously advance every room;
room invalidation follows bounded room cleanup, and offline clients must reconnect.
This is not instantaneous device erasure or global purge completion. C06 remains a
separate coordinated contract cutover and must preserve the content-epoch binding.

## Verification scope

Tests added for the real Nest module and disposable MySQL cover external/checkpoint
authorization, current status versus an older RR snapshot, pages over 100 rows,
restart/no-starvation, read-state/period and push/session FK ordering, unrelated
content and approved sticker preservation, original identity/replay coverage, and
profile/avatar denial. A composed real HTTP regression covers another participant's
event/history/profile reset, atomic rollback, reaction-page reset, no-op epoch
stability, and independent message preservation. Focused unit tests exercise the distinct M11 continuation
contracts, including zero-deletion pending pages, and the isolated module graph.
No local build, install or database execution is authorized under the mobile
resource hold; final exact-head hosted validation must supply execution evidence.
No deployment or shared database/provider change is part of this slice.
