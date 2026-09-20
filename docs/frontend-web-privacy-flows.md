# Web privacy source and integration contract

Frontend base: `cd34c5c2733df61fa0e9a72a704f6ad6b79be547` (schema 2).
Account/publication backend: `f9197a31d61b7c34256e92f0bcb73ee255275d40`.
Reviewed controllers, services, auth flow, publication core and OpenAPI, together
with FW05/FW07 and backend product policy. These are source changes, not release
or live account verification. No real SOOP login was attempted.

## Owned leaves and integration boundary

`apps/web/src/features/privacy/index.ts` exports:

- `AccountDeletionControl({origin, session, generation, onBlocked})` for settings.
- `AccountDeletionRecovery({origin, onResume, onBlocked?})` ahead of private gates.
- `ACCOUNT_DELETION_PENDING`, `PRIVACY_CHANGED`, and synchronous
  `isAccountDeletionPending(storage)`. Read failures fail closed. Marker existence
  gates every private-session consumer before profile/room restoration.
- `PublicationControl({origin, session, scope, generation, message, onPublished})`
  for an authorized PRIVATE TEXT DTO. Full session/generation/room/membership/
  authorization revision/message version key remounts abort stale work. The
  integrator must also unmount on original deletion, session hiding and reset.
- Temporary `ModerationUnavailable()` is an honest unavailable state, not a
  substitute for the required report/block flows.

The media integrator exclusively owns shared settings/chat/auth-gate mounting.
`onBlocked` must synchronously invalidate private lifecycle resources (outbox,
drafts, caches, push binding); the leaf additionally forgets chat memory and
emits session/privacy invalidation. Recovery owns marker reconciliation/clearing.
`onResume` only means the user closed the notice, never cancellation of an
accepted deletion. It must refresh authorization before private content returns.
`onPublished` requests authoritative fresh sync, with no local SHARED projection.

The marker is written **before** DELETE as `unknown`, containing only a random
operation ID, a hash of API origin plus opaque account partition, and phase.
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

## Validation and outstanding integration

Direct Node 24 tests cover strict receipts, transport bounds, lost ACK/401/503,
reauth account switching, storage failure, stale operation fencing, publication
permissions, version/generation keys and unknown-to-published status recovery.
TypeScript and leaf ESLint run without a local build or dependency install.
Shared UI mounting, browser/a11y fixtures and CI build remain the integrator's
review boundary; unused leaves alone do not complete this task.

Reporting/blocking are absent at the pinned backend SHA. The backend owner is
preparing concrete source contracts; no guessed endpoint or fabricated support
address is used. Their immutable tested source and actual mounts are still
required. M10/2 runtime and real QA user/room behavior are not verified here.
