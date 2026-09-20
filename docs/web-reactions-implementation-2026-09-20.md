# Web reactions — 2026-09-20

## Scope and contract evidence

Bounded FW05 reaction slice, based on QA/PR20 commit
`90a73e1a490c4ae6b3056cbc07e67e253da7c75b`. The frozen PR20 release is unchanged.
Read-only backend sources inspected:

- `apps/api/src/modules/reactions/reactions.controller.ts`: GET
  `/v1/rooms/:roomId/messages/:messageId/reactions`, PUT `/me` with
  `{emoji: string | null}`, DELETE `/me` with no required body, HTTP 200.
- `dto/reaction.dto.ts`: one normalized Unicode emoji sequence or null;
  `dto/reaction.openapi.ts`: `{counts: [{emoji, count}], mine: string | null}`.
- `reactions-core.service.ts`: active membership and readable-message checks;
  one selection per member, idempotent replacement/removal, real changes advance
  message version and emit `MESSAGE_UPDATED`.
- `apps/api/test/unit/reactions.test.mjs` and
  `apps/api/test/integration/reactions.test.mjs`: emoji validation, no reactor
  identities, authorization, anonymous projection and root-deletion races.

Ownership is the web chat feature, minimal PUT/DELETE method typing in the API
client and channel request wrapper, isolated tests, and this note. Backend,
mobile, CI/Docker, deployment, DNS and host configuration are unchanged.

## Behavior and privacy

Opening a reaction control reads the actual API. Only validated server responses
show counts or a selected reaction; loading and errors have no invented count or
optimistic success. Six common emoji choices and existing aggregate emoji support
selection/replacement/removal. Controls use existing shadcn buttons and design
tokens, labelled pressed state, keyboard interaction and 44px minimum targets.
Anonymous rows use only the published message's own server ID; no source,
counterpart or reactor identity is inferred.

No requests are issued for every timeline row on mount. Explicit/open controls
share a four-request ceiling, per-message deduplication and 20-second timeout.
A version change invalidates old counts; open controls request fresh aggregates.
If an older request still occupies that message, its completion emits a
content-free revision signal so only still-open controls re-read the new version. There is no automatic write replay.
After a failed mutation, the user re-reads before selecting again. A 429 clears
unconfirmed data and applies a conservative 30-second local cooldown (the current
transport exposes status, not Retry-After). Raw upstream error text is discarded.

Reaction replies are fenced by the controller abort/privacy epoch and message
version, then the existing session verifier. Existing account/room unmount,
profile/manifest reset, local deletion and incoming deletion erase reaction
state. 401 invalidates the session; individual 403/404 clears private scope and
reauthorizes without asserting global logout. Incoming deletion's full epoch
reset and uncertain message-send IDs are preserved.

## Verification

Node 24.21.0, separate external scratch build; the shared release snapshot was
read-only. Production build, full web ESLint/typecheck and production artifact
isolation check pass. All 58 web unit tests pass, including reaction contract
validation, request bounds, set/change/remove, 401/403/404/429/503, stale version,
profile reset, deletion and disposal; existing send/deletion tests remain green.

All 26 focused production-artifact Playwright cases cover desktop and mobile Chromium:
real method/CSRF requests, authoritative counts, empty/loading/error states,
keyboard focus, axe accessibility, 401/403/404 recovery, 429 cooldown, 503 read
recovery, delayed replies after deletion/session change, version-hint refresh
anonymous publication identity, and delayed GET/PUT version-advance races with
open-control reread and closed-control suppression. Synthetic data exists only in isolated test
interception and is excluded from production bundles.

Side-effect inspection found no backend/mobile consumer of the changed web-only
controller/request types. Existing transport cookie, CSRF, no-store and timeout
behavior is preserved; no API schema or dependency changes were needed.

## Remaining gates

Real logged-in QA/provider round-trip validation remains externally blocked; local
interception tests are not evidence of that validation or deployment. Root owns
normal QA PR integration and deployment. This change does not complete all FW05:
publication commands, counterpart inference and durable outbox remain outside this
slice pending their backend contracts. Opaque participation/account binding and
own-command projection followups are not invented in the reaction cache.
