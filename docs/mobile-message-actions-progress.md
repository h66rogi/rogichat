# Mobile message actions implementation and integration handoff

2026-09-20. Branch `dokdo2013/mobile-message-actions`, base `8216b8f35b45a1ab1a2e3c1b570a42a17b5178fe`.
This is a feature module delivery, not an app mounting, live API, database migration, distribution or deployment completion claim.

## Contract sources

Baseline: backend `f9197a31d61b7c34256e92f0bcb73ee255275d40`, read using `git show` rather than the older API files in this branch.

| Flow | Actual source and meaning |
| --- | --- |
| Delete | `messages/messages.controller.ts`, `messages/dto/message.openapi.ts`: POST `rooms/{roomId}/messages/{messageId}/delete`, `{}`, 200 `{requestId,status:"blocked"}`. Access blocked is not physical erasure. Receipt IDs allow UUID v4/v5. No mutation-status lookup exists. |
| Reactions | `reactions/reactions.controller.ts`, `reactions/dto/reaction.openapi.ts`, `reactions/dto/reaction.dto.ts`: GET aggregate; PUT `reactions/me` `{emoji}`; DELETE `reactions/me`. Counts/mine only, never actor lists. Fixed valid emoji choices; server reauthorizes every write. |
| Publication | `publications/publications.controller.ts`, `publications/dto/publication.openapi.ts`, `publications/publications-core.service.ts`: POST `publications` returns 202 preparing/published/revoked receipt, GET `rooms/{roomId}/publications/{id}` polls status. TEXT and PHOTO supported. Never insert an optimistic anonymous message. |
| Permission hints | `messages/dto/message.openapi.ts`: `allowedActions.delete/publish` gate corresponding controls, not fabricated ownership/role. Reply belongs to TEXT writer. This is not a complete capability registry; reactions require a currently readable message and actual server authorization. |
| Read position | `read-state/read-state.controller.ts`, `read-state/read-state-docs.openapi.ts`: GET own bounded readable IDs + opaque readContext; PUT only newly displayed ID with current context. Null PUT result is valid; GET items cannot contain null. 409 discards queued updates/context and requires fresh GET. Omission is not unread. |
| Report/block | Moderation commit `42357558d411bd22d9218a3086a51f8abc4d4f06`, `moderation.openapi.ts` and `moderation.controller.ts`, inspected 2026-09-20. Backend owner retains runtime validation/deployment evidence. POST message reports uses original durable UUID idempotency key + reason, optional detail omitted. GET `report-receipts/{key}` recovers lost response. PUT room-scoped `blocks/{actorId}` requires currently visible nonself actor and returns `resetRequired:true`. Reported means received, never staff contacted/review begun. |

No fabricated report endpoint was added to the baseline API. Moderation module is prepared against the separate writer's concrete source; release integration must include that backend change. Report recovery never automatically resends POST; an unavailable receipt stays unknown. No global user ID, hidden source or author inferred from anonymous messages is used. Ban/operator workflows and blocked-list/unblock screens are outside this message-selection bundle and remain separate integration work.

## Owned modules and mounting contract

Android: `core/messageactions` + `feature/messageactions`; iOS: `Sources/Core/MessageActions` + `Sources/Features/MessageActions`. Shared network/session/RoomDB/navigation/project files are unchanged.

1. After an authorized live message has been committed in the parent's DB, construct `ActionScope` from environment, account UUID, original local session UUID, room UUID, own actor UUID, canonical M/A tokens, and current cache epoch UUID. Construct `ActionSelection` with message ID/version, exact delete/publish hints, kind, anonymous discriminator and **only a visible member author actor ID**. Anonymous selection must have no actor ID. Never select a tombstone or synthesize permission hints.
2. `MessageActionState.select` invalidates previous dialog/read tokens and unclaimed transport permits. Call on every scope/reset/selection/version/hint change, including same-version permission changes. `capture` returns a generation-bearing `ActionViewToken`; callbacks always carry that original token. A→B→A does not resurrect the original dialog.
3. `begin(token, action, emoji?, reportReason?)` durably stores UNKNOWN before a one-use `ActionPermit` is returned. Mount `ActionJournal.records/put` on the existing account DB. `put` must be atomic, durable and bind the record's original environment/account/room/membership; never use the newly current account. On logout remove original account content per existing policy and do not recreate wiped partitions from a late callback. Storage errors must surface; do not replace missing/corrupt storage with an empty successful journal.
4. Mount `MessageActionTransport.execute` on the existing scoped shared HTTP transport. Build requests through `MessageActionWire`; use the **original admitted credential**, check original session/scope again after every suspension, and call `permit.claim()` at final serialized network admission. Swift permits handle selection invalidation; the session gateway must additionally fence its own logout/account epoch. No redirects, transparent mutation retries, token substitution or recursive reauthentication. Socket/cancellation/5xx/malformed responses after possible admission are UNKNOWN. Parse with `MessageActionWire.result` using actual status/body.
5. `MessageActionRunner.execute` finishes in the original journal. Apply effects only through the parent's original scoped transaction. `AccessBlocked` must atomically remove body, author, counterpart, quote references, attachments, reactions and hints, invalidate linked publication caches and sync. `Refresh` fetches authoritative DB projections; never append a raw response as a second message list. `ResetRoom` clears affected cache and resnapshots because block changes authorization revision A and manifest generation. Preserve membership scope M and the original SEND queue scope; do not rewrite old commands. Receipt-local state is not cache/DB erasure proof.
6. After an authoritative DB tombstone, call `MessageActionState.deleted(scope,messageId)` and `MessageReadPosition.deleted(messageId)`; never infer tombstones from 404 or missing pages. Action journal tombstones remove the visible author and hints. On reset call action/read/viewport reset before new scope admission. Parent must validate event scope/version before forwarding.
7. Mount `MessageActionsPanel` with immutable current token/state/reactions and callbacks. `MessageModerationPanel` is separate to support the corresponding backend rollout; pass unavailable/error state from actual integration rather than fabricating success. For its `busy` argument include unresolved/preparing/blocked phases, not just a spinner. Preserve captured token in confirm closures. Network/query errors belong to the parent's existing error/retry presentation.
8. Refresh is GET-only: publication GET with stored receipt ID, reaction aggregate GET, report-receipt GET with the original journal ID, and normal conversation sync. Call `publicationStatus`/`reportStatus` with the token captured before GET. UNKNOWN delete/publication without a receipt stays unresolved; a 404 is not success or proof that retry is safe. Preparing is not published. Unknown reactions never auto-replay or allow an inverse mutation while unresolved.

## Read state and scroll anchoring

`MessageReadPosition` shares the original immutable scope. GET results use its captured read token and are accepted once. After successful GET, report only a newly displayed authorized row; never report restored or queued old rows. `ReadDisplayPermit.claim()` also belongs at final HTTP admission. Finish using the actual PUT receipt; false/unknown/409 drops context and all pending display work. The caller obtains a fresh token/context before any new display reporting. This state is **own display progress**, never a delivery ACK, unread count, internal stream order or sync cursor.

Mount `ScrollAnchorStore.load/save` in the existing account DB, keyed by environment/account/room/membership and authorization revision. Persist only message ID and nonnegative platform scroll offset. Restore only after intersecting with currently authorized committed local rows; hidden/deleted/missing anchors are discarded. Store failures must reach the existing error presentation. Switching accounts must not load another partition's anchor.

`MessageViewport` separates initial/latest following from reading history. Initialize once with a validated restored anchor, otherwise move to latest once. Feed observed visible anchor + whether at latest; older pagination restores that exact anchor/offset. Only newly committed **sync** IDs count as incoming; history IDs do not. While reading history, new messages increase a deduplicated count and never force-jump. An explicit showLatest action clears the count. Parent owns native list measurements, pagination and the incoming-count affordance.

## Meloming reuse audit rows for parent consolidation

Existing audit document is outside this worker's ownership; parent should append these exact rows to `docs/mobile-reuse-audit.md`.

| Source commit/path/symbol | Destination | Reuse and changes |
| --- | --- | --- |
| Android `ecb3dbedb1dde5364bd617f072bc1ac4091b1a17`, `feature/reviews/src/main/java/com/meloming/android/feature/reviews/MyReviewsScreen.kt`, captured `deleteTarget` / `AlertDialog` lines 85–103 | `feature/messageactions/MessageActionsPanel.kt` | Adapted actual target-backed dialog, destructive confirm styling, dismiss-before-dispatch structure. Target now immutable view token; message/delete/publication copy and unknown-state disabling replace review callback. |
| iOS `18a33bbf96fe52b28d0de361916e20549bdcce6b`, `Meloming/Presentation/Reviews/MyReviewsView.swift`, `reviewPendingDelete` / presenting-target `.alert` lines 170–188 | `Sources/Features/MessageActions/MessageActionsPanel.swift` | Adapted presenting-target alert and destructive/cancel flow. Capture original action token inside presenting value; no async callback reads current selection. |
| Same review ViewModel `deleteReview` paths (Android `MyReviewsViewModel.kt`, iOS `MyReviewsView.swift`) | New MessageActionState, wire and journal protocols | Audited; boolean/remove-item review completion semantics cannot represent ambiguous receipt or M/A/session changes. New typed state required; this is not counted as reused state logic. |
| Existing Rogichat `M11Dtos`/`ReadContext`, `StrictAuthJson` | Android MessageReadWire / MessageActionWire | Reused validated read-state contract and duplicate-key parser; added strict field checks and display/anchor state. Swift uses a scoped structural duplicate-key scanner adapted to arrays/numbers. |

No Talk/TalkV2 UX, old identifiers/assets, reference history, signing material, private configuration or credentials were copied. Both reference repositories remained read-only.

## Validation and remaining integration

- Swift standalone executable exercises wire parity, malformed/duplicate response handling, A→B→A stale confirmation, late callback, actor-hop revocation, one-use permit, unknown/inverse mutation prevention, durable journal reconstruction, storage failure, anonymous-safe report/block, read-context conflict and viewport behavior.
- Kotlin bounded runner compiles all owned core source, with exact existing StrictAuthJson/M11 source slices and cached dependencies; JVM compiler heap 512 MiB, test heap 256 MiB. It does not replace the full app/Compose/Room build. Tests use disk-backed isolated fixtures only.
- Disk reconstruction tests validate the feature journal contract, not the parent's Room/GRDB adapter. Actual DB mount, transactional invalidation, platform list integration, full mobile checks, immutable artifact and real account/device API flow belong to the central OS writers. No GUI/simulator/install/full Gradle was run here.
- Moderation source at `42357558d411bd22d9218a3086a51f8abc4d4f06` is not a live deployment claim. Full app integration must include that contract and confirm runtime availability.

### Executed leaf results

- Swift core regression executable: **57 checks passed**, built with `swiftc -strict-concurrency=complete Sources/Core/MessageActions/*.swift Tests/MessageActions/MessageActionChecks.swift` (paths relative to `apps/ios`).
- Swift core + SwiftUI panels: `swiftc -typecheck -strict-concurrency=complete` passed on the host SDK. This does not replace iOS-target/full app validation.
- Kotlin: `python3 apps/android/app/src/test/java/chat/rogi/rogichat/core/messageactions/run_checks.py`: **54 checks passed**, no compiler warnings after making captured tokens opaque classes. The runner uses `GRADLE_USER_HOME` and cached dependencies and performs no installation.
- Security `all`, commit hook and push hook results are recorded in the final handoff; no scanner bypass is permitted.

Additional reference audit: Android `ReviewsNavigation.kt` uses a review-specific route extension and iOS `MyReviewsView` owns review navigation state. No independent navigation was copied because the existing conversation writer owns the message selection mount and route lifecycle. The review generation/page guards informed the audit; new scope/receipt state is explicitly new implementation rather than claimed reuse.

Moderation owner addendum: block/unblock preserves membershipScope M and global account generation, changing only room authorization revision A and manifest generation. Source validation reported by that owner: 385 unit + 11 OpenAPI checks passed; migration 22 and DB integration were still pending. Ban/unban recovery list is a separate owner-only flow, not part of this message panel.
