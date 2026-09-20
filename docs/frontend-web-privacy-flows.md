# Web privacy source and integration contract

Frontend base: `cd34c5c2733df61fa0e9a72a704f6ad6b79be547` (schema 2).
Account/publication backend: `f9197a31d61b7c34256e92f0bcb73ee255275d40`.
Moderation backend: `42357558d411bd22d9218a3086a51f8abc4d4f06`.
Reviewed controllers, services, auth flow, publication core and OpenAPI, together
with FW05/FW07 and backend product policy. These are source changes, not release
or live account verification. No real SOOP login was attempted.

## Owned leaves and integration boundary

`apps/web/src/features/privacy/index.ts` exports:

- `AccountDeletionControl({origin, session, generation, onBlocked})` for settings.
- `AccountDeletionRecovery({origin, onResume, onBlocked})` ahead of private gates.
- `ACCOUNT_DELETION_PENDING`, `PRIVACY_CHANGED`, and synchronous
  `isAccountDeletionPending(storage)`. Read failures fail closed. Marker existence
  gates every private-session consumer before profile/room restoration.
- `PublicationControl({origin, session, scope, generation, message, onPublished})`
  for an authorized PRIVATE TEXT DTO. Full session/generation/room/membership/
  authorization revision/message version key remounts abort stale work. The
  integrator must also unmount on original deletion, session hiding and reset.
- `MessageModerationControl({origin, session, scope, generation, message,
  onReset})` reports currently readable messages and blocks only a visible,
  non-self C05 member author. Anonymous publications never reveal a block target.
- `BlockedActorsControl({origin, session, roomId, generation, onReset})` reads
  paginated server blocks and explicitly confirms unblock, including after leave.
- `ReportRecovery({origin, session, generation})` reconciles an own pending report
  by its idempotency key after reload. Mount it in settings.

The media integrator exclusively owns shared settings/chat/auth-gate mounting.
`onBlocked` must synchronously invalidate private lifecycle resources (outbox,
drafts, caches, push binding); the leaf additionally forgets chat memory and
emits session/privacy invalidation. Recovery owns marker reconciliation/clearing.
`onResume` only means the user closed the notice, never cancellation of an
accepted deletion. It must refresh authorization before private content returns.
`onPublished` requests authoritative fresh sync, with no local SHARED projection.

The marker is written **before** DELETE as `unknown`, containing only a random
operation ID, a hash of API origin plus opaque account partition, and phase.
An optional one-way session equality hash distinguishes the session that received
RECENT_AUTH_REQUIRED from a subsequently rotated same-account login. The hash is
not an authentication credential and never authorizes a request.
No token, CSRF, raw account UUID, message content, or deletion request UUID is
stored. Receipt status `blocked` means account access blocked, never physical
purge complete. 401, 503, malformed JSON and lost ACK remain uncertain. Recovery
is read-only until a new explicit confirmation; session/account comparisons
prevent deleting a newly logged-in account. SOOP uses supported `login` intent
and terms consent; no invented reauth intent or automatic deletion retry.

Publication 202 receipts are checked strictly; only `published` has `messageId`.
Five timed GET polls at two-second intervals are bounded, followed by manual
status checks. Pending publication IDs remain memory-only within that exact DTO
and authorization lifetime. Reload discards linkage; no automatic POST replay.
404 is unknown, never evidence that creating another publication is safe.
The server remains sole owner/role authority; C05 publish is only an affordance.

Publication POST and status GET recheck the exact session before and after the
response before invoking sync. Noncooperative late responses and disposed scopes
cannot update a successor timeline. Report/block responses and lists use the
same session fences. Block or unblock ACK loss still requires scoped cleanup and
manifest reconciliation while the original session remains current. `onReset`
owns that cleanup, not merely hiding a row locally.
Block/unblock changes authorization revision A and manifest generation while
membership scope M stays stable: preserve immutable SEND M and reconcile the
existing queue under C06 instead of silently deleting uncertain sends.

Report creation stores only a random idempotency key and hashed account binding.
Reason/detail/source IDs stay in memory. A lost ACK recovers the own receipt by
GET; 404 permits explicit identical-body retry only in the original live control.
After reload, the original body is unavailable and is never fabricated or
automatically resent. `received` means durable storage, not staff review/contact.
Explicit removal of a local recovery notice never cancels a server report.
Blocks use only visible room actor IDs; no hidden identity/global ID lookup.

## Validation and outstanding integration

The direct Node 24 tests cover strict receipts, transport bounds, lost ACK/401/503,
reauth account switching, storage failure, stale operation fencing, publication
permissions, version/generation keys and unknown-to-published status recovery.
TypeScript and leaf ESLint run without a local build or dependency install.
Eight dedicated `privacy-production.spec.ts` cases exercise actual settings/chat mounts with
isolated interception, including confirmation, same/different account reauth,
lost ACK reload, publication preparation/revocation and report recovery plus axe.
Shared UI mounting, browser/a11y execution and CI build remain the integrator's
review boundary; unused leaves alone do not complete this task.

Reporting/blocking are absent at the original pinned backend SHA. The new leaf
uses the backend owner's concrete moderation controller, OpenAPI, DTO and service
source at the moderation pin above: report POST/own receipt GET, room actor block
PUT/unblock DELETE and paginated block GET. Backend unit/OpenAPI checks passed;
migration 22, isolated DB integration and deployment evidence remain pending.
Detail is bounded to 1,000 Unicode code points, matching the checked-in DTO.
No guessed endpoint, support address, operator console or
local block-success projection is supplied. M10/2 runtime and real QA user/room
behavior are not verified here.
